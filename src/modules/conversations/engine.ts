import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq, desc } from "drizzle-orm";
import { runAIExecution } from "@/modules/ai";
import { checkCredits, chargeUsage } from "@/modules/billing/ledger";
import { chooseModel } from "@/modules/billing/model-router";
import { executeToolCalls } from "@/modules/ai/actions";
import { retrieveRelevantKnowledge } from "@/modules/knowledge/service";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";
import type { ConversationTurn } from "@/modules/ai/types";
import { recordTrafficSession, recordConversationTouch } from "@/modules/attribution/service";
import { logOnboardingEventOnce } from "@/modules/onboarding/service";
import { ensureLegacyWidgetForAgent, firstEnabledWidgetAgent } from "@/modules/widgets/service";
import { routeConversation } from "@/modules/widgets/router";

export interface StartConversationInput {
  /** Legacy embed: <script data-agent="..."> — still fully supported,
   * resolves through the same Widget machinery as a new install (see
   * ensureLegacyWidgetForAgent) so it's one code path, not two. */
  publicAgentId?: string;
  /** New embed: <script data-widget="..."> (multi-agent-routing spec
   * Part A §5). Exactly one of publicAgentId/publicWidgetId must be set. */
  publicWidgetId?: string;
  sessionId: string;
  channel: "WEBSITE" | "WHATSAPP" | "INSTAGRAM" | "MESSENGER";
  landingPage?: string;
  referringUrl?: string;
  currentPage?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  gclid?: string;
  fbclid?: string;
  consentAcknowledged?: boolean;
}

/**
 * Creates (or resumes) a widget/channel conversation — the entry point of
 * the "Advertising -> Conversation -> AI Sales Agent" loop the whole
 * platform is built around. Shared by the public widget API route and the
 * demo-journey script so both exercise identical logic.
 */
export async function startConversation(input: StartConversationInput) {
  let agent: typeof schema.agents.$inferSelect | undefined;
  let widgetId: string | null = null;

  if (input.publicWidgetId) {
    const [widget] = await db.select().from(schema.widgets).where(and(eq(schema.widgets.publicWidgetId, input.publicWidgetId), eq(schema.widgets.status, "ACTIVE"))).limit(1);
    if (!widget) throw new Error("Unknown or inactive widget");
    widgetId = widget.id;
    // The widget opens before the customer has typed anything, so there's
    // no message yet to route on — pick the widget's default (or
    // top-priority enabled) agent to send the greeting. Real routing on
    // customer intent happens once, on their first message (see
    // handleCustomerMessage below).
    const initialAgentId = widget.defaultAgentId ?? (await firstEnabledWidgetAgent(widget.id));
    if (!initialAgentId) throw new Error("Widget has no agent configured");
    [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, initialAgentId)).limit(1);
  } else if (input.publicAgentId) {
    [agent] = await db.select().from(schema.agents).where(eq(schema.agents.publicAgentId, input.publicAgentId)).limit(1);
    if (agent) widgetId = await ensureLegacyWidgetForAgent(agent.tenantId, agent.id);
  }

  if (!agent || agent.status !== "ACTIVE") throw new Error("Unknown or inactive agent");
  const tenantId = agent.tenantId;

  const [existingIdentity] = await db
    .select()
    .from(schema.contactIdentities)
    .where(
      and(
        eq(schema.contactIdentities.tenantId, tenantId),
        eq(schema.contactIdentities.type, "ANONYMOUS_SESSION"),
        eq(schema.contactIdentities.value, input.sessionId)
      )
    )
    .limit(1);

  let contactId: string;
  if (existingIdentity) {
    contactId = existingIdentity.contactId;
  } else {
    contactId = generateId();
    await db.insert(schema.contacts).values({ id: contactId, tenantId });
    await db.insert(schema.contactIdentities).values({
      id: generateId(),
      tenantId,
      contactId,
      type: "ANONYMOUS_SESSION",
      value: input.sessionId,
    });
    await logOnboardingEventOnce(tenantId, "first_contact_created", { contactId });
  }

  const [existingConversation] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), eq(schema.conversations.sessionId, input.sessionId), eq(schema.conversations.status, "OPEN")))
    .limit(1);

  if (existingConversation) {
    const messages = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, existingConversation.id)).orderBy(schema.messages.createdAt);
    return { conversationId: existingConversation.id, contactId, messages, aiActive: existingConversation.aiActive };
  }

  await recordTrafficSession({
    tenantId,
    sessionId: input.sessionId,
    contactId,
    firstLandingPage: input.landingPage,
    referringUrl: input.referringUrl,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    utmContent: input.utmContent,
    utmTerm: input.utmTerm,
    gclid: input.gclid,
    fbclid: input.fbclid,
  });

  const conversationId = generateId();
  await db.insert(schema.conversations).values({
    id: conversationId,
    tenantId,
    contactId,
    agentId: agent.id,
    widgetId,
    channel: input.channel,
    sessionId: input.sessionId,
    landingPage: input.landingPage,
    referringUrl: input.referringUrl,
    currentPage: input.currentPage,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    utmContent: input.utmContent,
    utmTerm: input.utmTerm,
    gclid: input.gclid,
    fbclid: input.fbclid,
    consentAcknowledged: input.consentAcknowledged ?? false,
  });

  const [newConversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).limit(1);
  if (newConversation) await recordConversationTouch(newConversation);

  await db.insert(schema.messages).values({
    id: generateId(),
    tenantId,
    conversationId,
    sender: "AI",
    content: agent.greeting || `Hi! I'm ${agent.name}. How can I help you today?`,
  });

  await dispatchWebhooks(tenantId, "conversation.created", { conversationId });
  await logOnboardingEventOnce(tenantId, "first_real_conversation", { conversationId, channel: input.channel });

  const messages = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversationId));
  return { conversationId, contactId, messages, aiActive: true, tenantId };
}

