import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { runAIExecution } from "@/modules/ai";
import { retrieveRelevantKnowledge } from "@/modules/knowledge/service";
import type { ConversationTurn } from "@/modules/ai/types";
import { chargeUsage } from "@/modules/billing/ledger";
import { chooseModel } from "@/modules/billing/model-router";
import { checkCreditsForTrigger, explainBlockedReason } from "@/modules/billing/reserve-policy";

// Agent test sandbox — docs/ONBOARDING_SPEC.md section 14 / addendum §A13.
//
// Deliberately reuses the exact same building blocks as the real
// conversation engine (src/modules/conversations/engine.ts):
// runAIExecution() (the AIExecutionGateway) and retrieveRelevantKnowledge()
// are the identical functions, so the AI's reply here is completely real —
// not a separate "test mode" AI, same rule as every other sandbox/demo path
// in this codebase. Sandbox calls are tracked as their own AgentRun
// (triggerType SANDBOX_TEST) and bounded by the same limits as a real
// conversation turn.
//
// What's different from the real engine, deliberately: no conversation,
// message, contact, lead, or opportunity ever gets written to the
// database, and executeToolCalls() (src/modules/ai/actions.ts) — the only
// thing that actually mutates contacts/leads/opportunities — is never
// called. Tool calls the AI would have made are reported back for display
// (spec section 14: "Show what happens internally... lead qualification,
// contact creation simulation, lead score, handoff decision") but never
// executed. History is passed in and returned by the caller (kept
// client-side or in local component state), not persisted server-side —
// "clearly marked test/sandbox data" per spec is satisfied by it simply
// not existing as a production row anywhere.

export interface SandboxMessage {
  sender: "CUSTOMER" | "AI";
  content: string;
}

export async function runSandboxMessage(params: {
  tenantId: string;
  agentId: string;
  history: SandboxMessage[];
  latestMessage: string;
}) {
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, params.agentId), eq(schema.agents.tenantId, params.tenantId)))
    .limit(1);
  if (!agent) throw new Error("Agent not found");

  // Sandbox calls hit the same real provider as production (see file
  // header) — they cost real money too, so they're metered the same way,
  // but as DISCRETIONARY usage under the reserve/max-drawdown policy
  // (modules/billing/reserve-policy.ts) — testing is the first thing
  // that pauses when a tenant's balance runs low, protecting the reserve
  // that keeps live customer conversations working.
  const credits = await checkCreditsForTrigger(params.tenantId, "SANDBOX_TEST");
  if (!credits.ok) {
    const isExhausted = credits.reason === "balance_exhausted";
    const err = new Error(isExhausted ? "You're out of AI credits — buy more to keep testing and going live." : explainBlockedReason(credits));
    err.name = isExhausted ? "OUT_OF_CREDITS" : "CREDITS_RESERVED";
    throw err;
  }

  const products = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.tenantId, params.tenantId), eq(schema.products.status, "ACTIVE")));

  const knowledge = await retrieveRelevantKnowledge(params.tenantId, params.latestMessage, 3);

  const turns: ConversationTurn[] = params.history.map((m) => ({ sender: m.sender, content: m.content }));

  const modelOverride = chooseModel({
    leadScore: 0,
    latestMessage: params.latestMessage,
    agent: { escalationConditions: agent.escalationConditions ?? [] },
  });
  const { reply } = await runAIExecution({
    tenantId: params.tenantId,
    agentId: agent.id,
    conversationId: null,
    triggerType: "SANDBOX_TEST",
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
      latestMessage: params.latestMessage,
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
      contactKnownFields: {},
      conversationMeta: { productsDiscussed: [], leadScore: 0 },
    },
  });

  if (reply.usage) {
    await chargeUsage({ tenantId: params.tenantId, usage: reply.usage });
  }

  return {
    message: reply.message,
    escalate: reply.escalate,
    leadScoreDelta: reply.leadScoreDelta,
    // Informational only — what WOULD happen in a real conversation, not
    // what did. Never passed to executeToolCalls().
    simulatedActions: reply.toolCalls.map((c) => ({ action: c.action, parameters: c.parameters })),
  };
}
