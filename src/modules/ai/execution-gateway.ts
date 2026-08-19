import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { getAIProvider } from "./index";
import type { AIProviderContext, AIReplyResult, ToolCall } from "./types";
import { computeApiCostUsd } from "@/modules/billing/pricing";
import { DEFAULT_RUN_LIMITS, type RunLimits } from "./run-limits";

// ============================================================================
// AIExecutionGateway — the single mandatory chokepoint in front of every AI
// provider call on this platform (multi-agent-routing spec, Part B). No
// module should call getAIProvider().generateReply() directly — everything
// goes through runAIExecution() instead, which:
//
//   1. Opens an AgentRun row (src/db/schema.ts) with backend-enforced hard
//      limits the model cannot see or override.
//   2. Bounds the call with a wall-clock timeout and ONE bounded retry on a
//      genuinely transient provider error (never on validation failures —
//      spec §21, "do not let the LLM decide retries").
//   3. Caps the number of tool calls a single reply can request, so even a
//      single pathological model response can't fan out into dozens of
//      DB writes.
//   4. Records real usage/cost/tokens on the run row regardless of outcome,
//      for the per-tenant/per-agent cost observability spec §34-39 asks
//      for.
//
// IMPORTANT — honest scope note: this codebase makes exactly ONE model call
// per customer turn (see src/modules/conversations/engine.ts —
// handleCustomerMessage calls generateReply() once, gets back a message
// plus a batch of tool calls, and executes them; there is no
// Agent -> Tool -> Agent loop where the model re-prompts itself after
// seeing tool results). So "max model calls" here bounds the retry above,
// not an iterative agent loop — that loop doesn't exist yet. If/when a
// true multi-step agent loop is added (e.g. as part of Part A's
// multi-agent handoffs), it MUST call runAIExecution() once per model
// call within the same run (passing the same runId forward) so
// maxModelCalls actually gates it. Tool-call-level duplicate detection
// and cross-run idempotency live in src/modules/ai/actions.ts
// (executeToolCalls) — this file only bounds the model call itself.
// ============================================================================

export type RunTrigger = (typeof schema.AGENT_RUN_TRIGGERS)[number];
export type RunStatus = (typeof schema.AGENT_RUN_STATUSES)[number];

export interface ExecutionGatewayParams {
  tenantId: string;
  agentId: string | null;
  conversationId: string | null;
  triggerType: RunTrigger;
  context: AIProviderContext;
  limits?: Partial<RunLimits>;
  correlationId?: string;
}

export interface ExecutionGatewayResult {
  reply: AIReplyResult;
  run: { id: string; status: RunStatus; stopReason: string | null };
}

class RunTimeoutError extends Error {}

/** Rough, cheap token estimate (chars/4) used only to decide whether to
 * trim conversation history before the call — not billing (real billing
 * always uses the provider's actual reported usage, see pricing.ts). Good
 * enough for a pre-call budget guard; no tokenizer dependency needed. */
function estimateTokens(ctx: AIProviderContext): number {
  const chars =
    (ctx.agent.instructions?.length ?? 0) +
    ctx.knowledge.reduce((n, k) => n + k.content.length, 0) +
    ctx.products.reduce((n, p) => n + (p.description?.length ?? 0) + (p.sellingPoints?.join("").length ?? 0), 0) +
    ctx.history.reduce((n, h) => n + h.content.length, 0) +
    ctx.latestMessage.length;
  return Math.ceil(chars / 4);
}

/** Context budgeting (spec §29-30, lite version): if the estimated prompt
 * would blow the run's token budget, drop the oldest turns first rather
 * than fail the call outright — a long-running conversation should
 * degrade to "recent context only", not stop responding. */
function trimHistoryToBudget(ctx: AIProviderContext, maxTokens: number): AIProviderContext {
  let trimmed = ctx;
  let guard = 0;
  while (estimateTokens(trimmed) > maxTokens && trimmed.history.length > 4 && guard < 100) {
    trimmed = { ...trimmed, history: trimmed.history.slice(2) }; // drop oldest customer+reply pair
    guard++;
  }
  return trimmed;
}

/** Deterministic action+params fingerprint — shared with
 * src/modules/ai/actions.ts, which uses the same function to check
 * cross-run idempotency (was this exact action already executed for this
 * conversation) before writing to the database. */
export function actionSignature(call: ToolCall): string {
  const sortedKeys = Object.keys(call.parameters ?? {}).sort();
  const canonicalParams: Record<string, unknown> = {};
  for (const k of sortedKeys) canonicalParams[k] = call.parameters[k];
  return `${call.action}:${JSON.stringify(canonicalParams)}`;
}

/** Caps tool-call count and collapses exact repeats within one reply
 * (spec §18-19 applied at the point they arrive from the model, before
 * execution). Cross-run idempotency — "was this exact action already
 * executed for this conversation" — is a separate, DB-backed check in
 * src/modules/ai/actions.ts, since only that layer knows what actually
 * got written. */
