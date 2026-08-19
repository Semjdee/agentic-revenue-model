import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";

// docs/ONBOARDING_TASKS.md Milestone 6 — user explicitly says "looks
// good" after trying the sandbox. Testing itself (POST
// /api/internal/agents/[id]/test) never advances the wizard on its own —
// this is a deliberate separate action so a user isn't forced forward by
// merely sending a test message.
export async function POST() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const progress = await advanceOnboardingStep(session.tenantId, "AGENT_TEST", "CHANNEL_CONNECT");
  await logOnboardingEvent(session.tenantId, "agent_test_completed");
  return jsonOk({ progress });
}
