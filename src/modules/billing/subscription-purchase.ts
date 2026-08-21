import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { generateId } from "@/lib/ids";
import crypto from "crypto";
import { getPaymentConnector, type FlutterwaveCustomer } from "@/integrations/payments/flutterwave";
import { computeSubscriptionQuote } from "./subscription-pricing";
import type { CreditPlan, SubscriptionTerm } from "@/db/schema";

// Real subscription-term purchases — Industry Team Subscription
// Architecture doc, Part C. Structurally the SAME PENDING/SUCCEEDED/FAILED
// idempotent-intent pattern as modules/billing/topup.ts (reusing the same
// getPaymentConnector()) — a term purchase is just a bigger one-time
// Flutterwave charge, not new recurring-billing infra. On fulfillment this
// is the one place that actually moves creditBalances.plan away from the
// platform-admin-manual PATCH /api/platform/tenants/[id]/plan route — both
// remain valid ways a tenant ends up on a paid plan.

export class SubscriptionPurchaseError extends Error {}

export async function initiateSubscriptionPurchase(params: {
  tenantId: string;
  plan: CreditPlan;
  term: SubscriptionTerm;
  seats: number;
  customer: FlutterwaveCustomer;
  mobileMoneyNetwork: "MTN" | "AIRTEL";
  redirectUrl: string;
}) {
  if (params.plan === "FREE") throw new SubscriptionPurchaseError("FREE has no subscription purchase — it's the default, unpaid plan.");
  if (params.seats < 1) throw new SubscriptionPurchaseError("Seats must be at least 1.");

  const quote = computeSubscriptionQuote({ plan: params.plan, term: params.term, seats: params.seats });

  const reference = `sub_${crypto.randomBytes(12).toString("hex")}`;
  const intentId = generateId();
  await db.insert(schema.subscriptionPurchaseIntents).values({
    id: intentId,
    tenantId: params.tenantId,
    reference,
    plan: params.plan,
    term: params.term,
    seats: params.seats,
    totalUsd: quote.totalDueUsd.toFixed(2),
    status: "PENDING",
  });

  const connector = getPaymentConnector();
  const charge = await connector.initiateCharge({
    amountUsd: quote.totalDueUsd,
    reference,
    customer: params.customer,
    redirectUrl: params.redirectUrl,
    mobileMoneyNetwork: params.mobileMoneyNetwork,
  });

  await db.update(schema.subscriptionPurchaseIntents).set({ chargeId: charge.chargeId }).where(eq(schema.subscriptionPurchaseIntents.id, intentId));

  return { reference, quote, redirectUrl: charge.redirectUrl, isMock: charge.isMock };
}

/** Idempotent, same shape as fulfillTopup() — safe to call more than once
 * for the same charge. */
export async function fulfillSubscriptionPurchase(chargeId: string): Promise<{ activated: boolean; reason: string; tenantId?: string }> {
  const [intent] = await db.select().from(schema.subscriptionPurchaseIntents).where(eq(schema.subscriptionPurchaseIntents.chargeId, chargeId)).limit(1);
  if (!intent) return { activated: false, reason: "no matching subscription purchase intent for this charge" };
  if (intent.status === "SUCCEEDED") return { activated: false, reason: "already fulfilled (idempotent no-op)" };
  if (intent.status === "FAILED") return { activated: false, reason: "intent already marked failed" };

  const connector = getPaymentConnector();
  const verified = await connector.verifyCharge(chargeId);

  if (verified.status !== "succeeded") {
    if (verified.status === "failed" || verified.status === "voided") {
      await db.update(schema.subscriptionPurchaseIntents).set({ status: "FAILED", completedAt: new Date() }).where(eq(schema.subscriptionPurchaseIntents.id, intent.id));
    }
    return { activated: false, reason: `Flutterwave reports status "${verified.status}", not succeeded` };
  }

  const updated = await db
    .update(schema.subscriptionPurchaseIntents)
    .set({ status: "SUCCEEDED", completedAt: new Date() })
    .where(and(eq(schema.subscriptionPurchaseIntents.id, intent.id), eq(schema.subscriptionPurchaseIntents.status, "PENDING")))
    .returning();
  if (updated.length === 0) return { activated: false, reason: "already fulfilled by a concurrent request (idempotent no-op)" };

  const quote = computeSubscriptionQuote({ plan: intent.plan, term: intent.term, seats: intent.seats });
  const startedAt = new Date();
  const termEndsAt = new Date(startedAt);
  termEndsAt.setMonth(termEndsAt.getMonth() + quote.termMonths);

  await Promise.all([
    db.update(schema.creditBalances).set({ plan: intent.plan, updatedAt: new Date() }).where(eq(schema.creditBalances.tenantId, intent.tenantId)),
    db.insert(schema.subscriptions).values({
      id: generateId(),
      tenantId: intent.tenantId,
      plan: intent.plan,
      term: intent.term,
      seats: intent.seats,
      totalUsd: intent.totalUsd,
      startedAt,
      termEndsAt,
      renewalAmountUsd: quote.renewalAmountUsd.toFixed(2),
    }),
  ]);

  return { activated: true, reason: "subscription activated", tenantId: intent.tenantId };
}
