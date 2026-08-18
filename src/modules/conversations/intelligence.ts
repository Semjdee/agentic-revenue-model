import { db, schema } from "@/db/client";
import { and, eq, gte } from "drizzle-orm";

// Conversation Intelligence (spec section 16). Lightweight keyword-based
// classification over customer messages — a real deployment would swap this
// for LLM-based classification (the AIProvider abstraction makes that a
// contained change), but the output shape (category -> count/%) already
// matches what the dashboard and AI Advertising Analyst consume.
const CATEGORY_PATTERNS: Record<string, RegExp> = {
  price: /\b(price|cost|expensive|cheap|afford|budget)\b/i,
  delivery: /\b(deliver|shipping|arrive|when.*get)\b/i,
  stock: /\b(stock|available|availability|out of stock)\b/i,
  payment: /\b(pay|payment|installment|mobile money|loan|financing)\b/i,
  warranty: /\b(warrant(y|ies)|guarantee)\b/i,
  competitors: /\b(competitor|other company|cheaper elsewhere|another provider)\b/i,
};

export interface ConversationIntelligence {
  totalCustomerMessages: number;
  objectionBreakdown: { category: string; count: number; pct: number }[];
  topRequestedProducts: { product: string; count: number }[];
  lostSaleReasons: { reason: string; count: number }[];
}

export async function computeConversationIntelligence(tenantId: string, sinceDays = 30): Promise<ConversationIntelligence> {
  const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);

  const msgs = await db
    .select({ content: schema.messages.content, createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.tenantId, tenantId), eq(schema.messages.sender, "CUSTOMER"), gte(schema.messages.createdAt, since)));

  const counts: Record<string, number> = {};
  for (const key of Object.keys(CATEGORY_PATTERNS)) counts[key] = 0;
  for (const m of msgs) {
    for (const [key, pattern] of Object.entries(CATEGORY_PATTERNS)) {
      if (pattern.test(m.content)) counts[key] += 1;
    }
  }
  const totalHits = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const objectionBreakdown = Object.entries(counts)
    .map(([category, count]) => ({ category, count, pct: Math.round((count / totalHits) * 100) }))
    .sort((a, b) => b.count - a.count);

  const conversations = await db
    .select({ productsDiscussed: schema.conversations.productsDiscussed })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), gte(schema.conversations.createdAt, since)));
  const productCounts: Record<string, number> = {};
  for (const c of conversations) {
    for (const p of c.productsDiscussed ?? []) productCounts[p] = (productCounts[p] ?? 0) + 1;
  }
  const topRequestedProducts = Object.entries(productCounts)
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const lostOpps = await db
    .select({ lostReason: schema.opportunities.lostReason })
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.tenantId, tenantId), eq(schema.opportunities.stage, "LOST")));
  const reasonCounts: Record<string, number> = {};
  for (const o of lostOpps) {
    const reason = o.lostReason || "Unspecified";
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  const lostSaleReasons = Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return { totalCustomerMessages: msgs.length, objectionBreakdown, topRequestedProducts, lostSaleReasons };
}
