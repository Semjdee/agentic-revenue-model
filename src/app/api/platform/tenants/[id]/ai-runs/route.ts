import { db, schema } from "@/db/client";
import { eq, desc, sql } from "drizzle-orm";
import { requirePlatformSession } from "@/lib/platform-auth";
import { jsonError, jsonOk } from "@/lib/api";

// The raw agent_runs detail (model, tokens, $ cost, stop reason) this
// used to live at /api/internal/ai/runs, reachable by any tenant session
// — moved here per Master Product Architecture Update §29-31: tenants
// never see raw provider/token/cost internals; that data still exists in
// full for Platform Staff. Tenant-facing equivalent is now
// /api/internal/billing/ai-activity, translated into business-readable
// language with no internals.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePlatformSession();
  } catch {
    return jsonError("Not authenticated", 401);
  }

  const recent = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.tenantId, params.id)).orderBy(desc(schema.agentRuns.startedAt)).limit(100);

  const [stats] = await db
    .select({
      totalRuns: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'COMPLETED')::int`,
      stoppedLimit: sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'STOPPED_LIMIT')::int`,
      stoppedLoop: sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'STOPPED_LOOP')::int`,
      timedOut: sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'TIMED_OUT')::int`,
      failed: sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'FAILED')::int`,
      totalCostUsd: sql<string>`coalesce(sum(${schema.agentRuns.estimatedCostUsd}), 0)`,
      avgToolCalls: sql<string>`coalesce(avg(${schema.agentRuns.toolCalls}), 0)`,
    })
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.tenantId, params.id));

  return jsonOk({ recent, stats });
}
