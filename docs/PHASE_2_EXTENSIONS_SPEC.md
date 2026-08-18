# Agentic Revenue Operations Platform — Extensions Spec (Phase 2)

> Source: `Agentic Revenue Operations Platform Extensions.pdf`, provided by
> the product owner. Transcribed to markdown verbatim (structure and
> wording preserved) so it's searchable/diffable/linkable from code and
> PRs. If anything here ever looks ambiguous against the original PDF,
> the PDF is the source of truth — ask before assuming.
>
> **This is the Phase 2 backlog — not yet built.** See `HANDOFF.md` at
> the repo root for how to start on it and what already exists.

## Add features to existing MVP

1. **Influencer Attribution & AI Performance Intelligence**
2. **Self-service WhatsApp, Instagram & TikTok integration onboarding**

These features are **extensions of the existing AI Revenue Agent Platform
MVP**. Do NOT build them as separate products, separate CRMs, separate
attribution systems, or disconnected integration tools. The existing MVP
remains the architectural source of truth.

The platform is evolving into a scalable **Multi-Tenant Agentic Revenue
Operations SaaS Platform**.

The existing MVP revenue loop remains:

> Advertising → Conversation → AI Sales Agent → CRM → Follow-up → Sale →
> Revenue Attribution → Advertising Intelligence

Extend it with:

> Influencer Content → Tracking Link → Conversation → AI Sales Agent →
> Lead → Opportunity → Sale → Revenue Attribution → Influencer
> Intelligence

and with:

> Customer SaaS Login → Connect Social Channel → Official
> OAuth/Embedded Authorization → Webhooks/API Connection → Unified
> Inbox / Advertising / Lead Capture / Attribution

The objective is that customers can self-onboard their own business
communication and marketing accounts **without SMS Consult manually
configuring credentials for every tenant.**

---

## Core architectural rule

**Reuse the existing:**

- Tenant / Workspace architecture
- Users / Roles / Permissions
- Contacts
- Contact Identities
- Conversations
- Messages
- Leads
- Opportunities
- Tasks
- Sales
- Products
- AI Agents
- AI Tool/Action system
- Approval architecture
- Follow-up engine
- Attribution engine
- Advertising analytics
- AI Advertising Analyst
- Conversation Intelligence
- Integration Hub
- API Gateway
- Webhooks
- Audit Log
- External ID Mapping
- Reporting
- Background jobs
- Connector/adaptor architecture

**Do not duplicate existing business entities unnecessarily.**

---

## Part A — Self-service social integration onboarding

This is a major SaaS requirement. Customers should be able to connect
supported external platforms from inside their own workspace.

The intended UX is:

```
Integrations
  WhatsApp   [Connect WhatsApp]
  Instagram  [Connect Instagram]
  TikTok     [Connect TikTok]
```

The customer clicks Connect, completes the official provider
authorization flow, and returns to the platform with the integration
configured.

Do NOT require SMS Consult staff to manually enter credentials for every
customer unless the provider specifically requires manual setup.

### 1. Authentication vs platform authorization

Do not confuse SaaS authentication with external-platform authorization.

The customer may log into our SaaS using: Email/password, Passkey,
Google authentication, or other supported authentication. **This only
authenticates the user into their SMS platform workspace.**

Then external platforms must use their own official authorization flow.

Example:

> **Passkey / Email** → Authenticate into Agentic SaaS
>
> then:
>
> **Connect WhatsApp** → Meta authorization
> **Connect Instagram** → Instagram/Meta authorization
> **Connect TikTok** → TikTok authorization

Never ask customers to provide Facebook, Instagram, WhatsApp or TikTok
passwords directly to our platform.

### 2. WhatsApp self-onboarding

Build architecture around the official WhatsApp Business Platform
onboarding approach. Where supported, use **WhatsApp Embedded Signup**.

The intended experience:

