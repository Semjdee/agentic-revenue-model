import { db, schema } from "@/db/client";
import { and, eq, inArray } from "drizzle-orm";
import { PLAN_INCLUDED_SEATS } from "@/modules/billing/plans";
import { getOrInitBalance } from "@/modules/billing/ledger";
import type { CreditPlan } from "@/db/schema";

// Team seats — Industry Team Subscription Architecture doc, Part B.
//
// countBillableSeats() counts ACTIVE + INVITED users: an invite reserves
// seat capacity immediately (the doc's own rule — a tenant can't invite
// past their limit and leave the pending invite uncounted), while
// SUSPENDED/DEACTIVATED free the seat back up. This is independent of the
// existing `active` boolean, which nothing here touches.

const BILLABLE_STATUSES: (typeof schema.USER_STATUSES)[number][] = ["ACTIVE", "INVITED"];

export async function countBillableSeats(tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenantId), inArray(schema.users.status, BILLABLE_STATUSES)));
  return rows.length;
}

export interface SeatAvailability {
  plan: CreditPlan;
  used: number;
  included: number;
  extra: number;
  atOrOverIncluded: boolean;
}

/** Extra seats beyond the plan's included count ARE allowed on PRO/PREMIUM
 * (billed via a subscription purchase — modules/billing/subscription-
 * purchase.ts — not blocked). FREE has no path to buy additional seats
 * (the doc's own rule: "Free cannot purchase additional seats during
 * MVP.") — callers block the invite there. */
export async function checkSeatAvailability(tenantId: string): Promise<SeatAvailability> {
  const [balance, used] = await Promise.all([getOrInitBalance(tenantId), countBillableSeats(tenantId)]);
  const included = PLAN_INCLUDED_SEATS[balance.plan] ?? PLAN_INCLUDED_SEATS.FREE;
  return {
    plan: balance.plan,
    used,
    included,
    extra: Math.max(0, used - included),
    atOrOverIncluded: used >= included,
  };
}
