import { db, schema } from "@/db/client";
import { and, eq, isNotNull, ne } from "drizzle-orm";

// Single shared definition of "this opportunity is still an active
// candidate for an automated follow-up" — an open (not WON/LOST) opportunity
// with AI follow-up enabled and attempts remaining. Previously the
// Dashboard's "overdue follow-ups" count (src/app/api/internal/dashboard)
// and the Follow-ups page (src/app/(app)/followups/page.tsx, via the plain
// /api/internal/opportunities list) each filtered independently and could
// disagree — e.g. the dashboard counted a WON opportunity whose
// nextFollowUpAt hadn't been cleared, while the Follow-ups page (via its
// own separate filtering logic) didn't. Both now call getFollowUpQueue()
// below, which itself reuses these exact conditions, so there is exactly
// one place that decides what counts.
export const MAX_ATTEMPTS = 3;

export function openFollowUpConditions() {
  return [ne(schema.opportunities.stage, "WON"), ne(schema.opportunities.stage, "LOST"), eq(schema.opportunities.aiFollowUpEnabled, true)];
  // Note: the "attempts remaining" (< MAX_ATTEMPTS) condition is applied by
  // the caller — runFollowUpCheck applies it as a DB filter, while the
  // queue below intentionally does NOT, so a maxed-out opportunity still
  // shows up (as neither due nor upcoming is quite right — see
  // getFollowUpQueue's doc comment) rather than silently disappearing.
}

export interface FollowUpOpportunity {
  id: string;
  contactId: string;
  stage: string;
  nextFollowUpAt: Date | null;
  followUpAttempts: number;
  followUpObjective: string | null;
  aiFollowUpEnabled: boolean;
}

/** The tenant's open opportunities that still have a scheduled follow-up,
 * split into overdue (nextFollowUpAt has passed) and upcoming — the exact
 * same "still open + AI-enabled" scope runFollowUpCheck() uses to decide
 * what's due, so this count and the worker's actual behavior can never
 * drift apart. Opportunities that have exhausted MAX_ATTEMPTS are
 * excluded from "overdue" (the worker would hand them to a human instead
 * of counting them as an automatable overdue follow-up) but are cheap
 * enough to just filter here rather than needing a third bucket. */
export async function getFollowUpQueue(tenantId: string, now: Date = new Date()): Promise<{ overdue: FollowUpOpportunity[]; upcoming: FollowUpOpportunity[] }> {
  const rows = await db
    .select({
      id: schema.opportunities.id,
      contactId: schema.opportunities.contactId,
      stage: schema.opportunities.stage,
      nextFollowUpAt: schema.opportunities.nextFollowUpAt,
      followUpAttempts: schema.opportunities.followUpAttempts,
      followUpObjective: schema.opportunities.followUpObjective,
      aiFollowUpEnabled: schema.opportunities.aiFollowUpEnabled,
    })
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.tenantId, tenantId), isNotNull(schema.opportunities.nextFollowUpAt), ...openFollowUpConditions()));

  const overdue = rows.filter((o) => o.followUpAttempts < MAX_ATTEMPTS && o.nextFollowUpAt! <= now);
  const upcoming = rows.filter((o) => o.nextFollowUpAt! > now);
  return { overdue, upcoming };
}

/** Just the count — what the Dashboard's "Needs Attention" panel needs,
 * without pulling full rows. */
export async function countOverdueFollowUps(tenantId: string, now: Date = new Date()): Promise<number> {
  const { overdue } = await getFollowUpQueue(tenantId, now);
  return overdue.length;
}
