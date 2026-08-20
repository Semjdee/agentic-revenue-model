import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq, lte, isNotNull } from "drizzle-orm";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";
import { MAX_ATTEMPTS, openFollowUpConditions } from "./service";

const REPEAT_INTERVAL_HOURS = 48;

/**
 * Follow-up Engine tick (spec section 11).
 *
 * Runs on a schedule (via BullMQ repeatable job — src/modules/followups/queue.ts
 * — or can be invoked directly, which is what the demo-journey script and the
 * "Run follow-up check now" button in Settings do). For every opportunity
 * whose `nextFollowUpAt` has passed:
 *   - if still open (not WON/LOST) and AI follow-up is enabled and attempts
 *     remain, generate + send a follow-up message and reschedule
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

    const message =
      opp.followUpAttempts === 0
        ? `Hi again! Just checking in on the ${opp.followUpObjective ?? "quotation"} we discussed — would you like to go ahead?`
        : `Hi, following up once more on your request — happy to answer any questions before you decide.`;

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
        nextFollowUpAt: stillHasAttempts ? new Date(now.getTime() + REPEAT_INTERVAL_HOURS * 3600 * 1000) : null,
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
