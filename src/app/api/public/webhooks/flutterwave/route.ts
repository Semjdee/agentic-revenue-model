import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { getPaymentConnector } from "@/integrations/payments/flutterwave";
import { fulfillTopup } from "@/modules/billing/topup";
import { logAudit } from "@/lib/audit";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

// Unauthenticated by design, same as every other public webhook in this
// app (WhatsApp/Instagram) — real authentication is the
// flutterwave-signature header (HMAC-SHA256 of the raw body against our
// configured secret hash), checked below BEFORE anything in the payload
// is trusted. Even after that, the actual credit grant only ever happens
// via fulfillTopup()'s own server-side re-verification against
// Flutterwave's live API — this handler's job is just "is this really
// Flutterwave, and if so, which charge should I go check."
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("flutterwave-signature");

  const connector = getPaymentConnector();
  if (!connector.verifyWebhookSignature(rawBody, signature)) {
    return jsonError("Invalid signature", 401);
  }

  const payload = JSON.parse(rawBody || "{}");
  const chargeId: string | undefined = payload?.data?.id;
  if (!chargeId) return jsonError("Malformed webhook payload", 422);

  const result = await fulfillTopup(chargeId);

  if (result.granted) {
    const [intent] = await db.select().from(schema.creditPurchaseIntents).where(eq(schema.creditPurchaseIntents.chargeId, chargeId)).limit(1);
    if (intent) {
      await logAudit({
        tenantId: intent.tenantId,
        action: "billing.topup_fulfilled",
        entity: "credit_purchase_intent",
        entityId: intent.id,
        source: "WEBHOOK",
        after: { chargeId, credits: intent.credits, priceUsd: intent.priceUsd },
      });
    }
  }

  // Always 200 once the signature checks out and the payload parses —
  // Flutterwave retries on non-2xx, and "already fulfilled" /
  // "not succeeded yet" are both legitimate, expected outcomes here, not
  // errors worth a retry storm over.
  return jsonOk({ ok: true, ...result });
}
