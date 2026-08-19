// Backend-enforced hard limits for one AgentRun (AIExecutionGateway spec
// Part B §16-17). The LLM never sees or controls these — they exist so a
// misbehaving prompt, a pathological conversation, or a future multi-step
// agent loop cannot run up unbounded tokens/cost/time.
//
// "Moderate" defaults, confirmed with the product owner 2026-08-19:
// comfortable for a full sales qualification turn (create_lead +
// create_opportunity + schedule_followup in one reply, same shape as
// scripts/demo-journey.ts), while still cutting off genuine runaway
// behavior fast. Override per-call via ExecutionGatewayParams.limits —
// e.g. a higher-plan tenant or a specialized agent could get a larger
// budget later without changing this file.
export interface RunLimits {
  maxModelCalls: number;
  maxToolCalls: number;
  maxTokens: number;
  maxCostUsd: number;
  maxSeconds: number;
}

export const DEFAULT_RUN_LIMITS: RunLimits = {
  maxModelCalls: 8,
  maxToolCalls: 15,
  maxTokens: 40_000,
  maxCostUsd: 0.5,
  maxSeconds: 90,
};
