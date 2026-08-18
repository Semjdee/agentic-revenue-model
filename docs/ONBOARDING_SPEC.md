# Zero-to-Live Self-Onboarding — Spec (current top priority)

> Source: pasted directly into chat by the product owner on 2026-08-19,
> transcribed here verbatim (structure and wording preserved) so it's
> searchable/diffable/linkable from code and PRs, following the same
> discipline as `docs/PHASE_2_EXTENSIONS_SPEC.md`. If anything here ever
> looks ambiguous, ask before assuming.
>
> **This supersedes `docs/PHASE_2_TASKS.md` in priority, not in existence.**
> Phase 2 (self-service WhatsApp/Instagram/TikTok + Influencer
> Intelligence) is not being removed or abandoned — see section 28 below
> and `HANDOFF.md` for how the two relate. This doc is now what a fresh
> session should build first.

## 0. Framing

We are changing the immediate development priority of the existing
Agentic Revenue Operations SaaS Platform.

**DO NOT** remove or redesign the existing MVP architecture.

**DO NOT** remove the gated architecture already prepared for:

- Revenue Goal Agent
- Influencer Intelligence
- Advanced Attribution
- Autonomous Ad Optimization
- Additional AI Agents
- Pro subscriptions/add-ons

However, these advanced capabilities are **not** the immediate build
priority.

The immediate priority is: **ZERO-TO-LIVE SELF-ONBOARDING**.

The platform must become usable by a normal business owner without SMS
Consult staff manually configuring their account.

Our primary product test is:

> "Can we give a business owner the platform URL and have them
> successfully create, configure, test and activate their AI sales
> operation without speaking to us?"

If not, onboarding is not finished.

## 1. Primary product objective

Build a self-service onboarding journey:

```
LANDING PAGE
  → CREATE ACCOUNT
  → CREATE BUSINESS WORKSPACE
  → TELL US ABOUT YOUR BUSINESS
  → CONNECT BUSINESS CHANNEL
  → IMPORT PRODUCTS / SERVICES / BUSINESS KNOWLEDGE
  → AI CONFIGURES INITIAL SALES AGENT
  → USER REVIEWS CONFIGURATION
  → TEST AI AGENT
  → SYSTEM HEALTH CHECK
  → GO LIVE
  → FIRST REAL CUSTOMER CONVERSATION
  → CONTACT / LEAD CREATED
  → FOLLOW-UP / CRM WORKFLOW ACTIVE
  → FIRST VALUE ACHIEVED
```

Target: simple business **< 15 minutes** from signup to activation; more
complex SME **< 30 minutes** where practical. Do not expose unnecessary
technical configuration to the customer.

## 2. Definition of self-service

"Without third-party involvement" means the customer should **not**
require SMS Consult staff, developers, implementation consultants or
support agents to manually configure their workspace.

We may still depend on official infrastructure/providers including Meta,
WhatsApp, Instagram, Google, TikTok, AI model providers, payment
providers, CRM providers. Always use official authorization/API
mechanisms. Never use unofficial scraping, browser-session hacks, or ask
users for social-network passwords.

## 3. Onboarding UX principle

The user should **not** see: "Configure webhook", "Enter API token",
"Enter Meta App ID", "Configure callback", "Write system prompt",
"Create attribution schema", "Configure tool permissions JSON", "Enter
CRM endpoint". Those belong in the platform infrastructure.

The customer should see: "Tell us about your business", "Connect
WhatsApp", "Add your products", "Meet your AI Sales Agent", "Test your
Agent", "Go Live". Hide technical complexity behind a simple
business-oriented UX.

## 4. Onboarding wizard

**Step 1 — Account.** Email/password, Google, Passkey where supported.
Create the tenant/workspace automatically.

**Step 2 — Business.** Ask only essential info: business name, industry,
country, currency, timezone, website URL, business description, primary
sales objective, primary customer channel. Do not overwhelm the user.

