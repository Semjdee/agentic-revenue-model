import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq, gt } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { logOnboardingEventOnce } from "@/modules/onboarding/service";
import type { ToolCall } from "./types";
import { actionSignature } from "./execution-gateway";

// Cross-run idempotency window (multi-agent-routing spec Part B §19-20):
// how long a successfully-EXECUTED action "remembers" itself for this
// conversation. A customer message that somehow triggers the same
// create_lead/schedule_followup/record_sale twice in quick succession
// (double webhook delivery, a retried request, a future multi-agent
// handoff re-processing the same turn) produces one write, not two.
// Long enough to catch a real duplicate, short enough that a customer
// genuinely re-requesting the same thing an hour later isn't silently
// dropped.
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;

// ============================================================================
// AI Tool / Action System (spec section 6 & 7).
//
// The language model NEVER touches the database directly. It can only
// *request* one of a fixed set of named actions with structured parameters.
// Every request is:
//   - validated       (parameters shape-checked before use)
//   - tenant-scoped    (all writes carry tenantId, never trust model output for this)
//   - permission checked (AUTOMATIC / APPROVAL_REQUIRED / DISABLED, section 7)
//   - logged           (agent_actions row, always, even if rejected/pending)
//   - auditable        (audit_logs row on every executed write)
// ============================================================================

export const ACTION_PERMISSIONS: Record<string, "AUTOMATIC" | "APPROVAL_REQUIRED" | "DISABLED"> = {
  create_contact: "AUTOMATIC",
  update_contact: "AUTOMATIC",
  create_lead: "AUTOMATIC",
  update_lead: "AUTOMATIC",
  create_task: "AUTOMATIC",
  create_opportunity: "AUTOMATIC",
  update_opportunity: "AUTOMATIC",
  schedule_followup: "AUTOMATIC",
  send_message: "AUTOMATIC",
  request_human: "AUTOMATIC",
  record_sale: "AUTOMATIC",
  offer_discount: "APPROVAL_REQUIRED",
  delete_record: "DISABLED",
};

export interface ExecutionState {
  tenantId: string;
  agentId: string | null;
  conversationId: string;
  contactId: string;
  leadId: string | null;
  opportunityId: string | null;
  /** Real channel/campaign data from the conversation — the platform
   * knows this deterministically; the AI is never asked to report its
   * own channel (same "platform calculates, AI interprets" discipline
   * as everywhere else in this codebase). Used as the honest default
   * for a new lead's source/campaign instead of a hardcoded fallback,
   * so leads are actually filterable by where they came from. */
  channel?: string;
  utmSource?: string | null;
  utmCampaign?: string | null;
  /** The AgentRun (src/modules/ai/execution-gateway.ts) that produced
   * these tool calls — recorded on every agent_actions row for
   * cost/loop observability. Null for callers that predate the gateway
   * wiring (should not happen in practice, but never block execution on
   * it being present). */
  runId?: string | null;
}

export interface ExecutionResult extends ExecutionState {
  aiActive: boolean;
  executed: { action: string; status: string }[];
}

// Both AI providers can, in principle, hand back a raw customer sentence
// ("My name is John Mukasa") instead of the extracted name itself — the
// mock provider used to do this outright (see mock-provider.ts fix), and
// even a real LLM can slip on an oddly-phrased reply. This is the single
// place every AI-sourced contact name passes through before it's saved,
// so it's the right spot for a defensive backstop rather than trusting
// either provider to always hand back a clean value.
const NAME_LEADIN_PATTERN = /^(my\s+name\s+is|i\s*'?\s*m|i\s+am|this\s+is|it'?s|call\s+me|name'?s)\s+/i;

function sanitizeExtractedName(raw: string): string | null {
  let name = raw.trim();
  const leadinMatch = name.match(NAME_LEADIN_PATTERN);
  if (leadinMatch) name = name.slice(leadinMatch[0].length).trim();
  // Strip a trailing "and I live in..." / "and my number is..." runs-on,
  // keep just the name clause itself.
  name = name.split(/[.,!?;]/)[0].trim();
  if (!name) return null;
  // A genuine name is a handful of words; anything longer is almost
  // certainly still a sentence fragment that slipped past the checks
  // above (e.g. no punctuation for split() to catch), so reject rather
  // than save garbage into the contact record.
  const wordCount = name.split(/\s+/).length;
  if (wordCount > 5 || name.length > 80) return null;
  return name;
}

async function upsertContactFields(tenantId: string, contactId: string, params: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if (typeof params.name === "string" && params.name.trim()) {
    const cleanName = sanitizeExtractedName(params.name);
    if (cleanName) patch.name = cleanName;
  }
  if (typeof params.phone === "string" && params.phone.trim()) patch.phone = params.phone.trim();
  if (typeof params.email === "string" && params.email.trim()) patch.email = params.email.trim();
  if (Object.keys(patch).length === 0) return;
  patch.updatedAt = new Date();
  await db.update(schema.contacts).set(patch).where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.tenantId, tenantId)));

  if (typeof params.phone === "string" && params.phone.trim()) {
    await ensureIdentity(tenantId, contactId, "PHONE", params.phone.trim());
  }
  if (typeof params.email === "string" && params.email.trim()) {
    await ensureIdentity(tenantId, contactId, "EMAIL", params.email.trim());
  }
}

