import type { AIProvider, AIProviderContext, AIReplyResult, ToolCall } from "./types";

// ============================================================================
// MockAIProvider — deterministic, rule-based "AI Sales Agent" brain.
//
// This is the DEFAULT provider (no external API key required) so the whole
// platform is demoable offline. It is intentionally simple: slot-filling
// qualification, keyword-based product matching, and scripted escalation
// rules. It is wired behind the same AIProvider interface a real LLM-backed
// provider uses (see openai-provider.ts / anthropic-provider.ts), so
// swapping in a real model later is a one-line config change — see
// src/modules/ai/index.ts and BUILD_NOTES.md → "AI abstraction".
//
// It deliberately NEVER invents prices/stock/warranty/delivery times
// (spec section 5): those only ever come from `ctx.products` or
// `ctx.knowledge`. If the answer isn't there, it escalates instead of
// guessing.
// ============================================================================

const DEFAULT_QUESTIONS = [
  "What are you looking for today?",
  "Could I get your name?",
  "What's the best phone number or email to reach you on?",
  "And where are you located, or is this for your home or business?",
];

const DISCOUNT_PATTERN = /\b(discount|cheaper|lower the price|reduce the price|negotiate|best price)\b/i;
const HUMAN_PATTERN = /\b(human|real person|agent please|talk to (a|someone)|speak to (a|someone)|salesperson)\b/i;
const AFFIRM_QUOTE_PATTERN = /\b(yes|yeah|sure|please|go ahead|quote|quotation|send it|interested|proceed|order|buy)\b/i;
const PHONE_PATTERN = /(\+?\d[\d\s-]{7,}\d)/;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[a-z.]{2,}/i;

function scoreProduct(text: string, product: AIProviderContext["products"][number]): number {
  const haystack = `${product.name} ${product.category ?? ""} ${product.description ?? ""} ${(
    product.features || []
  ).join(" ")}`.toLowerCase();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    // Keep words of length > 2, but don't drop short numeric tokens like
    // "4" (bedroom count, system size) — they're exactly the signal that
    // differentiates similar products for a business like this.
    .filter((w) => w.length > 2 || /\d/.test(w));
  let score = 0;
  for (const w of words) if (haystack.includes(w)) score += 1;
  return score;
}

