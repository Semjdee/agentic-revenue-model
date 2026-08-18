import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";

const bodySchema = z.object({
  contactId: z.string(),
  leadId: z.string().optional(),
  estimatedValue: z.string().optional(),
  products: z.array(z.object({ productId: z.string(), name: z.string(), qty: z.number() })).default([]),
  source: z.string().optional(),
  campaign: z.string().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db.select().from(schema.opportunities).where(eq(schema.opportunities.tenantId, session.tenantId)).orderBy(desc(schema.opportunities.createdAt));
  return jsonOk(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "opportunities", "create")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.opportunities).values({ id, tenantId: session.tenantId, owner: session.userId, ...parsed.data });
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "opportunity.created", entity: "opportunity", entityId: id, after: parsed.data });
  await dispatchWebhooks(session.tenantId, "opportunity.created", { opportunityId: id });
  return jsonOk({ id }, 201);
}
