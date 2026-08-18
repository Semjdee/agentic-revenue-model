import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { LEAD_STAGES } from "@/db/schema";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";

const bodySchema = z.object({
  contactId: z.string(),
  conversationId: z.string().optional(),
  stage: z.enum(LEAD_STAGES).default("NEW"),
  source: z.string().optional(),
  campaign: z.string().optional(),
  assignedUserId: z.string().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db.select().from(schema.leads).where(eq(schema.leads.tenantId, session.tenantId)).orderBy(desc(schema.leads.createdAt));
  return jsonOk(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "leads", "create")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.leads).values({ id, tenantId: session.tenantId, ...parsed.data });
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "lead.created", entity: "lead", entityId: id, after: parsed.data });
  await dispatchWebhooks(session.tenantId, "lead.created", { leadId: id });
  return jsonOk({ id }, 201);
}