```
Integrations → WhatsApp → Connect → Meta signup/authorization
  → Customer selects or creates appropriate WhatsApp business assets
  → Customer authorizes our application
  → Callback returns to our platform
  → Backend exchanges authorization securely
  → Required assets are associated with tenant
  → Webhooks registered
  → Connection tested
  → Status becomes CONNECTED
```

Support onboarding of existing WhatsApp Business assets where officially
supported.

- Do not build unofficial WhatsApp Web scraping.
- Do not use browser-session hacks.
- Do not expose WhatsApp credentials in frontend code.

### 3. Instagram self-onboarding

Build Instagram connection using the official professional-account
login/authorization architecture.

Intended flow:

```
Integrations → Instagram → Connect Instagram
  → Official authorization screen
  → Select professional account
  → Approve required permissions
  → Redirect to our callback
  → Secure backend token exchange
  → Account mapped to tenant
  → Messaging webhook subscription configured where approved
  → Connection tested
  → Status CONNECTED
```

Only supported Instagram Business/Creator account capabilities should be
exposed. Do not fake messaging or analytics capabilities that the
approved API does not provide.

### 4. TikTok self-onboarding

Build TikTok authorization using the official OAuth architecture.

Intended flow:

```
Integrations → TikTok → Connect TikTok
  → Official TikTok authorization
  → Requested scopes approved
  → Redirect callback
  → Backend exchanges authorization code
  → Access/refresh tokens stored encrypted
  → TikTok account mapped to tenant
  → Supported lead/advertising/content capabilities enabled
  → Status CONNECTED
```

TikTok capabilities may differ from WhatsApp and Instagram. Do not imply
TikTok DM support unless the relevant approved API capability exists.

Treat TikTok integrations as separate capability modules where
appropriate:

- TikTok Ads
- TikTok Lead Generation
- TikTok Organic Metrics
- TikTok Content Posting
- TikTok Messaging — only if officially supported for the
  application/use case

### 5. Generic integration connection framework

Do not hard-code separate authentication logic throughout the
application. Create a reusable integration authorization framework.

Example domain entity: `IntegrationConnection`

Suggested fields:

- `id`
- `tenant_id`
- `workspace_id`
- `provider`
- `integration_type`
- `external_account_id`
- `external_account_name`
- `status`
- `scopes`
- `encrypted_access_token`
- `encrypted_refresh_token`
- `token_expires_at`
- `webhook_status`
- `last_sync_at`
- `connected_by_user_id`
- `connected_at`
- `metadata`
- `created_at`
- `updated_at`

Possible statuses: `PENDING`, `CONNECTED`, `EXPIRED`, `REAUTH_REQUIRED`,
`ERROR`, `DISCONNECTED`

### 6. Generic OAuth / authorization interface

Create an internal interface such as: `OAuthConnector`

with methods conceptually similar to:

- `getAuthorizationUrl()`
- `handleCallback()`
- `exchangeAuthorizationCode()`
- `refreshToken()`
- `revokeAccess()`
- `testConnection()`
- `getGrantedScopes()`
- `registerWebhooks()`
- `unregisterWebhooks()`

Each provider implements the interface. Examples:

- `MetaWhatsAppConnector`
- `InstagramConnector`
- `TikTokConnector`

Future:

- `GoogleAdsConnector`
- `HubSpotConnector`
- `KommoConnector`
- `SalesforceConnector`
- `ZohoConnector`
- `OdooConnector`

**Do not call authorization or provider APIs directly from UI
components.**

### 7. Least-privilege permissions

This is mandatory. Request only permissions necessary for the feature
the customer is activating. Do not ask for every possible scope during
initial onboarding.

Example — Instagram Messaging enabled: request only the permissions
required for that approved messaging capability. Later, if customer
enables publishing: request the additional publishing permission at that
point.

TikTok initial configuration may enable: Lead capture, Reporting. Later:
Content publishing, Advertising management — can request additional
scopes separately.

