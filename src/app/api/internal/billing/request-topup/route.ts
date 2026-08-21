import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { PAID_TOPUP_CREDITS, PAID_TOPUP_PRICE_USD } from "@/modules/billing/pricing";

// Superseded by /api/internal/billing/topup/initiate (real Flutterwave
// mobile-money purchases — modules/billing/topup.ts), which the Settings
// → Credits & Usage "Add Credits" dialog uses now. Left in place, unused
// by the current UI, only as a manual fallback path (audit-log the
// request, follow up outside the platform) if the real payment flow is
// ever unavailable — deliberately still does NOT grant credits itself,
// same reasoning as before: crediting an account as if payment had
// happened without it would be fabricating a financial transaction.
export async function POST() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "billing.topup_requested",
    entity: "credit_balance",
    entityId: session.tenantId,
    after: { credits: PAID_TOPUP_CREDITS, priceUsd: PAID_TOPUP_PRICE_USD },
  });

  return jsonOk({
    ok: true,
    message: "Request recorded. Real payment collection isn't connected yet — we'll follow up to complete this top-up.",
  });
}
