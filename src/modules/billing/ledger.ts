import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { computeApiCostUsd, computeCreditsCharged, type UsageInput } from "./pricing";

// Single chokepoint for every credit balance read/write — every AI call
// site (conversation engine, sandbox) goes through checkCredits() before
// calling the model and chargeUsage() after, never touching
// credit_balances/credit_ledger directly. Same "one place, not
// re-implemented per caller" discipline as src/modules/onboarding/service.ts.

export async function getOrInitBalance(tenantId: string) {
  const [existing] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.tenantId, tenantId)).limit(1);
  if (existing) return existing;

  const id = generateId();
  await db.insert(schema.creditBalances).values({ id, tenantId, balance: 0, plan: "FREE" });
  const [created] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.id, id)).limit(1);
  return created;
}

/** Adds credits (signup grant, a real paid top-up once billing is wired,
 * or a manual adjustment) and records why. Never call db.update on
 * credit_balances directly outside this file — every change needs a
 * matching ledger row or the balance and the audit trail drift apart. */
export async function grantCredits(tenantId: string, amount: number, type: "GRANT" | "PURCHASE" | "ADJUSTMENT", reason: string) {
  const current = await getOrInitBalance(tenantId);
  const balanceAfter = current.balance + amount;

  await db.update(schema.creditBalances).set({ balance: balanceAfter, updatedAt: new Date() }).where(eq(schema.creditBalances.tenantId, tenantId));
  await db.insert(schema.creditLedger).values({
    id: generateId(),
    tenantId,
    type,
    credits: amount,
    balanceAfter,
    reason,
  });

  return balanceAfter;
}

export interface CreditCheckResult {
  ok: boolean;
  balance: number;
}

/** Pre-call check — never let a conversation reach the AI provider with a
 * balance at or below zero. This is the actual enforcement point; the
 * conversation engine must not call getAIProvider().generateReply() unless
 * this returns ok:true. */
export async function checkCredits(tenantId: string): Promise<CreditCheckResult> {
  const { balance } = await getOrInitBalance(tenantId);
  return { ok: balance > 0, balance };
}

/** Post-call charge — meters what the AI call actually cost and deducts
 * it. Can only run AFTER the provider returns, since exact token counts
 * aren't known beforehand; this is why checkCredits() is a >0 gate rather
 * than a "do we have enough for this exact call" check — the balance can
 * go slightly negative on the turn that exhausts it, but checkCredits()
 * blocks every turn after that. Standard for token-metered systems where
 * cost is only known post-hoc; documented here rather than left implicit. */
export async function chargeUsage(params: { tenantId: string; conversationId?: string | null; usage: UsageInput }) {
  const costUsd = computeApiCostUsd(params.usage);
  const credits = computeCreditsCharged(costUsd);
  const current = await getOrInitBalance(params.tenantId);
  const balanceAfter = current.balance - credits;

  await db.update(schema.creditBalances).set({ balance: balanceAfter, updatedAt: new Date() }).where(eq(schema.creditBalances.tenantId, params.tenantId));
  await db.insert(schema.creditLedger).values({
    id: generateId(),
    tenantId: params.tenantId,
    type: "CONSUMPTION",
    credits: -credits,
    balanceAfter,
    model: params.usage.model,
    inputTokens: params.usage.inputTokens,
    outputTokens: params.usage.outputTokens,
    cacheReadTokens: params.usage.cacheReadTokens ?? 0,
    cacheWriteTokens: params.usage.cacheWriteTokens ?? 0,
    costUsd: costUsd.toFixed(6),
    conversationId: params.conversationId ?? null,
    reason: "ai_reply",
  });

  return { credits, costUsd, balanceAfter };
}
