import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq, and, gte } from "drizzle-orm";
import { computeConversationIntelligence } from "@/modules/conversations/intelligence";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";

// AI Advertising Analyst (spec section 14). Combines ad-platform metrics
// with our own CRM/sales data (never advertising-platform-reported
// conversions alone — section 13) to produce recommendations. Every
// recommendation requires human approval before anything is executed
// (section 15: "DO NOT permit unrestricted autonomous advertising spend
// changes").
export interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversations: number;
  leads: number;
  qualifiedLeads: number;
  sales: number;
  revenue: number;
  cpa: number;
  cpl: number;
  roas: number;
  ctr: number;
}

export async function computeCampaignPerformance(tenantId: string, days = 30): Promise<CampaignPerformance[]> {
  const sinceDate = new Date(Date.now() - days * 24 * 3600 * 1000);
  const since = sinceDate.toISOString().slice(0, 10);
  const campaignsRows = await db.select().from(schema.campaigns).where(eq(schema.campaigns.tenantId, tenantId));

  const results: CampaignPerformance[] = [];
  for (const c of campaignsRows) {
    // Platform-reported metrics (spend/impressions/clicks) come from the ad
    // connector's snapshots. Conversations/leads/qualified-leads/sales/
    // revenue come from OUR CRM + attribution data instead of the ad
    // platform's self-reported conversions (spec section 13).
    const snapshots = await db
      .select()
      .from(schema.adMetricSnapshots)
      .where(and(eq(schema.adMetricSnapshots.campaignId, c.id), gte(schema.adMetricSnapshots.date, since)));

    const spend = snapshots.reduce((s, r) => s + Number(r.spend), 0);
    const impressions = snapshots.reduce((s, r) => s + r.impressions, 0);
    const clicks = snapshots.reduce((s, r) => s + r.clicks, 0);

    const matchingConversations = await db
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.tenantId, tenantId), eq(schema.conversations.utmCampaign, c.name), gte(schema.conversations.createdAt, sinceDate)));
    const conversationIds = new Set(matchingConversations.map((mc) => mc.id));

    const allLeads = await db.select().from(schema.leads).where(eq(schema.leads.tenantId, tenantId));
    const matchingLeads = allLeads.filter((l) => l.conversationId && conversationIds.has(l.conversationId));
    const qualifiedLeads = matchingLeads.filter((l) => ["QUALIFIED", "OPPORTUNITY", "QUOTATION", "WON"].includes(l.stage)).length;

    const attributedTouches = await db
      .select()
      .from(schema.attributionTouches)
      .where(and(eq(schema.attributionTouches.tenantId, tenantId), eq(schema.attributionTouches.touchType, "LAST"), eq(schema.attributionTouches.campaign, c.name)));
    const saleIds = attributedTouches.map((t) => t.saleId).filter((id): id is string => !!id);
    const allSales = saleIds.length ? await db.select().from(schema.sales).where(eq(schema.sales.tenantId, tenantId)) : [];
    const matchingSales = allSales.filter((s) => saleIds.includes(s.id));
    const revenue = matchingSales.reduce((s, r) => s + Number(r.amount), 0);

    const leadsCount = matchingLeads.length;
    const salesCount = matchingSales.length;

    results.push({
      campaignId: c.id,
      campaignName: c.name,
      spend,
      impressions,
      clicks,
      conversations: matchingConversations.length,
      leads: leadsCount,
      qualifiedLeads,
      sales: salesCount,
      revenue,
      cpa: salesCount > 0 ? spend / salesCount : 0,
      cpl: leadsCount > 0 ? spend / leadsCount : 0,
      roas: spend > 0 ? revenue / spend : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    });
  }
  return results;
}