function boundToolCalls(toolCalls: ToolCall[], maxToolCalls: number): { calls: ToolCall[]; note: string | null } {
  const seen = new Set<string>();
  const deduped: ToolCall[] = [];
  let duplicatesFound = false;
  for (const call of toolCalls) {
    const sig = actionSignature(call);
    if (seen.has(sig)) {
      duplicatesFound = true;
      continue;
    }
    seen.add(sig);
    deduped.push(call);
  }
  if (deduped.length > maxToolCalls) {
    return { calls: deduped.slice(0, maxToolCalls), note: `truncated ${deduped.length - maxToolCalls} tool call(s) beyond max_tool_calls (${maxToolCalls})` };
  }
  if (duplicatesFound) {
    return { calls: deduped, note: "collapsed duplicate tool call(s) requested in the same reply" };
  }
  return { calls: deduped, note: null };
}

function fallbackReply(reason: string): AIReplyResult {
  return {
    message: "Sorry — I'm having trouble responding right now. Let me get one of our team to help you.",
    toolCalls: [{ action: "request_human", parameters: { reason } }],
    escalate: true,
    escalateReason: reason,
    leadScoreDelta: 0,
    extractedFields: {},
  };
}

export async function runAIExecution(params: ExecutionGatewayParams): Promise<ExecutionGatewayResult> {
  const limits: RunLimits = { ...DEFAULT_RUN_LIMITS, ...params.limits };
  const runId = generateId();
  const timeoutAt = new Date(Date.now() + limits.maxSeconds * 1000);

  await db.insert(schema.agentRuns).values({
    id: runId,
    tenantId: params.tenantId,
    agentId: params.agentId,
    conversationId: params.conversationId,
    triggerType: params.triggerType,
    status: "RUNNING",
    maxModelCalls: limits.maxModelCalls,
    maxToolCalls: limits.maxToolCalls,
    maxTokens: limits.maxTokens,
    maxCostUsd: limits.maxCostUsd.toFixed(6),
    timeoutAt,
    correlationId: params.correlationId ?? null,
  });

  const context = trimHistoryToBudget(params.context, limits.maxTokens);
  const provider = getAIProvider();

  let modelCalls = 0;
  let reply: AIReplyResult = fallbackReply("not started");
  let status: RunStatus = "COMPLETED";
  let stopReason: string | null = "ok";

  async function callOnce(): Promise<AIReplyResult> {
    modelCalls++;
    return Promise.race([
      provider.generateReply(context),
      new Promise<AIReplyResult>((_, reject) => setTimeout(() => reject(new RunTimeoutError("run exceeded max_seconds")), limits.maxSeconds * 1000)),
    ]);
  }

  try {
    try {
      reply = await callOnce();
    } catch (err) {
      if (err instanceof RunTimeoutError) throw err;
      // One bounded retry on a transient failure only (network error /
      // non-2xx from the provider) — never on a timeout, and never more
      // than once, and never beyond maxModelCalls (spec §21: platform
      // controls retries, not the model).
      if (modelCalls < limits.maxModelCalls) {
        reply = await callOnce();
      } else {
        throw err;
      }
    }
  } catch (err) {
    if (err instanceof RunTimeoutError) {
      status = "TIMED_OUT";
      stopReason = err.message;
    } else {
      status = "FAILED";
      stopReason = err instanceof Error ? err.message.slice(0, 500) : "unknown provider error";
    }
    reply = fallbackReply(stopReason);
  }

  let finalToolCalls = reply.toolCalls;
  if (status === "COMPLETED") {
    const bounded = boundToolCalls(reply.toolCalls, limits.maxToolCalls);
    finalToolCalls = bounded.calls;
    if (bounded.note) {
      status = bounded.note.startsWith("truncated") ? "STOPPED_LIMIT" : "STOPPED_LOOP";
      stopReason = bounded.note;
    }
  }

  const costUsd = reply.usage ? computeApiCostUsd(reply.usage) : 0;
  if (status === "COMPLETED" && costUsd > limits.maxCostUsd) {
    // Post-hoc — the call already happened and already cost real money,
    // so there's nothing to "stop" retroactively. Recorded for cost
    // observability/alerting (spec §39-40); does not block returning the
    // reply that was already paid for.
    stopReason = `cost $${costUsd.toFixed(4)} exceeded max_cost_usd ($${limits.maxCostUsd})`;
  }

  await db
    .update(schema.agentRuns)
    .set({
      status,
      stopReason,
      completedAt: new Date(),
      modelCalls,
      toolCalls: finalToolCalls.length,
      inputTokens: reply.usage?.inputTokens ?? 0,
      outputTokens: reply.usage?.outputTokens ?? 0,
      cachedTokens: (reply.usage?.cacheReadTokens ?? 0) + (reply.usage?.cacheWriteTokens ?? 0),
      estimatedCostUsd: costUsd.toFixed(6),
    })
    .where(eq(schema.agentRuns.id, runId));

  return {
    reply: { ...reply, toolCalls: finalToolCalls },
    run: { id: runId, status, stopReason },
  };
}
