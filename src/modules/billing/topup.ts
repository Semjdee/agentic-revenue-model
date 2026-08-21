import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { generateId } from "@/lib/ids";
import crypto from "crypto";
import { getPaymentConnector, type FlutterwaveCustomer } from "@/integrations/payments/flutterwave";
import { grantCredits } from "./ledger";
import { CREDIT_PACKAGES, CUSTOM_TOPUP_MIN_USD, creditsForCustomAmount } from "./plans";

// ============================================================================
// Real credit top-up purchases (Master Product Architecture Update
// §26-28). initiateTopup() starts a Flutterwave charge and records a
// PENDING intent; fulfillTopup() — called only from the webhook route
// after a real server-side re-verification against Flutterwave's API,
// never from the webhook payload alone — grants credits exactly once per
// real payment via the existing grantCredits() (billing/ledger.ts),
// unchanged.
// ============================================================================

export class TopupError extends Error {}

export async function initiateTopup(params: { tenantId: string; packageId: string; customAmountUsd?: number; customer: FlutterwaveCustomer; mobileMoneyNetwork: "MTN" | "AIRTEL"; redirectUrl: string }) {
  let priceUsd: number;
  let credits: number;

  if (params.packageId === "custom") {
    const amount = params.customAmountUsd;
    if (!amount || amount < CUSTOM_TOPUP_MIN_USD) throw new TopupError(`Custom top-up amount must be at least $${CUSTOM_TOPUP_MIN_USD}.`);
    priceUsd = amount;
    credits = creditsForCustomAmount(amount);
  } else {
    const pkg = CREDIT_PACKAGES.find((p) => p.id === params.packageId && !p.custom);
    if (!pkg) throw new TopupError("Unknown top-up package.");
    priceUsd = pkg.priceUsd;
    credits = pkg.credits;
  }

  const reference = `topup_${crypto.randomBytes(12).toString("hex")}`;
  const intentId = generateId();
  await db.insert(schema.creditPurchaseIntents).values({
    id: intentId,
    tenantId: params.tenantId,
    reference,
    packageId: params.packageId,
    priceUsd: priceUsd.toFixed(2),
    credits,
    status: "PENDING",
  });

  const connector = getPaymentConnector();
  const charge = await connector.initiateCharge({
    amountUsd: priceUsd,
    reference,
    customer: params.customer,
    redirectUrl: params.redirectUrl,
    mobileMoneyNetwork: params.mobileMoneyNetwork,
  });

  await db.update(schema.creditPurchaseIntents).set({ chargeId: charge.chargeId }).where(eq(schema.creditPurchaseIntents.id, intentId));

  return { reference, credits, priceUsd, redirectUrl: charge.redirectUrl, isMock: charge.isMock };
}

/** Idempotent — safe to call more than once for the same charge (a
 * webhook can legitimately retry). Only grants credits the first time an
 * intent transitions into SUCCEEDED; every call after that is a no-op. */
export async function fulfillTopup(chargeId: string): Promise<{ granted: boolean; reason: string }> {
  const [intent] = await db.select().from(schema.creditPurchaseIntents).where(eq(schema.creditPurchaseIntents.chargeId, chargeId)).limit(1);
  if (!intent) return { granted: false, reason: "no matching purchase intent for this charge" };
  if (intent.status === "SUCCEEDED") return { granted: false, reason: "already fulfilled (idempotent no-op)" };
  if (intent.status === "FAILED") return { granted: false, reason: "intent already marked failed" };

  // The one rule that matters here: never trust the webhook payload's own
  // claimed status — always re-verify server-side against Flutterwave's
  // own API before granting anything real.
  const connector = getPaymentConnector();
  const verified = await connector.verifyCharge(chargeId);

  if (verified.status !== "succeeded") {
    if (verified.status === "failed" || verified.status === "voided") {
      await db.update(schema.creditPurchaseIntents).set({ status: "FAILED", completedAt: new Date() }).where(eq(schema.creditPurchaseIntents.id, intent.id));
    }
    return { granted: false, reason: `Flutterwave reports status "${verified.status}", not succeeded` };
  }

  // Re-check status hasn't changed between our read and now (a second
  // concurrent webhook delivery) — a tenant_id + status=SUCCEEDED update
  // guarded by the row's own current status is the actual idempotency
  // lock, not just the earlier read above.
  const updated = await db
    .update(schema.creditPurchaseIntents)
    .set({ status: "SUCCEEDED", completedAt: new Date() })
    .where(and(eq(schema.creditPurchaseIntents.id, intent.id), eq(schema.creditPurchaseIntents.status, "PENDING")))
    .returning();
  if (updated.length === 0) return { granted: false, reason: "already fulfilled by a concurrent request (idempotent no-op)" };

  await grantCredits(intent.tenantId, intent.credits, "PURCHASE", `flutterwave_topup:${intent.reference}`);
  return { granted: true, reason: "credits granted" };
}
