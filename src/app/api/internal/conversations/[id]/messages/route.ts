import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";
import { dispatchOutboundChannelMessage } from "@/modules/conversations/channel-dispatch";

const bodySchema = z.object({ content: z.string().min(1) });

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const messages = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, params.id)).orderBy(schema.messages.createdAt);
  return jsonOk(messages);
}

// Human (salesperson) sends a message. Only usable once the conversation has
// been taken over (aiActive = false), enforced client-side + here.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [conv] = await db.select().from(schema.conversations).where(and(eq(schema.conversations.id, params.id), eq(schema.conversations.tenantId, session.tenantId))).limit(1);
  if (!conv) return jsonError("Not found", 404);

  const id = generateId();
  await db.insert(schema.messages).values({
    id,
    tenantId: session.tenantId,
    conversationId: params.id,
    sender: "HUMAN",
    senderUserId: session.userId,
    content: parsed.data.content,
  });
  await db.update(schema.conversations).set({ updatedAt: new Date(), lastMessageAt: new Date(), aiActive: false }).where(eq(schema.conversations.id, params.id));
  await dispatchOutboundChannelMessage({ tenantId: session.tenantId, conversationId: params.id, channel: conv.channel, content: parsed.data.content });
  await dispatchWebhooks(session.tenantId, "message.sent", { conversationId: params.id });

  return jsonOk({ id }, 201);
}
