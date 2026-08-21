import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { computeTeamPerformance } from "@/modules/team/performance";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const performance = await computeTeamPerformance(session.tenantId, 30);
  return jsonOk({ performance });
}