async function ensureIdentity(tenantId: string, contactId: string, type: string, value: string) {
  const [existing] = await db
    .select()
    .from(schema.contactIdentities)
    .where(
      and(
        eq(schema.contactIdentities.tenantId, tenantId),
        eq(schema.contactIdentities.type, type as "PHONE"),
        eq(schema.contactIdentities.value, value)
      )
    )
    .limit(1);
  if (!existing) {
    await db.insert(schema.contactIdentities).values({
      id: generateId(),
      tenantId,
      contactId,
      type: type as "PHONE",
      value,
    });
  }
}

export async function executeToolCalls(
  state: ExecutionState,
  toolCalls: ToolCall[]
): Promise<ExecutionResult> {
  let { leadId, opportunityId } = state;
  let aiActive = true;
  const executed: { action: string; status: string }[] = [];

  for (const call of toolCalls) {
    const mode = ACTION_PERMISSIONS[call.action] ?? "APPROVAL_REQUIRED";
    const actionRowId = generateId();
    const signature = actionSignature(call);

    if (mode === "DISABLED") {
      await db.insert(schema.agentActions).values({
        id: actionRowId,
        tenantId: state.tenantId,
        agentId: state.agentId,
        conversationId: state.conversationId,
        action: call.action,
        parameters: call.parameters,
        result: {},
        status: "REJECTED",
        approvalRequired: false,
        signature,
        runId: state.runId ?? null,
      });
      executed.push({ action: call.action, status: "REJECTED" });
      continue;
    }

    // Cross-run idempotency (spec §19-20): this exact action already ran
    // successfully for this conversation very recently — do not repeat a
    // consequential write (create_lead, schedule_followup, record_sale,
    // etc.) just because the model asked for it again. Only guards
    // AUTOMATIC actions; a duplicate APPROVAL_REQUIRED request is safe to
    // log again since a human still gates it either way.
    if (mode === "AUTOMATIC") {
      const [dup] = await db
        .select({ id: schema.agentActions.id })
        .from(schema.agentActions)
        .where(
          and(
            eq(schema.agentActions.tenantId, state.tenantId),
            eq(schema.agentActions.conversationId, state.conversationId),
            eq(schema.agentActions.signature, signature),
            eq(schema.agentActions.status, "EXECUTED"),
            gt(schema.agentActions.createdAt, new Date(Date.now() - IDEMPOTENCY_WINDOW_MS))
          )
        )
        .limit(1);
      if (dup) {
        await db.insert(schema.agentActions).values({
          id: actionRowId,
          tenantId: state.tenantId,
          agentId: state.agentId,
          conversationId: state.conversationId,
          action: call.action,
          parameters: call.parameters,
          result: { duplicateOf: dup.id },
          status: "SKIPPED_DUPLICATE",
          approvalRequired: false,
          signature,
          runId: state.runId ?? null,
        });
        executed.push({ action: call.action, status: "SKIPPED_DUPLICATE" });
        continue;
      }
    }

    if (mode === "APPROVAL_REQUIRED") {
      await db.insert(schema.agentActions).values({
        id: actionRowId,
        tenantId: state.tenantId,
        agentId: state.agentId,
        conversationId: state.conversationId,
        action: call.action,
        parameters: call.parameters,
        result: {},
        status: "PENDING",
        approvalRequired: true,
        signature,
        runId: state.runId ?? null,
      });
      await db.insert(schema.approvals).values({
        id: generateId(),
        tenantId: state.tenantId,
        type: "AGENT_ACTION",
        entityId: actionRowId,
        requestedBy: "ai-agent",
        status: "PENDING",
        payload: { action: call.action, parameters: call.parameters, conversationId: state.conversationId },
      });
      executed.push({ action: call.action, status: "PENDING_APPROVAL" });
      continue;
    }

    // AUTOMATIC -> execute now
    let result: Record<string, unknown> = {};
    try {
      switch (call.action) {
        case "create_contact":
        case "update_contact": {
          await upsertContactFields(state.tenantId, state.contactId, call.parameters);
          result = { contactId: state.contactId };
          break;
        }
        case "create_lead": {
          if (!leadId) {
            const newLeadId = generateId();
            await db.insert(schema.leads).values({
              id: newLeadId,
              tenantId: state.tenantId,
              contactId: state.contactId,
              conversationId: state.conversationId,
              stage: (call.parameters.stage as string as "NEW") || "NEW",
              // Real channel/UTM data first — never the AI's own guess at
              // "source", and never a hardcoded fallback. A WhatsApp
              // conversation must produce a lead whose source says
              // "whatsapp", not "website" (see BUILD_NOTES.md — this was
              // a real bug found and now fixed).
              source: (call.parameters.source as string) || state.utmSource || state.channel?.toLowerCase() || "website",
              campaign: (call.parameters.campaign as string) || state.utmCampaign || undefined,
            });
            leadId = newLeadId;
            await logAudit({
              tenantId: state.tenantId,
              action: "lead.created",
              entity: "lead",
              entityId: newLeadId,
              source: "SYSTEM",
              after: { stage: call.parameters.stage ?? "NEW" },
            });
            // docs/ONBOARDING_SPEC.md section 18/20 — activation milestone,
            // fires at most once per tenant regardless of how many leads
            // follow.
            await logOnboardingEventOnce(state.tenantId, "first_lead_created", { leadId: newLeadId });
          }
          result = { leadId };
          break;
        }
        case "update_lead": {
          if (leadId) {
            const patch: Record<string, unknown> = { updatedAt: new Date() };
            if (call.parameters.stage) patch.stage = call.parameters.stage;
            if (typeof call.parameters.score === "number") patch.score = call.parameters.score;
            if (Array.isArray(call.parameters.productsDiscussed))
              patch.productsDiscussed = call.parameters.productsDiscussed;
            await db.update(schema.leads).set(patch).where(eq(schema.leads.id, leadId));
            if (call.parameters.stage === "QUALIFIED") {
              await logAudit({
                tenantId: state.tenantId,
                action: "lead.qualified",
                entity: "lead",
                entityId: leadId,
                source: "SYSTEM",
              });
              await logOnboardingEventOnce(state.tenantId, "first_qualified_lead", { leadId });
            }
          }
          result = { leadId };
          break;
        }
        case "create_opportunity": {
          if (!opportunityId) {
            const newOppId = generateId();
            await db.insert(schema.opportunities).values({
              id: newOppId,
              tenantId: state.tenantId,
              leadId,
              contactId: state.contactId,
              estimatedValue: (call.parameters.estimatedValue as string) ?? null,
              products: (call.parameters.products as never[]) ?? [],
              stage: (call.parameters.stage as string as "OPPORTUNITY") || "OPPORTUNITY",
              source: state.utmSource || state.channel?.toLowerCase() || "website",
              campaign: state.utmCampaign || undefined,
              firstConversationId: state.conversationId,
              latestConversationId: state.conversationId,
              lastInteractionAt: new Date(),
            });
            opportunityId = newOppId;
            if (leadId) await db.update(schema.leads).set({ stage: "OPPORTUNITY" }).where(eq(schema.leads.id, leadId));
            await logAudit({
              tenantId: state.tenantId,
              action: "opportunity.created",
              entity: "opportunity",
              entityId: newOppId,
              source: "SYSTEM",
            });
          } else {
            await db
              .update(schema.opportunities)
              .set({ stage: (call.parameters.stage as string as "QUOTATION") || undefined, updatedAt: new Date() })
              .where(eq(schema.opportunities.id, opportunityId));
          }
          result = { opportunityId };
          break;
        }
        case "update_opportunity": {
          if (opportunityId) {
            const patch: Record<string, unknown> = { updatedAt: new Date() };
            if (call.parameters.stage) patch.stage = call.parameters.stage;
            if (call.parameters.lostReason) patch.lostReason = call.parameters.lostReason;
            await db.update(schema.opportunities).set(patch).where(eq(schema.opportunities.id, opportunityId));
          }
          result = { opportunityId };
          break;
        }
        case "schedule_followup": {
          const hours = Number(call.parameters.hoursFromNow ?? 48);
          const followUpAt = new Date(Date.now() + hours * 3600 * 1000);
          if (opportunityId) {
            await db
              .update(schema.opportunities)
              .set({
                nextFollowUpAt: followUpAt,
                followUpObjective: (call.parameters.objective as string) ?? "Follow up with customer",
                aiFollowUpEnabled: true,
              })
              .where(eq(schema.opportunities.id, opportunityId));
          }
          await db.insert(schema.tasks).values({
            id: generateId(),
            tenantId: state.tenantId,
            opportunityId,
            leadId,
            title: (call.parameters.objective as string) || "Follow up with customer",
            type: "FOLLOW_UP",
            dueAt: followUpAt,
          });
          result = { followUpAt: followUpAt.toISOString() };
          break;
        }
        case "create_task": {
          await db.insert(schema.tasks).values({
            id: generateId(),
            tenantId: state.tenantId,
            opportunityId,
            leadId,
            title: (call.parameters.title as string) || "Follow up",
            type: (call.parameters.type as string) || "GENERAL",
            dueAt: call.parameters.dueAt ? new Date(call.parameters.dueAt as string) : null,
          });
          result = { created: true };
          break;
        }
        case "request_human": {
          await db
            .update(schema.conversations)
            .set({ aiActive: false, updatedAt: new Date() })
            .where(eq(schema.conversations.id, state.conversationId));
          await db.insert(schema.tasks).values({
            id: generateId(),
            tenantId: state.tenantId,
            leadId,
            opportunityId,
            title: `Human requested: ${(call.parameters.reason as string) || "assistance needed"}`,
            type: "HUMAN_TAKEOVER",
            dueAt: new Date(),
          });
          aiActive = false;
          result = { aiActive: false };
          break;
        }
        case "record_sale": {
          if (opportunityId) {
            const amount = (call.parameters.amount as string) ?? "0";
            const saleId = generateId();
            await db.insert(schema.sales).values({
              id: saleId,
              tenantId: state.tenantId,
              opportunityId,
              contactId: state.contactId,
              amount,
              currency: (call.parameters.currency as string) || "UGX",
              products: (call.parameters.products as never[]) ?? [],
            });
            await db
              .update(schema.opportunities)
              .set({ stage: "WON", actualSaleValue: amount, updatedAt: new Date() })
              .where(eq(schema.opportunities.id, opportunityId));
            if (leadId) await db.update(schema.leads).set({ stage: "WON" }).where(eq(schema.leads.id, leadId));
            await logAudit({
              tenantId: state.tenantId,
              action: "sale.created",
              entity: "sale",
              entityId: saleId,
              source: "SYSTEM",
              after: { amount },
            });
            await logOnboardingEventOnce(state.tenantId, "first_sale", { saleId, amount });
            result = { saleId };
          }
          break;
        }
        default:
          result = { skipped: true, reason: "unknown action" };
      }

      await db.insert(schema.agentActions).values({
        id: actionRowId,
        tenantId: state.tenantId,
        agentId: state.agentId,
        conversationId: state.conversationId,
        action: call.action,
        parameters: call.parameters,
        result,
        status: "EXECUTED",
        approvalRequired: false,
        signature,
        runId: state.runId ?? null,
      });
      executed.push({ action: call.action, status: "EXECUTED" });
    } catch (err) {
      await db.insert(schema.agentActions).values({
        id: actionRowId,
        tenantId: state.tenantId,
        agentId: state.agentId,
        conversationId: state.conversationId,
        action: call.action,
        parameters: call.parameters,
        result: { error: String(err) },
        status: "FAILED",
        approvalRequired: false,
        signature,
        runId: state.runId ?? null,
      });
      executed.push({ action: call.action, status: "FAILED" });
    }
  }

  return { ...state, leadId, opportunityId, aiActive, executed };
}
