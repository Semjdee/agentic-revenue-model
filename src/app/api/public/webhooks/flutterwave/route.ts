import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api";
import { getPaymentConnector } from "@/integrations/payments/flutterwave";
import { fulfillTopup } from "@/modules/billing/topup";
import { fulfillSubscriptionPurchase } from "@/modules/billing/subscription-purchase";
import { logAudit } from "@/lib/audit";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

// Unauthenticated by design, same as every other public webhook in this
// app (WhatsApp/Instagram) — real authentication is the
// flutterwave-signature header (HMAC-SHA256 of the raw body against our
// configured secret hash), checked below BEFORE anything in the payload
// is trusted. Even after that, the actual credit grant / subscription
// activation only ever happens via fulfillTopup()/
// fulfillSubscriptionPurchase()'s own server-side re-verification against
// Flutterwave's live API — this handler's job is just "is this really
// Flutterwave, and if so, which of our two intent tables does this charge
// belong to."
//
// One webhook endpoint handles both credit top-ups and subscription-term
// purchases (Industry Team Subscription Architecture doc, Part C) — a
// charge's own `reference` (which we generated at initiation time,
// "topup_..." vs "sub_...") tells us which fulfiller owns it, so we look
// it up in credit_purchase_intents first, falling back to
// subscription_purchase_intents.
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

  const [topupIntent] = await db.select().from(schema.creditPurchaseIntents).where(eq(schema.creditPurchaseIntents.chargeId, chargeId)).limit(1);
  if (topupIntent) {
    const result = await fulfillTopup(chargeId);
    if (result.granted) {
      await logAudit({
        tenantId: topupIntent.tenantId,
        action: "billing.topup_fulfilled",
        entity: "credit_purchase_intent",
        entityId: topupIntent.id,
        source: "WEBHOOK",
        after: { chargeId, credits: topupIntent.credits, priceUsd: topupIntent.priceUsd },
      });
    }
    return jsonOk({ ok: true, ...result });
  }

  const [subIntent] = await db.select().from(schema.subscriptionPurchaseIntents).where(eq(schema.subscriptionPurchaseIntents.chargeId, chargeId)).limit(1);
  if (subIntent) {
    const result = await fulfillSubscriptionPurchase(chargeId);
    if (result.activated) {
      await logAudit({
        tenantId: subIntent.tenantId,
        action: "billing.subscription_activated",
        entity: "subscription_purchase_intent",
        entityId: subIntent.id,
        source: "WEBHOOK",
        after: { chargeId, plan: subIntent.plan, term: subIntent.term, seats: subIntent.seats, totalUsd: subIntent.totalUsd },
      });
    }
    // Always 200 once the signature checks out and the payload parses —
    // Flutterwave retries on non-2xx, and "already fulfilled" /
    // "not succeeded yet" are both legitimate, expected outcomes here, not
    // errors worth a retry storm over.
    return jsonOk({ ok: true, ...result });
  }

  return jsonError("No matching purchase intent for this charge", 404);
}
