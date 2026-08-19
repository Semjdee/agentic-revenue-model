import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { getOnboardingProgress, markOnboardingComplete, logOnboardingEvent, logOnboardingEventOnce } from "@/modules/onboarding/service";
import { runHealthCheck } from "@/modules/onboarding/health-check";

// docs/ONBOARDING_SPEC.md section 17 — "Once health checks pass: [ GO LIVE ]".
// Re-runs the health check server-side rather than trusting the client's
// last-seen result (never trust a client-reported "all green" for
// something this consequential — same discipline as every other
// server-side re-validation in this codebase, e.g. requireSession()
// re-checking the user is still active on every request).
export async function POST() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const progress = await getOnboardingProgress(session.tenantId);
  if (!progress?.agentId) return jsonError("No agent set up yet", 409);

  const result = await runHealthCheck(session.tenantId, progress.agentId);
  if (!result.ready) {
    return jsonError("Not all readiness checks pass yet.", 409, "HEALTH_CHECK_FAILED");
  }

  const [before] = await db.select().from(schema.agents).where(eq(schema.agents.id, progress.agentId)).limit(1);
  if (!before) return jsonError("Agent not found", 404);

  // The actual activation: flip the agent to ACTIVE. Every gate that
  // matters already exists and reads this exact field —
  // src/modules/conversations/engine.ts's startConversation()/
  // startChannelConversation() and the public widget route all refuse to
  // process anything for a non-ACTIVE agent. Nothing else needs a
  // separate "enable processing" flag; this status flip *is* what turns
  // production processing on (spec section 35 — "Live" means production
  // processing is enabled, not a cosmetic label).
  await db.update(schema.agents).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(schema.agents.id, progress.agentId));

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "onboarding.go_live",
    entity: "agent",
    entityId: progress.agentId,
    before: { status: before.status },
    after: { status: "ACTIVE" },
  });

  await markOnboardingComplete(session.tenantId);
  await logOnboardingEvent(session.tenantId, "go_live_clicked");
  await logOnboardingEvent(session.tenantId, "agent_activated", { agentId: progress.agentId });
  // "First value" tracking starts here (spec section 18/20) — the TTFV
  // clock (Milestone 10) measures from account creation to the first real
  // conversation, which can now genuinely happen since the agent is live.
  await logOnboardingEventOnce(session.tenantId, "onboarding_completed");

  return jsonOk({ ok: true, agentId: progress.agentId });
}
