import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { requirePlatformSession } from "@/lib/platform-auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { getOrInitBalance } from "@/modules/billing/ledger";
import { CREDIT_PLANS } from "@/db/schema";

// No recurring subscription-billing integration exists yet (P0 shipped
// Flutterwave for one-time credit top-ups only — see
// modules/entitlements/service.ts's header comment) — until one does,
// this is how a tenant actually moves onto PRO/PREMIUM: a platform staff
// member sets it here after confirming payment out of band. Every
// creditBalances row otherwise defaults to FREE forever
// (getOrInitBalance() in billing/ledger.ts) with no other write path.
const bodySchema = z.object({ plan: z.enum(CREDIT_PLANS) });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let session;
  try {
    session = await requirePlatformSession();
  } catch {
    return jsonError("Not authenticated", 401);
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, params.id)).limit(1);
  if (!tenant) return jsonError("Tenant not found", 404);

  const before = await getOrInitBalance(params.id);
  await db.update(schema.creditBalances).set({ plan: parsed.data.plan, updatedAt: new Date() }).where(eq(schema.creditBalances.tenantId, params.id));

  await logAudit({
    tenantId: params.id,
    action: "platform.tenant_plan_changed",
    entity: "credit_balance",
    entityId: before.id,
    source: "SYSTEM",
    before: { plan: before.plan },
    after: { plan: parsed.data.plan, changedByPlatformStaffId: session.staffId },
  });

  return jsonOk({ ok: true, plan: parsed.data.plan });
}
