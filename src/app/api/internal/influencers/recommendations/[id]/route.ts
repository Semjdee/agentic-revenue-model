import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";

const bodySchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

// Human approval gate for AI Influencer Analyst recommendations — same
// pattern as advertising recommendations (src/app/api/internal/
// advertising/recommendations/[id]/route.ts). PAUSE/DO_NOT_RENEW-style
// approvals also flip the influencer's own status, since that's a real
// state change worth reflecting immediately rather than leaving the
// recommendation as the only record of the decision.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "influencers", "approve")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [rec] = await db
    .select()
    .from(schema.influencerRecommendations)
    .where(and(eq(schema.influencerRecommendations.id, params.id), eq(schema.influencerRecommendations.tenantId, session.tenantId)))
    .limit(1);
  if (!rec) return jsonError("Not found", 404);

  await db
    .update(schema.influencerRecommendations)
    .set({ status: parsed.data.decision, decidedBy: session.userId, decidedAt: new Date() })
    .where(eq(schema.influencerRecommendations.id, params.id));

  if (parsed.data.decision === "APPROVED" && (rec.title === "Pause" || rec.title === "Reduce Allocation")) {
    await db.update(schema.influencers).set({ status: rec.title === "Pause" ? "PAUSED" : "ACTIVE", updatedAt: new Date() }).where(eq(schema.influencers.id, rec.influencerId));
  }

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "influencer.recommendation_decided",
    entity: "influencer_recommendation",
    entityId: params.id,
    after: { decision: parsed.data.decision },
  });
  await dispatchWebhooks(session.tenantId, "recommendation.approved", { recommendationId: params.id });

  return jsonOk({ ok: true });
}
