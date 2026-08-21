import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { generateId } from "@/lib/ids";

const createSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default("UGX"),
  note: z.string().optional(),
  incurredAt: z.string().optional(),
});

// Manual cost entry — there's no live billing API to pull influencer
// payments from, so a marketer records what was actually paid (spec's
// MANUAL/ESTIMATED source category). This is what makes ROAS/ROI/cost-
// per-sale in modules/influencers/metrics.ts real numbers instead of
// permanently zero.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "influencers", "edit")) return jsonError("Forbidden", 403);

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [influencer] = await db.select().from(schema.influencers).where(and(eq(schema.influencers.id, params.id), eq(schema.influencers.tenantId, session.tenantId))).limit(1);
  if (!influencer) return jsonError("Not found", 404);

  const id = generateId();
  await db.insert(schema.influencerCosts).values({
    id,
    tenantId: session.tenantId,
    influencerId: params.id,
    amount: String(parsed.data.amount),
    currency: parsed.data.currency,
    note: parsed.data.note,
    incurredAt: parsed.data.incurredAt ? new Date(parsed.data.incurredAt) : new Date(),
  });

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "influencer_cost.created", entity: "influencer_cost", entityId: id, after: { influencerId: params.id, amount: parsed.data.amount } });

  return jsonOk({ id }, 201);
}
