import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { computeAllInfluencerMetrics, computeInfluencerMetrics } from "@/modules/influencers/metrics";
import { computeCommercialScore, computePublicityScore, classifyCreator } from "@/modules/influencers/scoring";
import { buildTrackingLinkUrl } from "@/modules/influencers/tracking-links";
import { INFLUENCER_STATUSES } from "@/db/schema";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(INFLUENCER_STATUSES).optional(),
  category: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const [influencer] = await db.select().from(schema.influencers).where(and(eq(schema.influencers.id, params.id), eq(schema.influencers.tenantId, session.tenantId))).limit(1);
  if (!influencer) return jsonError("Not found", 404);

  const allMetrics = await computeAllInfluencerMetrics(session.tenantId);
  const metrics = await computeInfluencerMetrics(session.tenantId, params.id);
  const commercialScore = computeCommercialScore(metrics, allMetrics);
  const publicityScore = computePublicityScore(metrics, allMetrics);
  const classification = classifyCreator(commercialScore, publicityScore, metrics);

  const links = await db.select().from(schema.trackingLinks).where(and(eq(schema.trackingLinks.tenantId, session.tenantId), eq(schema.trackingLinks.influencerId, params.id)));
  const linksWithUrl = links.map((l) => ({ ...l, url: buildTrackingLinkUrl(l.code) }));

  const costs = await db.select().from(schema.influencerCosts).where(and(eq(schema.influencerCosts.tenantId, session.tenantId), eq(schema.influencerCosts.influencerId, params.id)));
  const recommendations = await db
    .select()
    .from(schema.influencerRecommendations)
    .where(and(eq(schema.influencerRecommendations.tenantId, session.tenantId), eq(schema.influencerRecommendations.influencerId, params.id)));

  return jsonOk({ influencer, metrics, commercialScore, publicityScore, classification, trackingLinks: linksWithUrl, costs, recommendations });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "influencers", "edit")) return jsonError("Forbidden", 403);

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [before] = await db.select().from(schema.influencers).where(and(eq(schema.influencers.id, params.id), eq(schema.influencers.tenantId, session.tenantId))).limit(1);
  if (!before) return jsonError("Not found", 404);

  await db.update(schema.influencers).set({ ...parsed.data, updatedAt: new Date() }).where(eq(schema.influencers.id, params.id));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "influencer.updated", entity: "influencer", entityId: params.id, before, after: parsed.data });

  return jsonOk({ ok: true });
}
