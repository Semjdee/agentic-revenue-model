import { db, schema } from "@/db/client";
import { and, eq, gte, inArray } from "drizzle-orm";
import { requirePlatformSession } from "@/lib/platform-auth";
import { jsonError, jsonOk } from "@/lib/api";
import { computeCohortRetention } from "@/modules/platform/cohorts";
import { computePlatformTenantForecastSummary } from "@/modules/billing/forecast";
import { approxCreditsFromCost } from "@/modules/billing/pricing";

// Deep platform-admin analytics, deliberately a separate route/page from
// the basic KPI dashboard (/api/platform/dashboard) rather than folded
// into it — these queries are heavier (cross-tenant aggregation, a 7-day
// consumption scan) and answer a different question: not "how is the
// platform doing right now" but "which agents cost the most, which
// tenants are trending over their budget, and how well do we retain
// tenants over time."
export async function GET() {
  try {
    await requirePlatformSession();
  } catch {
    return jsonError("Not authenticated", 401);
  }

  const since30 = new Date(Date.now() - 30 * 86400000);

  // Cross-tenant per-agent cost leaderboard — real agent_runs cost data,
  // joined to both the agent and its tenant for display. Same
  // "estimatedCostUsd is actually the real post-call cost" data source as
  // the per-tenant breakdown in modules/billing/forecast.ts.
  const runs = await db
    .select({
      agentId: schema.agentRuns.agentId,
      tenantId: schema.agentRuns.tenantId,
      costUsd: schema.agentRuns.estimatedCostUsd,
      inputTokens: schema.agentRuns.inputTokens,
      outputTokens: schema.agentRuns.outputTokens,
    })
    .from(schema.agentRuns)
    .where(and(gte(schema.agentRuns.startedAt, since30), eq(schema.agentRuns.status, "COMPLETED")));

  const agentIds = [...new Set(runs.map((r) => r.agentId).filter((id): id is string => !!id))];
  const tenantIds = [...new Set(runs.map((r) => r.tenantId))];
  const agentRows = agentIds.length ? await db.select().from(schema.agents).where(inArray(schema.agents.id, agentIds)) : [];
  const tenantRows = tenantIds.length ? await db.select().from(schema.tenants).where(inArray(schema.tenants.id, tenantIds)) : [];
  const agentNameById = new Map(agentRows.map((a) => [a.id, a.name]));
  const tenantNameById = new Map(tenantRows.map((t) => [t.id, t.name]));

  const byAgent = new Map<string, { agentId: string | null; agentName: string; tenantId: string; tenantName: string; runs: number; inputTokens: number; outputTokens: number; totalCostUsd: number }>();
  for (const r of runs) {
    const key = `${r.tenantId}:${r.agentId ?? "unassigned"}`;
    const entry = byAgent.get(key) ?? {
      agentId: r.agentId,
      agentName: r.agentId ? agentNameById.get(r.agentId) ?? "Deleted agent" : "Unassigned",
      tenantId: r.tenantId,
      tenantName: tenantNameById.get(r.tenantId) ?? "Unknown tenant",
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCostUsd: 0,
    };
    entry.runs += 1;
    entry.inputTokens += r.inputTokens;
    entry.outputTokens += r.outputTokens;
    entry.totalCostUsd += Number(r.costUsd);
    byAgent.set(key, entry);
  }
  const topAgentsByCost = Array.from(byAgent.values())
    .map((e) => ({ ...e, approxCredits: approxCreditsFromCost(e.totalCostUsd) }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
    .slice(0, 25);

  const [cohorts, forecastSummary, tenantRowsForNames] = await Promise.all([computeCohortRetention(), computePlatformTenantForecastSummary(), db.select().from(schema.tenants)]);
  const nameByTenantId = new Map(tenantRowsForNames.map((t) => [t.id, t.name]));
  const tenantForecasts = forecastSummary
    .map((f) => ({ ...f, tenantName: nameByTenantId.get(f.tenantId) ?? "Unknown tenant" }))
    .sort((a, b) => b.projectedMonthlyCredits - a.projectedMonthlyCredits);

  return jsonOk({ topAgentsByCost, cohorts, tenantForecasts });
}
