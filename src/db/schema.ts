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
// PLATFORM STAFF — deliberately OUTSIDE the tenant model entirely. Every
// other table in this file carries a tenantId and every query in
// src/app/api/internal/** filters by the signed-in user's tenant; this
// table has no tenantId column at all, on purpose, so it structurally
// cannot be reached by that isolation logic or confused with a tenant
// `users` row. Session handling lives in a separate module
// (src/lib/platform-auth.ts) with its own cookie name and JWT payload
// shape, and there is deliberately no self-service signup route for
// this table — accounts are provisioned only via
// scripts/create-platform-staff.ts, run by whoever operates the
// platform. See src/app/platform/** for the admin surface this powers
// (cross-tenant analytics — something no per-tenant role should ever be
// able to reach).
// ---------------------------------------------------------------------------
export const PLATFORM_ROLES = ["PLATFORM_SUPER_ADMIN", "PLATFORM_SUPPORT", "PLATFORM_FINANCE", "PLATFORM_OPERATIONS"] as const;

export const platformStaff = pgTable("platform_staff", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").$type<(typeof PLATFORM_ROLES)[number]>().notNull().default("PLATFORM_SUPPORT"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

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
    // email + passwordHash are nullable now that a user can also exist via
    // phone/SMS OTP or a Google/Apple sign-in (auth_identities below) with
    // no password at all. A password-auth user still always has both; a
    // phone-only or OAuth-only user has neither. Postgres unique indexes
    // ignore NULLs, so multiple phone-only users with no email don't
    // collide on this index.
    email: text("email"),
    passwordHash: text("password_hash"),
    // Globally unique (not tenant-scoped) — phone login, like email login,
    // has to resolve which account it is before it knows the tenant.
    phone: text("phone"),
    phoneVerifiedAt: ts("phone_verified_at"),
    name: text("name").notNull(),
    role: text("role").$type<Role>().notNull().default("SALES"),
    avatarUrl: text("avatar_url"),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tenantEmailIdx: uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email),
    phoneIdx: uniqueIndex("users_phone_idx").on(t.phone),
  })
);

// Links a user to a third-party identity provider (Google / Apple Sign-In)
// — a user can have a password AND a Google identity AND a phone, all
// pointing at the same account, same spirit as contact_identities below
// for customer-facing identities. providerUserId is that provider's
// stable subject id ("sub" claim for OIDC), never the email (an email
// can change; the sub cannot).
export const AUTH_IDENTITY_PROVIDERS = ["GOOGLE", "APPLE"] as const;

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<(typeof AUTH_IDENTITY_PROVIDERS)[number]>().notNull(),
    providerUserId: text("provider_user_id").notNull(),
    email: text("email"), // informational — the email the provider reported at link time
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    providerIdx: uniqueIndex("auth_identities_provider_idx").on(t.provider, t.providerUserId),
    userIdx: index("auth_identities_user_idx").on(t.userId),
  })
);

// Phone/SMS one-time-passcode verification, for both new-account signup
// and returning-user login. DEMO/MOCK sender by default (no SMS provider
// credentials in this environment — see modules/sms/*) — same "never fake
// a completed integration" discipline as every other connector in this
// codebase: the code is real, hashed, time-limited, and attempt-limited;
// only DELIVERY is mocked (shown in the response) until a real SMS
// provider is configured.
export const OTP_PURPOSES = ["SIGNUP", "LOGIN"] as const;

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: id(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").$type<(typeof OTP_PURPOSES)[number]>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ phoneIdx: index("otp_codes_phone_idx").on(t.phone) })
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

// ---------------------------------------------------------------------------
// MULTI-AGENT WIDGET ROUTING (Part A of the multi-agent-routing spec) —
// Channels are separate from AI Agents. A Widget is a communication
// channel's routing configuration; WidgetAgent links it to the Agent(s)
// (already-existing production entities, never duplicated) allowed to
// answer through it. See src/modules/widgets/router.ts (AgentRouter) and
// src/modules/widgets/migrate.ts for how existing single-agent widgets
// (the `<script data-agent="...">` embed every agent already has today)
// become SINGLE_AGENT-mode Widget rows — additive, non-breaking, no
// existing embed needs to change.
// ---------------------------------------------------------------------------
export const WIDGET_ROUTING_MODES = ["SINGLE_AGENT", "INTENT_ROUTING", "RULE_BASED", "MENU_SELECTION", "HYBRID"] as const;
export const WIDGET_STATUSES = ["ACTIVE", "PAUSED"] as const;

export const widgets = pgTable(
  "widgets",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    // New-style embed identifier: <script data-widget="...">. Legacy
    // <script data-agent="..."> installs keep resolving straight through
    // agents.publicAgentId (see startConversation() in
    // src/modules/conversations/engine.ts) — this column is never used to
    // satisfy a legacy embed, only new ones.
    publicWidgetId: text("public_widget_id").notNull().unique(),
    name: text("name").notNull().default("Website Widget"),
    allowedDomains: jsonb("allowed_domains").$type<string[]>().default([]),
    logo: text("logo"),
    brandColour: text("brand_colour"),
    greeting: text("greeting"),
    launcherPosition: text("launcher_position").default("bottom-right"),
    defaultAgentId: text("default_agent_id").references(() => agents.id, { onDelete: "set null" }),
    routingMode: text("routing_mode").$type<(typeof WIDGET_ROUTING_MODES)[number]>().notNull().default("SINGLE_AGENT"),
    fallbackAgentId: text("fallback_agent_id").references(() => agents.id, { onDelete: "set null" }),
    status: text("status").$type<(typeof WIDGET_STATUSES)[number]>().notNull().default("ACTIVE"),
    consentConfiguration: jsonb("consent_configuration").$type<Record<string, unknown>>().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("widgets_tenant_idx").on(t.tenantId) })
);

