import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { getFollowUpQueue } from "@/modules/followups/service";

// Powers the Follow-ups page (src/app/(app)/followups/page.tsx). Replaces
// that page's old approach of fetching every opportunity via
// /api/internal/opportunities and filtering client-side — this returns
// the exact same overdue/upcoming split the Dashboard's "Needs Attention"
// panel counts from (src/modules/followups/service.ts), so the two can
// never show different numbers again.
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const queue = await getFollowUpQueue(session.tenantId);
  return jsonOk(queue);
}
