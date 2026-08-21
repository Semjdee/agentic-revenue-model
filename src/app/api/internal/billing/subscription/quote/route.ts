import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { computeSubscriptionQuote, TERM_MONTHS, TERM_DISCOUNT_PCT, TERM_LABELS } from "@/modules/billing/subscription-pricing";
import { CREDIT_PLANS, SUBSCRIPTION_TERMS } from "@/db/schema";
import { PLAN_INCLUDED_SEATS, ADDITIONAL_SEAT_PRICE_USD } from "@/modules/billing/plans";

// Live quote for the "Plans & Billing" UI's term selector — lets the
// tenant see the discounted total before starting a real charge. Pure
// calculation (computeSubscriptionQuote has no DB access); this route
// exists only because the calculation lives in a server module, same
// reason /api/internal/billing/packages exists for CREDIT_PACKAGES.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const url = new URL(req.url);
  const plan = url.searchParams.get("plan");
  const term = url.searchParams.get("term");
  const seats = Number(url.searchParams.get("seats") ?? "1");

  if (!plan || !(CREDIT_PLANS as readonly string[]).includes(plan) || plan === "FREE") {
    return jsonError("plan must be PRO or PREMIUM", 422, "VALIDATION_ERROR");
  }
  if (!term || !(SUBSCRIPTION_TERMS as readonly string[]).includes(term)) {
    return jsonError("Invalid term", 422, "VALIDATION_ERROR");
  }
  if (!Number.isFinite(seats) || seats < 1) return jsonError("seats must be at least 1", 422, "VALIDATION_ERROR");

  const quote = computeSubscriptionQuote({ plan: plan as (typeof CREDIT_PLANS)[number], term: term as (typeof SUBSCRIPTION_TERMS)[number], seats });
  return jsonOk({
    quote,
    terms: SUBSCRIPTION_TERMS.map((t) => ({ term: t, label: TERM_LABELS[t], months: TERM_MONTHS[t], discountPct: TERM_DISCOUNT_PCT[t] })),
    planIncludedSeats: PLAN_INCLUDED_SEATS,
    additionalSeatPriceUsd: ADDITIONAL_SEAT_PRICE_USD,
  });
}
