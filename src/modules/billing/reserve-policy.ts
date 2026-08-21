import { db, schema } from "@/db/client";
import { and, eq, gte, sql } from "drizzle-orm";
import { FREE_TIER_GRANT_CREDITS } from "./pricing";
import { PLAN_MONTHLY_CREDITS } from "./plans";
import type { AgentRunTrigger, CreditPlan } from "@/db/schema";

// ============================================================================
// Tenant credit reserve & max-drawdown policy — "special AI notes."
//
// SHORT VERSION: this platform already gives every tenant ONE shared
// credit pool (credit_balances.tenantId, no per-agent column exists
// anywhere) — a tenant never buys separate credits per AI agent; every
// agent in their workspace draws from the same balance. That part needed
// no new work, only confirming and documenting (see BUILD_NOTES.md's
// "Special AI Notes" entry for the full writeup this file implements).
//
// What WAS missing: nothing stopped one low-priority use of that shared
// pool (agent-builder testing) from draining it down to zero and taking
// real, revenue-critical customer conversations down with it. This file
// is the fix — a two-part policy:
//
//   1. RESERVE — a slice of the tenant's monthly credit budget is off
//      limits to anything except a live customer conversation. Once the
//      balance drops into that slice, discretionary AI usage (agent
//      testing) is refused with a clear reason; a real customer talking
//      to the AI is NEVER refused for this reason — see checkCreditsForTrigger().
//   2. MAX DRAWDOWN — even above the reserve line, discretionary usage on
//      any single day is capped at a multiple of its fair daily share of
//      the monthly budget, so one heavy testing session can't burn a
//      meaningful fraction of the whole month's runway in an afternoon.
//
// Every threshold below is an AI-proposed default, not a business
// decision confirmed with a product owner (unlike the pricing constants
// in pricing.ts, which are marked as such) — chosen from common SaaS
// quota/reserve patterns (cloud cost-budget reserves commonly hold back
// 10-30% for critical workloads; rate-limit systems commonly cap bursts
// at 2-5x a steady-state share) and this platform's own real margin
// math. Revisit with real usage data once enough tenants have hit these
// limits to see whether they bind too early, too late, or about right.
// ============================================================================

/** How each AGENT_RUN_TRIGGERS value is treated by the reserve/drawdown policy. */
export const TRIGGER_TIER: Record<AgentRunTrigger, "ESSENTIAL" | "SEMI_ESSENTIAL" | "DISCRETIONARY"> = {
  // A real customer is on the other end of this conversation right now.
  // Never gated by the reserve or the daily cap — the one guarantee this
  // whole policy exists to protect.
  INBOUND_MESSAGE: "ESSENTIAL",
  // Not wired to a real AI call yet (the follow-up engine currently sends
  // template messages, not AI-generated ones — see followups/processor.ts)
  // but classified now so the policy is ready the day that changes. Sits
  // between the two: automated and revenue-relevant, but not a customer
  // mid-conversation, so it gets a larger daily allowance than pure
  // testing but is still capped and still pauses before the hard reserve
  // floor.
  FOLLOWUP: "SEMI_ESSENTIAL",
  // Internal agent-configuration testing (the "Test this agent" feature
  // in the agent builder). Never customer-facing — the safest thing to
  // pause first when a tenant's balance is low.
  SANDBOX_TEST: "DISCRETIONARY",
};

/** Fraction of the monthly allotment held back exclusively for ESSENTIAL usage. */
export const RESERVE_PCT = 0.2;
/** SEMI_ESSENTIAL pauses at a smaller buffer than the full reserve — it's automated/valuable but not a live customer. */
export const SEMI_ESSENTIAL_BUFFER_PCT = 0.1;
/** A single day's DISCRETIONARY usage is capped at this multiple of the monthly allotment's average daily share. */
export const DISCRETIONARY_DAILY_BURST_MULTIPLIER = 2;
/** SEMI_ESSENTIAL gets a bigger daily allowance than pure discretionary testing, but is still capped. */
export const SEMI_ESSENTIAL_DAILY_BURST_MULTIPLIER = 4;

/** The reference monthly credit budget a tenant's reserve/cap percentages
 * are computed against. FREE has no monthly renewal (its one-time signup
 * grant, FREE_TIER_GRANT_CREDITS, is used as the reference instead of
 * PLAN_MONTHLY_CREDITS.FREE, which is 0 by design — see plans.ts) so the
 * reserve/cap math still means something for a FREE tenant living off
 * their initial grant plus top-ups. */
