import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const rows = await db
    .select({
      conversation: schema.conversations,
      contact: schema.contacts,
    })
    .from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.conversations.contactId, schema.contacts.id))
    .where(eq(schema.conversations.tenantId, session.tenantId))
    .orderBy(desc(schema.conversations.lastMessageAt));

  return jsonOk(rows.map((r) => ({ ...r.conversation, contact: r.contact })));
}
