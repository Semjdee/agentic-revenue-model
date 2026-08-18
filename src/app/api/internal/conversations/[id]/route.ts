import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const [conv] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.id, params.id), eq(schema.conversations.tenantId, session.tenantId)))
    .limit(1);
  if (!conv) return jsonError("Not found", 404);

  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, conv.contactId)).limit(1);
  const messages = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, params.id)).orderBy(schema.messages.createdAt);
  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.conversationId, params.id)).limit(1);

  await db.update(schema.conversations).set({ unread: false }).where(eq(schema.conversations.id, params.id));

  return jsonOk({ conversation: conv, contact, messages, lead: lead ?? null });
}
