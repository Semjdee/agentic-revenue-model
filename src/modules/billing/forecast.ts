import { db, schema } from "@/db/client";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { approxCreditsFromCost } from "./pricing";
import { resolveMonthlyAllotment, RESERVE_PCT, checkCreditsForTrigger } from "./reserve-policy";

// ============================================================================
// Usage forecasting & per-agent cost breakdown — "special AI notes" (see
// BUILD_NOTES.md). Answers two concrete questions with real historical
// data, never a guess dressed up as a number:
//
//   1. "How much will this tenant use for daily/recurring tasks?" —
//      predictTenantUsage() projects forward from real trailing-window
//      consumption, broken down by trigger type and by individual agent.
//   2. "Which of a tenant's AI agents is actually costing the money?" —
//      computeAgentCostBreakdown() aggregates real per-run cost
//      (agent_runs.estimatedCostUsd, which despite the column name is
//      the REAL post-call cost — see execution-gateway.ts) by agentId.
//
// Both feed the tenant's own Settings → Credits & Usage page and the
// platform-admin dashboard's per-tenant/per-agent views.
// ============================================================================

export interface AgentCostBreakdownRow {
  agentId: string | null;
  agentName: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  /** Aggregate credits this agent's runs represent, for display alongside
   * the credit-denominated UI elsewhere. Derived from the summed real
   * cost via approxCreditsFromCost() (0 for genuinely $0 runs — e.g. a
   * tenant still on MockAIProvider, which never calls chargeUsage() at
   * all), not summed per-call rounded charges — see chargeUsage() in
   * ledger.ts for why those two numbers don't sum identically anyway
   * (per-call minimum-1-credit rounding on REAL charges). Labelled
   * "approx" wherever shown. */
  approxCredits: number;
  avgCostPerRunUsd: number;
}