export async function generateAdvertisingRecommendations(tenantId: string) {
  const performance = await computeCampaignPerformance(tenantId, 30);
  const intel = await computeConversationIntelligence(tenantId, 30);
  const created: string[] = [];

  for (const perf of performance) {
    const candidates: { title: string; finding: string; evidence: string; recommendation: string; expectedObjective: string; confidence: "LOW" | "MEDIUM" | "HIGH"; risk: string }[] = [];

    if (perf.roas >= 8 && perf.spend > 0) {
      candidates.push({
        title: "Increase Budget",
        finding: `${perf.campaignName} delivered ${perf.roas.toFixed(1)}x ROAS over the last 30 days.`,
        evidence: `Spend ${perf.spend.toLocaleString()}, Revenue ${perf.revenue.toLocaleString()}, ${perf.sales} sales.`,
        recommendation: "Increase daily budget by 15% to capture more high-intent traffic.",
        expectedObjective: "Grow revenue while maintaining ROAS above 6x",
        confidence: "HIGH",
        risk: "LOW",
      });
    }
    if (perf.roas > 0 && perf.roas < 2 && perf.spend > 0) {
      candidates.push({
        title: "Reduce Budget",
        finding: `${perf.campaignName} is underperforming with ${perf.roas.toFixed(1)}x ROAS.`,
        evidence: `Spend ${perf.spend.toLocaleString()} generated only ${perf.revenue.toLocaleString()} in revenue.`,
        recommendation: "Reduce daily budget by 30% and review targeting before scaling back up.",
        expectedObjective: "Cut wasted spend",
        confidence: "MEDIUM",
        risk: "MEDIUM",
      });
    }
    if (perf.leads > 5 && perf.qualifiedLeads / Math.max(perf.leads, 1) < 0.3) {
      candidates.push({
        title: "Review Targeting",
        finding: `Only ${Math.round((perf.qualifiedLeads / perf.leads) * 100)}% of leads from ${perf.campaignName} qualify.`,
        evidence: `${perf.leads} leads, ${perf.qualifiedLeads} qualified.`,
        recommendation: "Narrow targeting or exclude low-intent audiences to improve lead quality.",
        expectedObjective: "Raise lead qualification rate",
        confidence: "MEDIUM",
        risk: "LOW",
      });
    }

    const topObjection = intel.objectionBreakdown[0];
    if (topObjection && topObjection.count > 2 && topObjection.category === "price") {
      candidates.push({
        title: "Change Offer",
        finding: `${topObjection.pct}% of recent customer objections mention price.`,
        evidence: `${topObjection.count} price-related objections captured across conversations.`,
        recommendation: "Test a payment-plan or discount-led creative variant to address price sensitivity.",
        expectedObjective: "Reduce price-objection drop-off",
        confidence: "MEDIUM",
        risk: "LOW",
      });
    }
    if (topObjection && topObjection.count > 2 && topObjection.category === "warranty") {
      candidates.push({
        title: "Create New Creative",
        finding: `${topObjection.pct}% of buyers ask about warranty.`,
        evidence: `${topObjection.count} warranty-related questions captured.`,
        recommendation: "Test a warranty-led advertising creative.",
        expectedObjective: "Pre-empt the top objection in-ad",
        confidence: "LOW",
        risk: "LOW",
      });
    }

    for (const c of candidates) {
      // Avoid spamming duplicate NEW recommendations for the same campaign+title
      const [existing] = await db
        .select()
        .from(schema.advertisingRecommendations)
        .where(
          and(
            eq(schema.advertisingRecommendations.tenantId, tenantId),
            eq(schema.advertisingRecommendations.campaignId, perf.campaignId),
            eq(schema.advertisingRecommendations.title, c.title),
            eq(schema.advertisingRecommendations.status, "NEW")
          )
        )
        .limit(1);
      if (existing) continue;

      const id = generateId();
      await db.insert(schema.advertisingRecommendations).values({
        id,
        tenantId,
        campaignId: perf.campaignId,
        title: c.title,
        finding: c.finding,
        evidence: c.evidence,
        recommendation: c.recommendation,
        expectedObjective: c.expectedObjective,
        confidence: c.confidence,
        risk: c.risk,
        status: "NEW",
      });
      await dispatchWebhooks(tenantId, "recommendation.created", { recommendationId: id, campaignId: perf.campaignId });
      created.push(id);
    }
  }
  return created;
}
