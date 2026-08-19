import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";

// Explicit, honest skip — docs/ONBOARDING_SPEC.md section 5: "activate
// with ONE supported primary channel... do not delay initial activation
// because every integration is not connected" is about not requiring
// every channel, not about faking one. Skipping here does NOT mark
// anything "Connected" — Milestone 9's health check will correctly show
// "no channel connected" as a failing/pending check if the user reaches
// Go Live having skipped this.
export async function POST() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const progress = await advanceOnboardingStep(session.tenantId, "CHANNEL_CONNECT", "HEALTH_CHECK");
  await logOnboardingEvent(session.tenantId, "channel_connect_skipped");
  return jsonOk({ progress });
}
