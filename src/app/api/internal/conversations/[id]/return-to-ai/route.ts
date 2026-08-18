import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const [conv] = await db.select().from(schema.conversations).where(and(eq(schema.conversations.id, params.id), eq(schema.conversations.tenantId, session.tenantId))).limit(1);
  if (!conv) return jsonError("Not found", 404);

  await db.update(schema.conversations).set({ aiActive: true, updatedAt: new Date() }).where(eq(schema.conversations.id, params.id));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "conversation.return_to_ai", entity: "conversation", entityId: params.id });

  return jsonOk({ ok: true });
}
