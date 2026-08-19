import { DEFAULT_MODEL, ESCALATION_MODEL } from "./pricing";
import type { AgentConfigLike } from "@/modules/ai/types";

// Deterministic, pre-call routing — decides which model handles a turn
// BEFORE calling the AI, so the decision itself never costs a token (no
// "ask the model which model to use"). Confirmed with the product owner
// 2026-08-19: Haiku 4.5 by default, Sonnet 5 escalation for the turns
// where quality genuinely matters more than the ~5x cost difference.
//
// This is intentionally a plain heuristic, not a classifier — every
// signal below is something the conversation engine already has in hand
// (lead score, message text, agent config) with zero extra latency or
// cost. Revisit with real usage data once there's enough volume to see
// whether Haiku ever mis-handles something these rules should have
// escalated.

const ESCALATION_KEYWORDS = [
  // Price negotiation / objection — the moments a mediocre reply costs
  // an actual sale, not just a mediocre chat.
  "discount",
  "negotiate",
  "cheaper",
  "lower price",
  "best price",
  "compare",
  "competitor",
  // Dissatisfaction — a wrong tone here escalates a complaint into a
  // churn risk.
  "complaint",
  "complain",
  "refund",
  "cancel",
  "angry",
  "unacceptable",
  "unhappy",
  "disappointed",
  "legal",
  "lawyer",
  "sue",
];

/** A lead crossing into genuinely-qualified territory is worth the better
 * model — this is close to a real sale, not a routine FAQ. */
const HOT_LEAD_SCORE_THRESHOLD = 60;

export function chooseModel(params: { leadScore: number; latestMessage: string; agent: Pick<AgentConfigLike, "escalationConditions"> }): string {
  if (params.leadScore >= HOT_LEAD_SCORE_THRESHOLD) return ESCALATION_MODEL;

  const lower = params.latestMessage.toLowerCase();
  if (ESCALATION_KEYWORDS.some((kw) => lower.includes(kw))) return ESCALATION_MODEL;

  // Best-effort match against the business owner's own escalation rules
  // (spec section 11 / addendum §A3 — these are plain-English, not
  // structured, so this is a substring check, not exact matching).
  const agentEscalationText = params.agent.escalationConditions.join(" ").toLowerCase();
  if (agentEscalationText) {
    const agentKeywords = agentEscalationText.split(/[^a-z]+/).filter((w) => w.length > 4);
    if (agentKeywords.some((kw) => lower.includes(kw))) return ESCALATION_MODEL;
  }

  return DEFAULT_MODEL;
}