export const widgetAgents = pgTable(
  "widget_agents",
  {
    id: id(),
    widgetId: text("widget_id").notNull().references(() => widgets.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    // Free-text role label (e.g. "SALES", "SUPPORT", "PRODUCT") plus a
    // plain-English description the deterministic router matches keywords
    // from (spec Part A §10: rules before a classifier before an LLM —
    // see src/modules/widgets/router.ts).
    routingRole: text("routing_role"),
    routingDescription: text("routing_description"),
    allowedIntents: jsonb("allowed_intents").$type<string[]>().default([]),
    restrictedIntents: jsonb("restricted_intents").$type<string[]>().default([]),
    fallbackPriority: integer("fallback_priority").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    widgetIdx: index("widget_agents_widget_idx").on(t.widgetId),
    uniqueWidgetAgent: uniqueIndex("widget_agents_widget_agent_unique").on(t.widgetId, t.agentId),
  })
);

// Tracks every routing decision the AgentRouter makes — spec Part A §9's
// "output: selected_agent_id, routing_reason, confidence, fallback_agent_id,
// routing_timestamp", and the audit trail for handoff-loop detection (§26).
export const AGENT_HANDOFF_STOP_REASONS = ["MAX_HANDOFFS_EXCEEDED", "REPEATED_PAIR_LOOP"] as const;

export const agentRoutingDecisions = pgTable(
  "agent_routing_decisions",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    widgetId: text("widget_id").references(() => widgets.id, { onDelete: "set null" }),
    conversationId: text("conversation_id"),
    selectedAgentId: text("selected_agent_id").references(() => agents.id, { onDelete: "set null" }),
    fallbackAgentId: text("fallback_agent_id").references(() => agents.id, { onDelete: "set null" }),
    routingReason: text("routing_reason").notNull(), // e.g. "existing_assignment" | "single_agent_mode" | "rule_match:<role>" | "no_match_fallback"
    confidence: numeric("confidence"), // 0..1, only meaningful for rule/classifier matches
    // Set only when this decision was itself a handoff stopped for looping
    // (spec §26) — null on every normal routing decision.
    handoffStopReason: text("handoff_stop_reason").$type<(typeof AGENT_HANDOFF_STOP_REASONS)[number] | null>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("agent_routing_decisions_tenant_idx").on(t.tenantId),
    conversationIdx: index("agent_routing_decisions_conversation_idx").on(t.conversationId),
  })
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
    status: text("status").notNull().default("PENDING"), // PENDING|EXECUTED|REJECTED|FAILED|SKIPPED_DUPLICATE
    approvalRequired: boolean("approval_required").notNull().default(false),
    approver: text("approver"),
    // Deterministic action+params fingerprint (see actionSignature() in
    // src/modules/ai/actions.ts) — lets executeToolCalls() recognize "this
    // exact action already ran for this conversation" and skip it instead
    // of duplicating a lead/task/message (AIExecutionGateway spec Part B
    // §19-20: tool call deduplication + idempotency). Nullable so existing
    // rows from before this column existed just never match anything.
    signature: text("signature"),
    // Which AgentRun (below) produced this action attempt — nullable for
    // the same reason.
    runId: text("run_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("agent_actions_tenant_idx").on(t.tenantId),
    signatureIdx: index("agent_actions_signature_idx").on(t.conversationId, t.signature),
  })
);

