import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { computeCampaignPerformance } from "@/modules/advertising/analyst";
import { computeConversationIntelligence } from "@/modules/conversations/intelligence";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const performance = await computeCampaignPerformance(session.tenantId, 30);
  const intelligence = await computeConversationIntelligence(session.tenantId, 30);
  return jsonOk({ performance, intelligence });
}
