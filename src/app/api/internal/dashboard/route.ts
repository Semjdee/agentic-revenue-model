import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { countOverdueFollowUps } from "@/modules/followups/service";
import { computeCampaignPerformance } from "@/modules/advertising/analyst";
import { percentChange } from "@/lib/format";
import { generateRevenueBrief } from "@/modules/dashboard/brief";

// UI/UX Modernization doc §11 "Fix analytics consistency" — every metric
// on this page that claims to describe "the selected period" now shares
// the exact same [from, to] window; nothing here silently falls back to
// an all-time count next to a range-scoped one. The two genuine
// exceptions (documented at each site below) are Needs Attention and
// Open/Weighted Pipeline, which are deliberately point-in-time snapshots
// ("what's true right now"), not period-created counts — a different,
// clearly-labelled kind of number, not an inconsistency.

// Doc's own default "good ROAS" bar (already used by the dashboard's
// existing KpiCard tone logic before this change) — no per-campaign
// target-ROAS concept exists in this schema yet, so this is the
// platform-wide stand-in "underperforming" threshold until a real
// per-campaign target is added.
const UNDERPERFORMING_ROAS_THRESHOLD = 3;

// AI-proposed defaults for weighted pipeline (not a business decision
// confirmed with a product owner — same status as reserve-policy.ts's
// thresholds). Revisit once real win-rate data exists per stage.
const STAGE_WIN_PROBABILITY: Record<string, number> = {
  NEW: 0.05,
  CONTACTED: 0.1,
  QUALIFIED: 0.25,
  OPPORTUNITY: 0.4,
  QUOTATION: 0.65,
  WON: 1,
  LOST: 0,
};

function rangeFromQuery(req: NextRequest): { from: Date; to: Date } {
  const range = req.nextUrl.searchParams.get("range") || "7d";
  const now = new Date();
  const to = now;
  if (range === "today") return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to };
  if (range === "yesterday") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: start, to: end };
  }
  if (range === "30d") return { from: new Date(now.getTime() - 30 * 86400000), to };
  if (range === "custom") {
    const from = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    return { from: from ? new Date(from) : new Date(now.getTime() - 7 * 86400000), to: toParam ? new Date(toParam) : to };
  }
  return { from: new Date(now.getTime() - 7 * 86400000), to };
}

/** Same-length window immediately before [from, to) — the "previous
 * equivalent period" every trend indicator compares against (doc §7). */
function previousRange(from: Date, to: Date): { from: Date; to: Date } {
  const durationMs = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - durationMs), to: from };
}

async function countConversations(tenantId: string, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), gte(schema.conversations.createdAt, from), lte(schema.conversations.createdAt, to)));
  return Number(row.n);
}

async function countQualifiedLeads(tenantId: string, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(eq(schema.leads.tenantId, tenantId), sql`${schema.leads.stage} in ('QUALIFIED','OPPORTUNITY','QUOTATION','WON')`, gte(schema.leads.createdAt, from), lte(schema.leads.createdAt, to)));
  return Number(row.n);
}

