import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { jsonError, jsonOk } from "@/lib/api";
import { startChannelConversation } from "@/modules/conversations/engine";

// The Instagram adapter — normalizes an inbound payload shaped like
// Meta's real Instagram Messaging webhook (entry[].messaging[].sender.id
// / .message.text) into a call to the same startChannelConversation()/
// handleCustomerMessage() the WhatsApp webhook
// (src/app/api/public/webhooks/whatsapp/route.ts) and the website widget
// all go through. Real Instagram webhooks don't include a profile name
// in the messaging payload (a real connector would look it up via a
// separate Graph API call); `sender.username` here is a mock-only
// convenience field for testability, clearly not part of the real
// payload shape.
//
// Unauthenticated by design (real Meta webhooks aren't session-cookie
// authenticated) — tenant is resolved from `entry[].id` matching a
// CONNECTED integration's externalAccountId, never from anything else in
// the payload.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const entry = body?.entry?.[0];
  const messagingEvent = entry?.messaging?.[0];
  const igAccountId: string | undefined = entry?.id;
  const senderId: string | undefined = messagingEvent?.sender?.id;
  const text: string | undefined = messagingEvent?.message?.text;

  if (!igAccountId || !senderId || !text) {
    return jsonError("Malformed Instagram webhook payload", 422);
  }

  const [integration] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.provider, "instagram"), eq(schema.integrations.externalAccountId, igAccountId), eq(schema.integrations.status, "CONNECTED")))
    .limit(1);
  if (!integration) return jsonError("Unknown or disconnected Instagram account", 404);

  const result = await startChannelConversation({
    tenantId: integration.tenantId,
    channel: "INSTAGRAM",
    identityType: "INSTAGRAM",
    identityValue: senderId,
    contactName: messagingEvent?.sender?.username,
    content: text,
  });

  await db.update(schema.integrations).set({ lastSyncAt: new Date() }).where(eq(schema.integrations.id, integration.id));

  return jsonOk({ conversationId: result.conversationId });
}

/** Meta's webhook verification handshake — same as the WhatsApp route. */
export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (challenge) return new Response(challenge, { status: 200 });
  return jsonError("Missing hub.challenge", 400);
}
