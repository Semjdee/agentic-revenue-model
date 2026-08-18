import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

// "Take Over Conversation" (spec section 4): AI auto-response = paused,
// human becomes the active responder.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const [conv] = await db.select().from(schema.conversations).where(and(eq(schema.conversations.id, params.id), eq(schema.conversations.tenantId, session.tenantId))).limit(1);
  if (!conv) return jsonError("Not found", 404);

  await db.update(schema.conversations).set({ aiActive: false, assignedUserId: session.userId, updatedAt: new Date() }).where(eq(schema.conversations.id, params.id));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "conversation.human_takeover", entity: "conversation", entityId: params.id });

  return jsonOk({ ok: true });
}
