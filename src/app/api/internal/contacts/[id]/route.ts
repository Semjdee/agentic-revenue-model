import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { syncContactToCrm } from "@/modules/crm/sync";

const patchSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  company: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const [contact] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, params.id), eq(schema.contacts.tenantId, session.tenantId))).limit(1);
  if (!contact) return jsonError("Not found", 404);

  const identities = await db.select().from(schema.contactIdentities).where(eq(schema.contactIdentities.contactId, params.id));
  const conversations = await db.select().from(schema.conversations).where(eq(schema.conversations.contactId, params.id));
  const leads = await db.select().from(schema.leads).where(eq(schema.leads.contactId, params.id));
  const opportunities = await db.select().from(schema.opportunities).where(eq(schema.opportunities.contactId, params.id));

  return jsonOk({ contact, identities, conversations, leads, opportunities });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "contacts", "edit")) return jsonError("Forbidden", 403);

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [before] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, params.id), eq(schema.contacts.tenantId, session.tenantId))).limit(1);
  if (!before) return jsonError("Not found", 404);

  await db
    .update(schema.contacts)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(schema.contacts.id, params.id), eq(schema.contacts.tenantId, session.tenantId)));

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "contact.updated", entity: "contact", entityId: params.id, before, after: parsed.data });
  await syncContactToCrm(session.tenantId, params.id);
  return jsonOk({ ok: true });
}
