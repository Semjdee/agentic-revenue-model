import { db, schema } from "@/db/client";
import { eq, desc, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

// AI execution observability (multi-agent-routing spec Part B §39-40):
// every AgentRun (src/modules/ai/execution-gateway.ts) the tenant's agents
// have produced, plus rollup stats so a business owner can see at a
// glance whether their AI is behaving — total spend, how many runs got
// stopped for looping/hitting a limit, how many timed out. Tenant-scoped
// only (no cross-tenant view) — that's a platform-admin concern this
// route deliberately doesn't expose.
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const recent = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.tenantId, session.tenantId))
    .orderBy(desc(schema.agentRuns.startedAt))
    .limit(50);

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
    .where(eq(schema.agentRuns.tenantId, session.tenantId));

  return jsonOk({ recent, stats });
}
