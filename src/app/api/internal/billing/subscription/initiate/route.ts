import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { initiateSubscriptionPurchase, SubscriptionPurchaseError } from "@/modules/billing/subscription-purchase";
import { CREDIT_PLANS, SUBSCRIPTION_TERMS } from "@/db/schema";

const bodySchema = z.object({
  plan: z.enum(CREDIT_PLANS),
  term: z.enum(SUBSCRIPTION_TERMS),
  seats: z.number().int().min(1),
  phoneNumber: z.string().min(6),
  phoneCountryCode: z.string().min(1).default("256"),
  mobileMoneyNetwork: z.enum(["MTN", "AIRTEL"]),
  email: z.string().email().optional(),
});

// Real Flutterwave term-purchase (Industry Team Subscription Architecture
// doc, Part C) — same "charge now, verify server-side on webhook before
// activating anything" discipline as billing/topup/initiate. Plan only
// actually changes once the webhook re-verifies the charge (see
// modules/billing/subscription-purchase.ts's fulfillSubscriptionPurchase()).
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const email = parsed.data.email ?? session.email;
  if (!email) return jsonError("An email address is required to complete a purchase.", 422, "VALIDATION_ERROR");

  const [firstName, ...rest] = session.name.trim().split(/\s+/);
  const lastName = rest.join(" ") || firstName;

  try {
    const result = await initiateSubscriptionPurchase({
      tenantId: session.tenantId,
      plan: parsed.data.plan,
      term: parsed.data.term,
      seats: parsed.data.seats,
      mobileMoneyNetwork: parsed.data.mobileMoneyNetwork,
      redirectUrl: `${process.env.APP_URL || ""}/settings?subscription=complete`,
      customer: {
        email,
        firstName: firstName || "Customer",
        lastName,
        phoneCountryCode: parsed.data.phoneCountryCode,
        phoneNumber: parsed.data.phoneNumber,
      },
    });
    return jsonOk(result);
  } catch (err) {
    if (err instanceof SubscriptionPurchaseError) return jsonError(err.message, 422, "SUBSCRIPTION_PURCHASE_ERROR");
    // eslint-disable-next-line no-console
    console.error("[billing] subscription purchase initiation failed:", err);
    return jsonError("Couldn't start that payment — please try again.", 500);
  }
}
