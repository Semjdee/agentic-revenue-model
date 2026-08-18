import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { runFollowUpCheck } from "@/modules/followups/processor";

// Manual "run now" trigger, exposed in Settings, for demoing/testing the
// follow-up engine without waiting for the BullMQ repeatable job or running
// the separate worker process.
export async function POST() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const results = await runFollowUpCheck(new Date(), session.tenantId);
  return jsonOk({ processed: results.length, results });
}
