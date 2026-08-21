# AI Revenue Agent Platform — Feature Reference

A complete, module-by-module walkthrough of what this platform does and how each
part actually works. Written from the real implementation (not the spec) — where
something is a labelled DEMO/MOCK connector rather than a live third-party
integration, that's called out explicitly rather than implied.

Last updated: 21 August 2026.

---

## 1. Multi-tenant foundation & authentication

**Tenancy.** Every table that holds tenant data carries a `tenantId` and every
query filters by it — there is no cross-tenant query path in the tenant-facing
app. A second, fully isolated auth system exists for platform staff (see
§14) with its own session cookie, its own JWT signing secret, and its own
database table with no `tenantId` column at all, so a leaked tenant session
can never forge a platform-admin session or vice versa.

**Sign-in methods**, all live:
- **Email + password** — bcrypt-hashed, with a strength check (zxcvbn-style
  scoring) enforced at registration, and per-IP/per-account rate limiting on
  `/api/internal/auth/login`.
- **Phone number + SMS OTP** — real generation/hashing/expiry/attempt-limiting
  mechanics; actual SMS delivery is a swappable DEMO/MOCK sender until a real
  provider (e.g. Twilio) is configured, same discipline as every other
  connector on this platform.
- **Google Sign-In** and **Apple Sign-In** — real OAuth 2.0 / OIDC flows (not
  mocked), CSRF-protected via a short-lived state cookie, with account-linking
  logic: link by provider+subject id first, else by email if exactly one
  match exists, else provision a brand-new tenant.

**Roles (tenant-level, 8):** `OWNER`, `ADMIN`, `MANAGER`, `SALES`,
`MARKETING`, `AGENT`, `VIEWER`, `DEVELOPER` — a static resource:action
permission matrix in `src/lib/permissions.ts` gates every API route and nav
item (`hasPermission(role, resource, action)`).

---

## 2. AI Sales Agents & the conversation engine

**Agent configuration** (`/agents`): name, role, tone, greeting, qualification
questions (asked one at a time, slot-filling style), restricted topics,
escalation conditions, and per-action permission mode (see below). An agent
can be guided-setup via a wizard or configured manually.

**Multi-agent widget routing.** A single embeddable widget can route an
incoming conversation to one of several agents:
1. An existing conversation's agent assignment always wins (continuity).
2. A `SINGLE_AGENT` widget routes to its one configured agent — zero added
   cost or latency versus a pre-multi-agent embed.
3. Otherwise, deterministic keyword rules match the customer's first message
   against each agent's routing description — no LLM call spent just
   deciding who answers.
4. Falls back to the widget's fallback/default agent, or the highest-priority
   enabled agent.

Mid-conversation agent *handoff* is not implemented yet — an agent is
assigned once, at conversation start (see Outstanding Work in the QA report).

**AI Execution Gateway.** Every single call to an AI provider — mock or
real — passes through `runAIExecution()`, the one mandatory chokepoint:
- Opens an `AgentRun` row with backend-enforced hard limits the model itself
  never sees or controls (moderate defaults: max tool calls per reply, wall-
  clock timeout, one bounded retry on a genuinely transient provider error
  only — never on a validation failure).
- Records real usage/cost/tokens on that run row regardless of outcome, for
  per-tenant and per-agent cost observability.
- Makes exactly **one** model call per customer turn today — there is no
  iterative agent-re-prompts-itself loop yet; "max model calls" currently
  only bounds the retry, honestly documented as such in the code.

**Model routing.** A deterministic, pre-call heuristic (`chooseModel()`)
picks Haiku 4.5 by default and escalates to Sonnet 5 for turns where quality
matters more than cost: a hot lead (score ≥ 60), a price-negotiation or
complaint keyword, or a match against the agent owner's own plain-English
escalation conditions. The routing decision itself never costs a token.

**Providers.** `MockAIProvider` (default, deterministic, zero cost, fully
offline) and `AnthropicProvider` (real Claude calls, activated by setting
`ANTHROPIC_API_KEY`) sit behind one interface — swapping is a one-line config
change, and both populate the same `extractedFields`/`toolCalls` shape.

