import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { generateInfluencerRecommendations } from "@/modules/influencers/analyst";

// Manual trigger — mirrors the "Run follow-up check now" button pattern
// in Settings (src/app/api/internal/followups/run/route.ts) rather than
// requiring a scheduled background job to see this work end-to-end.
export async function POST() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "influencers", "approve")) return jsonError("Forbidden", 403);

  const created = await generateInfluencerRecommendations(session.tenantId);
  return jsonOk({ created: created.length });
}
