import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { getOrInitBalance } from "@/modules/billing/ledger";
import { FREE_TIER_GRANT_CREDITS, PAID_TOPUP_CREDITS, PAID_TOPUP_PRICE_USD } from "@/modules/billing/pricing";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const balance = await getOrInitBalance(session.tenantId);
  const recent = await db
    .select()
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.tenantId, session.tenantId))
    .orderBy(desc(schema.creditLedger.createdAt))
    .limit(50);

  return jsonOk({
    balance: balance.balance,
    plan: balance.plan,
    recent,
    pricing: { freeTierGrant: FREE_TIER_GRANT_CREDITS, paidTopupCredits: PAID_TOPUP_CREDITS, paidTopupPriceUsd: PAID_TOPUP_PRICE_USD },
  });
}
