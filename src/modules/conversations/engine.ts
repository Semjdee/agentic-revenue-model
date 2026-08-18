import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getAIProvider } from "@/modules/ai";
import { executeToolCalls } from "@/modules/ai/actions";
import { retrieveRelevantKnowledge } from "@/modules/knowledge/service";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";
import type { ConversationTurn } from "@/modules/ai/types";
import { recordTrafficSession } from "@/modules/attribution/service";

export interface StartConversationInput {
  publicAgentId: string;
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
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.publicAgentId, input.publicAgentId)).limit(1);
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

  await db.insert(schema.messages).values({
    id: generateId(),
    tenantId,
    conversationId,
    sender: "AI",
    content: agent.greeting || `Hi! I'm ${agent.name}. How can I help you today?`,
  });

  await dispatchWebhooks(tenantId, "conversation.created", { conversationId });

  const messages = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversationId));
  return { conversationId, contactId, messages, aiActive: true, tenantId };
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

  const [agent] = conversation.agentId
    ? await db.select().from(schema.agents).where(eq(schema.agents.id, conversation.agentId)).limit(1)
    : [null];
  if (!agent) return { aiReplied: false, aiActive: conversation.aiActive };

  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, conversation.contactId)).limit(1);

  const products = await db.select().from(schema.products).where(and(eq(schema.products.tenantId, tenantId), eq(schema.products.status, "ACTIVE")));

  const history = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(schema.messages.createdAt);

  const knowledge = await retrieveRelevantKnowledge(tenantId, content, 3);

  const turns: ConversationTurn[] = history.map((m) => ({ sender: m.sender, content: m.content }));

  const provider = getAIProvider();
  const reply = await provider.generateReply({
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
  });

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