async function sumRevenueAndAdSpend(tenantId: string, from: Date, to: Date) {
  const salesRows = await db.select().from(schema.sales).where(and(eq(schema.sales.tenantId, tenantId), gte(schema.sales.closedAt, from), lte(schema.sales.closedAt, to)));
  const revenue = salesRows.reduce((s, r) => s + Number(r.amount), 0);
  const adSnapshots = await db
    .select()
    .from(schema.adMetricSnapshots)
    .where(and(eq(schema.adMetricSnapshots.tenantId, tenantId), gte(schema.adMetricSnapshots.date, from.toISOString().slice(0, 10)), lte(schema.adMetricSnapshots.date, to.toISOString().slice(0, 10))));
  const adSpend = adSnapshots.reduce((s, r) => s + Number(r.spend), 0);
  return { salesCount: salesRows.length, revenue, adSpend };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const { from, to } = rangeFromQuery(req);
  const prev = previousRange(from, to);
  const tenantId = session.tenantId;

  const [conversations, prevConversations, qualifiedLeads, prevQualifiedLeads, { salesCount, revenue, adSpend }, prevTotals] = await Promise.all([
    countConversations(tenantId, from, to),
    countConversations(tenantId, prev.from, prev.to),
    countQualifiedLeads(tenantId, from, to),
    countQualifiedLeads(tenantId, prev.from, prev.to),
    sumRevenueAndAdSpend(tenantId, from, to),
    sumRevenueAndAdSpend(tenantId, prev.from, prev.to),
  ]);

  const salesRows = await db.select().from(schema.sales).where(and(eq(schema.sales.tenantId, tenantId), gte(schema.sales.closedAt, from), lte(schema.sales.closedAt, to)));
  const revenueByDay = new Map<string, number>();
  for (const s of salesRows) {
    const day = s.closedAt.toISOString().slice(0, 10);
    revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + Number(s.amount));
  }
  const revenueSeries = Array.from(revenueByDay.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const [{ aiHandled }] = await db
    .select({ aiHandled: sql<number>`count(*) filter (where ${schema.conversations.aiActive} = true)` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), gte(schema.conversations.createdAt, from), lte(schema.conversations.createdAt, to)));
  const [{ humanHandled }] = await db
    .select({ humanHandled: sql<number>`count(*) filter (where ${schema.conversations.aiActive} = false)` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), gte(schema.conversations.createdAt, from), lte(schema.conversations.createdAt, to)));

  const roas = adSpend > 0 ? revenue / adSpend : 0;
  const prevRoas = prevTotals.adSpend > 0 ? prevTotals.revenue / prevTotals.adSpend : 0;
  const cpl = qualifiedLeads > 0 ? adSpend / qualifiedLeads : 0;
  const cps = salesCount > 0 ? adSpend / salesCount : 0;

  // --- Lead funnel (doc §12) — date-scoped to the SAME [from,to] window
  // as everything above, and its top row IS the "Conversations" number
  // above (not a separately-queried, potentially-divergent count) — the
  // exact class of bug doc §11 calls out. Percentages are relative to
  // that top row, matching the doc's own worked example (72/120=60%).
  const leadsInRange = await db
    .select({ stage: schema.leads.stage })
    .from(schema.leads)
    .where(and(eq(schema.leads.tenantId, tenantId), gte(schema.leads.createdAt, from), lte(schema.leads.createdAt, to)));
  const countAtOrBeyond = (stages: string[]) => leadsInRange.filter((l) => stages.includes(l.stage)).length;
  const funnelStages = [
    { key: "CONVERSATIONS", label: "Conversations", count: conversations },
    { key: "QUALIFIED", label: "Qualified", count: countAtOrBeyond(["QUALIFIED", "OPPORTUNITY", "QUOTATION", "WON"]) },
    { key: "OPPORTUNITY", label: "Opportunity", count: countAtOrBeyond(["OPPORTUNITY", "QUOTATION", "WON"]) },
    { key: "QUOTATION", label: "Quotation", count: countAtOrBeyond(["QUOTATION", "WON"]) },
    { key: "WON", label: "Won", count: countAtOrBeyond(["WON"]) },
  ].map((s) => ({ ...s, pctOfTop: conversations > 0 ? (s.count / conversations) * 100 : null }));
  const conversationToSaleConversionPct = conversations > 0 ? (salesCount / conversations) * 100 : null;

  // --- Channel & traffic-source performance (doc §17-18) — now
  // date-scoped (same window) and enriched with qualified/sales/revenue/
  // conversion, not just a raw conversation count. In-memory join, same
  // idiom used elsewhere in this codebase (e.g. platform/ai-economics.ts)
  // rather than a multi-table SQL join.
  const convRows = await db
    .select({ id: schema.conversations.id, channel: schema.conversations.channel, utmSource: schema.conversations.utmSource })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), gte(schema.conversations.createdAt, from), lte(schema.conversations.createdAt, to)));
  const channelByConvId = new Map(convRows.map((c) => [c.id, c.channel]));
  const sourceByConvId = new Map(convRows.map((c) => [c.id, c.utmSource ?? "Direct"]));

  const leadsWithConv = await db
    .select({ conversationId: schema.leads.conversationId, stage: schema.leads.stage })
    .from(schema.leads)
    .where(and(eq(schema.leads.tenantId, tenantId), gte(schema.leads.createdAt, from), lte(schema.leads.createdAt, to)));

  const oppsWithConv = await db
    .select({ id: schema.opportunities.id, firstConversationId: schema.opportunities.firstConversationId })
    .from(schema.opportunities)
    .where(eq(schema.opportunities.tenantId, tenantId));
  const convIdByOppId = new Map(oppsWithConv.map((o) => [o.id, o.firstConversationId]));

  interface Enriched {
    conversations: number;
    qualified: number;
    sales: number;
    revenue: number;
  }
  function enrichBy(keyFn: (convId: string | null) => string): Map<string, Enriched> {
    const byKey = new Map<string, Enriched>();
    const get = (key: string) => byKey.get(key) ?? { conversations: 0, qualified: 0, sales: 0, revenue: 0 };
    for (const c of convRows) {
      const key = keyFn(c.id);
      const entry = get(key);
      entry.conversations += 1;
      byKey.set(key, entry);
    }
    for (const l of leadsWithConv) {
      if (!l.conversationId || !channelByConvId.has(l.conversationId)) continue;
      if (!["QUALIFIED", "OPPORTUNITY", "QUOTATION", "WON"].includes(l.stage)) continue;
      const key = keyFn(l.conversationId);
      const entry = get(key);
      entry.qualified += 1;
      byKey.set(key, entry);
    }
    for (const s of salesRows) {
      const convId = convIdByOppId.get(s.opportunityId) ?? null;
      if (!convId || !channelByConvId.has(convId)) continue;
      const key = keyFn(convId);
      const entry = get(key);
      entry.sales += 1;
      entry.revenue += Number(s.amount);
      byKey.set(key, entry);
    }
    return byKey;
  }

  const byChannel = enrichBy((convId) => (convId ? (channelByConvId.get(convId) ?? "Unknown") : "Unknown"));
  const bySource = enrichBy((convId) => (convId ? (sourceByConvId.get(convId) ?? "Direct") : "Direct"));

  const channelPerformance = Array.from(byChannel.entries())
    .map(([channel, v]) => ({ channel, ...v, conversionPct: v.conversations > 0 ? (v.sales / v.conversations) * 100 : null }))
    .sort((a, b) => b.revenue - a.revenue);
  const trafficSourcePerformance = Array.from(bySource.entries())
    .map(([source, v]) => ({ source, ...v, conversionPct: v.conversations > 0 ? (v.sales / v.conversations) * 100 : null }))
    .sort((a, b) => b.revenue - a.revenue);

  // --- Pipeline value (doc §19) — deliberately a live snapshot ("as of
  // now"), not scoped to the selected date range: "how much is currently
  // in the pipeline" doesn't mean "how much entered the pipeline in the
  // last 7 days." wonRevenue reuses the exact same `revenue` figure as
  // the primary Revenue KPI above (same definition, not a second
  // differently-scoped "revenue" number on the same page).
  const openOpportunities = await db
    .select({ estimatedValue: schema.opportunities.estimatedValue, stage: schema.opportunities.stage })
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.tenantId, tenantId), sql`${schema.opportunities.stage} not in ('WON','LOST')`));
  const openPipelineValue = openOpportunities.reduce((s, o) => s + Number(o.estimatedValue ?? 0), 0);
  const weightedPipelineValue = openOpportunities.reduce((s, o) => s + Number(o.estimatedValue ?? 0) * (STAGE_WIN_PROBABILITY[o.stage] ?? 0), 0);

  // --- Needs Attention (doc §9) — a point-in-time snapshot, same
  // reasoning as Pipeline Value above: "what needs my attention right
  // now" isn't scoped to whichever date range happens to be selected.
  const now = new Date();
  const overdueFollowUpsCount = await countOverdueFollowUps(tenantId, now);
  const hotLeads = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.tenantId, tenantId), sql`${schema.leads.score} >= 60`, eq(schema.leads.stage, "QUALIFIED")));
  const pendingRecommendations = await db
    .select()
    .from(schema.advertisingRecommendations)
    .where(and(eq(schema.advertisingRecommendations.tenantId, tenantId), eq(schema.advertisingRecommendations.status, "NEW")));
  const failedWebhooks = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(and(eq(schema.webhookDeliveries.tenantId, tenantId), eq(schema.webhookDeliveries.status, "FAILED")));
  const quotationOpportunities = await db
    .select({ estimatedValue: schema.opportunities.estimatedValue })
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.tenantId, tenantId), eq(schema.opportunities.stage, "QUOTATION")));
  const quotationsPendingValue = quotationOpportunities.reduce((s, o) => s + Number(o.estimatedValue ?? 0), 0);

  // Deliberately a fixed 30-day lookback via computeCampaignPerformance(),
  // not the dashboard's own selected [from,to] range — same "point-in-time
  // state" reasoning as Needs Attention/Pipeline above: a campaign's ROAS
  // needs a real trailing window to be meaningful, so "is this campaign
  // currently underperforming" doesn't reduce to "in the last hour."
  const campaignPerformance = await computeCampaignPerformance(tenantId, 30);
  const underperformingCampaigns = campaignPerformance.filter((c) => c.spend > 0 && c.roas < UNDERPERFORMING_ROAS_THRESHOLD);

  // --- AI Revenue Brief (doc §8) — deterministic, built entirely from
  // the real numbers computed above; see modules/dashboard/brief.ts for
  // why this isn't a live LLM call.
  const qualifiedByChannel = Array.from(byChannel.entries()).map(([channel, v]) => ({ channel, qualified: v.qualified }));
  const topQualifiedChannel = qualifiedByChannel.length ? qualifiedByChannel.sort((a, b) => b.qualified - a.qualified)[0] : null;
  const conversionByChannel = Array.from(byChannel.entries())
    .filter(([, v]) => v.conversations > 0)
    .map(([channel, v]) => ({ channel, conversionPct: (v.sales / v.conversations) * 100 }));
  const topConversionChannel = conversionByChannel.length ? conversionByChannel.sort((a, b) => b.conversionPct - a.conversionPct)[0] : null;

  const aiRevenueBrief = generateRevenueBrief({
    currency: "UGX",
    revenue,
    revenueTrendPct: percentChange(revenue, prevTotals.revenue),
    topQualifiedChannel: topQualifiedChannel && topQualifiedChannel.qualified > 0 ? topQualifiedChannel : null,
    topConversionChannel: topConversionChannel && topConversionChannel.conversionPct > 0 ? topConversionChannel : null,
    quotationsPendingCount: quotationOpportunities.length,
    quotationsPendingValue,
    underperformingCampaigns: underperformingCampaigns.length,
  });

  return jsonOk({
    range: { from, to },
    revenueSeries,
    kpis: {
      revenue,
      revenueTrendPct: percentChange(revenue, prevTotals.revenue),
      openPipelineValue,
      openOpportunityCount: openOpportunities.length,
      weightedPipelineValue,
      sales: salesCount,
      salesTrendPct: percentChange(salesCount, prevTotals.salesCount),
      qualifiedLeads,
      qualifiedLeadsTrendPct: percentChange(qualifiedLeads, prevQualifiedLeads),
      conversations,
      conversationsTrendPct: percentChange(conversations, prevConversations),
      advertisingSpend: adSpend,
      advertisingSpendTrendPct: percentChange(adSpend, prevTotals.adSpend),
      costPerLead: cpl,
      costPerSale: cps,
      roas,
      roasTrendPct: percentChange(roas, prevRoas),
      aiHandled: Number(aiHandled),
      humanHandled: Number(humanHandled),
    },
    funnel: { stages: funnelStages, conversationToSaleConversionPct },
    channelPerformance,
    trafficSourcePerformance,
    needsAttention: {
      hotLeads: hotLeads.length,
      overdueFollowUps: overdueFollowUpsCount,
      quotationsPendingCount: quotationOpportunities.length,
      quotationsPendingValue,
      underperformingCampaigns: underperformingCampaigns.length,
      pendingRecommendations: pendingRecommendations.length,
      failedWebhooks: failedWebhooks.length,
    },
    aiRevenueBrief,
  });
}
