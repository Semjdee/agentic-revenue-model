import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { generateId } from "@/lib/ids";
import { computeAllInfluencerMetrics } from "@/modules/influencers/metrics";
import { computeCommercialScore, computePublicityScore, classifyCreator } from "@/modules/influencers/scoring";
import { INFLUENCER_PLATFORMS } from "@/db/schema";

const createSchema = z.object({
  name: z.string().min(1),
  handle: z.string().optional(),
  platform: z.enum(INFLUENCER_PLATFORMS).default("INSTAGRAM"),
  category: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const rows = await db.select().from(schema.influencers).where(eq(schema.influencers.tenantId, session.tenantId)).orderBy(desc(schema.influencers.createdAt));
  const allMetrics = await computeAllInfluencerMetrics(session.tenantId);
  const metricsById = new Map(allMetrics.map((m) => [m.influencerId, m]));

  const withScores = rows.map((r) => {
    const metrics = metricsById.get(r.id);
    const commercialScore = metrics ? computeCommercialScore(metrics, allMetrics) : null;
    const publicityScore = metrics ? computePublicityScore(metrics, allMetrics) : null;
    const classification = metrics ? classifyCreator(commercialScore, publicityScore, metrics) : "INSUFFICIENT_DATA";
    return { ...r, metrics, commercialScore, publicityScore, classification };
  });

  return jsonOk(withScores);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "influencers", "create")) return jsonError("Forbidden", 403);

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.influencers).values({
    id,
    tenantId: session.tenantId,
    name: parsed.data.name,
    handle: parsed.data.handle,
    platform: parsed.data.platform,
    category: parsed.data.category,
    contactEmail: parsed.data.contactEmail || undefined,
    contactPhone: parsed.data.contactPhone,
    notes: parsed.data.notes,
  });

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "influencer.created", entity: "influencer", entityId: id, after: { name: parsed.data.name } });

  return jsonOk({ id }, 201);
}
