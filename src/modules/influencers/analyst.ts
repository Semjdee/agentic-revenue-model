import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";
import { computeAllInfluencerMetrics } from "./metrics";
import { computeCommercialScore, computePublicityScore, classifyCreator } from "./scoring";

// ============================================================================
// AI Influencer Analyst (docs/PHASE_2_TASKS.md Milestone 6, spec sections
// 25-31/34). Mirrors generateAdvertisingRecommendations()
// (modules/advertising/analyst.ts) exactly: same duplicate-NEW-guard
// pattern, same "creates NEW recommendation rows for a human to
// approve/reject" shape, same append-only-until-decided lifecycle. Every
// finding/evidence line here quotes a number that came out of
// metrics.ts/scoring.ts — this function explains scores, it never
// invents them.
// ============================================================================

interface Candidate {
  title: string;
  finding: string;
  evidence: string;
  recommendation: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  risk: string;
}

export async function generateInfluencerRecommendations(tenantId: string): Promise<string[]> {
  const allMetrics = await computeAllInfluencerMetrics(tenantId);
  const influencerRows = await db.select().from(schema.influencers).where(eq(schema.influencers.tenantId, tenantId));
  const influencerById = new Map(influencerRows.map((i) => [i.id, i]));
  const created: string[] = [];

  for (const metrics of allMetrics) {
    const influencer = influencerById.get(metrics.influencerId);
    if (!influencer) continue;

    const commercialScore = computeCommercialScore(metrics, allMetrics);
    const publicityScore = computePublicityScore(metrics, allMetrics);
    const classification = classifyCreator(commercialScore, publicityScore, metrics);

    const candidates: Candidate[] = [];

    if (classification === "INSUFFICIENT_DATA") {
      candidates.push({
        title: "Insufficient Data",
        finding: `${influencer.name} has only ${metrics.clicks} tracked clicks and ${metrics.leads} leads so far.`,
        evidence: `Clicks: ${metrics.clicks}, Leads: ${metrics.leads}, Sales: ${metrics.sales}.`,
        recommendation: "Wait for more referral traffic before drawing conclusions — scoring needs a minimum volume of clicks to be meaningful.",
        confidence: "LOW",
        risk: "LOW",
      });
    } else if (classification === "SALES_DRIVER" || classification === "FULL_FUNNEL_PERFORMER") {
      candidates.push({
        title: "Scale",
        finding: `${influencer.name} is driving real revenue — ${metrics.sales} sale(s) worth ${Math.round(metrics.revenue).toLocaleString()} at ${metrics.roas.toFixed(1)}x ROAS.`,
        evidence: `Commercial score ${commercialScore}/100. Cost per sale: ${Math.round(metrics.costPerSale).toLocaleString()}.`,
        recommendation: metrics.cost > 0 ? "Increase content frequency or budget with this creator — commercial performance justifies scaling." : "Consider a paid partnership — this creator is already converting organically.",
        confidence: metrics.sales >= 3 ? "HIGH" : "MEDIUM",
        risk: "LOW",
      });
    }

    if (classification === "PUBLICITY_DRIVER") {
      candidates.push({
        title: "Use For Publicity",
        finding: `${influencer.name} drives strong reach (publicity score ${publicityScore}/100) but hasn't converted to sales yet.`,
        evidence: `${metrics.clicks} clicks, ${metrics.conversationsStarted} conversations started, ${metrics.sales} sales.`,
        recommendation: "Keep for brand awareness campaigns; pair with a stronger sales-focused offer or CTA to test commercial conversion before reallocating budget.",
        confidence: "MEDIUM",
        risk: "LOW",
      });
    }

    if (classification === "ENGAGEMENT_SPECIALIST") {
      candidates.push({
        title: "Change Offer",
        finding: `${influencer.name}'s audience engages well (${Math.round(metrics.clickToConversationRate * 100)}% click-to-conversation rate) but rarely buys.`,
        evidence: `${metrics.conversationsStarted} conversations started, only ${metrics.sales} sale(s), lead-to-sale rate ${Math.round(metrics.leadToSaleRate * 100)}%.`,
        recommendation: "Test a different product, price point, or promotional offer with this creator before concluding the audience isn't a fit.",
        confidence: "MEDIUM",
        risk: "LOW",
      });
    }

    if (classification === "UNDERPERFORMER" && metrics.cost > 0) {
      candidates.push({
        title: "Reduce Allocation",
        finding: `${influencer.name} has generated ${Math.round(metrics.revenue).toLocaleString()} revenue against ${Math.round(metrics.cost).toLocaleString()} cost (ROI ${(metrics.roi * 100).toFixed(0)}%).`,
        evidence: `Commercial score ${commercialScore}/100, publicity score ${publicityScore}/100.`,
        recommendation: metrics.roi < -0.5 ? "Pause future spend with this creator until performance improves." : "Reduce budget allocation and monitor before renewing.",
        confidence: "MEDIUM",
        risk: metrics.roi < -0.5 ? "MEDIUM" : "LOW",
      });
    }

    for (const c of candidates) {
      const [existing] = await db
        .select()
        .from(schema.influencerRecommendations)
        .where(
          and(
            eq(schema.influencerRecommendations.tenantId, tenantId),
            eq(schema.influencerRecommendations.influencerId, influencer.id),
            eq(schema.influencerRecommendations.title, c.title),
            eq(schema.influencerRecommendations.status, "NEW")
          )
        )
        .limit(1);
      if (existing) continue;

      const id = generateId();
      await db.insert(schema.influencerRecommendations).values({
        id,
        tenantId,
        influencerId: influencer.id,
        title: c.title,
        finding: c.finding,
        evidence: c.evidence,
        recommendation: c.recommendation,
        confidence: c.confidence,
        risk: c.risk,
        status: "NEW",
        payload: { commercialScore, publicityScore, classification },
      });
      await dispatchWebhooks(tenantId, "recommendation.created", { recommendationId: id, influencerId: influencer.id });
      created.push(id);
    }
  }

  return created;
}
