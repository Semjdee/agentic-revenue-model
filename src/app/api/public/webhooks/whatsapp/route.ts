import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { jsonError, jsonOk } from "@/lib/api";
import { startChannelConversation } from "@/modules/conversations/engine";

// docs/PHASE_2_EXTENSIONS_SPEC.md section 13's flow: "WhatsApp message ->
// Meta webhook -> WhatsApp adapter -> normalized Message -> Conversation
// -> AI Agent". This IS the WhatsApp adapter — it normalizes an inbound
// payload (shaped like Meta's real Cloud API webhook so swapping the mock
// connector for a real one later needs no changes here) into a call to
// the exact same startChannelConversation()/handleCustomerMessage() the
// website widget goes through.
//
// Unauthenticated by design (real Meta webhooks aren't session-cookie
// authenticated) — tenant is resolved from `phone_number_id` matching a
// CONNECTED integration's externalAccountId, never from anything else in
// the payload. A payload for a phone_number_id with no CONNECTED
// integration is rejected, not silently accepted.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
  const message = value?.messages?.[0];
  const contactProfile = value?.contacts?.[0]?.profile;

  if (!phoneNumberId || !message?.from || !message?.text?.body) {
    return jsonError("Malformed WhatsApp webhook payload", 422);
  }

  const [integration] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.provider, "whatsapp"), eq(schema.integrations.externalAccountId, phoneNumberId), eq(schema.integrations.status, "CONNECTED")))
    .limit(1);
  if (!integration) return jsonError("Unknown or disconnected WhatsApp number", 404);

  const result = await startChannelConversation({
    tenantId: integration.tenantId,
    channel: "WHATSAPP",
    identityType: "WHATSAPP",
    identityValue: message.from,
    contactName: contactProfile?.name,
    content: message.text.body,
  });

  await db.update(schema.integrations).set({ lastSyncAt: new Date() }).where(eq(schema.integrations.id, integration.id));

  return jsonOk({ conversationId: result.conversationId });
}

/** Meta's webhook verification handshake (hub.challenge echo) — real
 * connector only; harmless to answer honestly even in mock mode since no
 * secret is involved. */
export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (challenge) return new Response(challenge, { status: 200 });
  return jsonError("Missing hub.challenge", 400);
}
