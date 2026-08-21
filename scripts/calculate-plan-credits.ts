/* eslint-disable no-console */
// Master Product Architecture Update §5 & §27: "Do NOT guess these
// values... Use actual AIExecutionGateway production/QA usage data."
// This computes real P50/P90/P95 cost-per-run and cost-per-conversation
// from agent_runs, and prints the exact recommendation table the doc asks
// for (§27) plus the PRO/PREMIUM monthly-allocation math. Platform-admin
// / commercial-configuration tool — never expose this table to tenants
// (§27). Not part of the regular build; run manually as real usage
// accumulates and use the output to update modules/billing/plans.ts.
import "dotenv/config";
import { db, schema } from "../src/db/client";
import { eq, isNotNull } from "drizzle-orm";
import { CREDIT_PRICE_USD, MAX_COST_USD_PER_CREDIT, TARGET_GROSS_MARGIN } from "../src/modules/billing/pricing";
import { CREDIT_PACKAGES, PLAN_MONTHLY_PRICE_USD } from "../src/modules/billing/plans";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.status, "COMPLETED"));
  const realRuns = runs.filter((r) => Number(r.estimatedCostUsd) > 0); // exclude $0 MockAIProvider runs — see pricing.ts's approxCreditsFromCost header comment

  console.log(`Total COMPLETED runs: ${runs.length}. Real (non-mock, cost > $0) runs: ${realRuns.length}.\n`);

  if (realRuns.length < 30) {
    console.log("⚠️  Fewer than 30 real runs — not enough production/QA volume yet for a statistically meaningful P50/P90/P95.");
    console.log("    The numbers below are still computed from whatever real data exists, but treat them as directional only.");
    console.log("    Re-run this script once real tenant usage accumulates, and update modules/billing/plans.ts from its output.\n");
  }

  const costs = realRuns.map((r) => Number(r.estimatedCostUsd)).sort((a, b) => a - b);
  const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
  const p50 = percentile(costs, 50);
  const p90 = percentile(costs, 90);
  const p95 = percentile(costs, 95);

  console.log("--- Real cost per AI run (INBOUND_MESSAGE + SANDBOX_TEST + FOLLOWUP triggers) ---");
  console.log(`Average: $${avg.toFixed(5)}   P50: $${p50.toFixed(5)}   P90: $${p90.toFixed(5)}   P95: $${p95.toFixed(5)}`);

  // Cost per CONVERSATION (a conversation is usually several turns/runs) —
  // group by conversationId to get a real per-conversation total, not
  // just a per-turn figure.
  const byConversation = new Map<string, number>();
  for (const r of realRuns) {
    if (!r.conversationId) continue;
    byConversation.set(r.conversationId, (byConversation.get(r.conversationId) ?? 0) + Number(r.estimatedCostUsd));
  }
  const convoCosts = Array.from(byConversation.values()).sort((a, b) => a - b);
  const avgConvo = convoCosts.length ? convoCosts.reduce((a, b) => a + b, 0) / convoCosts.length : 0;
  console.log(`\n--- Real cost per CONVERSATION (${convoCosts.length} conversations with at least one real AI run) ---`);
  console.log(`Average: $${avgConvo.toFixed(5)}   P50: $${percentile(convoCosts, 50).toFixed(5)}   P90: $${percentile(convoCosts, 90).toFixed(5)}   P95: $${percentile(convoCosts, 95).toFixed(5)}`);

  console.log(`\n--- Current pricing constants (pricing.ts) ---`);
  console.log(`CREDIT_PRICE_USD: $${CREDIT_PRICE_USD.toFixed(4)}/credit   MAX_COST_USD_PER_CREDIT: $${MAX_COST_USD_PER_CREDIT.toFixed(4)}   TARGET_GROSS_MARGIN: ${(TARGET_GROSS_MARGIN * 100).toFixed(0)}%`);

  console.log(`\n--- Top-up package economics (doc §27's requested table — Platform Admin only, never shown to tenants) ---`);
  console.log("Purchase\tCredits\tEst. Delivery Cost\tRevenue\tGross Profit\tGross Margin");
  for (const pkg of CREDIT_PACKAGES) {
    const deliveryCost = pkg.credits * MAX_COST_USD_PER_CREDIT;
    const profit = pkg.priceUsd - deliveryCost;
    const margin = (profit / pkg.priceUsd) * 100;
    console.log(`$${pkg.priceUsd}${pkg.custom ? " (min custom)" : ""}\t${pkg.credits}\t$${deliveryCost.toFixed(2)}\t$${pkg.priceUsd.toFixed(2)}\t$${profit.toFixed(2)}\t${margin.toFixed(1)}%`);
  }

  console.log(`\n--- PRO/PREMIUM monthly allocation (provisional bootstrap in plans.ts, translated into real conversation volume) ---`);
  for (const plan of ["PRO", "PREMIUM"] as const) {
    const price = PLAN_MONTHLY_PRICE_USD[plan];
    const bootstrapCredits = Math.round(price / CREDIT_PRICE_USD);
    console.log(`${plan} ($${price}/mo): provisional bootstrap = ${bootstrapCredits} credits.`);
    if (avgConvo > 0) {
      const impliedConversations = Math.round((bootstrapCredits * CREDIT_PRICE_USD) / avgConvo);
      console.log(`  At the real average cost/conversation observed above ($${avgConvo.toFixed(5)}), that bootstrap allocation covers roughly ${impliedConversations} typical conversations/month — sanity-check this against expected PRO/PREMIUM usage volume (a business assumption this script can't supply) before treating it as final.`);
    } else {
      console.log("  No real conversation-cost data yet to sanity-check this against — keep the bootstrap value until some exists.");
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
