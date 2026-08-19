import { db, schema } from "@/db/client";
import { eq, asc } from "drizzle-orm";

// docs/ONBOARDING_SPEC.md sections 19-21/33 — TTFV + funnel analytics.
// Pure read/compute functions, no LLM involvement (same discipline as
// src/modules/advertising/analyst.ts and src/modules/influencers/metrics.ts
// elsewhere in this codebase — the platform calculates, nothing here
// interprets).
//
// Scoped to a single tenant rather than the spec's literal cross-tenant
// admin dashboard (section 33 describes SMS Consult staff viewing every
// tenant's funnel) — this codebase has no "platform staff" auth concept
// distinct from per-tenant roles (src/lib/permissions.ts is entirely
// tenant-scoped by design, for multi-tenant isolation). Building
// cross-tenant admin access needs that auth concept designed first, not
// bolted on under time pressure — flagged in docs/ONBOARDING_TASKS.md
// backlog. This tenant-scoped version still answers the real question
// ("how long did MY activation take, where am I in the funnel") using
// existing session auth, safely.

const MILESTONE_EVENTS = [
  "signup_completed",
  "workspace_created",
  "business_profile_completed",
  "knowledge_import_completed",
  "agent_generated",
  "agent_test_completed",
  "channel_connected",
  "health_check_completed",
  "go_live_clicked",
  "agent_activated",
  "first_real_conversation",
  "first_contact_created",
  "first_lead_created",
  "first_qualified_lead",
  "first_sale",
  "first_attributed_sale",
] as const;

export interface OnboardingMetrics {
  accountCreatedAt: string | null;
  milestones: { event: string; occurredAt: string | null }[];
  ttfvSeconds: number | null; // account created -> first_real_conversation
  timeToGoLiveSeconds: number | null; // account created -> go_live_clicked
  timeToFirstSaleSeconds: number | null;
}

export async function getTenantOnboardingMetrics(tenantId: string): Promise<OnboardingMetrics> {
  const [progress] = await db.select().from(schema.onboardingProgress).where(eq(schema.onboardingProgress.tenantId, tenantId)).limit(1);
  const accountCreatedAt = progress?.startedAt ?? null;

  const events = await db
    .select({ event: schema.onboardingEvents.event, createdAt: schema.onboardingEvents.createdAt })
    .from(schema.onboardingEvents)
    .where(eq(schema.onboardingEvents.tenantId, tenantId))
    .orderBy(asc(schema.onboardingEvents.createdAt));

  const firstOccurrence = new Map<string, Date>();
  for (const e of events) {
    if (!firstOccurrence.has(e.event)) firstOccurrence.set(e.event, e.createdAt);
  }

  const milestones = MILESTONE_EVENTS.map((event) => ({
    event,
    occurredAt: firstOccurrence.get(event)?.toISOString() ?? null,
  }));

  function secondsBetween(target: string): number | null {
    if (!accountCreatedAt) return null;
    const at = firstOccurrence.get(target);
    if (!at) return null;
    return Math.round((at.getTime() - accountCreatedAt.getTime()) / 1000);
  }

  return {
    accountCreatedAt: accountCreatedAt?.toISOString() ?? null,
    milestones,
    ttfvSeconds: secondsBetween("first_real_conversation"),
    timeToGoLiveSeconds: secondsBetween("go_live_clicked"),
    timeToFirstSaleSeconds: secondsBetween("first_sale"),
  };
}

/** Drop-off funnel — how many of this tenant's own onboarding steps have
 * been reached (a single-tenant analog of spec section 21's cross-tenant
 * "1,000 signups -> 820 workspace created -> ..." example; see the
 * cross-tenant note above for why this doesn't aggregate across tenants
 * yet). */
export async function getStepCompletion(tenantId: string) {
  const [progress] = await db.select().from(schema.onboardingProgress).where(eq(schema.onboardingProgress.tenantId, tenantId)).limit(1);
  return {
    currentStep: progress?.currentStep ?? null,
    completedSteps: progress?.completedSteps ?? [],
    completedAt: progress?.completedAt?.toISOString() ?? null,
  };
}

