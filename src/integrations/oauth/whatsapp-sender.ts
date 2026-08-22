// Real outbound WhatsApp send via Meta's Cloud API — the piece that was
// MISSING-ENTIRELY per LAUNCH_CHECKLIST.md: this platform could already
// receive a real-shaped inbound webhook and generate an AI reply, but
// nothing ever pushed that reply back out to the customer's actual phone.
// Deliberately separate from RealWhatsAppConnector (that class only
// implements the OAuth-connect lifecycle) — sending happens on every
// message turn, not just at connect time, and doesn't need any of the
// connector interface's plumbing.

const GRAPH_API_VERSION = "v21.0";

export interface WhatsAppSendResult {
  ok: boolean;
  detail?: string;
}

/** `to` must already be in the customer's WhatsApp-format phone number
 * (whatever arrived as `message.from` on the inbound webhook — Meta
 * expects the same format back, no re-formatting here). */
export async function sendWhatsAppTextMessage(params: { phoneNumberId: string; accessToken: string; to: string; body: string }): Promise<WhatsAppSendResult> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${params.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${params.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: params.to,
      type: "text",
      text: { body: params.body },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    return { ok: false, detail };
  }
  return { ok: true };
}
