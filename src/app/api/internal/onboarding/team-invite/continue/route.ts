import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";

// Advances past the TEAM_INVITE step — called whether the owner actually
// invited someone (through the existing api/internal/team POST, used
// as-is here, no new invite backend) or clicked "Skip for now."
// ONBOARDING_SPEC.md's own note: team invites should be offered "later,
// contextually," not forced — this step never blocks Go Live.
export async function POST() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const progress = await advanceOnboardingStep(session.tenantId, "TEAM_INVITE", "GO_LIVE");
  await logOnboardingEvent(session.tenantId, "team_invite_step_completed");
  return jsonOk({ progress });
}