// ---------------------------------------------------------------------------
// AI EXECUTION GOVERNANCE — every AI provider call is required to go
// through src/modules/ai/execution-gateway.ts (the "AIExecutionGateway"),
// which wraps it in one of these rows. This is what makes a runaway
// "Agent -> Tool -> Agent -> Tool -> ..." loop impossible to run
// unbounded: every call has backend-enforced (not model-controlled) caps
// on tool calls, tokens, cost, and wall-clock time, and the outcome is
// always recorded here for cost/loop/timeout observability — independent
// of whether the reply that came back was ever actually used.
// ---------------------------------------------------------------------------
export const AGENT_RUN_STATUSES = [
  "RUNNING",
  "COMPLETED",
  "STOPPED_LIMIT",
  "STOPPED_LOOP",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
] as const;

// What kind of trigger started this run. INBOUND_MESSAGE covers every real
// channel (website/WhatsApp/Instagram/Messenger all funnel through
// handleCustomerMessage — see src/modules/conversations/engine.ts).
export const AGENT_RUN_TRIGGERS = ["INBOUND_MESSAGE", "SANDBOX_TEST", "FOLLOWUP"] as const;
export type AgentRunTrigger = (typeof AGENT_RUN_TRIGGERS)[number];

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    conversationId: text("conversation_id"),
    triggerType: text("trigger_type").$type<(typeof AGENT_RUN_TRIGGERS)[number]>().notNull(),
    status: text("status").$type<(typeof AGENT_RUN_STATUSES)[number]>().notNull().default("RUNNING"),
    startedAt: ts("started_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
    // This platform makes exactly one model call per run today (no
    // internal agent-loop exists yet — see execution-gateway.ts's header
    // comment), so modelCalls is 1 or 2 (one bounded retry on a transient
    // provider error). Tracked as a count, not a boolean, so the column
    // means the same thing once multi-step runs exist.
    modelCalls: integer("model_calls").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    estimatedCostUsd: numeric("estimated_cost_usd").notNull().default("0"),
    maxModelCalls: integer("max_model_calls").notNull(),
    maxToolCalls: integer("max_tool_calls").notNull(),
    maxTokens: integer("max_tokens").notNull(),
    maxCostUsd: numeric("max_cost_usd").notNull(),
    timeoutAt: ts("timeout_at").notNull(),
    stopReason: text("stop_reason"),
    parentRunId: text("parent_run_id"),
    correlationId: text("correlation_id"),
  },
  (t) => ({
    tenantIdx: index("agent_runs_tenant_idx").on(t.tenantId),
    conversationIdx: index("agent_runs_conversation_idx").on(t.conversationId),
  })
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
    // Which Widget (below) this conversation came in through — null for
    // conversations created before this column existed, and for
    // WhatsApp/Instagram/Messenger conversations (those channels don't
    // route through a Widget yet — see modules/widgets/router.ts's
    // honest-scope note). Used to re-run AgentRouter with real customer
    // intent on the first inbound message for a multi-agent widget.
    widgetId: text("widget_id").references(() => widgets.id, { onDelete: "set null" }),
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
    // Set when this conversation started from a resolved influencer
    // tracking-link referral (Milestone 5's "Ref: <code>" detection —
    // see src/app/api/public/webhooks/whatsapp/route.ts). Denormalized
    // here (rather than only living on the attribution_touches row)
    // specifically so conversationToTouch() in modules/attribution/
    // service.ts can pass it straight through to FIRST/LAST touch
    // promotion with zero extra queries — utmSource/utmCampaign/
    // utmContent are set to the influencer/campaign/content values at
    // conversation-creation time too, reusing 100% of the existing UTM-
    // driven attribution machinery instead of a parallel code path.
    trackingLinkId: text("tracking_link_id").references(() => trackingLinks.id, { onDelete: "set null" }),
    influencerId: text("influencer_id").references(() => influencers.id, { onDelete: "set null" }),
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
  touchType: text("touch_type").notNull(), // FIRST | LAST | TOUCH
  // Set only when this touch was generated by resolving a tracking-link
  // referral code (see modules/influencers/tracking-links.ts + the
  // WhatsApp webhook's "Ref: <code>" detection) — lets influencer metrics
  // walk touches directly by influencer/link instead of string-matching
  // on the free-text `source` column. Nullable/additive: every existing
  // row and every non-influencer touch leaves these null.
  influencerId: text("influencer_id").references(() => influencers.id, { onDelete: "set null" }),
  trackingLinkId: text("tracking_link_id").references(() => trackingLinks.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// Free-text `attributionTouches.source` values already in use elsewhere
// in the app ("google", "meta", "direct", channel names) stay free text —
// this is a type-safety aid for new influencer-sourced touches, not a
// migration of existing rows/columns.
export const ATTRIBUTION_SOURCE_TYPES = ["PAID_AD", "INFLUENCER", "ORGANIC_SOCIAL", "SEO", "REFERRAL", "DIRECT"] as const;

// ---------------------------------------------------------------------------
// INFLUENCER INTELLIGENCE (docs/PHASE_2_TASKS.md Milestones 4-7) — first
// working slice: creators, tracking links + referral clicks, deterministic
// scoring, and an AI analyst that explains those scores. Deliberately
// slimmer than the full spec's relational model (no separate
// InfluencerIdentity/InfluencerCampaignMember/InfluencerContent/
// InfluencerMetricSnapshot tables) — campaign/content are free-text labels
// on a tracking link rather than first-class entities, and scores are
// computed on demand (same pattern as computeCampaignPerformance /
// computeAssistedAttribution) rather than stored as periodic snapshots.
// Real metric snapshots from platform APIs (views/reach/engagement) aren't
// wired to a live connector, so this platform never fabricates them —
// only clicks/leads/sales/revenue, which are 100% real data this app
// already owns, feed the scores. See src/modules/influencers/*.
// ---------------------------------------------------------------------------

export const INFLUENCER_PLATFORMS = ["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK", "OTHER"] as const;
export const INFLUENCER_STATUSES = ["ACTIVE", "PAUSED", "ENDED"] as const;

export const influencers = pgTable(
  "influencers",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    handle: text("handle"),
    platform: text("platform").$type<(typeof INFLUENCER_PLATFORMS)[number]>().notNull().default("INSTAGRAM"),
    category: text("category"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    status: text("status").$type<(typeof INFLUENCER_STATUSES)[number]>().notNull().default("ACTIVE"),
    notes: text("notes"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("influencers_tenant_idx").on(t.tenantId) })
);

export const TRACKING_LINK_DESTINATIONS = ["WHATSAPP", "WEBSITE"] as const;

export const trackingLinks = pgTable(
  "tracking_links",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    influencerId: text("influencer_id").notNull().references(() => influencers.id, { onDelete: "cascade" }),
    // Short, URL-safe code — the /go/<code> path segment. Unique per
    // tenant so codes stay short (a handful of chars) rather than needing
    // to be globally unique.
    code: text("code").notNull(),
    campaignName: text("campaign_name").notNull(),
    contentLabel: text("content_label"),
    destinationType: text("destination_type").$type<(typeof TRACKING_LINK_DESTINATIONS)[number]>().notNull().default("WHATSAPP"),
    // WHATSAPP: the business's WhatsApp number to deep-link into (with a
    // prefilled "Ref: <code>" message the inbound webhook detects).
    // WEBSITE: the destination URL to redirect to.
    destinationValue: text("destination_value").notNull(),
    status: text("status").notNull().default("ACTIVE"), // ACTIVE|PAUSED
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("tracking_links_tenant_idx").on(t.tenantId),
    influencerIdx: index("tracking_links_influencer_idx").on(t.influencerId),
    uniqueCode: uniqueIndex("tracking_links_code_unique").on(t.tenantId, t.code),
  })
);

