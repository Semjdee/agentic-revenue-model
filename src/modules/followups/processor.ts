import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq, lte, isNotNull } from "drizzle-orm";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";
import { MAX_ATTEMPTS, openFollowUpConditions } from "./service";
import { resolveOpportunitySequence, getSequenceSteps, resolveStepForAttempt, renderFollowUpTemplate } from "./templates";

/**
 * Follow-up Engine tick (spec section 11).
 *
 * Runs on a schedule (via BullMQ repeatable job — src/modules/followups/queue.ts
 * — or can be invoked directly, which is what the demo-journey script and the
 * "Run follow-up check now" button in Settings do). For every opportunity
 * whose `nextFollowUpAt` has passed:
 *   - if still open (not WON/LOST) and AI follow-up is enabled and attempts
 *     remain, send the message from the opportunity's follow-up sequence
 *     (tenant-owned templates — see templates.ts — not AI-generated) and
 *     reschedule using that step's own delay
 *   - otherwise, hand off to a human via a Task instead of auto-sending
 *   - stop entirely once WON, LOST, opted out, or max attempts reached
 */
export async function runFollowUpCheck(now: Date = new Date(), tenantId?: string) {
  // Same "still open, AI-enabled, attempts remain" definition the Dashboard
  // and Follow-ups page use to COUNT due opportunities (src/modules/followups/service.ts)
  // — one shared definition of "due", not three independently-maintained ones.
  const conditions = [...openFollowUpConditions(), isNotNull(schema.opportunities.nextFollowUpAt), lte(schema.opportunities.nextFollowUpAt, now)];
  if (tenantId) conditions.push(eq(schema.opportunities.tenantId, tenantId));

  const dueOpportunities = await db
    .select()
    .from(schema.opportunities)
    .where(and(...conditions));

  const results: { opportunityId: string; action: string }[] = [];

  for (const opp of dueOpportunities) {
    const conversationId = opp.latestConversationId ?? opp.firstConversationId;

    if (!conversationId) {
      // Nothing to message into — hand to a human.
      await db.insert(schema.tasks).values({
        id: generateId(),
        tenantId: opp.tenantId,
        opportunityId: opp.id,
        title: `Follow up with customer (no active conversation) — ${opp.followUpObjective ?? ""}`,
        type: "FOLLOW_UP",
        dueAt: now,
      });
      await db.update(schema.opportunities).set({ nextFollowUpAt: null }).where(eq(schema.opportunities.id, opp.id));
      results.push({ opportunityId: opp.id, action: "escalated_no_conversation" });
      continue;
    }

    // Tenant-owned template, not an AI-generated message — see
    // modules/followups/templates.ts. Falls back to the tenant's
    // auto-created default sequence (which reproduces the platform's
    // original 2-message/48h behavior exactly) until a tenant edits it.
    const sequence = await resolveOpportunitySequence(opp.tenantId, opp.followUpSequenceId);
    const steps = await getSequenceSteps(sequence.id);
    const step = resolveStepForAttempt(steps, opp.followUpAttempts);

    if (!step) {
      // A tenant deleted every template out of their sequence — nothing
      // to send. Hand off rather than silently doing nothing or crashing.
      await db.insert(schema.tasks).values({
        id: generateId(),
        tenantId: opp.tenantId,
        opportunityId: opp.id,
        title: `Follow up with customer (no follow-up templates configured) — ${opp.followUpObjective ?? ""}`,
        type: "FOLLOW_UP",
        dueAt: now,
      });
      await db.update(schema.opportunities).set({ nextFollowUpAt: null }).where(eq(schema.opportunities.id, opp.id));
      results.push({ opportunityId: opp.id, action: "escalated_no_template" });
      continue;
    }

    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, opp.contactId)).limit(1);
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, opp.tenantId)).limit(1);
    const message = renderFollowUpTemplate(step.template.messageBody, {
      contactName: contact?.name,
      objective: opp.followUpObjective,
      product: opp.products?.[0]?.name,
      businessName: tenant?.name,
    });

    await db.insert(schema.messages).values({
      id: generateId(),
      tenantId: opp.tenantId,
      conversationId,
      sender: "AI",
      content: message,
    });
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: now, updatedAt: now, unread: true })
      .where(eq(schema.conversations.id, conversationId));

    const nextAttempts = opp.followUpAttempts + 1;
    const stillHasAttempts = nextAttempts < MAX_ATTEMPTS;

    await db
      .update(schema.opportunities)
      .set({
        followUpAttempts: nextAttempts,
        lastInteractionAt: now,
        // The step's own delay, not a flat global constant — the direct
        // replacement for the old REPEAT_INTERVAL_HOURS.
        nextFollowUpAt: stillHasAttempts ? new Date(now.getTime() + step.delayHours * 3600 * 1000) : null,
      })
      .where(eq(schema.opportunities.id, opp.id));

    if (!stillHasAttempts) {
      await db.insert(schema.tasks).values({
        id: generateId(),
        tenantId: opp.tenantId,
        opportunityId: opp.id,
        title: `Max automated follow-ups reached — please follow up personally`,
        type: "FOLLOW_UP",
        dueAt: now,
      });
    }

    await dispatchWebhooks(opp.tenantId, "task.created", { opportunityId: opp.id });
    results.push({ opportunityId: opp.id, action: "sent" });
  }

  return results;
}
