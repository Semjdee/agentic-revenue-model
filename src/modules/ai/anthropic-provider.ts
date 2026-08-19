import type { AIProvider, AIProviderContext, AIReplyResult } from "./types";
import { DEFAULT_MODEL } from "@/modules/billing/pricing";

// ============================================================================
// AnthropicProvider — optional real-LLM backend.
//
// Activated automatically when ANTHROPIC_API_KEY is set in the environment
// (see .env.example). Demonstrates that the AIProvider abstraction (spec
// section 25) is not just theoretical — a real model can be dropped in
// without touching the conversation engine, tool executor, or UI.
//
// The model is asked to return STRICT JSON matching AIReplyResult so the
// rest of the pipeline (tool execution, approvals, audit log) is identical
// regardless of which provider produced the reply.
//
// Model + usage: `ctx.modelOverride` (set by
// src/modules/billing/model-router.ts on every real call) picks the model
// per turn — not fixed at construction time — so Haiku/Sonnet routing
// actually takes effect per-reply, not per-provider-instance. The real
// `usage` block from Anthropic's response is returned on AIReplyResult.usage
// so the caller can meter it (src/modules/billing/ledger.ts); this file
// never touches the credit ledger itself, same separation as every other
// provider-agnostic boundary in this codebase.
// ============================================================================

const SYSTEM_TEMPLATE = (ctx: AIProviderContext) => `You are ${ctx.agent.name}, an AI sales agent for ${
  ctx.agent.company ?? "the business"
}. Role: ${ctx.agent.role ?? "Sales Assistant"}. Tone: ${ctx.agent.tone ?? "friendly, professional"}.

Instructions from the business owner:
${ctx.agent.instructions ?? "Be helpful, qualify the customer, and recommend suitable products."}

Rules you MUST follow:
- Never invent prices, stock levels, discounts, warranties, or delivery times. Only state facts present in the PRODUCTS or KNOWLEDGE sections below. If asked something you cannot answer from them, say you'll check and escalate.
- Restricted topics: ${ctx.agent.restrictedTopics?.join(", ") || "none specified"}.
- Escalate to a human when: ${ctx.agent.escalationConditions?.join("; ") || "the customer explicitly asks, or you cannot help"}.
- Ask qualification questions one at a time: ${ctx.agent.qualificationQuestions?.join(" | ") || "(use your judgement)"}.

PRODUCTS:
${ctx.products.map((p) => `- ${p.name} (${p.category ?? "n/a"}): ${p.description ?? ""} ${p.price ? `Price: ${p.currency} ${p.price}` : "(price not listed)"}`).join("\n")}

KNOWLEDGE:
${ctx.knowledge.map((k) => `[${k.documentTitle}] ${k.content}`).join("\n\n")}

Respond with STRICT JSON only, matching this TypeScript type, and nothing else:
{
  "message": string,
  "toolCalls": { "action": string, "parameters": object }[],
  "escalate": boolean,
  "escalateReason"?: string,
  "leadScoreDelta": number,
  "extractedFields": { "name"?: string, "phone"?: string, "email"?: string, "location"?: string, "budget"?: string, "requirements"?: string }
}

Valid tool call actions: create_contact, update_contact, create_lead, update_lead, create_opportunity, update_opportunity, schedule_followup, create_task, request_human, record_sale, offer_discount.`;

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  constructor(private apiKey: string, private defaultModel = DEFAULT_MODEL) {}

  async generateReply(ctx: AIProviderContext): Promise<AIReplyResult> {
    const model = ctx.modelOverride || this.defaultModel;
    const messages = ctx.history.map((h) => ({
      role: h.sender === "CUSTOMER" ? ("user" as const) : ("assistant" as const),
      content: h.content,
    }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        // System prompt is identical across every turn of a conversation
        // for a given agent (only PRODUCTS/KNOWLEDGE change, and only when
        // the owner edits the catalog/knowledge base) — a real
        // prompt-caching win, not a hypothetical one, since it's re-sent
        // on every single turn otherwise. `cache_control` marks it as the
        // cache breakpoint; Anthropic caches everything up to and
        // including this block.
        system: [{ type: "text", text: SYSTEM_TEMPLATE(ctx), cache_control: { type: "ephemeral" } }],
        messages: messages.length ? messages : [{ role: "user", content: ctx.latestMessage }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
    }

    const json = await res.json();
    const text: string = json.content?.[0]?.text ?? "{}";
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : "{}");

    const usage = json.usage
      ? {
          model,
          inputTokens: toFiniteNumber(json.usage.input_tokens),
          outputTokens: toFiniteNumber(json.usage.output_tokens),
          cacheReadTokens: toFiniteNumber(json.usage.cache_read_input_tokens),
          cacheWriteTokens: toFiniteNumber(json.usage.cache_creation_input_tokens),
        }
      : undefined;

    return {
      message: parsed.message ?? "Sorry, could you repeat that?",
      toolCalls: parsed.toolCalls ?? [],
      escalate: !!parsed.escalate,
      escalateReason: parsed.escalateReason,
      leadScoreDelta: parsed.leadScoreDelta ?? 0,
      extractedFields: parsed.extractedFields ?? {},
      usage,
    };
  }
}

function toFiniteNumber(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
