import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { getTenantOnboardingMetrics, getStepCompletion } from "@/modules/onboarding/metrics";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const [metrics, steps] = await Promise.all([
    getTenantOnboardingMetrics(session.tenantId),
    getStepCompletion(session.tenantId),
  ]);

  return jsonOk({ ...metrics, ...steps });
}
