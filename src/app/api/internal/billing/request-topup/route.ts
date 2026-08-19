import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { PAID_TOPUP_CREDITS, PAID_TOPUP_PRICE_USD } from "@/modules/billing/pricing";

// Deliberately does NOT grant credits. No real payment processor is
// connected yet (docs/ONBOARDING_TASKS.md P1 backlog — billing/subscription
// self-service) — crediting an account as if $20 had been paid when it
// hadn't would be fabricating a financial transaction, not a labelled
// DEMO/MOCK the way WhatsApp/Instagram/CRM connections are. This records
// the request honestly so the business can follow up manually until real
// checkout (Stripe or similar) is wired to this same button.
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