The customer should understand what the platform is requesting.

### 8. Integration Permission Centre

Create a user-facing **Permissions** (or **Integration Permissions**)
view.

Example:

**WhatsApp** — ✓ Receive messages, ✓ Send messages, ✓ Read delivery
status, ✓ AI conversation handling, ✗ Marketing broadcasts

**Instagram** — ✓ Receive supported messages, ✓ Reply to messages, ✓
Read professional account information, ✗ Publish content, ✗ Manage
advertising

**TikTok** — ✓ Read supported campaign performance, ✓ Capture approved
lead data, ✓ Revenue attribution, ✗ Change campaign budgets, ✗ Publish
content

The exact permissions displayed must derive from actual granted
scopes/capabilities. **Do not hard-code misleading checkmarks.**

### 9. Agent permissions are separate from API permissions

This is extremely important. A provider may authorize our application to
perform an action, but the AI agent may still not have permission to
perform it autonomously.

There are therefore TWO layers:

**External Provider Permission** — what Meta/TikTok technically allows
our application to access.

**Agent Action Permission** — what the business allows the AI agent to
do.

Example: WhatsApp API permits sending messages. But tenant configuration
may say: Normal follow-up: `AUTOMATIC`. Marketing broadcast:
`APPROVAL_REQUIRED`. Sensitive customer message: `APPROVAL_REQUIRED`.

The existing MVP modes remain: `AUTOMATIC`, `APPROVAL_REQUIRED`,
`DISABLED`.

### 10. Connection status UX

Integration cards must show meaningful status. Example:

**WhatsApp** — ● Connected · Phone: +256… · AI Responses: ON · Webhooks:
Healthy · Last Event: 3 min ago · `[Settings] [Permissions] [Reconnect]
[Disconnect]`

**Instagram** — ● Connected · Account: @company · Messaging: Enabled ·
Last Sync: 8 min ago

**TikTok** — ● Connected · Ads: Enabled · Lead Capture: Enabled ·
Organic Metrics: Not Enabled · Content Publishing: Not Enabled

**Never show functionality as connected when the relevant provider
capability is unavailable.**

### 11. Token security

All access and refresh tokens must:

- be stored server-side
- be encrypted at rest
- never appear in normal frontend responses
- never be written to logs
- support rotation/refresh
- support revocation
- be tenant-scoped

Do not expose: client secrets, provider secrets, access tokens, refresh
tokens — to browser code.

### 12. Callback security

OAuth/authorization callback handling must include:

- state validation
- CSRF protection
- tenant/workspace context validation
- redirect URI validation
- authorization-code validation
- secure error handling
- audit logging

**Do not trust tenant IDs passed directly from browser parameters
without server-side verification.**

### 13. Integration webhook registration

After successful authorization:

1. Register required supported webhooks.
2. Verify webhook endpoint.
3. Store webhook registration state.
4. Test the integration.
5. Mark the integration connected only when configuration is valid.

Webhook events must continue through the existing normalized connector
architecture. Example:

> WhatsApp message → Meta webhook → WhatsApp adapter → normalized
> Message → Conversation → AI Agent
>
> Instagram message → Meta webhook → Instagram adapter → normalized
> Message → Conversation → AI Agent
>
> TikTok lead event → TikTok webhook → TikTok Lead adapter →
> Contact/Lead → CRM/AI follow-up flow

### 14. Channel capability registry

Create a capability model. Example: `ProviderCapability`

Possible capabilities: `MESSAGING_RECEIVE`, `MESSAGING_SEND`,
`LEAD_CAPTURE`, `ADVERTISING_READ`, `ADVERTISING_WRITE`,
`ORGANIC_ANALYTICS`, `CONTENT_PUBLISH`, `WEBHOOKS`, `ATTRIBUTION`

This allows the platform to know exactly what each integration supports.
**Do not assume every social network behaves like WhatsApp.**

