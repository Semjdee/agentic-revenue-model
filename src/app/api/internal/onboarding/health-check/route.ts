import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { getOnboardingProgress, advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";
import { runHealthCheck } from "@/modules/onboarding/health-check";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const progress = await getOnboardingProgress(session.tenantId);
  if (!progress?.agentId) return jsonError("No agent set up yet", 409);

  const result = await runHealthCheck(session.tenantId, progress.agentId);

  if (result.ready && progress.currentStep === "HEALTH_CHECK") {
    await advanceOnboardingStep(session.tenantId, "HEALTH_CHECK", "GO_LIVE");
    await logOnboardingEvent(session.tenantId, "health_check_completed", { ready: true });
  }

  return jsonOk(result);
}
