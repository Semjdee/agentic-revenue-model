import { PLAN_MONTHLY_PRICE_USD, PLAN_INCLUDED_SEATS, ADDITIONAL_SEAT_PRICE_USD } from "./plans";
import type { CreditPlan, SubscriptionTerm } from "@/db/schema";
import { SUBSCRIPTION_TERMS } from "@/db/schema";

// Subscription pricing — Industry Team Subscription Architecture doc,
// Part C. Pure calculation only (no DB access — same discipline as
// modules/ai/guided-setup.ts), so it's directly unit-testable against the
// doc's own worked dollar examples.
//
// Term discounts apply ONLY to the plan + extra-seats subtotal — AI
// credits are never discounted by term and never appear in this
// calculation at all. That's not an oversight: it's the doc's own closing
// principle that Industry Template / Subscription Plan / Human Seats / AI
// Credits stay four independently-configurable concepts. Credits stay
// pay-as-you-go via the existing top-up flow (modules/billing/topup.ts)
// regardless of what subscription term a tenant is on.

export const TERM_MONTHS: Record<SubscriptionTerm, number> = {
  MONTHLY: 1,
  SIX_MONTH: 6,
  TWELVE_MONTH: 12,
  TWENTY_FOUR_MONTH: 24,
};

/** The doc's own stated discount schedule — not derived. */
export const TERM_DISCOUNT_PCT: Record<SubscriptionTerm, number> = {
  MONTHLY: 0,
  SIX_MONTH: 0.05,
  TWELVE_MONTH: 0.1,
  TWENTY_FOUR_MONTH: 0.2,
};

export const TERM_LABELS: Record<SubscriptionTerm, string> = {
  MONTHLY: "Monthly",
  SIX_MONTH: "6 months",
  TWELVE_MONTH: "12 months",
  TWENTY_FOUR_MONTH: "24 months",
};

export { SUBSCRIPTION_TERMS };

export interface SubscriptionQuoteInput {
  plan: CreditPlan;
  term: SubscriptionTerm;
  /** Total seats the tenant wants, including the plan's included count.
   * Only the amount above PLAN_INCLUDED_SEATS[plan] is charged. */
  seats: number;
}

export interface SubscriptionQuote {
  plan: CreditPlan;
  term: SubscriptionTerm;
  termMonths: number;
  seats: number;
  includedSeats: number;
  extraSeats: number;
  basePriceMonthlyUsd: number;
  extraSeatMonthlyUsd: number;
  subtotalMonthlyUsd: number;
  discountPct: number;
  /** What's actually charged up front for the whole term. */
  totalDueUsd: number;
  /** Subtotal-per-month equivalent after the discount — what the doc calls
   * the "effective monthly price." */
  effectiveMonthlyPriceUsd: number;
  /** What the term would cost to renew at the SAME discounted rate — the
   * doc's own "renewal amount" line. Computed for display only; nothing
   * auto-charges this (no recurring-billing infra exists yet). */
  renewalAmountUsd: number;
}

export function computeSubscriptionQuote(input: SubscriptionQuoteInput): SubscriptionQuote {
  const termMonths = TERM_MONTHS[input.term];
  const discountPct = TERM_DISCOUNT_PCT[input.term];
  const includedSeats = PLAN_INCLUDED_SEATS[input.plan] ?? PLAN_INCLUDED_SEATS.FREE;
  const extraSeats = Math.max(0, input.seats - includedSeats);

  const basePriceMonthlyUsd = PLAN_MONTHLY_PRICE_USD[input.plan];
  const extraSeatMonthlyUsd = extraSeats * ADDITIONAL_SEAT_PRICE_USD;
  const subtotalMonthlyUsd = basePriceMonthlyUsd + extraSeatMonthlyUsd;

  const fullTermUsd = subtotalMonthlyUsd * termMonths;
  const totalDueUsd = round2(fullTermUsd * (1 - discountPct));
  const effectiveMonthlyPriceUsd = round2(totalDueUsd / termMonths);

  return {
    plan: input.plan,
    term: input.term,
    termMonths,
    seats: input.seats,
    includedSeats,
    extraSeats,
    basePriceMonthlyUsd,
    extraSeatMonthlyUsd,
    subtotalMonthlyUsd,
    discountPct,
    totalDueUsd,
    effectiveMonthlyPriceUsd,
    renewalAmountUsd: totalDueUsd,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