function describeProduct(p: AIProviderContext["products"][number]): string {
  const bits: string[] = [];
  if (p.description) bits.push(p.description);
  if (p.sellingPoints?.length) bits.push(p.sellingPoints.slice(0, 2).join(", "));
  if (p.price) bits.push(`Indicative price: ${p.currency} ${Number(p.price).toLocaleString()}`);
  else bits.push("I'll confirm exact pricing with our team");
  return bits.join(". ");
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async generateReply(ctx: AIProviderContext): Promise<AIReplyResult> {
    const customerTurns = ctx.history.filter((h) => h.sender === "CUSTOMER");
    const idx = Math.max(0, customerTurns.length - 1); // index of the message just received
    const questions = ctx.agent.qualificationQuestions?.length
      ? ctx.agent.qualificationQuestions
      : DEFAULT_QUESTIONS;

    const toolCalls: ToolCall[] = [];
    const extractedFields: AIReplyResult["extractedFields"] = {};
    const latest = ctx.latestMessage;

    // Always opportunistically extract phone/email regardless of stage.
    const phoneMatch = latest.match(PHONE_PATTERN);
    const emailMatch = latest.match(EMAIL_PATTERN);
    if (phoneMatch) extractedFields.phone = phoneMatch[1].trim();
    if (emailMatch) extractedFields.email = emailMatch[0].trim();

    // --- Restricted topic / discount request -> escalate + approval-gated tool
    if (DISCOUNT_PATTERN.test(latest)) {
      toolCalls.push({
        action: "offer_discount",
        parameters: { conversationNote: latest },
      });
      return {
        message:
          "Great question — I don't have the authority to approve discounts myself, so I've flagged this for a specialist on our team to review and get back to you shortly. Is there anything else I can help with in the meantime?",
        toolCalls,
        escalate: true,
        escalateReason: "Pricing/discount negotiation requires human approval",
        leadScoreDelta: 5,
        extractedFields,
      };
    }

    // --- Explicit request for a human
    if (HUMAN_PATTERN.test(latest)) {
      toolCalls.push({ action: "request_human", parameters: { reason: "Customer requested a human" } });
      return {
        message: "Of course — connecting you with a member of our team now. They'll be with you shortly.",
        toolCalls,
        escalate: true,
        escalateReason: "Customer explicitly requested a human",
        leadScoreDelta: 5,
        extractedFields,
      };
    }

    // --- Qualification phase: still working through the slot-filling questions
    if (idx < questions.length - 1) {
      const currentQuestion = questions[idx];
      if (/name/i.test(currentQuestion)) extractedFields.name = latest.trim().split(/[.,!]/)[0].slice(0, 80);
      if (/location|where|home|business|address|city/i.test(currentQuestion)) extractedFields.location = latest.trim();
      if (/budget/i.test(currentQuestion)) extractedFields.budget = latest.trim();
      if (idx === 0) extractedFields.requirements = latest.trim();

      const nextQuestion = questions[idx + 1];
      toolCalls.push({
        action: "create_contact",
        parameters: { ...extractedFields },
      });
      toolCalls.push({ action: "create_lead", parameters: { stage: "CONTACTED", note: latest } });

      return {
        message: `Thanks! ${nextQuestion}`,
        toolCalls,
        escalate: false,
        leadScoreDelta: 10,
        extractedFields,
      };
    }

    // Last qualification answer just arrived
    if (idx === questions.length - 1) {
      const lastQuestion = questions[idx];
      if (/name/i.test(lastQuestion)) extractedFields.name = latest.trim().split(/[.,!]/)[0].slice(0, 80);
      if (/location|where|home|business|address|city/i.test(lastQuestion)) extractedFields.location = latest.trim();
      if (/budget/i.test(lastQuestion)) extractedFields.budget = latest.trim();

      const combinedText = customerTurns.map((t) => t.content).join(" ") + " " + latest;
      const scored = ctx.products
        .map((p) => ({ p, score: scoreProduct(combinedText, p) }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0]?.score ? scored[0].p : ctx.products[0];

      toolCalls.push({ action: "create_contact", parameters: { ...extractedFields } });
      toolCalls.push({
        action: "update_lead",
        parameters: { stage: "QUALIFIED", score: 60, productsDiscussed: best ? [best.name] : [] },
      });

      if (best) {
        return {
          message: `Based on what you've told me, I'd recommend our ${best.name}. ${describeProduct(
            best
          )}. Would you like me to prepare a formal quotation for you?`,
          toolCalls,
          escalate: false,
          leadScoreDelta: 30,
          extractedFields,
        };
      }

      return {
        message:
          "Thanks for the details! Let me check our catalogue for the best fit and get back to you shortly — in the meantime, is there anything specific you'd like it to include?",
        toolCalls: [...toolCalls, { action: "request_human", parameters: { reason: "No product match found" } }],
        escalate: true,
        escalateReason: "No catalogue match for stated requirements",
        leadScoreDelta: 15,
        extractedFields,
      };
    }

    // --- Post-qualification: customer confirms they want a quotation
    const alreadyDiscussed = ctx.conversationMeta.productsDiscussed[0];
    if (alreadyDiscussed && AFFIRM_QUOTE_PATTERN.test(latest)) {
      const product = ctx.products.find((p) => p.name === alreadyDiscussed);
      toolCalls.push({
        action: "create_opportunity",
        parameters: {
          stage: "QUOTATION",
          estimatedValue: product?.price ?? null,
          products: product ? [{ productId: product.id, name: product.name, qty: 1 }] : [],
        },
      });
      toolCalls.push({
        action: "schedule_followup",
        parameters: { hoursFromNow: 48, objective: "Confirm quotation & close" },
      });
      return {
        message:
          "Perfect — I've logged your request for a formal quotation and one of our sales specialists will follow up with you within 48 hours. Thank you for your interest!",
        toolCalls,
        escalate: false,
        leadScoreDelta: 40,
        extractedFields,
      };
    }

    // --- Try to answer from knowledge base
    if (ctx.knowledge.length > 0) {
      const top = ctx.knowledge[0];
      return {
        message: `${top.content.slice(0, 400)}${
          alreadyDiscussed ? " Would you like a formal quotation for this?" : ""
        }`,
        toolCalls,
        escalate: false,
        leadScoreDelta: 5,
        extractedFields,
      };
    }

    // --- Fallback: don't fabricate, offer escalation
    return {
      message:
        "I want to make sure I give you accurate information — let me check with our team and get back to you. Is there anything else I can help with?",
      toolCalls: [...toolCalls, { action: "request_human", parameters: { reason: "Unanswerable without fabricating info" } }],
      escalate: true,
      escalateReason: "Question could not be answered from knowledge base or product catalogue",
      leadScoreDelta: 0,
      extractedFields,
    };
  }
}
