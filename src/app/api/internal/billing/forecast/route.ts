import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { predictTenantUsage } from "@/modules/billing/forecast";

// Backs Settings → Credits & Usage's "Usage forecast & reserve" section —
// see modules/billing/forecast.ts for how the projection and per-agent
// breakdown are computed, and modules/billing/reserve-policy.ts for the
// reserve/max-drawdown policy this surfaces.
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const forecast = await predictTenantUsage(session.tenantId);
  return jsonOk(forecast);
}