**Tool / action system.** The model never touches the database directly — it
can only request one of a fixed set of named actions (`create_contact`,
`update_contact`, `create_lead`, `update_lead`, `create_opportunity`,
`update_opportunity`, `schedule_followup`, `create_task`, `request_human`,
`record_sale`, `offer_discount`) with structured parameters. Each request is
validated, tenant-scoped, permission-checked (`AUTOMATIC` / `APPROVAL_REQUIRED`
/ `DISABLED` per action), logged to `agent_actions` regardless of outcome, and
cross-run idempotent for a 10-minute window via a signature hash — a retried
or duplicated webhook delivery produces one write, not two.

**Contact-field extraction.** Both providers report `extractedFields`
(name/phone/email/location/budget/requirements) alongside their tool calls.
A shared sanitizer (`sanitizeExtractedName()`) strips lead-in phrases ("my
name is…") and rejects sentence-like values before anything is ever saved to
a contact record — the single defensive backstop regardless of which
provider or code path produced the value.

**Channels:** Website widget (`<script data-widget="...">`, or the legacy
`data-agent="...">` embed — both resolve through the same routing), WhatsApp,
Instagram, Messenger. WhatsApp and Instagram use a real staged connect flow
(state validation, webhook registration, an actual connection test gating
`CONNECTED`) with delivery itself swappable to a real provider.

---

## 3. Inbox — live conversation management

`/inbox` lists conversations per tenant with unread state, lets a human take
over from the AI (`aiActive: false`) or hand back control, and shows the full
message history. Human takeover and AI messages share the same `messages`
table so the transcript is continuous regardless of who's answering.

---

## 4. CRM — Leads, Contacts, Opportunities, Sales

**Contacts** (`/contacts`) are the identity anchor: one contact can have
multiple `contact_identities` (phone, email, WhatsApp id, Instagram id,
anonymous session) resolving to the same record across channels.

**Leads → Opportunities → Sales** (`/leads`) follow a fixed stage pipeline —
`NEW → CONTACTED → QUALIFIED → OPPORTUNITY → QUOTATION → WON/LOST` — written
by the AI's tool calls or by a human editing the record directly.

**CRM push-out sync** (new). Once a tenant connects a CRM (HubSpot, Kommo,
Salesforce, Zoho, Odoo, or a custom API — all currently DEMO/MOCK connectors
behind a real `CRMConnector` interface), every contact/lead/opportunity
create or update — from the AI *or* from a human editing the record in the
back office — pushes out to **every** connected CRM, not just one. Pushes are
idempotent (an `external_mappings` table remembers each entity's external id
per provider, so a repeat push updates rather than duplicates) and
best-effort: a downstream CRM failure is logged with the real provider/entity
and never blocks or rolls back the local write. `opportunities.crm_sync_status`
reflects the real outcome (`SYNCED`/`PARTIAL`/`FAILED`), and the Integrations
page shows a real "Last synced" timestamp per connected CRM.

---

## 5. Knowledge Base

`/knowledge`: collections of documents an AI agent is allowed to answer from
— and only from; the agent is instructed to escalate rather than guess when
an answer isn't present in the knowledge base or product catalogue.

**Source types:**
- **Text** — typed or pasted directly.
- **FAQ** — question/answer pair, stored as one document.
- **Website URL** (new: real extraction) — fetches the page server-side,
  strips script/style/nav/header/footer, decodes entities, and returns
  clean text + the page title for the owner to review before saving. Guarded
  against SSRF (blocks localhost/private/link-local addresses on both the
  literal hostname and the resolved IP).
- **PDF** (new: real extraction) — uploads a file, extracts its text via
  `pdf-parse`, strips multi-page separator artifacts, and returns a
  suggested title (from the filename) + content for review.

Neither extraction path auto-saves — the owner always reviews/edits the
result before it's written to the Knowledge Base, preserving the platform's
"the owner confirms what the AI can say" rule.

---

## 6. Attribution

`/attribution`: which campaign generated this customer, and which one
generated this sale — computed from real conversation/UTM/click-id data, never
from an ad platform's self-reported conversions.

**Complete touch history.** Every conversation, on every channel, writes a
durable `attribution_touches` row (`touchType: "TOUCH"`) the moment it's
created — not reconstructed retroactively from whichever two conversations
happened to end up linked to an eventual sale.

**First/Last touch** — the existing reporting model: once an opportunity is
won, two specific touches (`FIRST`/`LAST`) are promoted and linked to the
sale; the Attribution page's "Revenue by source/campaign" reads these.

**Assisted conversions** (new). First/last touch only ever credits the
opening and closing interaction — a contact who touched Instagram, then later
converted via a Google ad, showed 100% of the credit on just those two
touches. `computeAssistedAttribution()` walks each won sale's complete touch
history and credits every source that appeared in the path, separating the
closer from the sources that merely assisted (a channel touched twice
pre-conversion still counts as one assist — the standard definition). This is
the classic binary "did this channel appear in the path" model, not
fractional multi-touch weighting — a bigger step intentionally left for
later.

---

## 7. Advertising

`/advertising`: ad account/campaign performance (Meta, Google, TikTok,
Instagram Ads — DEMO/MOCK connectors behind a real interface) combined with
real CRM/sales outcomes, never ad-platform-reported conversions alone.

**AI Advertising Analyst** generates recommendations (Increase/Reduce
Budget, Review Targeting, Change Offer, Create New Creative) from real
computed campaign performance and conversation-intelligence signals (top
customer objections). A human must approve any budget-impacting
recommendation before it executes — approval flows through the connector and
is logged to the audit trail.

---

## 8. Influencer Intelligence *(new — first working slice)*

`/influencers`: track creator partnerships end to end — real referral
clicks, conversations, leads, and sales, not invented reach numbers. This
implements a working subset of a larger 4-milestone spec
(`docs/PHASE_2_TASKS.md`); see the QA report for exactly what's still
outstanding.

**Tracking links.** A creator gets a short `/go/<code>` URL. Visiting it logs
a `ReferralClick` and redirects to either a WhatsApp deep link (prefilled
with `Ref: <code>`) or a plain website URL.

**WhatsApp referral attribution, end to end.** The inbound WhatsApp webhook
detects a `Ref: <code>` token, resolves it to an influencer/campaign, and
sets it directly on the new conversation (`utmSource: "influencer"`,
`utmCampaign`, plus real `influencerId`/`trackingLinkId` foreign keys) — so
100% of the existing UTM-driven attribution machinery (touch capture,
first/last promotion, assisted attribution) picks it up automatically,
with no parallel tracking path. A message that is *just* the referral token
(exactly what WhatsApp sends when a follower taps the link) is recorded for
attribution but never handed to the AI as if it were a real answer — the
customer's next actual message starts qualification.

**Deterministic metrics** (`modules/influencers/metrics.ts`, no LLM call):
clicks, conversations started, click-to-conversation rate, leads, qualified
leads, opportunities, sales, revenue, AOV, lead-to-sale rate, cost (from
manually recorded creator payments), CPL, cost per qualified lead, cost per
sale, ROAS, ROI.

**Deterministic scoring** (`modules/influencers/scoring.ts`, no LLM call):
a **Commercial Score** and a **Publicity Score** (0–100, relative to a
tenant's other creators — not an invented absolute benchmark), and a
classification: `SALES_DRIVER`, `PUBLICITY_DRIVER`, `FULL_FUNNEL_PERFORMER`,
`ENGAGEMENT_SPECIALIST`, `EMERGING_PERFORMER`, `UNDERPERFORMER`, or
`INSUFFICIENT_DATA` (returned honestly below a minimum click threshold
rather than a confident-looking score from too little data). Publicity
Score is deliberately a click-volume proxy, not a fabricated reach number —
there's no live connector polling real platform reach/engagement yet.

**AI Influencer Analyst** explains — never invents — scores already computed
above, producing approvable recommendations (Scale, Use For Publicity,
Change Offer, Reduce Allocation, …) through the same human-approval pattern
as the Advertising Analyst.

**UI:** creator cards with scores/classification, a detail view (metrics,
tracking links with copy-to-clipboard URLs, cost entries, recommendations
with approve/reject), and a manual "Run AI Influencer Analyst" trigger.

---

## 9. Follow-ups

`/followups`: scheduled follow-up engine, `aiFollowUpEnabled` per
opportunity, run on a 5-minute interval — a persistent BullMQ worker locally,
or a Netlify Scheduled Function in production (calling the exact same
`runFollowUpCheck()` either way). A manual "Run follow-up check now" button
exists in Settings for on-demand testing.

---

## 10. Integrations Hub

`/integrations`: one page for every connector, grouped by category —
Messaging (WhatsApp, Instagram, Messenger), CRM (5 providers), Advertising
(4 providers), Analytics (Google Search Console — organic search, self-
onboarded), Ecommerce (Shopify/WooCommerce/custom), Productivity (Google
Calendar/Gmail/Slack). Every connector without a live third-party credential
in this environment is a clearly labelled DEMO/MOCK connector implementing
the real interface end to end — nothing pretends a real external API call
happened.

---

## 11. Billing & Credits

Real per-turn AI usage metering: real token counts × real per-model pricing
→ a credit ledger (`credit_ledger`) with running balance, charged only when
a real (non-mock) provider call actually happens. A tenant nearing its
credit limit can request a top-up (admin-approved manual flow today, not
live payment collection — see Outstanding Work).

---

## 12. Team & Permissions

`/team`: invite/manage users and assign one of the 8 tenant roles. Every API
route and nav item checks `hasPermission()` against the static
resource:action matrix — no per-tenant custom roles yet (documented as an
MVP simplification, drop-in to swap for a DB-backed table later).

---

## 13. Developer / API

`/developers`: API key management (prefix + hashed secret pairs) for the
public `/api/v1/*` gateway (agents, contacts, leads, opportunities,
conversations, attribution, campaigns, integrations, products,
recommendations, sales, tasks, webhooks) — Bearer-token authenticated,
tenant-scoped. Outbound webhooks (`webhooks` table) fire on real platform
events (lead qualified, sale recorded, recommendation created/approved,
conversation created, …) with a signing secret per webhook.

---

## 14. Platform Admin (staff dashboard)

`/platform` — a completely separate surface from the tenant app:
- **Isolated auth**: a `platform_staff` table with no `tenantId` column,
  its own session cookie name, and its own JWT signing secret
  (`PLATFORM_JWT_SECRET`) — a leaked tenant session cannot forge a platform
  session or reach `/platform/**` at all.
- **4 platform roles**: `PLATFORM_SUPER_ADMIN`, `PLATFORM_SUPPORT`,
  `PLATFORM_FINANCE`, `PLATFORM_OPERATIONS`.
- **Hostname-gated deployment**: the same codebase deploys as two Netlify
  sites — the main tenant-facing app, and a second site whose `ADMIN_HOSTNAME`
  env var makes middleware serve *only* `/platform/**` there and block it
  entirely on the main host, so the admin surface is unreachable from the
  tenant-facing domain even by URL.
- **Cross-tenant dashboard**: aggregate real platform metrics (active
  tenants, users, AI credits consumed, conversations, failed integrations,
  tenants approaching limits) — anything not yet genuinely trackable (e.g.
  MRR, Pro subscriptions) is honestly reported as untracked rather than
  invented.

---

## 15. Onboarding

`/onboarding`: guided first-run flow — business profile → create/import an
agent → connect a channel (or explicitly skip) → test the agent live → go
live. Progress and milestone events (`first_lead_created`,
`first_qualified_lead`, `first_sale`, `first_attributed_sale`, …) are logged
once per tenant regardless of how many times the underlying event recurs.

---

## 16. Dashboard & Reports

`/dashboard`: real-time KPIs (leads, opportunities, sales, revenue, credit
balance) and a "Needs Attention" panel (pending approvals, stalled
opportunities, low credits). `/reports`: point-in-time report views over the
same underlying real data.

---

## Cross-cutting platform disciplines

These aren't features on a nav bar, but they shape every feature above:

- **DEMO/MOCK connector pattern.** Wherever no live third-party credential
  exists, the platform builds the *complete* connector abstraction and
  clearly labels the connector as mock — it never pretends a real external
  API action occurred.
- **"Platform calculates, AI interprets."** Every metric, score, and
  ranking is computed by deterministic code from real data first; an AI
  analyst only ever explains numbers that already exist — it never invents
  one. Enforced consistently across the Advertising Analyst, the Influencer
  Analyst, and the platform dashboard's honest-untracked-metrics handling.
- **Human approval gate.** Any AI-proposed action with real-world
  consequence (a budget change, an influencer allocation change, a discount)
  requires explicit human approval before it executes, logged to the audit
  trail either way.
- **Idempotency & audit.** AI tool-call executions are signature-deduped
  within a 10-minute window; every write of consequence — contact edits, CRM
  syncs, recommendation decisions, sales — has a corresponding `audit_logs`
  entry.
