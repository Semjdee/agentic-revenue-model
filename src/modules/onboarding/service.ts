import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq, and } from "drizzle-orm";
import type { Role } from "@/db/schema";

// Zero-to-live self-onboarding — single chokepoint for reading/advancing a
// tenant's onboarding progress and logging funnel events. Every onboarding
// UI/route calls through here rather than touching `onboarding_progress` /
// `onboarding_events` directly, so save-and-resume (spec section 22) and
// funnel analytics (spec section 19) stay consistent by construction.
// See docs/ONBOARDING_SPEC.md and docs/ONBOARDING_TASKS.md Milestone 2.

export type OnboardingStep = (typeof schema.ONBOARDING_STEPS)[number];

export async function getOnboardingProgress(tenantId: string) {
  const [row] = await db
    .select()
    .from(schema.onboardingProgress)
    .where(eq(schema.onboardingProgress.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

/** Creates the progress row for a brand-new tenant. Idempotent — safe to
 * call even if a row already exists (returns the existing one untouched). */
export async function initOnboardingProgress(tenantId: string) {
  const existing = await getOnboardingProgress(tenantId);
  if (existing) return existing;
  const id = generateId();
  await db.insert(schema.onboardingProgress).values({ id, tenantId });
  return getOnboardingProgress(tenantId);
}

/** Marks `step` complete and moves `currentStep` to `next` (or leaves it
 * alone if `next` is omitted — useful for "log this step done, stay put"
 * cases). Never regresses `completedSteps` — a step once done stays done
 * even if the user revisits it. */
export async function advanceOnboardingStep(tenantId: string, step: OnboardingStep, next?: OnboardingStep) {
  const progress = await initOnboardingProgress(tenantId);
  if (!progress) throw new Error(`onboarding_progress missing for tenant ${tenantId}`);
  const completed = new Set(progress.completedSteps ?? []);
  completed.add(step);
  await db
    .update(schema.onboardingProgress)
    .set({
      completedSteps: Array.from(completed),
      currentStep: next ?? progress.currentStep,
      updatedAt: new Date(),
    })
    .where(eq(schema.onboardingProgress.tenantId, tenantId));
  return getOnboardingProgress(tenantId);
}

/** Records which agent this onboarding run is setting up (addendum §A9 —
 * guided-created, manually-created, or an existing agent the user chose
 * to reuse). Later steps (test/channel-connect/health-check/go-live) read
 * this rather than each re-deriving "which agent" independently. */
export async function setOnboardingAgent(tenantId: string, agentId: string) {
  await db.update(schema.onboardingProgress).set({ agentId, updatedAt: new Date() }).where(eq(schema.onboardingProgress.tenantId, tenantId));
}

export async function markOnboardingComplete(tenantId: string) {
  await db
    .update(schema.onboardingProgress)
    .set({ completedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.onboardingProgress.tenantId, tenantId));
}

/** Append-only funnel event log (spec section 19). `tenantId` is nullable
 * at the DB level for pre-tenant events, but every event we currently emit
 * happens after tenant creation, so callers always pass one — kept
 * optional in the type only to match the schema honestly. */
export async function logOnboardingEvent(
  tenantId: string | null,
  event: string,
  metadata?: Record<string, unknown>
) {
  await db.insert(schema.onboardingEvents).values({
    id: generateId(),
    tenantId,
    event,
    metadata: metadata ?? {},
  });
}

/** Guards a "first X" event so it only ever logs once per tenant — used
 * for the first_real_conversation / first_contact_created / first_lead_created
 * / first_sale family in Milestone 10, but exposed here since it's a
 * generic-enough pattern other "first N" events will want too. */
export async function logOnboardingEventOnce(
  tenantId: string,
  event: string,
  metadata?: Record<string, unknown>
) {
  const [alreadyLogged] = await db
    .select({ id: schema.onboardingEvents.id })
    .from(schema.onboardingEvents)
    .where(and(eq(schema.onboardingEvents.tenantId, tenantId), eq(schema.onboardingEvents.event, event)))
    .limit(1);
  if (alreadyLogged) return;
  await logOnboardingEvent(tenantId, event, metadata);
}

/** What the onboarding shell's checklist needs — human labels + completion
 * state for every step, so the UI never has to know the raw step-key
 * vocabulary. */
export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  ACCOUNT: "Create account",
  BUSINESS_PROFILE: "Business profile",
  KNOWLEDGE_IMPORT: "Products & knowledge",
  AGENT_SETUP: "Meet your AI Sales Agent",
  AGENT_TEST: "Test your agent",
  CHANNEL_CONNECT: "Connect a channel",
  HEALTH_CHECK: "Health check",
  GO_LIVE: "Go live",
};

export function ownerRoleAllowed(role: Role) {
  // Onboarding mutates tenant-wide config — restrict to roles that could
  // plausibly be the person setting the business up. Mirrors the spirit
  // of src/lib/permissions.ts without duplicating its full matrix here.
  return role === "OWNER" || role === "ADMIN";
}
