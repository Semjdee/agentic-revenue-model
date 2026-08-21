import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { getOrInitBalance } from "@/modules/billing/ledger";
import { summarizeCapacityStatus } from "@/modules/billing/reserve-policy";

// Backs Settings → Credits & Usage's "Live Conversation Protection" card.
// Deliberately just the coarse capacity status (see reserve-policy.ts's
// summarizeCapacityStatus()) — no per-agent breakdown, no daily-average
// consumption rate, no projected monthly total, no runway-in-days. All of
// that is real usage detail and, per policy, no tenant role sees it;
// modules/billing/forecast.ts's richer predictTenantUsage() still exists
// for a future Platform Admin per-tenant drill-down, just not surfaced
// here anymore.
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const balance = await getOrInitBalance(session.tenantId);
  const capacity = summarizeCapacityStatus(balance);
  return jsonOk(capacity);
}
