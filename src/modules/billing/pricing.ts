// Real Anthropic API pricing, and the margin math the credits system is
// built on. This is the ONE place these numbers live — everything else in
// src/modules/billing/** and the conversation engine reads from here rather
// than hardcoding a $/token figure anywhere else.
//
// Pricing verified against Anthropic's own current rate card (checked
// 2026-08-19, standard post-intro rates — NOT the temporary Sonnet 5 intro
// pricing that expires 2026-08-31, which would make the margin math below
// stale within days). Re-verify and update these constants if Anthropic
// changes pricing, or if the intro rate lapse actually lands and the
// standard rate changes.

export interface ModelRate {
  /** $ per 1,000,000 uncached input tokens. */
  inputPerM: number;
  /** $ per 1,000,000 output tokens. */
  outputPerM: number;
  /** $ per 1,000,000 tokens written to the prompt cache (~1.25x input rate). */
  cacheWritePerM: number;
  /** $ per 1,000,000 tokens read from the prompt cache (~0.1x input rate). */
  cacheReadPerM: number;
}

export const MODEL_RATES: Record<string, ModelRate> = {
  "claude-sonnet-5": { inputPerM: 3.0, outputPerM: 15.0, cacheWritePerM: 3.75, cacheReadPerM: 0.3 },
  "claude-haiku-4-5": { inputPerM: 1.0, outputPerM: 5.0, cacheWritePerM: 1.25, cacheReadPerM: 0.1 },
};

/** Model used when nothing routes to something else — see model-router.ts.
 * Haiku 4.5, not Sonnet 5: at this platform's credit pricing (below),
 * routing every reply through Sonnet 5 runs at break-even-to-negative
 * margin before infrastructure costs are even counted (see the worked
 * example in BUILD_NOTES.md's billing entry). Haiku handles routine
 * qualification/product-question turns; model-router.ts escalates to
 * Sonnet 5 for complex or high-value ones. */
export const DEFAULT_MODEL = "claude-haiku-4-5";
export const ESCALATION_MODEL = "claude-sonnet-5";

// --- Credit pricing (business decision, confirmed with the product owner
// 2026-08-19) ------------------------------------------------------------
export const FREE_TIER_GRANT_CREDITS = 1000;
export const PAID_TOPUP_CREDITS = 2500;
export const PAID_TOPUP_PRICE_USD = 20;

export const CREDIT_PRICE_USD = PAID_TOPUP_PRICE_USD / PAID_TOPUP_CREDITS; // $0.008/credit

/** Target gross margin on AI usage specifically (not overall company
 * margin — Postgres/Redis/Netlify/etc. are separate line items this
 * doesn't account for). 70% is a conservative, typical SaaS-on-LLM target;
 * adjust here if the business wants to run thinner for growth or thicker
 * for safety — every other number in this file derives from it. */
export const TARGET_GROSS_MARGIN = 0.7;

/** The maximum real API cost one credit is allowed to represent while
 * still hitting TARGET_GROSS_MARGIN at CREDIT_PRICE_USD. This is the
 * actual lever that protects margin — see computeCreditsCharged(). */
export const MAX_COST_USD_PER_CREDIT = CREDIT_PRICE_USD * (1 - TARGET_GROSS_MARGIN); // $0.0024

export interface UsageInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Real dollar cost of one AI call, from actual token counts — not an
 * estimate. Falls back to Haiku's rate for an unrecognized model string
 * rather than throwing, so a misconfigured model name degrades to
 * "charge conservatively" instead of crashing a live conversation. */
export function computeApiCostUsd(usage: UsageInput): number {
  const rate = MODEL_RATES[usage.model] ?? MODEL_RATES[DEFAULT_MODEL];
  const input = (usage.inputTokens / 1_000_000) * rate.inputPerM;
  const output = (usage.outputTokens / 1_000_000) * rate.outputPerM;
  const cacheRead = ((usage.cacheReadTokens ?? 0) / 1_000_000) * rate.cacheReadPerM;
  const cacheWrite = ((usage.cacheWriteTokens ?? 0) / 1_000_000) * rate.cacheWritePerM;
  return input + output + cacheRead + cacheWrite;
}

/** Credits charged for one AI call. Always at least 1 — a turn cheap
 * enough to round to 0 credits would otherwise be free forever, which
 * isn't a rounding error, it's an unmetered hole. Rounding up on cheap
 * (mostly Haiku) turns means realized margin on those turns runs above
 * TARGET_GROSS_MARGIN, which is the safe direction to be wrong in. */
export function computeCreditsCharged(costUsd: number): number {
  return Math.max(1, Math.ceil(costUsd / MAX_COST_USD_PER_CREDIT));
}
