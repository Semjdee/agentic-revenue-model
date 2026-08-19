// Guided AI Agent setup — docs/ONBOARDING_SPEC.md addendum §A2-§A3.
//
// Pure mapping only: takes the business-friendly answers a non-technical
// owner gives during onboarding and returns a partial `agents` row. No DB
// access here (same discipline as src/modules/advertising/analyst.ts's
// calculation/AI split) — the caller (an API route) does the actual
// insert, using the exact same `agents` table and `POST /api/internal/agents`-
// adjacent insert shape that manual creation uses. This file's only job is
// "business answers in, agent config out" — nothing here decides whether
// to create, update, or activate anything.
//
// Note: default Agent Action Permissions (spec section 25 — "large
// discount: APPROVAL_REQUIRED", "delete business records: DISABLED", etc.)
// are NOT part of this mapping because they already exist as the
// tenant-wide ACTION_PERMISSIONS defaults in src/modules/ai/actions.ts —
// every agent, guided or manual, is already covered by those defaults.
// Nothing to duplicate here.

export interface GuidedSetupAnswers {
  whatDoYouSell: string;
  typicalCustomers?: string;
  whatShouldAiHelpWith?: string;
  whatToCollectFromLead: string;
  whatMakesLeadQualified?: string;
  whenToHandOff?: string;
  neverPromise?: string;
  negotiatePrices?: boolean;
  offerDelivery?: boolean;
  locationsServed?: string;
  languages?: string[];
  tone?: string;
}

export interface GuidedAgentConfig {
  name: string;
  role: string;
  company?: string;
  instructions: string;
  tone: string;
  languageRules: string[];
  qualificationQuestions: string[];
  salesRules: string[];
  restrictedTopics: string[];
  escalationConditions: string[];
}

/** docs/ONBOARDING_SPEC.md addendum §A3's mapping table, made concrete. */
export function mapAnswersToAgentConfig(answers: GuidedSetupAnswers, businessName: string): GuidedAgentConfig {
  const qualificationQuestions = [
    "Could I get your name?",
    "What's the best phone number or email to reach you on?",
    answers.locationsServed ? "Which location are you in?" : "Where are you located?",
    answers.whatToCollectFromLead,
  ].filter((q): q is string => Boolean(q && q.trim()));

  const salesRules = [
    answers.negotiatePrices === false ? "Prices are fixed — do not negotiate or offer unauthorized discounts." : null,
    answers.negotiatePrices === true ? "Reasonable price negotiation is allowed within normal bounds." : null,
    answers.offerDelivery === true ? "Delivery is available — mention it when relevant." : null,
    answers.offerDelivery === false ? "Delivery is not offered — do not promise it." : null,
  ].filter((r): r is string => Boolean(r));

  const restrictedTopics = [answers.neverPromise].filter((t): t is string => Boolean(t && t.trim()));

  const escalationConditions = [
    answers.whenToHandOff,
    "Customer explicitly asks for a human.",
    "Customer is upset, frustrated, or files a complaint.",
  ].filter((c): c is string => Boolean(c && c.trim()));

  const instructions = [
    `You are a sales assistant for ${businessName}.`,
    `What we sell: ${answers.whatDoYouSell}`,
    answers.typicalCustomers ? `Typical customers: ${answers.typicalCustomers}` : null,
    answers.whatShouldAiHelpWith ? `Your job: ${answers.whatShouldAiHelpWith}` : null,
    answers.whatMakesLeadQualified ? `A lead is qualified when: ${answers.whatMakesLeadQualified}` : null,
    "Never fabricate a price, stock level, warranty, or delivery time — if you don't know, say so and offer to have a human follow up.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  return {
    name: "Sales Assistant",
    role: "Sales Assistant",
    company: businessName,
    instructions,
    tone: answers.tone?.trim() || "friendly, professional",
    languageRules: answers.languages?.length ? answers.languages : ["English"],
    qualificationQuestions,
    salesRules,
    restrictedTopics,
    escalationConditions,
  };
}
