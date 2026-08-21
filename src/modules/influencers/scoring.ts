import type { InfluencerMetrics } from "./metrics";

// ============================================================================
// Deterministic scoring (docs/PHASE_2_TASKS.md Milestone 6, spec sections
// 27-29). NO LLM call in this file — the platform calculates, the AI
// (modules/influencers/analyst.ts) only ever explains a score that was
// already computed here (spec section 38, the rule the whole spec
// repeats most).
//
// Honesty note on Publicity Score: this platform has no live connector
// polling reach/impressions/engagement from Instagram/TikTok/YouTube
// (that's the CSV-import backlog item in docs/PHASE_2_TASKS.md) — a
// score that pretended to measure "reach" from data we don't have would
// be exactly the kind of fabrication this codebase's DEMO/MOCK discipline
// exists to prevent. Publicity Score here is instead built from the one
// real awareness signal this app does own: tracking-link clicks and how
// well they convert into conversations, scored RELATIVE to the tenant's
// other creators (not against an invented absolute benchmark). Swapping
// in real reach/engagement data later is additive — see the TODO below.
// ============================================================================

export const SCORE_WEIGHTS = {
  commercial: { revenue: 0.4, roas: 0.25, leadToSale: 0.2, qualifiedLeadRate: 0.15 },
  publicity: { clickVolume: 0.6, clickToConversation: 0.4 },
};

const MIN_CLICKS_FOR_SCORING = 5; // below this, any score is noise, not signal

function relativeScore(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function computeCommercialScore(metrics: InfluencerMetrics, peers: InfluencerMetrics[]): number | null {
  if (metrics.clicks < MIN_CLICKS_FOR_SCORING && metrics.leads === 0) return null; // INSUFFICIENT_DATA
  const maxRevenue = Math.max(...peers.map((p) => p.revenue), 1);
  const maxRoas = Math.max(...peers.map((p) => p.roas), 1);
  const w = SCORE_WEIGHTS.commercial;
  const score =
    relativeScore(metrics.revenue, maxRevenue) * w.revenue +
    relativeScore(metrics.roas, maxRoas) * w.roas +
    metrics.leadToSaleRate * 100 * w.leadToSale +
    (metrics.leads > 0 ? metrics.qualifiedLeads / metrics.leads : 0) * 100 * w.qualifiedLeadRate;
  return Math.round(score);
}

export function computePublicityScore(metrics: InfluencerMetrics, peers: InfluencerMetrics[]): number | null {
  if (metrics.clicks < MIN_CLICKS_FOR_SCORING) return null; // INSUFFICIENT_DATA
  const maxClicks = Math.max(...peers.map((p) => p.clicks), 1);
  const w = SCORE_WEIGHTS.publicity;
  const score = relativeScore(metrics.clicks, maxClicks) * w.clickVolume + metrics.clickToConversationRate * 100 * w.clickToConversation;
  return Math.round(score);
}

export const CREATOR_CLASSIFICATIONS = [
  "SALES_DRIVER",
  "PUBLICITY_DRIVER",
  "FULL_FUNNEL_PERFORMER",
  "ENGAGEMENT_SPECIALIST",
  "EMERGING_PERFORMER",
  "UNDERPERFORMER",
  "INSUFFICIENT_DATA",
] as const;
export type CreatorClassification = (typeof CREATOR_CLASSIFICATIONS)[number];

const HIGH = 60;
const MID = 30;

export function classifyCreator(commercialScore: number | null, publicityScore: number | null, metrics: InfluencerMetrics): CreatorClassification {
  if (commercialScore === null || publicityScore === null) return "INSUFFICIENT_DATA";

  if (commercialScore >= HIGH && publicityScore >= HIGH) return "FULL_FUNNEL_PERFORMER";
  if (commercialScore >= HIGH) return "SALES_DRIVER";
  if (publicityScore >= HIGH) return "PUBLICITY_DRIVER";
  // High click-to-conversation but weak revenue: the audience engages
  // (clicks turn into real conversations) but doesn't buy — a distinct
  // pattern from simply "underperforming."
  if (metrics.clickToConversationRate >= 0.3 && commercialScore < MID) return "ENGAGEMENT_SPECIALIST";
  if (commercialScore >= MID || publicityScore >= MID) return "EMERGING_PERFORMER";
  return "UNDERPERFORMER";
}