/**
 * Channel-identity conversation entry point — for any channel that
 * identifies a customer by a stable identity (phone number, platform user
 * id) rather than the website widget's session cookie. Currently used by
 * the WhatsApp webhook handler (src/app/api/public/webhooks/whatsapp/route.ts,
 * docs/ONBOARDING_TASKS.md Milestone 8); Instagram/Messenger would reuse
 * this too once built (docs/PHASE_2_TASKS.md backlog) rather than each
 * needing their own contact/conversation resolution logic.
 *
 * Finds-or-creates the contact via `contact_identities` (same table
 * startConversation() uses for anonymous website sessions) and the OPEN
 * conversation for that contact+channel, then hands off to
 * handleCustomerMessage() — the exact same function the widget uses, per
 * spec section 13's "WhatsApp message -> Meta webhook -> WhatsApp adapter
 * -> normalized Message -> Conversation -> AI Agent" flow.
 */
export async function startChannelConversation(input: {
  tenantId: string;
  channel: "WHATSAPP" | "INSTAGRAM" | "MESSENGER";
  identityType: "WHATSAPP" | "INSTAGRAM" | "MESSENGER";
  identityValue: string; // phone number / platform user id
  contactName?: string;
  content: string;
}) {
  const { tenantId, channel, identityType, identityValue, content } = input;

  const [existingIdentity] = await db
    .select()
    .from(schema.contactIdentities)
    .where(
      and(
        eq(schema.contactIdentities.tenantId, tenantId),
        eq(schema.contactIdentities.type, identityType),
        eq(schema.contactIdentities.value, identityValue)
      )
    )
    .limit(1);

  let contactId: string;
  if (existingIdentity) {
    contactId = existingIdentity.contactId;
  } else {
    contactId = generateId();
    await db.insert(schema.contacts).values({ id: contactId, tenantId, name: input.contactName, phone: identityType === "WHATSAPP" ? identityValue : undefined });
    await db.insert(schema.contactIdentities).values({ id: generateId(), tenantId, contactId, type: identityType, value: identityValue });
    await logOnboardingEventOnce(tenantId, "first_contact_created", { contactId });
  }

  // First ACTIVE agent for this tenant — no per-channel agent assignment
  // exists yet (docs/ONBOARDING_TASKS.md backlog), so this mirrors the
  // "one primary agent" assumption the rest of onboarding makes for now.
  const [agent] = await db.select().from(schema.agents).where(and(eq(schema.agents.tenantId, tenantId), eq(schema.agents.status, "ACTIVE"))).limit(1);
  if (!agent) throw new Error("No active agent for this tenant");

  let [conversation] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), eq(schema.conversations.contactId, contactId), eq(schema.conversations.channel, channel), eq(schema.conversations.status, "OPEN")))
    .limit(1);

  if (!conversation) {
    const conversationId = generateId();
    await db.insert(schema.conversations).values({ id: conversationId, tenantId, contactId, agentId: agent.id, channel });
    [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).limit(1);
    if (conversation) await recordConversationTouch(conversation);
    await db.insert(schema.messages).values({ id: generateId(), tenantId, conversationId, sender: "AI", content: agent.greeting || `Hi! I'm ${agent.name}. How can I help you today?` });
    await dispatchWebhooks(tenantId, "conversation.created", { conversationId });
    await logOnboardingEventOnce(tenantId, "first_real_conversation", { conversationId, channel });
  }

  const result = await handleCustomerMessage({ tenantId, conversationId: conversation.id, content });
  return { conversationId: conversation.id, contactId, ...result };
}