### 15. Self-service connection success condition

A new tenant should be capable of:

```
Create Account
  → Create Workspace
  → Open Integrations
  → Connect WhatsApp / Instagram / TikTok
  → Complete official provider authorization
  → Return to platform
  → Connection verified
  → Permissions shown
  → Supported webhook/API capability enabled
  → AI/CRM workflow can use the channel
```

without requiring SMS Consult to manually configure credentials for that
tenant. **This is an important requirement for making the product
scalable SaaS.**

---

## Part B — Influencer Attribution & AI Performance Intelligence

The Influencer module is also an extension of the same existing MVP. Its
job is to answer:

- Who is good for sales?
- Who is good for publicity?
- Who is good for both?
- Which creators are costing us money without producing enough
  measurable value?

**Do NOT treat views as proof of commercial performance. Do NOT treat
sales alone as proof of publicity impact.**

### 16. Module structure

Add: **Influencers**

Navigation: Influencers → Overview, Creators, Campaigns, Content,
Tracking Links, Performance, Leaderboard, AI Insights

Use the same tenant/workspace. Do not create separate authentication.

### 17. Reuse existing attribution

Extend: `TrafficSession`, `AttributionTouch`, `Campaign`,
`Conversation`, `Lead`, `Opportunity`, `Sale`

with additional attribution source types such as: `PAID_AD`,
`INFLUENCER`, `ORGANIC_SOCIAL`, `SEO`, `REFERRAL`, `DIRECT`

**Do not build a duplicate attribution engine.**

### 18. Reuse CRM flow

Influencer-generated customers use the same existing flow:

> Contact → Conversation → Lead → Qualified → Opportunity → Quotation →
> Won/Lost → Sale → Revenue Attribution

**No influencer-specific CRM.**

### 19. Influencer data model

Add: `Influencer`, `InfluencerIdentity`, `InfluencerCampaignMember`,
`InfluencerContent`, `TrackingLink`, `ReferralClick`, `InfluencerCost`,
`InfluencerMetricSnapshot`, `InfluencerPerformanceScore`

Reuse existing: `Campaign`, `TrafficSession`, `AttributionTouch`,
`Contact`, `Conversation`, `Lead`, `Opportunity`, `Sale`, `Product`,
`Recommendation`, `Approval`, `AuditLog`

### 20. Influencer profile

`Influencer`:

- `tenant_id`
- `name`
- `display_name`
- `email`
- `phone`
- `category`
- `status`
- `notes`
- `default_cost`
- `currency`
- `contract_start`
- `contract_end`

`InfluencerIdentity`:

- `influencer_id`
- `platform`
- `username`
- `profile_url`
- `external_platform_id`
- `follower_count`
- `metadata`
- `last_synced_at`

Platforms: TikTok, Instagram, Facebook, YouTube, X, Other

### 21. Campaigns

Influencer campaigns should support objectives: `AWARENESS`,
`ENGAGEMENT`, `TRAFFIC`, `LEAD_GENERATION`, `SALES`, `MIXED`

Store: campaign name, objective, dates, budget, target revenue, target
reach, target conversations, target leads, target sales, products,
creators

### 22. Content-level tracking

Track: Influencer → Campaign → Platform → Individual Content →
Commercial Outcome

Support: `VIDEO`, `REEL`, `POST`, `STORY`, `SHORT`, `LIVE`, `OTHER`

This allows analysis such as: "Creator A performs better commercially on
Instagram than TikTok." or "Creator B's educational content produces
more sales than comedy content."

### 23. Unique tracking links

Create first-party short URLs. Example: `go.company.com/x7Kd2`

Each link maps to: `tenant`, `influencer`, `campaign`, `content`,
`platform`, `destination`, `referral token`

Possible destinations: WhatsApp, Website, Landing page, Product page,
Lead form, Booking page

### 24. WhatsApp influencer attribution

This must reuse the connected WhatsApp integration created in Part A.

