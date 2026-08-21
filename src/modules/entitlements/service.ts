import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import type { CreditPlan } from "@/db/schema";

// ============================================================================
// EntitlementService (Master Product Architecture Update §44). Centralized
// plan → feature resolution, replacing what the doc explicitly warns
// against: `if (plan === "pro")` scattered through components. Every
// gated route/page calls hasFeature() here instead.
//
// This sits ABOVE existing RBAC (src/lib/permissions.ts), not in place of
// it — the doc's own layered hierarchy (§9) is Feature availability →
// Subscription/Entitlement → Credits Available → Tenant Role/RBAC →
// existing Drawdown/Usage Limit → ... → AIExecutionGateway → Audit Log.
// A gated route checks hasFeature() FIRST (does this plan allow the
// feature at all), then hasPermission() (does this role), then the
// existing credit/reserve checks (modules/billing/reserve-policy.ts) —
// each layer already exists and is untouched; this only adds the missing
// top layer.
//
// Real payment collection (Flutterwave) grants CREDITS
// (modules/billing/ledger.ts's grantCredits) — a separate lever from
// PLAN, which a platform admin sets directly today (no recurring
// subscription-billing integration exists yet — see
// api/platform/tenants/[id]/plan/route.ts's header comment). Both are
// intentionally decoupled per the doc's §43 "subscriptions and credits
// remain separate."
// ============================================================================

export const FEATURE_KEYS = [
  "advanced_sales_diagnostics",
  "predictive_sales_intelligence",
  "advanced_attribution",
  "multi_touch_attribution",
  "assisted_attribution",
  "advanced_ad_analysis",
  "revenue_goal_agent",
  "autonomous_ad_optimization",
  "influencer_intelligence",
  "advanced_agent_analytics",
  "specialist_agents",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

// Doc §10-14/§48: FREE = L0+L1, PRO = + L2 diagnostic + L3 predictive,
// PREMIUM = + L4 prescriptive/autonomous. Every key below maps to exactly
// one of those levels; FREE gets none of them (it gets L0/L1 features by
// simply never being gated in the first place — see modules the doc lists
// as "core platform capabilities," which have no hasFeature() check at
// all, e.g. leads/opportunities/CRM/knowledge base).
const PRO_FEATURES: FeatureKey[] = [
  "advanced_sales_diagnostics",
  "predictive_sales_intelligence",
  "advanced_attribution",
  "multi_touch_attribution",
  "assisted_attribution",
  "advanced_ad_analysis",
  "influencer_intelligence",
  "advanced_agent_analytics",
];
const PREMIUM_ONLY_FEATURES: FeatureKey[] = ["revenue_goal_agent", "autonomous_ad_optimization", "specialist_agents"];

export const PLAN_FEATURES: Record<CreditPlan, Set<FeatureKey>> = {
  FREE: new Set(),
  PRO: new Set(PRO_FEATURES),
  PREMIUM: new Set([...PRO_FEATURES, ...PREMIUM_ONLY_FEATURES]),
};

export interface TenantEntitlements {
  plan: CreditPlan;
  features: Set<FeatureKey>;
}

/** Server-side only — never trust a client-supplied plan. Queries
 * credit_balances fresh (same source resolveMonthlyAllotment() reads),
 * not a session JWT — neither the tenant nor platform-staff session
 * carries plan (see src/lib/auth.ts / platform-auth.ts), by design: a
 * plan can change between requests (a platform admin can update it any
 * time via api/platform/tenants/[id]/plan), so a JWT claim would risk
 * going stale until re-login. */
export async function getEntitlements(tenantId: string): Promise<TenantEntitlements> {
  const [balance] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.tenantId, tenantId)).limit(1);
  const plan: CreditPlan = balance?.plan ?? "FREE";
  // Same defensive fallback as reserve-policy.ts's resolveMonthlyAllotment()
  // — an unrecognized plan value (e.g. a pre-3-tier "PAID" row) resolves
  // to FREE's feature set rather than an undefined lookup.
  return { plan, features: PLAN_FEATURES[plan] ?? PLAN_FEATURES.FREE };
}

export async function hasFeature(tenantId: string, feature: FeatureKey): Promise<boolean> {
  const { features } = await getEntitlements(tenantId);
  return features.has(feature);
}

/** Friendly, consistent "this needs a plan" response body for a gated
 * route to return — one shape every gated API uses, so the frontend's
 * upgrade-prompt UI (doc §23-24's "See Why · Pro" pattern) can handle
 * all of them the same way rather than parsing bespoke error text. */
export function entitlementRequiredError(feature: FeatureKey, currentPlan: CreditPlan) {
  const requiredPlan = PLAN_FEATURES.PRO.has(feature) && !PLAN_FEATURES.PREMIUM.has(feature) ? "PRO" : PREMIUM_ONLY_FEATURES.includes(feature) ? "PREMIUM" : "PRO";
  return { feature, currentPlan, requiredPlan };
}
