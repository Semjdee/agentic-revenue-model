// ============================================================================
// AI Revenue Agent Platform — Database Schema (Drizzle ORM / PostgreSQL)
//
// NOTE ON ORM CHOICE: The build spec recommends Prisma. This sandbox's
// network allowlist blocks binaries.prisma.sh (Prisma's engine binary CDN),
// so `prisma generate` / `migrate` cannot fetch the native query engine.
// Drizzle ORM is pure TypeScript (no native binaries), works against the
// same PostgreSQL database, and gives us the same "typed schema + migrations"
// workflow. See BUILD_NOTES.md → "Deviations from spec" for details.
// ============================================================================

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

const id = () => text("id").primaryKey();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// 23. MULTI-TENANCY
// ---------------------------------------------------------------------------
export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("trial"),
  // Business profile — captured by the onboarding wizard's "Tell us about
  // your business" step (docs/ONBOARDING_SPEC.md section 4 Step 2). All
  // nullable/additive: existing tenants (e.g. the seeded RayGrid demo)
  // simply have these unset until edited. This is deliberately on
  // `tenants` rather than `workspaces` since it's a one-per-business
  // concept, same granularity as `name`/`plan` above.
  industry: text("industry"),
  country: text("country"),
  currency: text("currency"),
  timezone: text("timezone"),
  websiteUrl: text("website_url"),
  description: text("description"),
  primaryObjective: text("primary_objective"),
  primaryChannel: text("primary_channel"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// Roles are a fixed enum per spec section 23. Permissions are a static
// resource:action matrix seeded in code (src/lib/permissions.ts) rather than
// a DB table — simplification documented in BUILD_NOTES.md.
export const ROLES = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "SALES",
  "MARKETING",
  "AGENT",
  "VIEWER",
  "DEVELOPER",
] as const;
export type Role = (typeof ROLES)[number];

export const users = pgTable(
  "users",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: text("role").$type<Role>().notNull().default("SALES"),
    avatarUrl: text("avatar_url"),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tenantEmailIdx: uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email),
  })
);

// ---------------------------------------------------------------------------
// 8. CONTACT IDENTITY MODEL
// ---------------------------------------------------------------------------
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    tags: jsonb("tags").$type<string[]>().default([]),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("contacts_tenant_idx").on(t.tenantId) })
);

export const CONTACT_IDENTITY_TYPES = [
  "PHONE",
  "EMAIL",
  "WHATSAPP",
  "INSTAGRAM",
  "MESSENGER",
  "ANONYMOUS_SESSION",
] as const;

export const contactIdentities = pgTable(
  "contact_identities",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    type: text("type").$type<(typeof CONTACT_IDENTITY_TYPES)[number]>().notNull(),
    value: text("value").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueIdentity: uniqueIndex("contact_identities_unique").on(t.tenantId, t.type, t.value),
  })
);

// ---------------------------------------------------------------------------
// 5/6. AI AGENTS (Agent + AgentConfiguration merged — see BUILD_NOTES.md)
// ---------------------------------------------------------------------------

// Agent lifecycle (docs/ONBOARDING_SPEC.md addendum §A14 — creation and
// activation are separate events). DRAFT/READY are new; existing rows
// (and every row created before this migration) default to ACTIVE, so
// this is purely additive — nothing that already worked stops working.
// DRAFT = just created (e.g. by the guided-setup wizard), not yet
// reviewed. READY = passed/would-pass a health check but the user hasn't
// clicked Go Live yet. ACTIVE = live, processing real conversations.
// PAUSED = was active, manually paused.
export const AGENT_STATUSES = ["DRAFT", "READY", "ACTIVE", "PAUSED"] as const;