Flow:

> Influencer Content → Tracking Link → WhatsApp → Existing WhatsApp
> Connector → Conversation → AI Agent → Lead → Sale

Generate a referral token. Example: `INF7K2`

Where appropriate use WhatsApp prefilled message:

> `Hello, I'm interested in this offer. Ref: INF7K2`

On message receipt:

1. Detect token.
2. Resolve influencer/campaign/content.
3. Create attribution touch.
4. Attach it to existing conversation/contact.
5. Continue normal AI sales workflow.

### 25. Social metrics

Where supported by official integrations, collect: Views, Reach,
Impressions, Likes, Comments, Shares, Saves, Followers, Engagement,
Completion, Link clicks

Possible metric sources: `API`, `MANUAL`, `CSV_IMPORT`, `ESTIMATED`

**Never fake unavailable values.**

### 26. Commercial metrics

Calculate deterministically: Tracking clicks, Conversation starts,
Click-to-conversation rate, Leads, Qualified leads, Opportunities,
Sales, Revenue, Average order value, Lead-to-sale conversion, Cost per
lead, Cost per qualified lead, Cost per sale, ROAS, ROI

**The LLM does not calculate these.**

### 27. Publicity score

Create deterministic: `Publicity Score 0-100`

Potential inputs: Reach, Views, Impressions, Engagement, Shares, Saves,
Completion rate, Traffic, Cost efficiency

Weightings should be configurable.

### 28. Commercial score

Create deterministic: `Commercial Score 0-100`

Potential inputs: Qualified leads, Lead quality, Opportunities, Sales,
Revenue, Conversion rate, CPA, ROAS

Weightings should be configurable.

### 29. Creator classifications

Derive classifications from deterministic scores: `SALES_DRIVER`,
`PUBLICITY_DRIVER`, `FULL_FUNNEL_PERFORMER`, `ENGAGEMENT_SPECIALIST`,
`EMERGING_PERFORMER`, `UNDERPERFORMER`, `INSUFFICIENT_DATA`

**The AI explains classifications. It does not invent them.**

### 30. AI Influencer Analyst

Create: **AI Influencer Performance Analyst**

It consumes verified analytics and interprets them. It must answer:

- Who is best for sales?
- Who is best for publicity?
- Who is best for both?
- Who generates the best quality leads?
- Who has the strongest ROAS?
- Who has high reach but weak conversion?
- Which creators should be renewed?
- Which creators should receive conversion campaigns?
- Which creators should receive awareness campaigns?
- Which content works best?
- Which platform works best for each creator?

### 31. Daily AI Influencer Report

Use the existing background-job architecture. At configured end-of-day:

1. Aggregate metrics.
2. Calculate publicity scores.
3. Calculate commercial scores.
4. Classify creators.
5. Compare campaign objectives.
6. Send structured data to AI.
7. Generate executive interpretation.
8. Store report.
9. Show dashboard notification.

Example:

> **Influencer Performance — Today**
>
> **Best for Sales** Creator A — Revenue: UGX 18.4M · Sales: 22 · ROAS:
> 9.2× · Commercial Score: 94
>
> **Best for Publicity** Creator B — Views: 640K · Engagement: 52K ·
> Publicity Score: 96
>
> **Best Overall** Creator C — Publicity Score: 89 · Commercial Score:
> 91 · Classification: Full-Funnel Performer
>
> **Needs Review** Creator D — High reach but weak conversation and
> qualification rates.
>
> **AI Interpretation** — Use Creator A for conversion-led campaigns.
> Use Creator B for awareness and brand visibility. Prioritize Creator C
> when both reach and sales are required. Review Creator D's audience
> fit, content and offer.

### 32. Leaderboard

Rank/filter by: Publicity Score, Commercial Score, Overall Score,
Revenue, Sales, ROAS, Qualified Leads, Conversion, CPA, Clicks,
Conversations, Views, Reach, Engagement