export async function computeAgentCostBreakdown(tenantId: string, days = 30): Promise<AgentCostBreakdownRow[]> {
  const since = new Date(Date.now() - days * 86400000);
  const runs = await db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.tenantId, tenantId), gte(schema.agentRuns.startedAt, since), eq(schema.agentRuns.status, "COMPLETED")));

  const agentIds = [...new Set(runs.map((r) => r.agentId).filter((id): id is string => !!id))];
  const agentRows = agentIds.length ? await db.select().from(schema.agents).where(inArray(schema.agents.id, agentIds)) : [];
  const nameById = new Map(agentRows.map((a) => [a.id, a.name]));

  const byAgent = new Map<string, { agentId: string | null; agentName: string; runs: number; inputTokens: number; outputTokens: number; totalCostUsd: number }>();
  for (const r of runs) {
    const key = r.agentId ?? "unassigned";
    const entry = byAgent.get(key) ?? { agentId: r.agentId, agentName: r.agentId ? nameById.get(r.agentId) ?? "Deleted agent" : "Unassigned", runs: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
    entry.runs += 1;
    entry.inputTokens += r.inputTokens;
    entry.outputTokens += r.outputTokens;
    entry.totalCostUsd += Number(r.estimatedCostUsd);
    byAgent.set(key, entry);
  }

  return Array.from(byAgent.values())
    .map((e) => ({ ...e, approxCredits: approxCreditsFromCost(e.totalCostUsd), avgCostPerRunUsd: e.runs > 0 ? e.totalCostUsd / e.runs : 0 }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

export interface TenantUsageForecast {
  currentBalance: number;
  monthlyAllotment: number;
  reserveThreshold: number;
  avgDailyCredits7d: number;
  avgDailyCredits30d: number;
  /** Whichever window has enough history to trust — 30d once available, else 7d, else null if the tenant is too new to project. */
  projectedMonthlyCredits: number | null;
  daysOfRunway: number | null;
  byTriggerType: { triggerType: string; credits: number; runs: number }[];
  byAgent: AgentCostBreakdownRow[];
  reserveStatus: Awaited<ReturnType<typeof checkCreditsForTrigger>>;
}

async function avgDailyConsumption(tenantId: string, days: number): Promise<{ avg: number; daysWithData: number }> {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await db
    .select({
      day: sql<string>`date_trunc('day', ${schema.creditLedger.createdAt})`,
      credits: sql<number>`coalesce(sum(-${schema.creditLedger.credits}), 0)::int`,
    })
    .from(schema.creditLedger)
    .where(and(eq(schema.creditLedger.tenantId, tenantId), eq(schema.creditLedger.type, "CONSUMPTION"), gte(schema.creditLedger.createdAt, since)))
    .groupBy(sql`date_trunc('day', ${schema.creditLedger.createdAt})`);

  const total = rows.reduce((s, r) => s + r.credits, 0);
  const daysWithData = rows.length;
  // Average over the actual number of days elapsed, not just days with
  // usage — a quiet Sunday is a real zero, not a missing data point.
  const elapsedDays = Math.max(1, Math.min(days, Math.ceil((Date.now() - since.getTime()) / 86400000)));
  return { avg: total / elapsedDays, daysWithData };
}

export interface PlatformTenantForecastRow {
  tenantId: string;
  avgDailyCredits7d: number;
  projectedMonthlyCredits: number;
  monthlyAllotment: number;
  overAllotment: boolean;
}

/**
 * Platform-admin cross-tenant version of the projection above — one
 * grouped query across every tenant's last 7 days of consumption rather
 * than N calls to predictTenantUsage() (which does several sub-queries
 * each). Deliberately a 7-day window only, for a lighter, faster
 * dashboard-wide query; a platform admin drilling into one specific
 * tenant gets the fuller 30-day-aware predictTenantUsage() instead.
 */
export async function computePlatformTenantForecastSummary(): Promise<PlatformTenantForecastRow[]> {
  const since = new Date(Date.now() - 7 * 86400000);
  const rows = await db
    .select({
      tenantId: schema.creditLedger.tenantId,
      credits: sql<number>`coalesce(sum(-${schema.creditLedger.credits}), 0)::int`,
    })
    .from(schema.creditLedger)
    .where(and(eq(schema.creditLedger.type, "CONSUMPTION"), gte(schema.creditLedger.createdAt, since)))
    .groupBy(schema.creditLedger.tenantId);

  const balances = await db.select().from(schema.creditBalances);
  const balanceByTenant = new Map(balances.map((b) => [b.tenantId, b]));

  return rows.map((r) => {
    const balanceRow = balanceByTenant.get(r.tenantId);
    const monthlyAllotment = resolveMonthlyAllotment(balanceRow ?? { plan: "FREE", monthlyAllotment: null });
    const avgDaily = r.credits / 7;
    const projectedMonthlyCredits = Math.round(avgDaily * 30);
    return { tenantId: r.tenantId, avgDailyCredits7d: Math.round(avgDaily), projectedMonthlyCredits, monthlyAllotment, overAllotment: projectedMonthlyCredits > monthlyAllotment };
  });
}

export async function predictTenantUsage(tenantId: string): Promise<TenantUsageForecast> {
  const [balanceRow] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.tenantId, tenantId)).limit(1);
  const currentBalance = balanceRow?.balance ?? 0;
  const monthlyAllotment = resolveMonthlyAllotment(balanceRow ?? { plan: "FREE", monthlyAllotment: null });
  const reserveThreshold = Math.round(monthlyAllotment * RESERVE_PCT);

  const [d7, d30] = await Promise.all([avgDailyConsumption(tenantId, 7), avgDailyConsumption(tenantId, 30)]);

  // Prefer the 30-day window once there's at least two weeks of real
  // history behind it (smooths out a single unusually busy/quiet week);
  // otherwise fall back to the 7-day window; a tenant with under 2 days
  // of any usage yet gets an honest "not enough data" rather than a
  // number extrapolated from one or two data points.
  let projectedMonthlyCredits: number | null = null;
  if (d30.daysWithData >= 14) projectedMonthlyCredits = Math.round(d30.avg * 30);
  else if (d7.daysWithData >= 2) projectedMonthlyCredits = Math.round(d7.avg * 30);

  const effectiveDaily = d30.daysWithData >= 14 ? d30.avg : d7.avg;
  const daysOfRunway = effectiveDaily > 0 ? Math.floor(currentBalance / effectiveDaily) : null;

  const since30 = new Date(Date.now() - 30 * 86400000);
  const runs = await db.select().from(schema.agentRuns).where(and(eq(schema.agentRuns.tenantId, tenantId), gte(schema.agentRuns.startedAt, since30), eq(schema.agentRuns.status, "COMPLETED")));
  const byTrigger = new Map<string, { credits: number; runs: number }>();
  for (const r of runs) {
    const entry = byTrigger.get(r.triggerType) ?? { credits: 0, runs: 0 };
    entry.credits += approxCreditsFromCost(Number(r.estimatedCostUsd));
    entry.runs += 1;
    byTrigger.set(r.triggerType, entry);
  }

  const [byAgent, reserveStatus] = await Promise.all([computeAgentCostBreakdown(tenantId, 30), checkCreditsForTrigger(tenantId, "SANDBOX_TEST")]);

  return {
    currentBalance,
    monthlyAllotment,
    reserveThreshold,
    avgDailyCredits7d: Math.round(d7.avg),
    avgDailyCredits30d: Math.round(d30.avg),
    projectedMonthlyCredits,
    daysOfRunway,
    byTriggerType: Array.from(byTrigger.entries()).map(([triggerType, v]) => ({ triggerType, ...v })),
    byAgent,
    reserveStatus,
  };
}