export const agents = pgTable(
  "agents",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    publicAgentId: text("public_agent_id").notNull().unique(), // used in <script data-agent="...">
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    role: text("role").default("Sales Assistant"),
    company: text("company"),
    instructions: text("instructions"),
    tone: text("tone").default("friendly, professional"),
    languageRules: jsonb("language_rules").$type<string[]>().default([]),
    productIds: jsonb("product_ids").$type<string[]>().default([]),
    qualificationQuestions: jsonb("qualification_questions").$type<string[]>().default([]),
    salesRules: jsonb("sales_rules").$type<string[]>().default([]),
    restrictedTopics: jsonb("restricted_topics").$type<string[]>().default([]),
    escalationConditions: jsonb("escalation_conditions").$type<string[]>().default([]),
    businessHours: jsonb("business_hours").$type<Record<string, unknown>>().default({}),
    followUpRules: jsonb("follow_up_rules").$type<Record<string, unknown>>().default({}),
    greeting: text("greeting").default("Hi! How can I help you today?"),
    widgetColor: text("widget_color").default("#4F46E5"),
    launcherPosition: text("launcher_position").default("bottom-right"),
    // Which path created this agent — informational only, never gates
    // functionality (docs/ONBOARDING_SPEC.md addendum §A5: guided-created
    // agents must be exactly as editable as manually-created ones).
    creationMethod: text("creation_method").notNull().default("MANUAL"), // MANUAL | GUIDED
    status: text("status").$type<(typeof AGENT_STATUSES)[number]>().notNull().default("ACTIVE"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("agents_tenant_idx").on(t.tenantId) })
);

export const ACTION_PERMISSION_MODES = ["AUTOMATIC", "APPROVAL_REQUIRED", "DISABLED"] as const;

// 6. AI TOOL/ACTION SYSTEM — audit trail of every tool call the AI attempts
export const agentActions = pgTable(
  "agent_actions",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    conversationId: text("conversation_id"),
    action: text("action").notNull(), // e.g. create_lead, schedule_followup
    parameters: jsonb("parameters").$type<Record<string, unknown>>().default({}),
    result: jsonb("result").$type<Record<string, unknown>>().default({}),
    status: text("status").notNull().default("PENDING"), // PENDING|EXECUTED|REJECTED|FAILED
    approvalRequired: boolean("approval_required").notNull().default(false),
    approver: text("approver"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("agent_actions_tenant_idx").on(t.tenantId) })
);

// ---------------------------------------------------------------------------
// 4. OMNICHANNEL INBOX — Conversations & Messages
// ---------------------------------------------------------------------------
export const CHANNELS = ["WEBSITE", "WHATSAPP", "INSTAGRAM", "MESSENGER"] as const;

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    channel: text("channel").$type<(typeof CHANNELS)[number]>().notNull(),
    status: text("status").notNull().default("OPEN"), // OPEN|WON|LOST|CLOSED
    aiActive: boolean("ai_active").notNull().default(true), // false = human took over
    assignedUserId: text("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    leadScore: integer("lead_score").notNull().default(0),
    productsDiscussed: jsonb("products_discussed").$type<string[]>().default([]),
    // attribution / session capture (section 1 + 12)
    sessionId: text("session_id"),
    landingPage: text("landing_page"),
    referringUrl: text("referring_url"),
    currentPage: text("current_page"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    gclid: text("gclid"),
    fbclid: text("fbclid"),
    consentAcknowledged: boolean("consent_acknowledged").notNull().default(false),
    followUpDate: ts("follow_up_date"),
    unread: boolean("unread").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    lastMessageAt: ts("last_message_at").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("conversations_tenant_idx").on(t.tenantId) })
);

export const MESSAGE_SENDERS = ["CUSTOMER", "AI", "HUMAN", "SYSTEM"] as const;

export const messages = pgTable(
  "messages",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    sender: text("sender").$type<(typeof MESSAGE_SENDERS)[number]>().notNull(),
    senderUserId: text("sender_user_id").references(() => users.id, { onDelete: "set null" }),
    content: text("content").notNull(),
    attachments: jsonb("attachments").$type<{ url: string; name: string; type: string }[]>().default([]),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ convIdx: index("messages_conversation_idx").on(t.conversationId) })
);

