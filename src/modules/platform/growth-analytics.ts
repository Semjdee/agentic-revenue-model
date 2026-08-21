import { db, schema } from "@/db/client";
import { inArray, sql } from "drizzle-orm";
import { PLAN_INCLUDED_SEATS } from "@/modules/billing/plans";
import { computeSubscriptionQuote, TERM_LABELS } from "@/modules/billing/subscription-pricing";
import type { CreditPlan, SubscriptionTerm } from "@/db/schema";

// Platform Admin growth analytics — Industry Team Subscription
// Architecture doc, Part E. Template adoption / seat expansion /
// subscription-term preference, extending the AI-economics module's
// discipline: every number is a real aggregate over rows that exist
// today, honestly 0 where nothing real has happened yet (no seed data or
// invented "typical" numbers).

export interface TemplateAdoptionRow {
  templateKey: string | null; // null = no template applied ("Started from scratch")
  tenantCount: number;
  paidTenantCount: number; // PRO or PREMIUM — a simple adoption→paid-conversion proxy
}

export async function computeTemplateAdoption(): Promise<TemplateAdoptionRow[]> {
  const tenants = await db.select({ id: schema.tenants.id, key: schema.tenants.appliedIndustryTemplateKey }).from(schema.tenants);
  const balances = await db.select({ tenantId: schema.creditBalances.tenantId, plan: schema.creditBalances.plan }).from(schema.creditBalances);
  const planByTenant = new Map(balances.map((b) => [b.tenantId, b.plan]));

  const byKey = new Map<string | null, { tenantCount: number; paidTenantCount: number }>();
  for (const t of tenants) {
    const key = t.key ?? null;
    const entry = byKey.get(key) ?? { tenantCount: 0, paidTenantCount: 0 };
    entry.tenantCount += 1;
    const plan = planByTenant.get(t.id);
    if (plan === "PRO" || plan === "PREMIUM") entry.paidTenantCount += 1;
    byKey.set(key, entry);
  }

  return Array.from(byKey.entries())
    .map(([templateKey, v]) => ({ templateKey, ...v }))
    .sort((a, b) => b.tenantCount - a.tenantCount);
}

export interface SeatGrowthSummary {
  totalTenants: number;
  totalBillableSeats: number;
  totalIncludedSeats: number;
  totalExtraSeats: number;
  byPlan: { plan: CreditPlan; tenants: number; billableSeats: number; extraSeats: number }[];
}

const BILLABLE_STATUSES = ["ACTIVE", "INVITED"] as const;

export async function computeSeatGrowth(): Promise<SeatGrowthSummary> {
  const [balances, userCounts] = await Promise.all([
    db.select({ tenantId: schema.creditBalances.tenantId, plan: schema.creditBalances.plan }).from(schema.creditBalances),
    db
      .select({ tenantId: schema.users.tenantId, n: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(inArray(schema.users.status, BILLABLE_STATUSES))
      .groupBy(schema.users.tenantId),
  ]);
  const seatsByTenant = new Map(userCounts.map((r) => [r.tenantId, r.n]));

  const byPlan = new Map<CreditPlan, { tenants: number; billableSeats: number; extraSeats: number }>();
  for (const b of balances) {
    const seats = seatsByTenant.get(b.tenantId) ?? 0;
    const included = PLAN_INCLUDED_SEATS[b.plan] ?? PLAN_INCLUDED_SEATS.FREE;
    const entry = byPlan.get(b.plan) ?? { tenants: 0, billableSeats: 0, extraSeats: 0 };
    entry.tenants += 1;
    entry.billableSeats += seats;
    entry.extraSeats += Math.max(0, seats - included);
    byPlan.set(b.plan, entry);
  }

  const byPlanArr = Array.from(byPlan.entries()).map(([plan, v]) => ({ plan, ...v }));
  return {
    totalTenants: balances.length,
    totalBillableSeats: byPlanArr.reduce((s, r) => s + r.billableSeats, 0),
    totalIncludedSeats: balances.reduce((s, b) => s + (PLAN_INCLUDED_SEATS[b.plan] ?? PLAN_INCLUDED_SEATS.FREE), 0),
    totalExtraSeats: byPlanArr.reduce((s, r) => s + r.extraSeats, 0),
    byPlan: byPlanArr,
  };
}

export interface TermDistributionRow {
  term: SubscriptionTerm;
  label: string;
  purchaseCount: number;
  avgDiscountPct: number;
  totalRevenueUsd: number;
}

/** Real subscription purchases only (the `subscriptions` table is written
 * exactly once per successfully-fulfilled purchase — see
 * modules/billing/subscription-purchase.ts) — honestly all-zero rows until
 * the first real term purchase completes. */
export async function computeTermDistribution(): Promise<TermDistributionRow[]> {
  const rows = await db.select().from(schema.subscriptions);
  const byTerm = new Map<SubscriptionTerm, { count: number; discountSum: number; revenue: number }>();
  for (const r of rows) {
    const quote = computeSubscriptionQuote({ plan: r.plan, term: r.term, seats: r.seats });
    const entry = byTerm.get(r.term) ?? { count: 0, discountSum: 0, revenue: 0 };
    entry.count += 1;
    entry.discountSum += quote.discountPct * 100;
    entry.revenue += Number(r.totalUsd);
    byTerm.set(r.term, entry);
  }
  return Array.from(byTerm.entries())
    .map(([term, v]) => ({ term, label: TERM_LABELS[term], purchaseCount: v.count, avgDiscountPct: v.count > 0 ? v.discountSum / v.count : 0, totalRevenueUsd: v.revenue }))
    .sort((a, b) => b.totalRevenueUsd - a.totalRevenueUsd);
}
