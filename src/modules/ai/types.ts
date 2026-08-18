export interface ConversationTurn {
  sender: "CUSTOMER" | "AI" | "HUMAN" | "SYSTEM";
  content: string;
}

export interface ToolCall {
  action: string;
  parameters: Record<string, unknown>;
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
}

export interface AIProvider {
  readonly name: string;
  generateReply(ctx: AIProviderContext): Promise<AIReplyResult>;
}
