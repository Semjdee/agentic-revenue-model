import { db, schema } from "@/db/client";
import { sql } from "drizzle-orm";

// ============================================================================
// Cross-tenant cohort retention (platform-admin analytics — "deep
// platform admin analytics beyond the basic dashboard"). Groups tenants
// by the calendar month they signed up, and for each month-offset since
// signup, reports the real % of that cohort with at least one
// conversation in that offset month — the same "activity" bar the
// existing dashboard's activeTenants30d stat already uses (a conversation
// happened), not a fabricated "login" or "session" concept this platform
// doesn't track separately.
//
// A month-offset that hasn't happened yet for a given cohort (e.g. month
// 3 for a cohort that signed up 6 weeks ago) is reported as null, not 0%
// — "no data yet" and "churned" are different facts and this platform
// doesn't blur them.
// ============================================================================

export interface CohortRow {
  cohortMonth: string; // "2026-06"
  cohortSize: number;
  /** retention[i] = % of the cohort active in the i-th month after signup (0 = signup month itself). null = that month hasn't happened yet for this cohort. */
  retention: (number | null)[];
}

const MAX_MONTH_OFFSET = 6;

export async function computeCohortRetention(): Promise<CohortRow[]> {
  const tenantRows = await db.select({ id: schema.tenants.id, createdAt: schema.tenants.createdAt }).from(schema.tenants);
  if (!tenantRows.length) return [];

  // One query for "which tenant had a conversation in which calendar
  // month" rather than N+1 per tenant per offset.
  const activityRows = await db
    .select({
      tenantId: schema.conversations.tenantId,
      month: sql<string>`to_char(date_trunc('month', ${schema.conversations.createdAt}), 'YYYY-MM')`,
    })
    .from(schema.conversations)
    .groupBy(schema.conversations.tenantId, sql`date_trunc('month', ${schema.conversations.createdAt})`);

  const activeMonthsByTenant = new Map<string, Set<string>>();
  for (const row of activityRows) {
    const set = activeMonthsByTenant.get(row.tenantId) ?? new Set<string>();
    set.add(row.month);
    activeMonthsByTenant.set(row.tenantId, set);
  }

  const cohorts = new Map<string, string[]>(); // cohortMonth -> tenantIds
  for (const t of tenantRows) {
    const cohortMonth = monthKey(t.createdAt);
    const list = cohorts.get(cohortMonth) ?? [];
    list.push(t.id);
    cohorts.set(cohortMonth, list);
  }

  const now = new Date();
  const rows: CohortRow[] = [];
  for (const [cohortMonth, tenantIds] of cohorts) {
    const cohortStart = new Date(cohortMonth + "-01T00:00:00Z");
    const elapsedMonths = monthsBetween(cohortStart, now);
    const retention: (number | null)[] = [];
    for (let offset = 0; offset <= MAX_MONTH_OFFSET; offset++) {
      if (offset > elapsedMonths) {
        retention.push(null);
        continue;
      }
      const targetMonth = monthKey(addMonths(cohortStart, offset));
      const activeCount = tenantIds.filter((id) => activeMonthsByTenant.get(id)?.has(targetMonth)).length;
      retention.push(Math.round((activeCount / tenantIds.length) * 100));
    }
    rows.push({ cohortMonth, cohortSize: tenantIds.length, retention });
  }

  return rows.sort((a, b) => b.cohortMonth.localeCompare(a.cohortMonth));
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}
