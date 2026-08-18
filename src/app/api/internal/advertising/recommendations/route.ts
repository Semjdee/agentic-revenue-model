import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { generateAdvertisingRecommendations } from "@/modules/advertising/analyst";
import { hasPermission } from "@/lib/permissions";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db
    .select()
    .from(schema.advertisingRecommendations)
    .where(eq(schema.advertisingRecommendations.tenantId, session.tenantId))
    .orderBy(desc(schema.advertisingRecommendations.createdAt));
  return jsonOk(rows);
}

// Manually trigger the AI Advertising Analyst to (re)generate recommendations.
export async function POST() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "advertising", "create")) return jsonError("Forbidden", 403);
  const created = await generateAdvertisingRecommendations(session.tenantId);
  return jsonOk({ created });
}
