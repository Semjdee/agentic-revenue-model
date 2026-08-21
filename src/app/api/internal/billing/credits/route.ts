import { db, schema } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { getOrInitBalance } from "@/modules/billing/ledger";
import { summarizeCapacityStatus } from "@/modules/billing/reserve-policy";

// Tenant-facing AI capacity — deliberately never returns the real
// balance, monthly allotment, or per-transaction credit amounts. Every
// role under a tenant (Owner, Sales, any department) sees the same coarse
// status: a rounded percent-remaining band + a 3-state status derived
// from the reserve policy's own 20% threshold (reserve-policy.ts's
// "Special AI Notes"). Raw numbers are Platform Admin only.
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const balance = await getOrInitBalance(session.tenantId);
  const recentRows = await db
    .select({ id: schema.creditLedger.id, type: schema.creditLedger.type, credits: schema.creditLedger.credits, createdAt: schema.creditLedger.createdAt })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.tenantId, session.tenantId))
    .orderBy(desc(schema.creditLedger.createdAt))
    .limit(50);

  const capacity = summarizeCapacityStatus(balance);

  // "direction" only — never the actual credit amount involved.
  const recent = recentRows.map((r) => ({ id: r.id, type: r.type, direction: r.credits >= 0 ? "added" : "used", createdAt: r.createdAt }));

  return jsonOk({ plan: balance.plan, status: capacity.status, percentRemainingBand: capacity.percentRemainingBand, recent });
}