export function resolveMonthlyAllotment(balance: { plan: CreditPlan; monthlyAllotment: number | null }): number {
  if (balance.monthlyAllotment && balance.monthlyAllotment > 0) return balance.monthlyAllotment;
  if (balance.plan === "FREE") return FREE_TIER_GRANT_CREDITS;
  // Defensive fallback for a plan value that predates the 3-tier model
  // (e.g. a stray "PAID" row from before CREDIT_PLANS changed) — treat it
  // as FREE's reference amount rather than crashing on an undefined
  // lookup. Confirmed via direct query that no such rows exist locally as
  // of this change; this guards production data this code can't inspect.
  return PLAN_MONTHLY_CREDITS[balance.plan] ?? FREE_TIER_GRANT_CREDITS;
}

export interface TieredCreditCheckResult {
  ok: boolean;
  balance: number;
  tier: "ESSENTIAL" | "SEMI_ESSENTIAL" | "DISCRETIONARY";
  /** Present only when ok is false — machine-readable reason for the caller/UI to explain to the tenant. */
  reason?: "balance_exhausted" | "reserve_protected" | "daily_cap_reached";
  reserveThreshold: number;
  dailyCap: number | null;
  usedToday: number;
}

/**
 * The tiered replacement for billing/ledger.ts's checkCredits() — same
 * "never call the AI provider without checking first" contract, but aware
 * of WHY this call is happening so a low balance protects live customer
 * conversations from being crowded out by testing/automation. ESSENTIAL
 * triggers reduce to the exact old behavior (balance > 0); the other two
 * tiers add the reserve floor and the daily burst cap on top.
 */
export async function checkCreditsForTrigger(tenantId: string, triggerType: AgentRunTrigger): Promise<TieredCreditCheckResult> {
  const [balanceRow] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.tenantId, tenantId)).limit(1);
  const balance = balanceRow?.balance ?? 0;
  const tier = TRIGGER_TIER[triggerType];
  const monthlyAllotment = resolveMonthlyAllotment(balanceRow ?? { plan: "FREE", monthlyAllotment: null });
  const reserveThreshold = Math.round(monthlyAllotment * RESERVE_PCT);
  const semiEssentialFloor = Math.round(monthlyAllotment * SEMI_ESSENTIAL_BUFFER_PCT);

  if (balance <= 0) {
    return { ok: false, balance, tier, reason: "balance_exhausted", reserveThreshold, dailyCap: null, usedToday: 0 };
  }

  if (tier === "ESSENTIAL") {
    // Unchanged from the original checkCredits(): a live customer
    // conversation is refused only when the tenant is genuinely at or
    // below zero, never for being "in the reserve."
    return { ok: true, balance, tier, reserveThreshold, dailyCap: null, usedToday: 0 };
  }

  const floor = tier === "SEMI_ESSENTIAL" ? semiEssentialFloor : reserveThreshold;
  if (balance <= floor) {
    return { ok: false, balance, tier, reason: "reserve_protected", reserveThreshold, dailyCap: null, usedToday: 0 };
  }

  const dailyCap = Math.round((monthlyAllotment / 30) * (tier === "SEMI_ESSENTIAL" ? SEMI_ESSENTIAL_DAILY_BURST_MULTIPLIER : DISCRETIONARY_DAILY_BURST_MULTIPLIER));
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [usedTodayRow] = await db
    .select({ n: sql<number>`coalesce(sum(-${schema.creditLedger.credits}), 0)::int` })
    .from(schema.creditLedger)
    .where(and(eq(schema.creditLedger.tenantId, tenantId), eq(schema.creditLedger.type, "CONSUMPTION"), gte(schema.creditLedger.createdAt, todayStart)));
  const usedToday = usedTodayRow?.n ?? 0;

  if (usedToday >= dailyCap) {
    return { ok: false, balance, tier, reason: "daily_cap_reached", reserveThreshold, dailyCap, usedToday };
  }

  return { ok: true, balance, tier, reserveThreshold, dailyCap, usedToday };
}

/** Human-readable explanation for a blocked check — used by both the sandbox-test UI and any future SEMI_ESSENTIAL caller. */
export function explainBlockedReason(result: TieredCreditCheckResult): string {
  switch (result.reason) {
    case "balance_exhausted":
      return "This tenant is out of AI credits.";
    case "reserve_protected":
      return `Balance (${result.balance} credits) has dropped into the reserve that protects live customer conversations (below ${result.reserveThreshold}) — non-essential AI usage pauses until it recovers. Live customer conversations keep working regardless.`;
    case "daily_cap_reached":
      return `Today's usage cap for this feature has been reached (${result.usedToday}/${result.dailyCap} credits) — this protects the rest of the month's runway from a single heavy day. Try again tomorrow, or top up to raise it sooner.`;
    default:
      return "AI credits are currently unavailable.";
  }
}
