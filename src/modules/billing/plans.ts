import { CREDIT_PRICE_USD, PAID_TOPUP_PRICE_USD } from "./pricing";
import type { CreditPlan } from "@/db/schema";

// ============================================================================
// Subscription plans (Master Product Architecture Update §3-5, §16).
// Separate commercial lever from AI credits — a plan gates FEATURE access
// (see modules/entitlements/service.ts), credits gate AI CONSUMPTION. A
// FREE tenant who buys credits repeatedly is still FREE-plan and still a
// real paying customer (§7, §43) — this file never conflates the two.
//
// PLAN_MONTHLY_PRICE_USD ($35/$45) is the doc's own stated commercial
// decision, not derived — same status as pricing.ts's credit-pricing
// constants.
//
// PLAN_MONTHLY_CREDITS is explicitly NOT that kind of decision. The doc is
// direct: "Do NOT guess these values... use actual AIExecutionGateway
// production/QA usage data." This platform does not yet have meaningful
// production volume to compute real P50/P90/P95 cost-per-conversation
// from (see scripts/calculate-plan-credits.ts, which computes exactly that
// once enough agent_runs history exists — run it periodically and update
// the values below). Until then, the values here are a **provisional
// bootstrap**, not a guess in the sense the doc warns against: they're
// formula-derived from the platform's own already-confirmed credit price
// ($0.008/credit, pricing.ts), not picked arbitrarily — "the subscription
// bundles the equivalent of its own price in AI credits, at the same rate
// a tenant would otherwise pay to buy them a la carte." Re-run the
// calculation script and replace these once real usage data exists, per
// the doc's own explicit allowance for a temporary test value.
// ============================================================================

export const PLAN_MONTHLY_PRICE_USD: Record<CreditPlan, number> = {
  FREE: 0,
  PRO: 35,
  PREMIUM: 45,
};

/** Provisional bootstrap — see file header. Recalculate with
 * scripts/calculate-plan-credits.ts once real usage data exists. */
export const PLAN_MONTHLY_CREDITS: Record<CreditPlan, number> = {
  FREE: 0, // FREE gets its allowance from the one-time signup grant (pricing.ts's FREE_TIER_GRANT_CREDITS), not a monthly renewal — see BUILD_NOTES.md §9i.
  PRO: Math.round(PLAN_MONTHLY_PRICE_USD.PRO / CREDIT_PRICE_USD),
  PREMIUM: Math.round(PLAN_MONTHLY_PRICE_USD.PREMIUM / CREDIT_PRICE_USD),
};

/** Top-up packages (Master Product Architecture Update §26-28). Same flat
 * $/credit rate as the original single $20 package (PAID_TOPUP_PRICE_USD
 * in pricing.ts) — deliberately no volume-discount bonus at larger
 * tiers, since a bonus percentage would itself be an unfounded guess the
 * doc explicitly warns against. A real volume-discount structure is a
 * legitimate future business decision, not a default to invent here. */
export interface CreditPackage {
  id: string;
  priceUsd: number;
  credits: number;
  custom?: boolean;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: "custom", priceUsd: 15, credits: Math.round(15 / CREDIT_PRICE_USD), custom: true }, // minimum for a custom amount ($15+, doc §26)
  { id: "pack_20", priceUsd: PAID_TOPUP_PRICE_USD, credits: Math.round(PAID_TOPUP_PRICE_USD / CREDIT_PRICE_USD) },
  { id: "pack_50", priceUsd: 50, credits: Math.round(50 / CREDIT_PRICE_USD) },
  { id: "pack_100", priceUsd: 100, credits: Math.round(100 / CREDIT_PRICE_USD) },
];

export const CUSTOM_TOPUP_MIN_USD = 15;

export function creditsForCustomAmount(usd: number): number {
  return Math.round(usd / CREDIT_PRICE_USD);
}

/** Human seats — Industry Team Subscription Architecture doc, Part B. A
 * fourth, deliberately independent commercial lever alongside plan/AI
 * credits/subscription term (the doc's own closing principle: these four
 * never merge). Included counts are the doc's own stated numbers, not
 * derived; ADDITIONAL_SEAT_PRICE_USD is likewise the doc's own $5/seat/mo. */
export const PLAN_INCLUDED_SEATS: Record<CreditPlan, number> = {
  FREE: 3,
  PRO: 7,
  PREMIUM: 15,
};

export const ADDITIONAL_SEAT_PRICE_USD = 5;