export const referralClicks = pgTable(
  "referral_clicks",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    trackingLinkId: text("tracking_link_id").notNull().references(() => trackingLinks.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash"), // hashed, never raw — see src/app/go/[code]/route.ts
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ linkIdx: index("referral_clicks_link_idx").on(t.trackingLinkId) })
);

export const influencerCosts = pgTable(
  "influencer_costs",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    influencerId: text("influencer_id").notNull().references(() => influencers.id, { onDelete: "cascade" }),
    amount: numeric("amount").notNull(),
    currency: text("currency").notNull().default("UGX"),
    note: text("note"),
    incurredAt: ts("incurred_at").notNull().defaultNow(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ influencerIdx: index("influencer_costs_influencer_idx").on(t.influencerId) })
);

// Mirrors advertisingRecommendations' shape/status lifecycle exactly (see
// generateAdvertisingRecommendations in modules/advertising/analyst.ts) —
// a separate table rather than reusing that one directly since it's
// FK'd to `campaigns` (ad campaigns), which an influencer recommendation
// isn't about.
export const influencerRecommendations = pgTable("influencer_recommendations", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  influencerId: text("influencer_id").notNull().references(() => influencers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  finding: text("finding"),
  evidence: text("evidence"),
  recommendation: text("recommendation").notNull(),
  confidence: text("confidence").notNull().default("MEDIUM"), // LOW|MEDIUM|HIGH
  risk: text("risk").notNull().default("LOW"),
  status: text("status").$type<(typeof RECOMMENDATION_STATUSES)[number]>().notNull().default("NEW"),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: ts("decided_at"),
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

// Organic Google Search (Search Console) — deliberately NOT modeled as an
// ad_account/campaign: there's no spend, no campaign, no ROAS, just
// impressions/clicks/ranking for the property as a whole. A parallel,
// smaller shape rather than forcing it through the paid-ads tables.
export const searchConsoleSnapshots = pgTable(
  "search_console_snapshots",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    integrationId: text("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    avgPosition: numeric("avg_position"),
    topQueries: jsonb("top_queries").$type<{ query: string; clicks: number; impressions: number }[]>().default([]),
  },
  (t) => ({ tenantIdx: index("search_console_snapshots_tenant_idx").on(t.tenantId) })
);

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
  provider: text("provider").notNull(), // whatsapp, instagram, messenger, hubspot, kommo, salesforce, zoho, odoo, instagram_ads, facebook_ads, google_ads, tiktok_ads, google_search_console, shopify, woocommerce, google_calendar, gmail, slack
  category: text("category").notNull(), // MESSAGING|CRM|ADVERTISING|ANALYTICS|ECOMMERCE|PRODUCTIVITY|OTHER
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
// 26. AI USAGE CREDITS & METERING (src/modules/billing/)
//
// Every AI-generated reply costs real money (Anthropic API tokens). This is
// the ledger that meters it, enforces free/paid tier limits, and protects
// margin — see src/modules/billing/pricing.ts for the real $/token math this
// is built on. Deliberately NOT a payment-processor integration: this tracks
// and enforces usage; collecting real money for a top-up needs a real Stripe
// (or similar) integration this schema doesn't assume or fake.
// ---------------------------------------------------------------------------
export const CREDIT_PLANS = ["FREE", "PAID"] as const;

export const creditBalances = pgTable("credit_balances", {
  id: id(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }).unique(),
  balance: integer("balance").notNull().default(0),
  plan: text("plan").$type<(typeof CREDIT_PLANS)[number]>().notNull().default("FREE"),
  // Reference monthly credit budget this tenant is expected to run on —
  // the denominator the reserve/max-drawdown policy (modules/billing/
  // reserve-policy.ts) computes its thresholds against. Nullable: falls
  // back to a plan-based default (FREE_TIER_GRANT_CREDITS / a paid
  // reference amount, see reserve-policy.ts's resolveMonthlyAllotment())
  // until a platform admin sets an explicit value for a tenant with an
  // unusual usage pattern (e.g. an enterprise deal). Not a hard monthly
  // reset — this platform's balance is still a running total, see
  // billing/ledger.ts's header comment — purely the reference figure the
  // policy percentages below are computed against.
  monthlyAllotment: integer("monthly_allotment"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const CREDIT_TRANSACTION_TYPES = ["GRANT", "PURCHASE", "CONSUMPTION", "ADJUSTMENT"] as const;

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: id(),
    tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").$type<(typeof CREDIT_TRANSACTION_TYPES)[number]>().notNull(),
    // Signed: positive for GRANT/PURCHASE, negative for CONSUMPTION.
    credits: integer("credits").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    // Populated for CONSUMPTION rows only — the real usage that produced the charge.
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    costUsd: numeric("cost_usd"),
    conversationId: text("conversation_id"),
    reason: text("reason").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("credit_ledger_tenant_idx").on(t.tenantId) })
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
