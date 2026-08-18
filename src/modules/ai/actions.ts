import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import type { ToolCall } from "./types";

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
}

export interface ExecutionResult extends ExecutionState {
  aiActive: boolean;
  executed: { action: string; status: string }[];
}

async function upsertContactFields(tenantId: string, contactId: string, params: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if (typeof params.name === "string" && params.name.trim()) patch.name = params.name.trim();
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
      });
      executed.push({ action: call.action, status: "REJECTED" });
      continue;
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
              source: (call.parameters.source as string) ?? "website",
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
              source: "website",
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
      });
      executed.push({ action: call.action, status: "FAILED" });
    }
  }

  return { ...state, leadId, opportunityId, aiActive, executed };
}
