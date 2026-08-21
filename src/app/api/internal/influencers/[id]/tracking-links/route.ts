import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { createTrackingLink, buildTrackingLinkUrl } from "@/modules/influencers/tracking-links";
import { TRACKING_LINK_DESTINATIONS } from "@/db/schema";

const createSchema = z.object({
  campaignName: z.string().min(1),
  contentLabel: z.string().optional(),
  destinationType: z.enum(TRACKING_LINK_DESTINATIONS),
  destinationValue: z.string().min(1),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db.select().from(schema.trackingLinks).where(and(eq(schema.trackingLinks.tenantId, session.tenantId), eq(schema.trackingLinks.influencerId, params.id)));
  return jsonOk(rows.map((r) => ({ ...r, url: buildTrackingLinkUrl(r.code) })));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "influencers", "create")) return jsonError("Forbidden", 403);

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [influencer] = await db.select().from(schema.influencers).where(and(eq(schema.influencers.id, params.id), eq(schema.influencers.tenantId, session.tenantId))).limit(1);
  if (!influencer) return jsonError("Not found", 404);

  if (parsed.data.destinationType === "WEBSITE") {
    try {
      new URL(parsed.data.destinationValue);
    } catch {
      return jsonError("Website destination must be a valid URL.", 422, "VALIDATION_ERROR");
    }
  }

  const { id, code } = await createTrackingLink({
    tenantId: session.tenantId,
    influencerId: params.id,
    campaignName: parsed.data.campaignName,
    contentLabel: parsed.data.contentLabel,
    destinationType: parsed.data.destinationType,
    destinationValue: parsed.data.destinationValue,
  });

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "tracking_link.created", entity: "tracking_link", entityId: id, after: { influencerId: params.id, code } });

  return jsonOk({ id, code, url: buildTrackingLinkUrl(code) }, 201);
}