/**
 * Core conversation loop: customer message in -> AI reply + tool execution
 * out. Used by both the public widget endpoint and any future channel
 * webhook (WhatsApp/Instagram/Messenger) since they all funnel through the
 * same Conversation/Message model (section 4).
 */
export async function handleCustomerMessage(params: {
  tenantId: string;
  conversationId: string;
  content: string;
}) {
  const { tenantId, conversationId, content } = params;

  const [conversation] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.id, conversationId), eq(schema.conversations.tenantId, tenantId)))
    .limit(1);
  if (!conversation) throw new Error("Conversation not found");

  // Duplicate-delivery protection (spec §24): a channel webhook (WhatsApp/
  // Instagram/Messenger) that times out and retries, or a flaky client
  // double-submitting, must not trigger a second AI run — and a second
  // real, distinct AI reply — for the exact same inbound message. Only
  // collapses an EXACT content match arriving within a few seconds of the
  // last one; a customer genuinely re-sending the same words minutes
  // later is a new turn, not a retry.
  const [lastMessage] = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversationId)).orderBy(desc(schema.messages.createdAt)).limit(1);
  if (lastMessage && lastMessage.sender === "CUSTOMER" && lastMessage.content === content && Date.now() - new Date(lastMessage.createdAt).getTime() < 5000) {
    return { aiReplied: false, aiActive: conversation.aiActive, duplicateMessage: true };
  }

  // Multi-agent re-routing (spec Part A §9-12): the conversation's agent
  // was picked without seeing the customer's actual message (the widget
  // opens before they've typed anything — see startConversation above).
  // On the customer's FIRST real message, and only then, re-run
  // AgentRouter with genuine intent. Every message after this one keeps
  // whichever agent that decision lands on — continuity is the router's
  // own first rule, so this never flip-flops mid-conversation. No-op for
  // SINGLE_AGENT widgets and for channels without a widgetId (WhatsApp/
  // Instagram/Messenger — see router.ts's honest-scope note).
  let resolvedAgentId = conversation.agentId;
  if (conversation.widgetId) {
    const [priorCustomerMessage] = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.sender, "CUSTOMER")))
      .limit(1);
    if (!priorCustomerMessage) {
      const [widget] = await db.select().from(schema.widgets).where(eq(schema.widgets.id, conversation.widgetId)).limit(1);
      if (widget && widget.routingMode !== "SINGLE_AGENT") {
        // existingAgentId is deliberately null here, not conversation.agentId:
        // the agent currently on the conversation is only the PROVISIONAL
        // one picked to send the greeting (see startConversation above),
        // not a real routing decision yet — the router's own continuity
        // rule must not treat it as one, or first-message routing could
        // never override it. A genuine reassignment mid-conversation
        // (once that's a real code path) would pass the true existing
        // agent instead.
        const decision = await routeConversation({ tenantId, widgetId: widget.id, conversationId, existingAgentId: null, latestMessage: content });
        if (decision.selectedAgentId !== conversation.agentId) {
          resolvedAgentId = decision.selectedAgentId;
          await db.update(schema.conversations).set({ agentId: resolvedAgentId, updatedAt: new Date() }).where(eq(schema.conversations.id, conversationId));
        }
      }
    }
  }

  await db.insert(schema.messages).values({
    id: generateId(),
    tenantId,
    conversationId,
    sender: "CUSTOMER",
    content,
  });

  await db
    .update(schema.conversations)
    .set({ updatedAt: new Date(), lastMessageAt: new Date(), unread: true })
    .where(eq(schema.conversations.id, conversationId));

  await dispatchWebhooks(tenantId, "message.received", { conversationId, content });

  // Human has taken over -> AI stays silent.
  if (!conversation.aiActive) {
    return { aiReplied: false, aiActive: false };
  }

  const [agent] = resolvedAgentId
    ? await db.select().from(schema.agents).where(eq(schema.agents.id, resolvedAgentId)).limit(1)
    : [null];
  if (!agent) return { aiReplied: false, aiActive: conversation.aiActive };

  // Credit gate (src/modules/billing/) — never call a real AI provider
  // without checking the tenant can afford it first. Hands off to a human
  // gracefully rather than leaving the customer unanswered or silently
  // running the tenant's balance further negative.
  const credits = await checkCredits(tenantId);
  if (!credits.ok) {
    await db.update(schema.conversations).set({ aiActive: false, updatedAt: new Date(), lastMessageAt: new Date() }).where(eq(schema.conversations.id, conversationId));
    await db.insert(schema.messages).values({
      id: generateId(),
      tenantId,
      conversationId,
      sender: "AI",
      content: "Thanks for your patience — let me get one of our team to help you with this.",
    });
    await db.insert(schema.tasks).values({
      id: generateId(),
      tenantId,
      title: "AI credits exhausted — needs human reply",
      type: "HUMAN_TAKEOVER",
      dueAt: new Date(),
    });
    await dispatchWebhooks(tenantId, "message.sent", { conversationId, content: "AI credits exhausted; handed off to human" });
    return { aiReplied: false, aiActive: false, creditsExhausted: true };
  }

  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, conversation.contactId)).limit(1);

  const products = await db.select().from(schema.products).where(and(eq(schema.products.tenantId, tenantId), eq(schema.products.status, "ACTIVE")));

  const history = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(schema.messages.createdAt);

  const knowledge = await retrieveRelevantKnowledge(tenantId, content, 3);

  const turns: ConversationTurn[] = history.map((m) => ({ sender: m.sender, content: m.content }));

  const modelOverride = chooseModel({
    leadScore: conversation.leadScore,
    latestMessage: content,
    agent: { escalationConditions: agent.escalationConditions ?? [] },
  });
  // Every AI provider call goes through the AIExecutionGateway
  // (src/modules/ai/execution-gateway.ts) — never getAIProvider() directly
  // — so it's bounded by backend-enforced tool-call/token/cost/time limits
  // and recorded as an AgentRun regardless of outcome.
  const { reply, run } = await runAIExecution({
    tenantId,
    agentId: agent.id,
    conversationId,
    triggerType: "INBOUND_MESSAGE",
    context: {
      modelOverride,
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        company: agent.company,
        instructions: agent.instructions,
        tone: agent.tone,
        languageRules: agent.languageRules ?? [],
        qualificationQuestions: agent.qualificationQuestions ?? [],
        salesRules: agent.salesRules ?? [],
        restrictedTopics: agent.restrictedTopics ?? [],
        escalationConditions: agent.escalationConditions ?? [],
        greeting: agent.greeting,
      },
      history: turns,
      latestMessage: content,
      knowledge: knowledge.map((k) => ({ documentTitle: k.documentTitle, content: k.content })),
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        features: p.features ?? [],
        sellingPoints: p.sellingPoints ?? [],
        price: p.price,
        currency: p.currency,
        availability: p.availability,
      })),
      contactKnownFields: { name: contact?.name, phone: contact?.phone, email: contact?.email },
      conversationMeta: {
        productsDiscussed: conversation.productsDiscussed ?? [],
        leadScore: conversation.leadScore,
      },
    },
  });

  // Meter the real cost of this call — only real when a real model ran
  // (MockAIProvider never sets usage, so this is a no-op cost of $0).
  if (reply.usage) {
    await chargeUsage({ tenantId, conversationId, usage: reply.usage });
  }

  const [existingLead] = await db.select().from(schema.leads).where(eq(schema.leads.conversationId, conversationId)).limit(1);
  const [existingOpp] = existingLead
    ? await db.select().from(schema.opportunities).where(eq(schema.opportunities.leadId, existingLead.id)).limit(1)
    : [null];

  const execResult = await executeToolCalls(
    {
      tenantId,
      agentId: agent.id,
      conversationId,
      contactId: conversation.contactId,
      leadId: existingLead?.id ?? null,
      opportunityId: existingOpp?.id ?? null,
      // Real channel/UTM data — see actions.ts's create_lead/create_opportunity
      // handlers, which use this as the honest source/campaign default
      // instead of ever guessing or hardcoding it.
      channel: conversation.channel,
      utmSource: conversation.utmSource,
      utmCampaign: conversation.utmCampaign,
      runId: run.id,
    },
    reply.toolCalls
  );

  await db.insert(schema.messages).values({
    id: generateId(),
    tenantId,
    conversationId,
    sender: "AI",
    content: reply.message,
  });

  const newProductsDiscussed = new Set(conversation.productsDiscussed ?? []);
  for (const call of reply.toolCalls) {
    if (call.action === "update_lead" && Array.isArray(call.parameters.productsDiscussed)) {
      for (const p of call.parameters.productsDiscussed as string[]) newProductsDiscussed.add(p);
    }
  }

  await db
    .update(schema.conversations)
    .set({
      leadScore: conversation.leadScore + reply.leadScoreDelta,
      productsDiscussed: Array.from(newProductsDiscussed),
      aiActive: execResult.aiActive,
      updatedAt: new Date(),
      lastMessageAt: new Date(),
    })
    .where(eq(schema.conversations.id, conversationId));

  await dispatchWebhooks(tenantId, "message.sent", { conversationId, content: reply.message });

  return {
    aiReplied: true,
    aiActive: execResult.aiActive,
    message: reply.message,
    escalate: reply.escalate,
    leadId: execResult.leadId,
    opportunityId: execResult.opportunityId,
  };
}