**Step 3 — Business knowledge.** Several simple ways to teach the AI:
`Scan My Website`, `Upload Product Catalogue`, `Upload Price List`,
`Upload Business Documents`, `Add Products Manually`, `Skip for Now`.
Where technically possible, automatically extract: business description,
products, services, prices, FAQs, locations, opening hours, delivery
info, warranty info, policies, contact info. **Do NOT immediately trust
extracted information** — show "We found the following information about
your business", allow Confirm / Edit / Remove. The business owner remains
the source of truth.

## 5. Connect your first channel

```
Where do customers contact you?
  WhatsApp   [ Connect ]
  Instagram  [ Connect ]
  Website    [ Install ]
  TikTok     [ Connect ]
```

Do not require all channels — activate with **one** supported primary
channel. Priority order: 1) WhatsApp, 2) Website widget, 3) Instagram,
4) Google Ads attribution, 5) TikTok. Do not delay initial activation
because every integration isn't connected.

## 6. WhatsApp self-service onboarding

Prioritize heavily. Use the official WhatsApp Business Platform
onboarding / Embedded Signup architecture where applicable.

```
Connect WhatsApp → Official Meta authorization
  → user selects/creates business assets → grants permissions
  → return to platform → backend exchanges authorization securely
  → tenant mapping created → webhooks configured → connection tested
  → CONNECTED
```

Customer never manually pastes tokens. After connection show real status
(number, message readiness, AI agent active/not, webhook health) plus
Test Connection / Permissions / Disconnect actions.

## 7. Website widget self-onboarding

Extremely simple: copy one script snippet (Option A now; guided
installation for common platforms is a later option). After install,
`[ Verify Installation ]` — the platform actually checks the widget is
reachable before showing "Website Widget Connected". Do not require the
user to understand WebSockets, APIs, or auth architecture.

## 8. Instagram self-service connection

Official Meta/Instagram authorization only. Never request the customer's
Instagram password directly.

## 9. TikTok connection

Prepare/build official OAuth-based onboarding. Only expose capabilities
actually available to our approved application (Advertising, Lead
capture, Organic analytics, Content — do not claim messaging capability
unless officially supported for our use case).

## 10. Progressive onboarding

**Do not** ask the customer to configure the entire platform during
signup. Day 1 requires only: Business → Products/services → One customer
channel → AI Sales Agent → Test → Go Live. Everything else (Instagram,
Google Ads, CRM connector, team invites, Pro upgrade, Influencer
Intelligence) is offered **later**, contextually, after first value.

## 11. Automatic AI agent configuration

