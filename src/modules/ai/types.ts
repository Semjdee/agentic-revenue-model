export interface ConversationTurn {
  sender: "CUSTOMER" | "AI" | "HUMAN" | "SYSTEM";
  content: string;
}

export interface ToolCall {
  action: string;
  parameters: Record<string, unknown>;
}

export interface AIUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface AIReplyResult {
  message: string;
  toolCalls: ToolCall[];
  escalate: boolean;
  escalateReason?: string;
  leadScoreDelta: number;
  extractedFields: {
    name?: string;
    phone?: string;
    email?: string;
    location?: string;
    budget?: string;
    requirements?: string;
  };
  /** Real token usage from the provider — absent for MockAIProvider, which
   * genuinely costs nothing (see src/modules/billing/ledger.ts, which
   * charges 0 credits when this is undefined). Present whenever a real
   * model actually ran, so usage can be metered against the tenant's
   * credit balance (src/modules/billing/). */
  usage?: AIUsage;
}

export interface AgentConfigLike {
  id: string;
  name: string;
  role: string | null;
  company: string | null;
  instructions: string | null;
  tone: string | null;
  languageRules: string[];
  qualificationQuestions: string[];
  salesRules: string[];
  restrictedTopics: string[];
  escalationConditions: string[];
  greeting: string | null;
}

export interface ProductLike {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  features: string[];
  sellingPoints: string[];
  price: string | null;
  currency: string;
  availability: string;
}

export interface KnowledgeSnippet {
  documentTitle: string;
  content: string;
}

export interface AIProviderContext {
  agent: AgentConfigLike;
  history: ConversationTurn[];
  latestMessage: string;
  knowledge: KnowledgeSnippet[];
  products: ProductLike[];
  contactKnownFields: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  conversationMeta: {
    productsDiscussed: string[];
    leadScore: number;
  };
  /** Which model to use for this specific call — set by
   * src/modules/billing/model-router.ts before every real call.
   * MockAIProvider ignores it (it's not calling a real model). */
  modelOverride?: string;
}

export interface AIProvider {
  readonly name: string;
  generateReply(ctx: AIProviderContext): Promise<AIReplyResult>;
}
