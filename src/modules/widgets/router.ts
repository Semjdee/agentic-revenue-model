import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq, desc } from "drizzle-orm";

// ============================================================================
// AgentRouter — chooses which Agent answers a conversation on a given
// Widget (multi-agent-routing spec Part A §9-10). Deterministic and cheap
// by design: no LLM call is ever spent just deciding who should reply.
//
// Priority order (spec §10):
//   1. Existing conversation assignment — once a conversation has an
//      agent, keep it (continuity beats re-routing).
//   2. SINGLE_AGENT widgets — return defaultAgentId immediately. This is
//      the only path an existing (pre-migration) single-agent embed ever
//      takes, so it costs exactly what direct resolution cost before this
//      router existed: one DB read, zero extra latency.
//   3. Deterministic keyword rules — match the customer's first message
//      against each enabled WidgetAgent's routingDescription/
//      allowedIntents (same plain-substring-match style as
//      src/modules/billing/model-router.ts's chooseModel, deliberately —
//      one heuristic pattern for "decide something cheaply from text
//      already in hand", not two).
//   4. Fallback — widget.fallbackAgentId, else widget.defaultAgentId,
//      else the highest-priority enabled WidgetAgent.
//
// Honest scope note: this platform assigns an agent to a conversation
// ONCE, at conversation start (handleCustomerMessage never reassigns
// conversation.agentId turn-to-turn — see engine.ts). So "agent handoff"
// mid-conversation (spec §12, §26-27) is not a runtime behavior that
// exists yet; agent_routing_decisions.handoffStopReason and
// AGENT_HANDOFF_STOP_REASONS exist in the schema for when it is (a real
// handoff must route back through here, not reassign directly), but
// routeConversation() below only ever runs the four steps above.
// ============================================================================

export interface RouteInput {
  tenantId: string;
  widgetId: string;
  conversationId: string | null;
  existingAgentId: string | null;
  latestMessage: string;
}

export interface RouteDecision {
  selectedAgentId: string;
  fallbackAgentId: string | null;
  routingReason: string;
  confidence: number | null;
}

async function recordDecision(input: RouteInput, decision: RouteDecision) {
  await db.insert(schema.agentRoutingDecisions).values({
    id: generateId(),
    tenantId: input.tenantId,
    widgetId: input.widgetId,
    conversationId: input.conversationId,
    selectedAgentId: decision.selectedAgentId,
    fallbackAgentId: decision.fallbackAgentId,
    routingReason: decision.routingReason,
    confidence: decision.confidence !== null ? decision.confidence.toFixed(2) : null,
  });
}

export async function routeConversation(input: RouteInput): Promise<RouteDecision> {
  const [widget] = await db.select().from(schema.widgets).where(eq(schema.widgets.id, input.widgetId)).limit(1);
  if (!widget) throw new Error("Widget not found");

  // 1. Continuity — an already-assigned, still-enabled agent keeps the
  // conversation. Prevents a routing-rule edit mid-conversation from
  // yanking the customer to a different agent mid-thread.
  if (input.existingAgentId) {
    const [link] = await db
      .select()
      .from(schema.widgetAgents)
      .where(and(eq(schema.widgetAgents.widgetId, widget.id), eq(schema.widgetAgents.agentId, input.existingAgentId), eq(schema.widgetAgents.enabled, true)))
      .limit(1);
    if (link) {
      const decision: RouteDecision = { selectedAgentId: input.existingAgentId, fallbackAgentId: widget.fallbackAgentId, routingReason: "existing_assignment", confidence: null };
      await recordDecision(input, decision);
      return decision;
    }
  }

  // 2. Single-agent widgets — the entire installed base today, and the
  // default for a new tenant with one agent (spec §6's "no routing
  // complexity" promise).
  if (widget.routingMode === "SINGLE_AGENT" && widget.defaultAgentId) {
    const decision: RouteDecision = { selectedAgentId: widget.defaultAgentId, fallbackAgentId: widget.fallbackAgentId, routingReason: "single_agent_mode", confidence: null };
    await recordDecision(input, decision);
    return decision;
  }

  // 3. Deterministic keyword rules across enabled agents, highest
  // priority first.
  const links = await db
    .select()
    .from(schema.widgetAgents)
    .where(and(eq(schema.widgetAgents.widgetId, widget.id), eq(schema.widgetAgents.enabled, true)))
    .orderBy(desc(schema.widgetAgents.priority));

  const lower = input.latestMessage.toLowerCase();
  for (const link of links) {
    const intents = link.allowedIntents ?? [];
    const restricted = link.restrictedIntents ?? [];
    if (restricted.some((kw) => kw && lower.includes(kw.toLowerCase()))) continue;
    const haystack = [link.routingRole ?? "", link.routingDescription ?? "", ...intents].join(" ").toLowerCase();
    const keywords = haystack.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    if (keywords.some((kw) => lower.includes(kw)) || intents.some((kw) => kw && lower.includes(kw.toLowerCase()))) {
      const decision: RouteDecision = { selectedAgentId: link.agentId, fallbackAgentId: widget.fallbackAgentId, routingReason: `rule_match:${link.routingRole ?? link.agentId}`, confidence: 0.7 };
      await recordDecision(input, decision);
      return decision;
    }
  }

  // 4. Fallback — explicit fallback, then widget default, then the
  // top-priority enabled agent. A widget with routing configured but
  // nothing eligible is a misconfiguration, not a reason to fail the
  // conversation.
  const fallbackAgentId = widget.fallbackAgentId ?? widget.defaultAgentId ?? links[0]?.agentId ?? null;
  if (!fallbackAgentId) throw new Error("Widget has no eligible agent to route to");
  const decision: RouteDecision = { selectedAgentId: fallbackAgentId, fallbackAgentId: null, routingReason: "no_match_fallback", confidence: null };
  await recordDecision(input, decision);
  return decision;
}
