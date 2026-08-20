import { db, schema } from "@/db/client";
import { and, eq, gte, sql } from "drizzle-orm";
import { requirePlatformSession } from "@/lib/platform-auth";
import { jsonError, jsonOk } from "@/lib/api";
import { FREE_TIER_GRANT_CREDITS } from "@/modules/billing/pricing";

// Cross-tenant aggregate stats — the one legitimate place in this
// codebase that queries across tenant boundaries, gated by
// requirePlatformSession() (never getSession()) so a tenant-scoped role
// can never reach it, however privileged (see src/lib/platform-auth.ts's
// header comment). Every number here is computed from real rows; where
// the underlying capability doesn't exist yet (MRR, paid subscriptions —
// no recurring-billing model is wired up, see
// src/app/api/internal/billing/request-topup/route.ts), it's reported
// as genuinely zero/untracked rather than invented.
export async function GET() {
  try {
    await requirePlatformSession();
  } catch {
    return jsonError("Not authenticated", 401);
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  // Roughly the same "running low" bar Settings → Credits & Usage already
  // shows a tenant for themselves (10% of the free-tier grant) — reused
  // here rather than inventing a second threshold.
  const LOW_BALANCE_THRESHOLD = FREE_TIER_GRANT_CREDITS * 0.1;

  const [tenantCount] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.tenants);
  const [activeTenants] = await db
    .select({ n: sql<number>`count(distinct ${schema.conversations.tenantId})::int` })
    .from(schema.conversations)
    .where(gte(schema.conversations.createdAt, thirtyDaysAgo));
  const [userCount] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);

  const [creditUsage] = await db
    .select({
      creditsConsumed: sql<number>`coalesce(sum(-${schema.creditLedger.credits}), 0)::int`,
      costUsd: sql<number>`coalesce(sum(${schema.creditLedger.costUsd}), 0)`,
    })
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.type, "CONSUMPTION"));

  const [tenantsApproachingLimits] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.creditBalances)
    .where(sql`${schema.creditBalances.balance} <= ${LOW_BALANCE_THRESHOLD}`);

  const [failedIntegrations] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.integrations).where(eq(schema.integrations.status, "ERROR"));

  const [conversationsToday] = await db
    .select({ n: sql<number>`count(distinct ${schema.agentRuns.conversationId})::int` })
    .from(schema.agentRuns)
    .where(and(gte(schema.agentRuns.startedAt, todayStart), eq(schema.agentRuns.triggerType, "INBOUND_MESSAGE")));

  const [paidPlanTenants] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.creditBalances).where(eq(schema.creditBalances.plan, "PAID"));

  // Per-tenant list for the table below the stat tiles.
  const tenantRows = await db.select().from(schema.tenants).orderBy(sql`${schema.tenants.createdAt} desc`).limit(100);
  const balances = await db.select().from(schema.creditBalances);
  const balanceByTenant = new Map(balances.map((b) => [b.tenantId, b]));
  const progressRows = await db.select().from(schema.onboardingProgress);
  const progressByTenant = new Map(progressRows.map((p) => [p.tenantId, p]));

  const tenants = tenantRows.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt,
    plan: balanceByTenant.get(t.id)?.plan ?? "FREE",
    creditBalance: balanceByTenant.get(t.id)?.balance ?? 0,
    onboardingStep: progressByTenant.get(t.id)?.currentStep ?? null,
    wentLive: Boolean(progressByTenant.get(t.id)?.completedAt),
  }));

  // Onboarding funnel — the literal original ask (docs/ONBOARDING_TASKS.md
  // backlog: "SMS Consult staff viewing every tenant's onboarding funnel/
  // drop-off, not just their own"). completedSteps is a jsonb array per
  // tenant; count how many tenants have reached (or passed) each step.
  const funnel: Record<string, number> = {};
  for (const step of schema.ONBOARDING_STEPS) funnel[step] = 0;
  for (const p of progressRows) {
    const reached = new Set([...(p.completedSteps ?? []), p.currentStep]);
    for (const step of schema.ONBOARDING_STEPS) {
      if (reached.has(step)) funnel[step]++;
    }
  }

  return jsonOk({
    stats: {
      totalTenants: tenantCount.n,
      activeTenants30d: activeTenants.n,
      totalUsers: userCount.n,
      creditsConsumed: creditUsage.creditsConsumed,
      aiProviderCostUsd: Number(creditUsage.costUsd),
      tenantsApproachingLimits: tenantsApproachingLimits.n,
      failedIntegrations: failedIntegrations.n,
      aiConversationsToday: conversationsToday.n,
      // Genuinely untracked — no recurring-billing model exists yet
      // (see file header). Reported honestly rather than invented.
      mrrUsd: null,
      proSubscriptions: paidPlanTenants.n,
      billingTracked: false,
    },
    funnel,
    tenants,
  });
}
