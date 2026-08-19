import { requireTenantSession, jsonError, jsonOk } from "@/lib/api";
import { getOnboardingProgress, initOnboardingProgress } from "@/modules/onboarding/service";

export async function GET() {
  const session = await requireTenantSession();
  if (!session) return jsonError("Not authenticated", 401);

  // A tenant created before this milestone landed (e.g. the seeded demo
  // tenant) won't have a progress row yet — initialize on first read
  // rather than erroring, so onboarding still works for pre-existing
  // tenants instead of leaving them permanently stuck.
  const progress = (await getOnboardingProgress(session.tenantId)) ?? (await initOnboardingProgress(session.tenantId));
  return jsonOk(progress);
}
