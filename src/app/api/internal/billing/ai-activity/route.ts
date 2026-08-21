import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { approxCreditsFromCost } from "@/modules/billing/pricing";

// Tenant-facing "AI Activity" (Master Product Architecture Update
// §29-31) — replaces the old raw AI Runs view (model/tokens/$cost/stop
// reason), which moved to Platform Staff only at
// /api/platform/tenants/[id]/ai-runs. Same underlying agent_runs data,
// translated into business-readable language: a trigger type becomes an
// activity label, a status becomes plain language, and cost is reported
// in credits (via approxCreditsFromCost — genuinely $0 MockAIProvider
// runs report 0 credits, not a false minimum-1 floor) rather than dollars
// or tokens.
const TRIGGER_LABELS: Record<string, string> = {
  INBOUND_MESSAGE: "Customer Conversation",
  SANDBOX_TEST: "Agent Test",
  FOLLOWUP: "Follow-up",
};
const STATUS_LABELS: Record<string, string> = {
  RUNNING: "In progress",
  COMPLETED: "Completed",
  STOPPED_LIMIT: "Completed",
  STOPPED_LOOP: "Completed",
  FAILED: "Failed",
  TIMED_OUT: "Failed",
  CANCELLED: "Cancelled",
};

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.tenantId, session.tenantId)).orderBy(desc(schema.agentRuns.startedAt)).limit(50);
  const agentIds = [...new Set(runs.map((r) => r.agentId).filter((id): id is string => !!id))];
  const agents = agentIds.length ? await db.select().from(schema.agents).where(eq(schema.agents.tenantId, session.tenantId)) : [];
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

  const activity = runs.map((r) => {
    const isFailure = r.status === "FAILED" || r.status === "TIMED_OUT";
    const label = TRIGGER_LABELS[r.triggerType] ?? "AI Activity";
    const agentName = r.agentId ? agentNameById.get(r.agentId) : null;
    return {
      id: r.id,
      title: agentName ? `${label} — ${agentName}` : label,
      status: STATUS_LABELS[r.status] ?? "Completed",
      isFailure,
      credits: isFailure ? 0 : approxCreditsFromCost(Number(r.estimatedCostUsd)), // failed/timed-out runs never charge — see execution-gateway.ts
      when: r.startedAt,
    };
  });

  const totalCreditsUsed = activity.reduce((s, a) => s + a.credits, 0);
  const conversationCount = new Set(runs.filter((r) => r.triggerType === "INBOUND_MESSAGE" && r.conversationId).map((r) => r.conversationId)).size;
  const actionCount = runs.length;

  return jsonOk({ activity, summary: { totalCreditsUsed, conversationCount, actionCount } });
}
