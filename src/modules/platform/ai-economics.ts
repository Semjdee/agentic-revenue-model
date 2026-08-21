import { db, schema } from "@/db/client";
import { eq, gte, inArray, sql } from "drizzle-orm";

// ============================================================================
// Deep Platform Admin AI economics (Master Product Architecture Update
// §40-41) — the metrics list the doc asks for beyond what
// /platform/analytics already had (per-agent cost, usage forecast,
// cohort retention). Every number here is computed from real rows —
// agent_runs, credit_ledger, credit_purchase_intents, leads/sales — same
// discipline as the rest of this platform: a metric with no real data
// behind it yet (credits sold, purchase conversion, before any real
// Flutterwave purchase has happened) reports as a real zero, not
// invented.
// ============================================================================

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface AiEconomics {
  costPercentilesUsd: { p50: number; p90: number; p95: number; p99: number; avg: number };
  costPerLeadUsd: number | null;
  costPerQualifiedLeadUsd: number | null;
  costPerSaleUsd: number | null;
  creditsSold: number;
  creditRevenueUsd: number;
  realizedGrossMarginPct: number | null;
  providerFailures: number;
  loopStops: number;
  timeouts: number;
  highCostRuns: { runId: string; tenantName: string; agentName: string; costUsd: number; startedAt: Date }[];
  firstPurchaseConversionPct: number;
  repeatPurchaseRatePct: number;
}

export async function computeAiEconomics(days = 30): Promise<AiEconomics> {
  const since = new Date(Date.now() - days * 86400000);

  const runs = await db.select().from(schema.agentRuns).where(gte(schema.agentRuns.startedAt, since));
  const completedRuns = runs.filter((r) => r.status === "COMPLETED");
  const realCosts = completedRuns.map((r) => Number(r.estimatedCostUsd)).filter((c) => c > 0).sort((a, b) => a - b);
  const avg = realCosts.length ? realCosts.reduce((a, b) => a + b, 0) / realCosts.length : 0;

  const providerFailures = runs.filter((r) => r.status === "FAILED").length;
  const loopStops = runs.filter((r) => r.status === "STOPPED_LOOP" || r.status === "STOPPED_LIMIT").length;
  const timeouts = runs.filter((r) => r.status === "TIMED_OUT").length;

  // Top individual runs by cost — a real drill-down, not just an
  // aggregate, so a platform admin can actually go look at what an
  // outlier run was.
  const topRuns = [...completedRuns].sort((a, b) => Number(b.estimatedCostUsd) - Number(a.estimatedCostUsd)).slice(0, 10);
  const highCostAgentIds = [...new Set(topRuns.map((r) => r.agentId).filter((id): id is string => !!id))];
  const highCostTenantIds = [...new Set(topRuns.map((r) => r.tenantId))];
  const [agentRows, tenantRows] = await Promise.all([
    highCostAgentIds.length ? db.select().from(schema.agents).where(inArray(schema.agents.id, highCostAgentIds)) : Promise.resolve([]),
    highCostTenantIds.length ? db.select().from(schema.tenants).where(inArray(schema.tenants.id, highCostTenantIds)) : Promise.resolve([]),
  ]);
  const agentNameById = new Map(agentRows.map((a) => [a.id, a.name]));
  const tenantNameById = new Map(tenantRows.map((t) => [t.id, t.name]));
  const highCostRuns = topRuns.map((r) => ({
    runId: r.id,
    tenantName: tenantNameById.get(r.tenantId) ?? "Unknown tenant",
    agentName: r.agentId ? agentNameById.get(r.agentId) ?? "Deleted agent" : "Unassigned",
    costUsd: Number(r.estimatedCostUsd),
    startedAt: r.startedAt,
  }));

  // Cost per lead / qualified lead / sale — same join pattern
  // computeCampaignPerformance() (modules/advertising/analyst.ts) already
  // uses for its own cost-per-X metrics, applied platform-wide instead of
  // per-campaign: total real AI cost against total leads/qualified-leads/
  // sales in the same window.
  const totalAiCostUsd = realCosts.reduce((a, b) => a + b, 0);
  const [leadsInWindow, salesInWindow] = await Promise.all([
    db.select().from(schema.leads).where(gte(schema.leads.createdAt, since)),
    db.select().from(schema.sales).where(gte(schema.sales.createdAt, since)),
  ]);
  const qualifiedLeadsInWindow = leadsInWindow.filter((l) => ["QUALIFIED", "OPPORTUNITY", "QUOTATION", "WON"].includes(l.stage));

  // Credits sold / revenue / realized margin — real Flutterwave
  // purchases only (credit_purchase_intents.status = SUCCEEDED); reports
  // an honest 0 until the first real purchase happens, same as this
  // platform's other untracked-until-real-data metrics (see
  // /api/platform/dashboard's mrrUsd).
  const succeededPurchases = await db.select().from(schema.creditPurchaseIntents).where(eq(schema.creditPurchaseIntents.status, "SUCCEEDED"));
  const creditsSold = succeededPurchases.reduce((s, p) => s + p.credits, 0);
  const creditRevenueUsd = succeededPurchases.reduce((s, p) => s + Number(p.priceUsd), 0);
  // Realized margin against ALL real AI cost incurred (all-time, not just
  // this window) — deliberately not the per-transaction TARGET_GROSS_MARGIN
  // constant from pricing.ts; this is what actually happened, including
  // AI cost spent serving free-tier usage that generated no revenue at
  // all, which will honestly understate margin until top-ups are common.
  const allTimeRealRuns = await db.select({ costUsd: schema.agentRuns.estimatedCostUsd }).from(schema.agentRuns).where(eq(schema.agentRuns.status, "COMPLETED"));
  const allTimeAiCostUsd = allTimeRealRuns.reduce((s, r) => s + Number(r.costUsd), 0);
  const realizedGrossMarginPct = creditRevenueUsd > 0 ? ((creditRevenueUsd - allTimeAiCostUsd) / creditRevenueUsd) * 100 : null;

  const purchasingTenants = new Set(succeededPurchases.map((p) => p.tenantId));
  const purchaseCountByTenant = new Map<string, number>();
  for (const p of succeededPurchases) purchaseCountByTenant.set(p.tenantId, (purchaseCountByTenant.get(p.tenantId) ?? 0) + 1);
  const repeatPurchasers = [...purchaseCountByTenant.values()].filter((n) => n >= 2).length;
  const [totalTenants] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.tenants);

  return {
    costPercentilesUsd: { p50: percentile(realCosts, 50), p90: percentile(realCosts, 90), p95: percentile(realCosts, 95), p99: percentile(realCosts, 99), avg },
    costPerLeadUsd: leadsInWindow.length > 0 ? totalAiCostUsd / leadsInWindow.length : null,
    costPerQualifiedLeadUsd: qualifiedLeadsInWindow.length > 0 ? totalAiCostUsd / qualifiedLeadsInWindow.length : null,
    costPerSaleUsd: salesInWindow.length > 0 ? totalAiCostUsd / salesInWindow.length : null,
    creditsSold,
    creditRevenueUsd,
    realizedGrossMarginPct,
    providerFailures,
    loopStops,
    timeouts,
    highCostRuns,
    firstPurchaseConversionPct: totalTenants.n > 0 ? (purchasingTenants.size / totalTenants.n) * 100 : 0,
    repeatPurchaseRatePct: purchasingTenants.size > 0 ? (repeatPurchasers / purchasingTenants.size) * 100 : 0,
  };
}
