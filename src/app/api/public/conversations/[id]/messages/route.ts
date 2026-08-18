import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { jsonError, jsonOk, rateLimit } from "@/lib/api";
import { handleCustomerMessage } from "@/modules/conversations/engine";

const bodySchema = z.object({ content: z.string().min(1).max(4000) });

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, params.id)).limit(1);
  if (!conv) return jsonError("Conversation not found", 404);
  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, params.id))
    .orderBy(schema.messages.createdAt);
  return jsonOk({ messages, aiActive: conv.aiActive });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await rateLimit(`widget-msg-${params.id}`, 20, 60_000))) return jsonError("Too many requests", 429);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, params.id)).limit(1);
  if (!conv) return jsonError("Conversation not found", 404);

  await handleCustomerMessage({ tenantId: conv.tenantId, conversationId: params.id, content: parsed.data.content });

  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, params.id))
    .orderBy(schema.messages.createdAt);

  const [updated] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, params.id)).limit(1);
  return jsonOk({ messages, aiActive: updated?.aiActive ?? conv.aiActive });
}