export const channelConnections = pgTable("channel_connections", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  channel: text("channel").$type<(typeof CHANNELS)[number]>().notNull(),
  status: text("status").notNull().default("NOT_CONNECTED"),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  connectedAt: ts("connected_at"),
});

// ---------------------------------------------------------------------------
// 9. INTERNAL CRM LAYER
// ---------------------------------------------------------------------------
export const LEAD_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "OPPORTUNITY", "QUOTATION", "WON", "LOST"] as const;

export const leads = pgTable(
  "leads",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    stage: text("stage").$type<(typeof LEAD_STAGES)[number]>().notNull().default("NEW"),
    score: integer("score").notNull().default(0),
    source: text("source"),
    campaign: text("campaign"),
    productsDiscussed: jsonb("products_discussed").$type<string[]>().default([]),
    assignedUserId: text("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("leads_tenant_idx").on(t.tenantId) })
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    estimatedValue: numeric("estimated_value"),
    actualSaleValue: numeric("actual_sale_value"),
    owner: text("owner").references(() => users.id, { onDelete: "set null" }),
    products: jsonb("products").$type<{ productId: string; name: string; qty: number }[]>().default([]),
    stage: text("stage").$type<(typeof LEAD_STAGES)[number]>().notNull().default("OPPORTUNITY"),
    source: text("source"),
    campaign: text("campaign"),
    firstConversationId: text("first_conversation_id"),
    latestConversationId: text("latest_conversation_id"),
    crmSyncStatus: text("crm_sync_status").notNull().default("NOT_SYNCED"),
    // follow-up engine fields (section 11 — folded into Opportunity, see BUILD_NOTES.md)
    nextFollowUpAt: ts("next_follow_up_at"),
    followUpOwner: text("follow_up_owner"),
    followUpChannel: text("follow_up_channel"),
    aiFollowUpEnabled: boolean("ai_follow_up_enabled").notNull().default(true),
    followUpAttempts: integer("follow_up_attempts").notNull().default(0),
    lastInteractionAt: ts("last_interaction_at"),
    followUpObjective: text("follow_up_objective"),
    lostReason: text("lost_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("opportunities_tenant_idx").on(t.tenantId) })
);

export const tasks = pgTable("tasks", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  assignedUserId: text("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  type: text("type").notNull().default("FOLLOW_UP"),
  dueAt: ts("due_at"),
  status: text("status").notNull().default("OPEN"), // OPEN|DONE|CANCELLED
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const sales = pgTable("sales", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  opportunityId: text("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  amount: numeric("amount").notNull(),
  currency: text("currency").notNull().default("UGX"),
  products: jsonb("products").$type<{ productId: string; name: string; qty: number }[]>().default([]),
  closedAt: ts("closed_at").notNull().defaultNow(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 18. PRODUCTS
// ---------------------------------------------------------------------------
export const products = pgTable("products", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sku: text("sku"),
  category: text("category"),
  description: text("description"),
  features: jsonb("features").$type<string[]>().default([]),
  sellingPoints: jsonb("selling_points").$type<string[]>().default([]),
  price: numeric("price"),
  currency: text("currency").notNull().default("UGX"),
  availability: text("availability").notNull().default("IN_STOCK"),
  images: jsonb("images").$type<string[]>().default([]),
  variants: jsonb("variants").$type<{ name: string; price?: number }[]>().default([]),
  status: text("status").notNull().default("ACTIVE"),
  externalProductId: text("external_product_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 17. KNOWLEDGE BASE  (this powers the "Knowledge Base" dialog box)
// ---------------------------------------------------------------------------
export const knowledgeCollections = pgTable("knowledge_collections", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // Products, Pricing, Warranty, Delivery, Company, FAQs, Sales Policies
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    collectionId: text("collection_id").notNull().references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceType: text("source_type").notNull().default("MANUAL"), // MANUAL|URL|PDF|FAQ
    sourceUrl: text("source_url"),
    content: text("content").notNull(),
    status: text("status").notNull().default("READY"), // PENDING|READY|FAILED
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("knowledge_documents_tenant_idx").on(t.tenantId) })
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    position: integer("position").notNull().default(0),
    keywords: jsonb("keywords").$type<string[]>().default([]), // lexical retrieval — see BUILD_NOTES.md re: pgvector
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ docIdx: index("knowledge_chunks_document_idx").on(t.documentId) })
);

// ---------------------------------------------------------------------------
// 12. ATTRIBUTION ENGINE
// ---------------------------------------------------------------------------
export const trafficSessions = pgTable("traffic_sessions", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  firstLandingPage: text("first_landing_page"),
  referringUrl: text("referring_url"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  gclid: text("gclid"),
  fbclid: text("fbclid"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const attributionTouches = pgTable("attribution_touches", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  saleId: text("sale_id").references(() => sales.id, { onDelete: "set null" }),
  source: text("source"),
  medium: text("medium"),
  campaign: text("campaign"),
  adSetName: text("ad_set_name"),
  adName: text("ad_name"),
  utm: jsonb("utm").$type<Record<string, string | undefined>>().default({}),
  clickIds: jsonb("click_ids").$type<Record<string, string | undefined>>().default({}),
  landingPage: text("landing_page"),
  referringPage: text("referring_page"),
  touchType: text("touch_type").notNull(), // FIRST | LAST
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 13/14. ADVERTISING INTEGRATION + AI ADVERTISING ANALYST
// ---------------------------------------------------------------------------
export const adAccounts = pgTable("ad_accounts", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // GOOGLE | META
  externalAccountId: text("external_account_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("CONNECTED"),
  isMock: boolean("is_mock").notNull().default(true),
  connectedAt: ts("connected_at").notNull().defaultNow(),
});

export const campaigns = pgTable("campaigns", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  adAccountId: text("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  objective: text("objective"),
  dailyBudget: numeric("daily_budget"),
  currency: text("currency").notNull().default("UGX"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const adSets = pgTable("ad_sets", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  budget: numeric("budget"),
});

export const ads = pgTable("ads", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  adSetId: text("ad_set_id").notNull().references(() => adSets.id, { onDelete: "cascade" }),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  creative: jsonb("creative").$type<Record<string, unknown>>().default({}),
  status: text("status").notNull().default("ACTIVE"),
});

export const adMetricSnapshots = pgTable("ad_metric_snapshots", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // YYYY-MM-DD
  spend: numeric("spend").notNull().default("0"),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  conversations: integer("conversations").notNull().default(0),
  leads: integer("leads").notNull().default(0),
  qualifiedLeads: integer("qualified_leads").notNull().default(0),
  sales: integer("sales").notNull().default(0),
  revenue: numeric("revenue").notNull().default("0"),
});

export const RECOMMENDATION_STATUSES = ["NEW", "APPROVED", "REJECTED", "IMPLEMENTED", "EXPIRED"] as const;

export const advertisingRecommendations = pgTable("advertising_recommendations", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  finding: text("finding"),
  evidence: text("evidence"),
  recommendation: text("recommendation").notNull(),
  expectedObjective: text("expected_objective"),
  confidence: text("confidence").notNull().default("MEDIUM"), // LOW|MEDIUM|HIGH
  risk: text("risk").notNull().default("LOW"),
  status: text("status").$type<(typeof RECOMMENDATION_STATUSES)[number]>().notNull().default("NEW"),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: ts("decided_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// generic approvals table (section 7 & 15 — advertising spend + risky agent actions)
export const approvals = pgTable("approvals", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // AGENT_ACTION | ADVERTISING_RECOMMENDATION
  entityId: text("entity_id").notNull(),
  requestedBy: text("requested_by"),
  status: text("status").notNull().default("PENDING"), // PENDING|APPROVED|REJECTED
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: ts("decided_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 21. INTEGRATION HUB + 33. EXTERNAL ID MAPPING
// ---------------------------------------------------------------------------
export const integrations = pgTable("integrations", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // whatsapp, instagram, messenger, hubspot, kommo, salesforce, zoho, odoo, google_ads, meta_ads, shopify, woocommerce, google_calendar, gmail, slack
  category: text("category").notNull(), // MESSAGING|CRM|ADVERTISING|ECOMMERCE|PRODUCTIVITY|OTHER
  // PENDING/REAUTH_REQUIRED added for docs/ONBOARDING_SPEC.md section 6/13
  // — real OAuth-style connectors (WhatsApp) pass through PENDING while
  // exchanging/registering/testing, and only ever reach CONNECTED if every
  // step actually succeeds (never a one-click fake). Additive to the
  // existing CONNECTED|NOT_CONNECTED|ERROR values other providers' simple
  // mock-connect flow still uses unchanged.
  status: text("status").notNull().default("NOT_CONNECTED"), // CONNECTED|NOT_CONNECTED|PENDING|ERROR|REAUTH_REQUIRED
  isMock: boolean("is_mock").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  // OAuth-connector fields (docs/PHASE_2_EXTENSIONS_SPEC.md section 5,
  // reused here rather than a parallel `integration_connections` table —
  // this is the same "Integration Hub" the spec is describing, just
  // already existing under this name). All additive/nullable.
  externalAccountId: text("external_account_id"),
  externalAccountName: text("external_account_name"),
  scopes: jsonb("scopes").$type<string[]>().default([]),
  webhookStatus: text("webhook_status"), // NOT_REGISTERED|HEALTHY|FAILED
  connectedByUserId: text("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  lastSyncAt: ts("last_sync_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const integrationCredentials = pgTable("integration_credentials", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  integrationId: text("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  encryptedPayload: text("encrypted_payload").notNull(), // AES-256-GCM ciphertext, see src/lib/crypto.ts
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const externalMappings = pgTable(
  "external_mappings",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    internalEntityType: text("internal_entity_type").notNull(), // LEAD|CONTACT|OPPORTUNITY|TASK
    internalEntityId: text("internal_entity_id").notNull(),
    integration: text("integration").notNull(), // KOMMO|HUBSPOT|SALESFORCE|ZOHO|ODOO
    externalEntityId: text("external_entity_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqueMap: uniqueIndex("external_mappings_unique").on(t.tenantId, t.internalEntityType, t.internalEntityId, t.integration),
  })
);

// ---------------------------------------------------------------------------
// 19/20/22. API GATEWAY, WEBHOOKS, DEVELOPER CENTRE
// ---------------------------------------------------------------------------
export const apiKeys = pgTable("api_keys", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hashedKey: text("hashed_key").notNull(),
  scopes: jsonb("scopes").$type<string[]>().default(["read", "write"]),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const WEBHOOK_EVENTS = [
  "contact.created",
  "contact.updated",
  "lead.created",
  "lead.updated",
  "lead.qualified",
  "conversation.created",
  "conversation.updated",
  "message.received",
  "message.sent",
  "opportunity.created",
  "opportunity.updated",
  "opportunity.won",
  "opportunity.lost",
  "task.created",
  "task.completed",
  "sale.created",
  "recommendation.created",
  "recommendation.approved",
  "integration.failed",
] as const;

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  events: jsonb("events").$type<string[]>().default([]),
  signingSecret: text("signing_secret").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  webhookEndpointId: text("webhook_endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  responseStatus: integer("response_status"),
  attempt: integer("attempt").notNull().default(1),
  status: text("status").notNull().default("PENDING"), // PENDING|SUCCESS|FAILED
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 24. AUDIT LOG
// ---------------------------------------------------------------------------
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    ip: text("ip"),
    source: text("source").notNull().default("APP"), // APP|API|WEBHOOK|SYSTEM
    timestamp: ts("timestamp").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("audit_logs_tenant_idx").on(t.tenantId) })
);

// ---------------------------------------------------------------------------
// 25. ZERO-TO-LIVE SELF-ONBOARDING (docs/ONBOARDING_SPEC.md, current top
// priority as of 2026-08-19 — see HANDOFF.md)
// ---------------------------------------------------------------------------

// One row per tenant. Backs "save and resume" (spec section 22) — the
// wizard is a step-router reading this, not a multi-page form that loses
// state on refresh.
export const ONBOARDING_STEPS = [
  "ACCOUNT",
  "BUSINESS_PROFILE",
  "KNOWLEDGE_IMPORT",
  "AGENT_SETUP",
  "AGENT_TEST",
  "CHANNEL_CONNECT",
  "HEALTH_CHECK",
  "GO_LIVE",
] as const;

export const onboardingProgress = pgTable("onboarding_progress", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }).unique(),
  currentStep: text("current_step").$type<(typeof ONBOARDING_STEPS)[number]>().notNull().default("ACCOUNT"),
  completedSteps: jsonb("completed_steps").$type<string[]>().default([]),
  // Which agent this onboarding run is setting up — set once the
  // AGENT_SETUP step picks/creates one (guided, manual, or an existing
  // agent per addendum §A9's "Use Existing Agent"), then read by
  // AGENT_TEST/CHANNEL_CONNECT/HEALTH_CHECK/GO_LIVE.
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  startedAt: ts("started_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// Append-only product-analytics log for the onboarding funnel (spec
// section 19 — signup_started, channel_connected, first_sale, etc.).
// Deliberately separate from `audit_logs`: that table is the compliance/
// security record of real business actions (see src/lib/audit.ts);
// this one is funnel instrumentation and may include pre-tenant events.
// Kept as free-text `event` (like `attribution_touches.source` elsewhere
// in this file) rather than a hard enum so new events don't need a
// migration — see docs/ONBOARDING_SPEC.md section 19 for the current
// vocabulary.
export const onboardingEvents = pgTable(
  "onboarding_events",
  {
    id: id(),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("onboarding_events_tenant_idx").on(t.tenantId),
    eventIdx: index("onboarding_events_event_idx").on(t.event),
  })
);

// docs/ONBOARDING_TASKS.md Milestone 6 — sandboxed agent-test feedback.
// Never auto-applied to the live agent config (spec section 15) — a
// human reviews `correctionNote` and edits the agent explicitly.
export const agentTestFeedback = pgTable(
  "agent_test_feedback",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    testMessage: text("test_message").notNull(),
    aiResponse: text("ai_response").notNull(),
    verdict: text("verdict").$type<"GOOD" | "NEEDS_IMPROVEMENT">().notNull(),
    correctionNote: text("correction_note"),
    createdAt: ts("created_at").notNull().defaultNow(),
    appliedAt: ts("applied_at"),
  },
  (t) => ({ agentIdx: index("agent_test_feedback_agent_idx").on(t.agentId) })
);

// ---------------------------------------------------------------------------
// Relations (for query ergonomics)
// ---------------------------------------------------------------------------
export const contactsRelations = relations(contacts, ({ many }) => ({
  identities: many(contactIdentities),
  conversations: many(conversations),
}));

export const conversationsRelations = relations(conversations, ({ many, one }) => ({
  messages: many(messages),
  contact: one(contacts, { fields: [conversations.contactId], references: [contacts.id] }),
  agent: one(agents, { fields: [conversations.agentId], references: [agents.id] }),
}));

export const knowledgeDocumentsRelations = relations(knowledgeDocuments, ({ many }) => ({
  chunks: many(knowledgeChunks),
}));