Do **not** ask ordinary users to write prompts — ask business questions
instead ("What do you sell?", "Who normally buys from you?", "What makes
customers choose you?", "What information should the AI collect from a
potential customer?", "What makes a lead qualified?", "When should the AI
hand over to a human?", "Are there things the AI must never promise?",
"Do you negotiate prices?", "Do you offer delivery?", "Do you offer
credit?", "Which locations do you serve?"). Use the answers plus the
verified knowledge base to generate the initial agent configuration. The
platform may still use system prompts/tools/policies/retrieval/
permissions/handoff rules internally — ordinary users should never need
to configure them by hand.

## 12. Industry starter templates

Optional templates (Solar, Real Estate, Automotive, Travel, Education,
Manufacturing, E-commerce, Professional Services, Other) may
preconfigure qualification questions, lead fields, suggested pipeline,
agent behavior, common FAQs, handoff rules. **Do not hard-code industry
assumptions as facts** — templates are editable starting points.

## 13. Agent preview

After configuration, show "Meet Your AI Sales Agent": name, primary role,
products/services understood, qualification behavior, handoff behavior,
connected channel, knowledge sources. Then `[ Test My Agent ]` — do not
immediately put the agent live.

## 14. Test sandbox

Realistic test environment ("Pretend you're a customer"): ask for price,
ask product questions, ask about delivery, object to price, ask for
discount, request salesperson, ask something unknown. Show internally
useful state where helpful: AI response, lead qualification, contact
creation simulation, lead score, handoff decision, follow-up action. **Do
not pollute production CRM data** with test conversations — clearly mark
test/sandbox data.

## 15. Correction loop

After each test: `[ Good Response ]` / `[ Needs Improvement ]`. If
"Needs Improvement", let the user explain what should have happened, and
use that feedback to update configurable knowledge/policy where
appropriate. **Do not let uncontrolled feedback silently rewrite critical
business rules** — important changes stay reviewable.

## 16. Pre-launch health check

Automatic readiness check before Go Live, e.g.:

```
BUSINESS PROFILE    ✓ Complete
KNOWLEDGE            ✓ Products loaded   ✓ Pricing confirmed
CHANNEL              ✓ WhatsApp connected   ✓ Webhook healthy
AI AGENT             ✓ Configuration valid   ✓ Knowledge retrieval working
CRM                  ✓ Default lead pipeline ready
SECURITY             ✓ Permissions valid

RESULT: 5/5 READY   [ GO LIVE ]
```

If something fails, never show developer errors — translate them (see
section 31).

## 17. One-button Go Live

Once health checks pass, `[ GO LIVE ]` safely: activates agent, enables
selected channel processing, enables production CRM writes, enables
configured follow-up rules, enables attribution/session tracking, begins
operational monitoring, creates an audit record. Show "YOUR AI SALES
AGENT IS LIVE".

## 18. First value is the real onboarding completion

Onboarding success is **not** "account created" or "WhatsApp connected".
It's **Time To First Value**: the first successful genuine customer
conversation handled by the platform. Track as activation milestones:
First Contact, First Lead, First Qualified Lead, First Follow-up, First
Opportunity, First Sale, First Attributed Revenue.

## 19. Onboarding funnel analytics

Instrument the entire journey: `signup_started`, `signup_completed`,
`workspace_created`, `business_profile_completed`,
`knowledge_import_started`, `knowledge_import_completed`,
`channel_connect_started`, `channel_connected`, `channel_connect_failed`,
`agent_generated`, `agent_test_started`, `agent_test_completed`,
`health_check_completed`, `go_live_clicked`, `agent_activated`,
`first_real_conversation`, `first_contact_created`, `first_lead_created`,
`first_qualified_lead`, `first_sale`, `first_attributed_sale`. Measure
conversion between each stage.

## 20. Time To First Value (TTFV) metric

Primary SaaS metric: Account Created → First Successful Production AI
Customer Conversation. Also measure Account→Channel Connected,
Account→Agent Generated, Account→Agent Tested, Account→Go Live,
Account→First Lead, Account→First Sale.

## 21. Onboarding drop-off detection

Identify where customers abandon onboarding (e.g. 1,000 signups → 820
workspace created → 690 business profile completed → 410 knowledge
imported → 220 WhatsApp connected → 180 agent tested → 150 activated →
**primary bottleneck: WhatsApp Connection**). This becomes a
product-development priority. **Do not respond to poor activation by
adding more features — fix the onboarding bottleneck first.**

## 22. Save and resume

Users must be able to leave onboarding and return later, with progress
auto-saved ("Welcome back. You're 3 steps away from going live." with a
checklist and `[ Continue Setup ]`). Never force a restart.

## 23. Onboarding assistant

AI may help during onboarding: explain a field, summarize an uploaded
catalogue, suggest qualification questions, identify missing business
info, help configure agent tone, explain a failed WhatsApp connection in
plain language. **The onboarding AI must never bypass security or
provider authorization.**

## 24. Default CRM configuration

Do not require a new user to design a pipeline. Sensible default: NEW →
CONTACTED → QUALIFIED → OPPORTUNITY → QUOTATION → WON → LOST.
Customizable later. Reuses the existing internal CRM architecture (this
already matches `LEAD_STAGES`/`OPPORTUNITY_STAGES` in `src/db/schema.ts`
— no new pipeline concept needed).

## 25. Default agent permissions

Safe defaults on creation: answer normal product questions →
`AUTOMATIC`; qualify lead → `AUTOMATIC`; create/update contact →
`AUTOMATIC`; create lead → `AUTOMATIC`; schedule normal follow-up →
`AUTOMATIC`; large discount → `APPROVAL_REQUIRED`; change advertising
budget → `APPROVAL_REQUIRED`; financial commitment →
`APPROVAL_REQUIRED`/`DISABLED`; delete business records → `DISABLED`.
Customizable later via the existing `ACTION_PERMISSIONS` system
(`src/modules/ai/actions.ts`) — no new permission model.

## 26. Billing must also be self-service

Eventual SaaS customer must be able to view plan, start trial where
enabled, subscribe, upgrade to Pro, buy add-ons, update billing, cancel —
without contacting SMS Consult. Reuse the entitlement architecture
already specified (P1, not immediate priority — see section 28/37).

## 27. Progressive premium discovery

Do not push every premium feature during initial onboarding. After the
user has real value, introduce upgrades contextually (e.g. after
attributed sales exist: "You generated UGX X from your connected
channels. Want the AI to work toward a revenue target? Revenue Goal
Agent — PRO"). Premium features appear when their value is understandable.

## 28. Keep advanced features gated

Preserve the existing entitlement architecture for `revenue_goal_agent`,
`influencer_intelligence`, `advanced_attribution`,
`autonomous_ad_optimization`, `additional_ai_agents`. **Do not remove
these features; do not make them the immediate priority.** Build core
architecture so they can be activated later — this is exactly what
`docs/PHASE_2_TASKS.md` already describes; it is not cancelled, just
lower priority than this doc for now (see section 37).

## 29. Mobile-first requirement (mandatory)

The entire onboarding process must work properly on smartphones. Test
Android Chrome, iPhone Safari, desktop Chrome, responsive tablet
layouts. Do not assume the business owner is on a laptop — buttons,
OAuth flows, forms, testing and Go Live must all work comfortably on
mobile.

## 30. Low-bandwidth design

Optimize for inconsistent connectivity: avoid unnecessarily large assets,
compress images, lazy-load nonessential resources, show upload progress,
allow upload retry, preserve onboarding state across a dropped
connection. Never lose completed steps to a network interruption.

## 31. Error experience

Translate technical errors into actionable business language.

- Bad: `OAuthException #190` → Good: "Your Instagram authorization
  expired." `[ Reconnect Instagram ]`
- Bad: `Webhook verification failed.` → Good: "We couldn't finish
  connecting WhatsApp." `[ Try Again ]`

Allow "View technical details" only where appropriate for advanced/admin
users.

## 32. Human help should be optional

Chat with Support / Book Setup Assistance / Enterprise Implementation may
exist later, but must **not** be necessary for normal onboarding. A
business owner must be able to complete activation independently.
Implementation services are an optional commercial add-on for complex
customers.

## 33. Onboarding admin analytics

Internal admin visibility into: total signups, activation rate, average
TTFV, median TTFV, channel connection success rate, WhatsApp connection
failure rate, knowledge import success, agent test completion, go-live
rate, first-lead rate, first-sale rate, drop-off stage, errors by
provider. For product improvement.

## 34. Self-service health monitoring after onboarding

Self-service doesn't end at Go Live. Monitor channel connection, token
expiration, webhook health, AI provider health, CRM connector health,
widget status — surface actionable prompts ("WhatsApp needs to be
reconnected." `[ Reconnect ]`) so the user can resolve common integration
problems themselves.

## 35. Do not build a fake onboarding (critical)

Do **not** create UI buttons that merely simulate Connected / Imported /
Verified / Live. Onboarding must use real backend state: "Connected"
means the provider connection is actually valid; "Widget installed" means
verification succeeded; "Knowledge imported" means usable data exists;
"Agent ready" means required services pass validation; "Live" means
production processing is enabled. This is the same non-negotiable rule
`BUILD_NOTES.md` and `HANDOFF.md` already apply to every other
integration in this codebase — no exception here.

## 36. Architecture principle

The onboarding wizard is an **orchestration UI**. It must reuse existing
platform services — do **not** create a separate onboarding version of
Contacts, CRM, Knowledge, AI Agents, Integrations, Attribution,
Permissions. The wizard configures the **same production entities** the
platform later uses. After onboarding, the user simply enters the normal
application.

## 37. Development priority order

Do not interpret this as removing previously built modules — this is
priority order, not scope removal.

**P0**
- Account/workspace creation
- Business profile
- Knowledge import
- WhatsApp self-connect
- Website widget installation
- AI Sales Agent automatic setup
- Agent testing
- Health check
- Go Live
- First conversation → Lead

**P1**
- Instagram self-connect
- CRM connector onboarding
- Google Ads self-connect + attribution
- Billing/subscription self-service

**P2**
- TikTok
- Advanced attribution
- Influencer Intelligence
- Revenue Goal Agent
- Additional AI Agents

**P3**
- Autonomous Ad Optimization

## 38. MVP success condition (unchanged, kept alongside the new one)

```
Advertisement → Conversation → AI Qualification → Product Recommendation
  → Lead → CRM Action → Follow-up → Sale → Revenue Attribution
  → Advertising Analysis → AI Recommendation → Human Approval
```
and
```
Website → Embedded Widget → AI Sales Agent → Back-office Inbox
```

New, equally important SaaS activation success condition:

```
NEW BUSINESS → SELF SIGNUP → BUSINESS SETUP → KNOWLEDGE IMPORT
  → SELF-CONNECT CHANNEL → AI AGENT GENERATED → TEST → HEALTH CHECK
  → GO LIVE → FIRST REAL CONVERSATION
```
without SMS Consult staff intervention.

## 39. Building principle

Before adding another major feature, ask: "Does this improve activation,
conversion, retention or revenue for the existing product?" If onboarding
has a major unresolved bottleneck, fix it before expanding feature
breadth. The immediate product objective is **not** "have the most AI
features" — it's "make the existing revenue engine ridiculously easy to
activate."

## 40. Final product test

Eventually: send a URL to a business owner in Kampala, Nairobi, Dar es
Salaam, or Kigali with no instructions. Observe whether they can create
an account, tell the platform about their business, connect
WhatsApp/website, load products/services, configure the AI through
business questions, test the agent, go live, receive a real inquiry, and
generate a lead — without calling us. If they cannot, identify exactly
where they failed and improve that step. Only once this activation
engine is strong should advanced feature expansion become the primary
focus again.

---

## Addendum — preserve existing AI Agent creation & advanced configuration

> Added same day, immediately after the main spec above, to close a gap
> the main spec didn't address explicitly: the existing manual AI Agent
> workflow (`src/app/(app)/agents/`) must not be replaced or weakened by
> the new guided path.

The new self-onboarding flow must **not** replace, remove, simplify
away, or break the existing AI Agent management workflow. The current MVP
already allows creating/configuring agents with detailed fields: name,
avatar, role, company, instructions, tone, language rules, products,
knowledge base, qualification questions, sales rules, restricted topics,
escalation conditions, business hours, follow-up rules (all of these
already exist as columns on `agents` in `src/db/schema.ts`). This
existing manual capability must remain available. **The onboarding
wizard is an additional guided creation path, not a replacement.**

### A1. Two agent creation paths

Inside **AI Agents**, support at minimum:

- **Create with Guided Setup** — for ordinary business owners who don't
  want to write prompts or configure advanced AI settings.
- **Create Manually** — for advanced users/admins/implementation
  specialists who want full control (this is the existing `/agents` "New
  Agent" flow, unchanged).
- **Existing Agents** — show all previously created agents regardless of
  which path created them.

### A2. Guided setup creates the same production agent

Guided onboarding must **not** create a separate `OnboardingAgent`,
`SimpleAgent`, `TemporaryAgent`, or any parallel agent model. It creates
the same `agents` row (and any future `AgentConfiguration` split — see
`BUILD_NOTES.md` §10's note that these are currently merged) already
used by the platform. The wizard just populates those entities
automatically from the user's business answers.

### A3. Guided questions → agent configuration mapping

Ask business-friendly questions: "What does your business sell?", "Who
are your typical customers?", "What should the AI help customers with?",
"What information should it collect from a lead?", "What makes a lead
qualified?", "When should the AI hand over to a human?", "What should the
AI never promise?", "Do you negotiate prices?", "Do you offer delivery?",
"Which locations do you serve?", "What languages should the agent
support?", "What tone should the agent use?"

Mapping:

| Answer | Maps to |
|---|---|
| Business tone | `tone` |
| What to collect | `qualificationQuestions` |
| Handoff rules | `escalationConditions` |
| Products/services | `productIds` |
| Restricted promises | `restrictedTopics` / `salesRules` |
| Business hours | `businessHours` |
| Follow-up preferences | `followUpRules` |

The user never needs to understand this mapping.

### A4. Review before creation

Before a guided agent goes live, show a review screen (name, role, tone,
languages, qualification summary, human-handoff summary, knowledge
sources) with `[ Edit ]` / `[ Create Agent ]`.

### A5. Full editability after guided creation

After creation, a guided agent is a **normal agent** inside AI Agents —
fully open and editable across tabs (Overview, Instructions, Knowledge,
Products, Qualification, Sales Rules, Language & Tone, Escalation,
Follow-ups, Business Hours, Permissions, Integrations, Activity,
Advanced). Never locked into a simplified mode.

### A6. Manual creation remains available, unchanged

The existing "Add AI Agent" workflow (`src/app/(app)/agents/page.tsx`,
`src/app/(app)/agents/[id]/page.tsx`) must keep working exactly as today.
Do not force every user through onboarding.

### A7. Existing agents must not be modified unexpectedly

Implementing self-onboarding must **not**: delete existing agents,
overwrite existing configurations, change existing agent instructions,
merge agents automatically, change permissions, change assigned
channels, or reset knowledge bases. Existing agents keep functioning
exactly as before unless the user explicitly edits them.

### A8. Onboarding reuses existing agent services, no duplicated logic

The wizard only orchestrates calls into existing production services for
agent creation/configuration, knowledge assignment, product assignment,
channel assignment, permission configuration, follow-up configuration.

### A9. User choice when agents already exist

If the tenant already has ≥1 agent, onboarding must **not**
auto-create a duplicate. Show: "You already have AI Agents." with
`[ Use Existing Agent ]` / `[ Create New with Guided Setup ]` /
`[ Create New Manually ]`. If they pick an existing agent, let them
assign it to the newly connected channel where permitted.

### A10. Default first agent

For a brand-new business with zero agents, the wizard may recommend
"Create My First AI Sales Agent" via Guided Setup by default, with
"Advanced / Create Manually" offered alongside for users who want direct
configuration.

### A11. Agent templates

Industry templates (Solar Sales Agent, Real Estate Lead Agent, Travel
Inquiry Agent, School Admissions Agent, Automotive Sales Agent,
E-commerce Sales Agent) assist both paths but still create normal,
fully-editable production agents — never a restricted agent type.

### A12. Agent versioning / change safety

Where practical, preserve configuration history for important changes
(instructions updated, qualification rules changed, escalation changed,
permissions changed) in the existing `audit_logs` table
(`src/lib/audit.ts`). Future support for full configuration versions
should remain architecturally possible.

### A13. Testing remains available after onboarding

`Test Agent` must be available from the AI Agents screen for **every**
agent, always — not just during onboarding — so users can safely test
configuration changes before they hit live conversations. Test
conversations stay separated from production CRM activity (same rule as
spec section 14).

### A14. Go-live control is separate from creation

Agent creation and agent activation are not the same event. An agent may
be in `DRAFT`, `READY`, `ACTIVE`, or `PAUSED` (extends the current
`status` column, which today is only `ACTIVE`/`PAUSED` — see
`src/db/schema.ts`). Creating an agent during onboarding must not
auto-activate it until the user completes readiness checks and clicks
Go Live.

### A15. Multiple agents remain fully supported

Do not design self-onboarding as if a tenant will only ever have one
agent (Sales Agent, Customer Support Agent, Lead Qualification Agent,
Follow-up Agent, Travel Agent, Product Specialist, future Pro Agents —
all must remain possible). The wizard is mainly concerned with making
the **first** agent easy to activate; it must not limit future
multi-agent usage.

### Final requirement

```
Guided Setup  → creates a normal Agent (same entity, same table)
Manual Setup  → creates a normal Agent (same entity, same table)
```

Both paths lead to the same production agent architecture. Do not create
separate agent systems. Do not remove advanced configuration. Do not
break existing AI Agents. Preserve the current MVP agent-management
capabilities while adding a simpler self-service path for new users.
