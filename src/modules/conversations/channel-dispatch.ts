import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";
import { sendWhatsAppTextMessage } from "@/integrations/oauth/whatsapp-sender";

// Pushes a reply (AI-generated or a human agent's) out to the customer's
// real phone on channels that need it — LAUNCH_CHECKLIST.md "WhatsApp —
// real send." A website-widget conversation has nothing to push (the
// widget polls/renders messages straight out of the DB), so this is a
// no-op there; same for any tenant still on the mock WhatsApp connector,
// where a reply living only in this app's own Inbox is the existing,
// unchanged behaviour. Called from both the AI reply path
// (conversations/engine.ts) and the human-send route
// (api/internal/conversations/[id]/messages/route.ts) so neither one can
// forget to actually deliver the message.
export async function dispatchOutboundChannelMessage(params: { tenantId: string; conversationId: string; channel: string; content: string }): Promise<void> {
  if (params.channel !== "WHATSAPP") return; // Instagram/Messenger real send: LAUNCH_CHECKLIST.md, not yet built.

  const [integration] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, params.tenantId), eq(schema.integrations.provider, "whatsapp"), eq(schema.integrations.status, "CONNECTED")))
    .limit(1);
  if (!integration || integration.isMock) return;

  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, params.conversationId)).limit(1);
  if (!conversation) return;

  const [identity] = await db
    .select()
    .from(schema.contactIdentities)
    .where(and(eq(schema.contactIdentities.tenantId, params.tenantId), eq(schema.contactIdentities.contactId, conversation.contactId), eq(schema.contactIdentities.type, "WHATSAPP")))
    .limit(1);
  if (!identity) return;

  const [cred] = await db
    .select()
    .from(schema.integrationCredentials)
    .where(eq(schema.integrationCredentials.integrationId, integration.id))
    .orderBy(schema.integrationCredentials.createdAt)
    .limit(1);
  if (!cred) return;

  let tokens: { accessToken: string };
  try {
    tokens = JSON.parse(decryptSecret(cred.encryptedPayload));
  } catch (err) {
    console.error(`[whatsapp-dispatch] could not decrypt stored credentials for tenant ${params.tenantId}`, err);
    return;
  }

  // Best-effort: a delivery failure must never break the request that
  // generated the reply (the message already exists in our own DB/Inbox
  // either way) — logged for now; see LAUNCH_CHECKLIST.md's monitoring
  // gap for where this should surface once real error tracking exists.
  const result = await sendWhatsAppTextMessage({ phoneNumberId: integration.externalAccountId!, accessToken: tokens.accessToken, to: identity.value, body: params.content });
  if (!result.ok) {
    console.error(`[whatsapp-dispatch] send failed for tenant ${params.tenantId}, conversation ${params.conversationId}: ${result.detail}`);
  }
}