Filter by: Campaign, Date, Platform, Product, Objective, Creator category

### 33. Multi-touch attribution

A customer may travel through:

> Influencer TikTok → Website → Meta Retargeting → WhatsApp → Sale

**Preserve all touches.** Support at minimum: First touch, Last touch,
Assisted attribution

**Do not automatically assign 100% of revenue to either influencer or
ad.**

### 34. AI recommendations

Support: `SCALE`, `RENEW`, `MAINTAIN`, `USE_FOR_SALES`,
`USE_FOR_PUBLICITY`, `USE_FOR_FULL_FUNNEL`, `TEST_DIFFERENT_CONTENT`,
`CHANGE_OFFER`, `REDUCE_ALLOCATION`, `PAUSE`, `DO_NOT_RENEW`,
`INSUFFICIENT_DATA`

Recommendations need: finding, evidence, recommendation, confidence,
risk, status, date

**Reuse the existing Recommendation/Approval architecture.**

### 35. Future marketing investment intelligence

Prepare architecture so the platform can ultimately compare: Influencers,
Meta Ads, Google Ads, TikTok Ads, Organic social, SEO, Referral

against: Leads, Qualified leads, Sales, Revenue, CPA, ROAS, ROI

The ultimate management question is:

> **Where should the company put its next marketing shilling to
> generate the greatest business value?**

The AI should eventually support evidence-based marketing allocation
recommendations. **Any actual budget change remains subject to the
existing approval system.**

---

## Feature flags

These additions must not destabilize the existing MVP. Use flags such
as:

- `SELF_SERVICE_SOCIAL_INTEGRATIONS_ENABLED`
- `INFLUENCER_INTELLIGENCE_ENABLED`

If full implementation would delay the core MVP:

1. Build migration-safe models.
2. Build connector interfaces.
3. Build authorization framework.
4. Add feature-flagged routes/navigation.
5. Prepare APIs.
6. Document remaining work.
7. Preserve current MVP functionality.

## Existing MVP success condition remains primary

Do not replace the original success condition. The platform must still
demonstrate:

> Advertisement → Conversation → AI Qualification → Product
> Recommendation → Lead → CRM Action → Follow-up → Sale → Revenue
> Attribution → Advertising Analysis → AI Recommendation → Human Approval

and:

> Website → Embedded Widget → AI Sales Agent → Back-office Inbox

The new future paths become:

**Social Self-Onboarding:**

> Tenant → Connect WhatsApp/Instagram/TikTok → Official Authorization →
> Verified Integration → AI/CRM Workflow

**Influencer Intelligence:**

> Influencer Content → Tracking Link → Conversation → AI Qualification
> → Lead → Opportunity → Sale → Revenue Attribution → Publicity vs Sales
> Classification → AI Recommendation

## Most important AI rule

**The platform calculates. The AI interprets.**

The LLM must never fabricate or calculate authoritative values for:
Revenue, Sales, ROI, ROAS, CPA, Conversion rate, Lead count, Publicity
score, Commercial score, Integration status, Granted permissions

Backend services calculate or retrieve verified values. The AI then
explains: what happened, why it matters, which influencer is strong for
which objective, which channel is producing revenue, what management
should consider doing next.

## Final product principle

We are not building: a chatbot · a social inbox only · an influencer
dashboard only · a CRM clone

We are building an: **Agentic Revenue Operations SaaS Platform**

It should progressively connect:

> Acquisition → Conversation → Intelligence → Action → CRM → Follow-up
> → Sale → Attribution → Marketing Intelligence → Management
> Recommendation

The platform must eventually understand revenue generated through: Paid
ads, Organic social, Influencers, Website, WhatsApp, Instagram, TikTok,
SEO, Referrals

and explain which sources, creators, campaigns and channels produce real
business value.

**All new capabilities must remain integrated into the existing MVP
architecture rather than creating isolated systems.**
