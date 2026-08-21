import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { CREDIT_PACKAGES, CUSTOM_TOPUP_MIN_USD } from "@/modules/billing/plans";

// Public-to-tenants package list for the "Add Credits" UI (Master Product
// Architecture Update §39) — price and credits only, never the internal
// cost/margin numbers computed alongside these in
// scripts/calculate-plan-credits.ts (§27: "Do NOT expose this table to
// tenants").
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  return jsonOk({
    packages: CREDIT_PACKAGES.map((p) => ({ id: p.id, priceUsd: p.priceUsd, credits: p.credits, custom: p.custom ?? false })),
    customMinUsd: CUSTOM_TOPUP_MIN_USD,
  });
}
