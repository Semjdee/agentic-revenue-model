# Build Notes — tools, decisions, and challenges

This is the running log for the team on how this MVP was actually built,
what deviates from the original spec and why, what's real vs. mocked, and
what to look at first if something looks wrong. Read this before reading
code.

> **Picking this up to build the next phase?** Go to
> [`HANDOFF.md`](./HANDOFF.md) — this document is context on the MVP
> that already exists. **As of 2026-08-19, the actual next task is
> [`docs/ONBOARDING_SPEC.md`](./docs/ONBOARDING_SPEC.md) /
> [`docs/ONBOARDING_TASKS.md`](./docs/ONBOARDING_TASKS.md)** (zero-to-live
> self-onboarding — re-prioritized above the previously-planned
> [`docs/PHASE_2_EXTENSIONS_SPEC.md`](./docs/PHASE_2_EXTENSIONS_SPEC.md),
> which is not cancelled, just now lower priority — see `HANDOFF.md`),
> which supersedes the small backlog in section 10 below in priority.

## 1. Where to find the thing you specifically asked about

The **Knowledge Base "Add Knowledge" dialog box** — where a business owner
types in their own business info for the AI agent to learn from — lives at
`/knowledge` → **"Add Knowledge"** button → opens a modal dialog
(`AddKnowledgeDialog` component inside
`src/app/(app)/knowledge/page.tsx`, built on the shared Radix Dialog
wrapper in `src/components/ui/dialog.tsx`). You type a title + free-text
content (or pick a source type: manual, FAQ, PDF/document placeholder,
website placeholder), it's chunked and indexed server-side
(`src/modules/knowledge/service.ts`), and from that point on the AI Sales
Agent's replies are grounded in it — it will quote from what you wrote
instead of guessing. This directly backs spec section 8 (Knowledge Base /
RAG) and section 5's "never fabricate" rule.

## 2. Tech stack actually used, and why it differs from the spec's suggestion

| Layer | Spec suggested | Used | Why |
|---|---|---|---|
| Frontend | Next.js/TypeScript/Tailwind | Same | No change |
| Backend | NestJS or modular Node | Next.js API route handlers (modular monolith) | Keeps one deployable app instead of two services for an MVP; every route lives under `src/app/api/**` and is organized the same way a NestJS module tree would be (see `src/modules/**`) |
| Database | PostgreSQL | Same | No change |
| ORM | Prisma | **Drizzle ORM + `pg`** | Prisma's engine binary CDN (`binaries.prisma.sh`) returned `403 Forbidden` from this build environment's network allowlist — confirmed with `curl -sI`, while npm and GitHub were reachable. Prisma cannot install without that binary. Drizzle is pure JS/TS with no native binary download, so it was a drop-in replacement with no loss of type safety or schema expressiveness. All 34 tables, relations, and enums translate directly; see `src/db/schema.ts`. If you're deploying somewhere Prisma's CDN *is* reachable, porting back is straightforward — the schema is well isolated. |
| Queue | BullMQ + Redis | Same | No change |
| Realtime | WebSockets | **Polling (4-5s intervals) on Inbox/dashboard** | Next.js route handlers are effectively serverless-style request/response; a persistent WebSocket server needs a separate long-running process outside the request lifecycle. Documented simplification — swap-in point is `src/app/(app)/inbox/page.tsx` and `src/app/(app)/dashboard/page.tsx`, where the polling `setInterval` calls would become socket event handlers. |
| RAG retrieval | pgvector + embeddings | **Lexical/keyword chunk-overlap scoring** | pgvector extension availability inside this sandbox's Postgres wasn't guaranteed, and no embeddings API was configured by default (embeddings would require an API key/service). Built a real chunking + keyword-overlap retrieval pipeline (`src/modules/knowledge/service.ts`) that is functionally correct today and swappable: the retrieval function's signature (`retrieveRelevantKnowledge(tenantId, query, limit)`) is exactly what a pgvector-backed version would keep, only the scoring internals change. |

Nothing else deviates architecturally from the spec's recommended stack.

## 3. AI provider abstraction

`src/modules/ai/` defines an `AIProvider` interface
(`generateReply(ctx): Promise<AIReplyResult>`) with two implementations:

- **`MockAIProvider`** (default, no API key needed) — deterministic,
  rule-based: slot-fills the agent's qualification questions, does
  keyword-overlap product matching against your real catalogue, detects
  discount requests / requests for a human via pattern matching, and
  **never invents a price, stock level, warranty, or delivery time** — if
  it can't find the answer in Products or Knowledge, it escalates instead
  of guessing (spec section 5's hard requirement). This is what makes the
  whole platform demoable with zero external dependencies.
- **`AnthropicProvider`** — a real LLM-backed provider, activated
  automatically the moment `ANTHROPIC_API_KEY` is set in `.env`. Calls
  `https://api.anthropic.com/v1/messages` directly with a system prompt
  built from the agent's configuration, product catalogue, and retrieved
  knowledge snippets.

Neither the conversation engine nor any API route talks to a provider
directly — they go through `getAIProvider()`
(`src/modules/ai/index.ts`), so a third provider (OpenAI, local model,
etc.) is a new class + one line in that factory, not a rewrite.

## 4. The controlled tool/action system

The language model — mock or real — never touches the database. It
returns `ToolCall { action, parameters }` objects, and
`executeToolCalls()` (`src/modules/ai/actions.ts`) is the only thing that
turns a tool call into a write. Every action type is classified
`AUTOMATIC`, `APPROVAL_REQUIRED`, or `DISABLED` in `ACTION_PERMISSIONS`.
Approval-required actions (like `offer_discount`) create a row in
`approvals` instead of executing, surfaced at `/settings` → Approvals tab.
Every attempt — executed, pending, or rejected — is logged to
`agent_actions`, and every actual write additionally lands in the central
`audit_logs` table via `logAudit()`. This is the mechanism spec section 6
calls for, and it's what stops the AI from, say, approving its own
discount or silently changing an opportunity's value.

## 5. What's real vs. mocked (spec section 37 compliance)

Per the spec's explicit instruction to **never fake a completed
integration**, every third-party connector is a fully-built abstraction
with a clearly labelled DEMO/MOCK implementation, not a stub that pretends
to succeed:

- **CRM connectors** (`src/integrations/crm/`) — `CRMConnector` interface
  covers contacts/leads/opportunities/tasks/webhooks. `MockCRMConnector`
  implements the full interface against an in-memory store and tags every
  response `isMock: true`. Real connectors (HubSpot, Kommo, Salesforce,
  Zoho, Odoo) would be added behind the same interface in
  `getCRMConnector(provider)` once real API credentials exist — no
  redesign needed.
- **Advertising connectors** (`src/integrations/advertising/`) — same
  pattern for Google/Meta Ads. `MockAdsConnector.updateBudget()` is what
  actually gets called when a human approves an AI budget recommendation
  (`/api/internal/advertising/recommendations/[id]/route.ts`) — the
  approval-gating logic runs for real, only the outbound API call to
  Google/Meta is mocked.
- **Ad performance data** — 21 days of believable, clearly-seeded metrics
  (spend/impressions/clicks) per campaign, generated by `scripts/seed.ts`
  and tagged via `adAccounts.isMock = true`. Conversions/leads/sales/
  revenue attributed to those campaigns, however, are **not** mocked —
  see the next section.

If you connect real credentials via `.env` (see `.env.example`), nothing
in the application layer needs to change; only `getCRMConnector`/
`getAdsConnector` need a new class registered.

## 6. Attribution & the AI Advertising Analyst — a deliberate fix mid-build

Spec section 13 is explicit: advertising ROI must be computed from **your
own CRM/sales data**, not the ad platform's self-reported conversion
numbers (platforms are well known to over-report). The first draft of
`computeCampaignPerformance()` summed the seeded `ad_metric_snapshots`
table's own `revenue`/`sales`/`leads` columns — which technically ran, but
violated that requirement and would have silently drifted from whatever
the real `sales` table said. It was rewritten so **spend/impressions/
clicks** still come from the ad snapshots (that's genuinely platform-
reported data), but **conversations/leads/qualified leads/sales/revenue**
are derived live from `conversations.utmCampaign` matches and
`attribution_touches` joins back to the real `sales` table. This also
required renaming the seeded campaigns to plain, exact-match names
("Residential Solar Campaign" etc.) since the join is a string match —
worth knowing if you add new campaigns and wonder why attribution isn't
picking them up.

The **AI Advertising Analyst** (`src/modules/advertising/analyst.ts`)
generates recommendations (increase/reduce budget, review targeting,
change offer/creative) from that real performance data, but — per spec
section 15 — **never applies a budget change itself**. Every budget-
impacting recommendation sits in `PENDING` until a human approves it in
the Advertising tab; only then does `getAdsConnector().updateBudget()`
get called, and that approval is written to the audit log.

## 7. End-to-end validation

`scripts/demo-journey.ts` runs the exact scenario from spec section 31 —
Facebook ad click → widget conversation → AI qualification → product
recommendation → lead → CRM opportunity → follow-up scheduled →
opportunity WON → sale recorded (UGX 18,000,000) → attribution engine →
AI Advertising Analyst recommendation → human approval — directly against
the real application modules (not mocked HTTP calls), so it exercises the
actual code paths the UI uses. Building this script caught two real bugs
before they could ship silently broken:

- **Wrong product recommendation.** `scoreProduct()`'s keyword filter
  dropped words of length ≤ 2, which excluded the digit "4" — the exact
  token that distinguishes "for a 4+ bedroom home" (5kW system) from "2-3
  bedroom" (3kW system). The AI was recommending the wrong system size.
  Fixed to keep any token containing a digit regardless of length
  (`src/modules/ai/mock-provider.ts`).
- **Attribution/ROAS data-sourcing bug** — covered in section 6 above;
  found because the demo journey's real sale wasn't moving the numbers the
  dashboard showed.

Run `npm run seed && npm run demo-journey` any time you want to confirm
the whole loop still works after a change.

## 8. Multi-tenancy & security

- Every table carries `tenantId`; every internal route resolves tenant
  from the **signed session**, never from client-supplied input, and
  filters every query by it (`src/lib/api.ts` → `requireTenantSession()`).
- 8-role RBAC (OWNER/ADMIN/MANAGER/SALES/MARKETING/AGENT/VIEWER/DEVELOPER)
  enforced through a static permission matrix (`src/lib/permissions.ts`),
  checked both server-side on every route and client-side to hide nav
  items the current role can't use.
- Session cookies are httpOnly JWTs; `requireSession()` re-validates the
  user still exists, is active, and still belongs to that tenant on every
  request (defense in depth against a JWT outliving a deactivated user).
- Integration credentials (CRM/ads API keys) are encrypted at rest with
  AES-256-GCM before being stored (`src/lib/crypto.ts`) — never logged in
  plaintext anywhere, including error paths.
- Public API keys (`/api/v1/*`) are stored hashed, never in plaintext;
  `requireApiKey()` compares a hash of the provided secret.
- Every AI action and every manual data mutation writes to `audit_logs`.

## 9. Errors hit during the build and how they were resolved

| Problem | Fix |
|---|---|
| Prisma engine binaries blocked by network allowlist | Switched ORM to Drizzle (section 2) |
| `zod` `z.record(z.string())` — v4 requires 2 args | `z.record(z.string(), z.string())` |
| BullMQ v6 rejects inline `.add(name, data, {repeat})` | Switched to `upsertJobScheduler()` (`src/modules/followups/queue.ts`) |
| `Set<string>` iteration TS error | `tsconfig.json` had no `target`, defaulting to ES3 — added `"target": "ES2020"` and cleared the stale `.tsbuildinfo` cache |
| Recharts `Tooltip formatter` type mismatch | Formatter coerced to `(v: unknown) => fmtUGX(Number(Array.isArray(v) ? v[0] : v ?? 0))` |
| Wrong product recommendation in demo journey | Digit-token filter bug, see section 7 |
| Campaign performance conflated with ad-platform self-reported numbers | Rewritten to source from real CRM/sales data, see section 6 |
| ESLint blocking `npm run build` (unused vars, unescaped apostrophes, missing hook deps) | Cleaned up dead code (`pickUnansweredName` stub was never wired in and removed), escaped literal apostrophes with `&apos;`, and added justified `eslint-disable-next-line` comments where a hook intentionally runs once regardless of a technically-changing reference (documented inline at each site) |

## 9b. Operational hardening pass (post-MVP fixes)

A second pass focused specifically on production-readiness gaps, prompted
by a team review of this document:

- **Rate limiting moved from in-memory to Redis.** `rateLimit()`
  (`src/lib/api.ts`) was a plain per-process `Map` — accurate for a single
  instance, but with N instances behind a load balancer a client could get
  `limit × N` requests through per window, since each process counted
  independently with no shared state. It now runs an atomic `INCR` +
  `PEXPIRE` Lua script against the same Redis connection BullMQ already
  holds open (`redisConnection`, exported from
  `src/modules/followups/queue.ts`) — no new infrastructure, and every
  instance now shares one accurate counter. It fails **open** (allows the
  request, logs a warning) if Redis itself is unreachable, so a rate-limiter
  outage can't take down the API. This is still a fixed-window limiter, not
  a sliding window/token bucket, so a small burst right at a window
  boundary is possible — acceptable at this traffic level, worth revisiting
  with `rate-limiter-flexible` if it becomes a problem. The function is now
  `async`; its 3 call sites were updated to `await` it.
- **Every `/api/v1/*` route now rate-limits, not just `/contacts`.**
  Auditing the public API gateway found that 11 of the 12 route files had
  `requireApiKey()` auth but no rate limiting at all — an authenticated
  key had literally unlimited request volume. All now call
  `rateLimit(\`v1-${auth.apiKeyId}\`, 120, 60_000)` right after the auth
  check, matching the pattern the `contacts` route already used.
- **Fixed a real duplicate-message bug in the widget**, found while taking
  the preview screenshots below (not a hypothetical — it reproduced on the
  very first try). `renderMessages()` in `public/widget.js` dedupes by
  message `id`, but the optimistic "customer just typed this" bubble was
  given a synthetic id (`"local_" + Date.now()`) that never matches the
  real id Postgres assigns once the message is actually persisted. When
  the `POST .../messages` response came back with the full, authoritative
  message list, the real row looked like a *new* message (different id),
  so the customer's own message rendered twice. Fixed by tracking each
  optimistic bubble's DOM node and removing it the moment the server's
  authoritative list is about to render in its place (`clearOptimistic()`
  in `public/widget.js`) — verified with a before/after screenshot; see
  section 12.

## 9c. Dev-only login bypass (2026-08-19)

Added at explicit request, purely for local demo convenience — clicking
through `/login` on every fresh session is friction during a walkthrough.
**Off by default; do not enable outside local dev.**

Set `DISABLE_AUTH="true"` in `.env` and every request is treated as already
authenticated as `DISABLE_AUTH_EMAIL` (default `owner@raygrid.demo` — the
seeded RayGrid owner). Implemented as a single chokepoint in `getSession()`
(`src/lib/auth.ts`), since every internal route and the `(app)` layout
already goes through it — no second auth path was introduced.

Two independent gates, both must hold before it does anything:

1. `DISABLE_AUTH` must be the literal string `"true"`.
2. `NODE_ENV` must **not** be `"production"` — Next.js sets this
   automatically for `npm run build`/`npm start` regardless of `.env`
   content, so this can't accidentally go live even if `DISABLE_AUTH="true"`
   ends up in a deployed environment's config by mistake.

It also never fabricates a session: it looks up `DISABLE_AUTH_EMAIL` as a
real, active row in `users` and returns null (falls back to requiring real
login) if that user doesn't exist — consistent with this codebase's "never
fake" discipline elsewhere. Logs a loud one-time `console.warn` the first
time it activates, so it's never silently on. Documented in `.env.example`.

## 9d. Priority pivot to zero-to-live self-onboarding (2026-08-19)

The product owner re-prioritized development the same day as the Phase 2
handoff was written. `docs/ONBOARDING_SPEC.md` (a self-service onboarding
wizard — signup → business profile → knowledge import → channel connect
→ AI agent auto-config → test → health check → Go Live, with zero SMS
Consult staff involvement) is now the top priority, broken into
milestones in `docs/ONBOARDING_TASKS.md`. Phase 2
(`docs/PHASE_2_EXTENSIONS_SPEC.md` / `docs/PHASE_2_TASKS.md`) is not
cancelled, just now P2 priority — see `docs/ONBOARDING_SPEC.md` section
37 for the full priority ordering. `HANDOFF.md` was updated to point
fresh sessions at the onboarding docs first. Not yet started as of this
entry — see `docs/ONBOARDING_TASKS.md` Milestone 0/1 for where to begin.

## 9e. Zero-to-live self-onboarding — complete (2026-08-19)

All 12 milestones in `docs/ONBOARDING_TASKS.md` (M0–M11) are done,
covering every P0 item in `docs/ONBOARDING_SPEC.md` section 37. The full
loop — `NEW BUSINESS → SELF SIGNUP → BUSINESS SETUP → KNOWLEDGE IMPORT →
SELF-CONNECT CHANNEL → AI AGENT GENERATED → TEST → HEALTH CHECK → GO LIVE
→ FIRST REAL CONVERSATION` (spec section 38) — was exercised end-to-end
against a real running server (not just `tsc`/mocked tests): a test
tenant registered, filled in a business profile, added a product,
generated a guided AI agent (created `DRAFT`, byte-identical `agents`
table row to a manually-created one), connected WhatsApp via a real
staged OAuth-shaped mock connector (state/CSRF validated — a wrong state
is genuinely rejected, not waved through), passed a genuine health check,
and went live — flipping the agent `DRAFT → ACTIVE`, which is the exact
same field `startConversation()`/`startChannelConversation()`/the public
widget route already gate on, so no new enforcement code was needed for
"live" to mean something real. A simulated inbound WhatsApp message to
RayGrid's seeded tenant produced a genuine AI reply from Amara, a real
contact, and a real lead — proving the WhatsApp adapter reuses the exact
same `handleCustomerMessage()` the widget uses, per spec section 13.

Two deliberate scope decisions, documented in `docs/ONBOARDING_TASKS.md`:

- **WhatsApp self-connect (M8)** extends the existing `integrations` /
  `integrationCredentials` tables (new OAuth fields: `scopes`,
  `webhookStatus`, `externalAccountId`, etc.) rather than adding a
  parallel `integration_connections` table — this already was the
  "Integration Hub" `docs/PHASE_2_EXTENSIONS_SPEC.md` section 5
  describes. Only WhatsApp got the full staged connector pipeline
  (`getAuthorizationUrl → handleCallback → exchangeAuthorizationCode →
  registerWebhooks → testConnection`, only reaching `CONNECTED` if every
  stage succeeds); the other providers on the general `/integrations`
  page keep their pre-existing one-click mock-connect, since they're
  outside this priority's P0 scope.
- **TTFV/funnel analytics (M10)** shipped tenant-scoped (a new
  "Activation" tab on `/settings`), not the spec's literal cross-tenant
  admin dashboard — this codebase has no "platform staff" auth concept
  distinct from the existing per-tenant roles in `src/lib/permissions.ts`,
  and building cross-tenant data access without that designed first would
  be a real security shortcut, not a productive one. Flagged in
  `docs/ONBOARDING_TASKS.md` backlog.

Two pre-existing bugs found (not introduced by this work, not yet fixed,
worth picking up separately):

- `lead.source` is hardcoded to `"website"` in
  `src/modules/ai/actions.ts`'s `create_lead` handler regardless of the
  conversation's actual channel — a WhatsApp-originated lead still shows
  `source: "website"`.
- The `/followups` page and the dashboard's "Overdue follow-ups" count
  can disagree (dashboard showed 3, the Follow-ups page showed
  Overdue 0 / Upcoming 1 for the same data) — looks like the two views
  compute "overdue" differently; not investigated further.

Everything above was verified with the regression gate (`npm run build`,
`npm run demo-journey`) clean after every milestone, per this project's
established discipline — see individual commit messages for the specific
verification each milestone got. Next up per spec section 37's priority
order: P1 (Instagram self-connect, CRM connector onboarding, Google Ads
self-connect + attribution, billing/subscription self-service).

## 9f. AI usage credits & margin protection (2026-08-19)

Every AI reply costs real Anthropic API money; this is the metering and
enforcement layer that makes that sustainable, confirmed with the product
owner: **free tier = 1,000 credits, paid tier = 2,500 credits for $20**.

**The real numbers this is built on** (Anthropic's current rate card,
checked 2026-08-19 — not the temporary Sonnet 5 intro pricing, which
expires 2026-08-31 and would have made the margin math stale within
days): Sonnet 5 is $3/$15 per million input/output tokens, Haiku 4.5 is
$1/$5. A typical sales-agent turn in this app runs ~2,000 input / ~250
output tokens. Routing every reply through Sonnet 5 at this platform's
$0.008/credit revenue would run at break-even-to-negative margin before
infrastructure costs are even counted — so this **is not** "1 credit = 1
reply":

- **Model routing** (`src/modules/billing/model-router.ts`) — Haiku 4.5
  handles routine turns by default; a deterministic, zero-extra-cost
  heuristic (lead score ≥60, price-negotiation/complaint keywords, or a
  match against the agent's own plain-English escalation rules) routes
  to Sonnet 5 for the turns where quality genuinely matters more than
  the ~5x cost difference. Verified with 5 hand-checked cases, all pass.
- **Credit pricing** (`src/modules/billing/pricing.ts`) — credits are
  charged from the *real dollar cost* of each call (`computeApiCostUsd`,
  using actual token counts including cache read/write), not a flat
  per-reply charge, converted via a fixed `$/credit` ceiling
  (`MAX_COST_USD_PER_CREDIT = $0.0024`, derived from a 70% target gross
  margin on AI usage at the stated $0.008/credit price) — verified this
  produces 75%+ realized margin across cached/uncached and Haiku/Sonnet
  scenarios (rounding a call up to at least 1 credit means margin can
  only run *above* target, never below — the safe direction to be
  wrong in).
- **Prompt caching** — `src/modules/ai/anthropic-provider.ts` now marks
  the system prompt (agent instructions + product catalog + knowledge,
  identical across every turn of a conversation) with `cache_control`,
  a real cost reduction this margin math assumes is on. Also fixed:
  the model was hardcoded to the retired `claude-sonnet-4-5`; now
  defaults to `claude-haiku-4-5` and accepts a per-call override.
- **Enforcement** (`src/modules/billing/ledger.ts`, wired into
  `src/modules/conversations/engine.ts` and `src/modules/ai/sandbox.ts`)
  — every real AI call is gated by `checkCredits()` before it runs and
  metered by `chargeUsage()` after. A tenant at 0 credits doesn't get a
  silent failure or an error page: the conversation hands off to a human
  gracefully ("let me get one of our team to help you"), `aiActive`
  flips off, and a real task is created. Sandbox/test-agent calls are
  metered identically — they hit the same real provider and cost the
  same real money, so a testing loophole would have been a margin hole.
  Verified live: zeroing a tenant's balance and sending a real widget
  message produced the exact graceful handoff, not a crash; the balance
  and ledger were untouched by MockAIProvider replies (genuinely free,
  not silently charged).
- **Visibility** — a new "Credits & Usage" tab on `/settings` shows the
  real balance, a low-balance warning, and the actual ledger (every
  grant/consumption row, with model + tokens + cost for consumption).
  Verified via a real browser click-through.
- **No fake payment collection.** A "Buy 2,500 credits — $20" button
  exists and is real — but it does **not** grant credits, since no
  payment processor is connected yet (billing/subscription self-service
  is still open P1 backlog). Clicking it records a real, auditable
  top-up request (`billing.topup_requested` in `audit_logs`) and tells
  the user honestly that payment collection isn't wired yet — crediting
  an account as if $20 had been paid when it hadn't would be
  fabricating a financial transaction, a different class of problem
  than a labelled DEMO/MOCK connector.

Every tenant now gets the free-tier grant automatically: wired into both
`POST /api/internal/auth/register` and `scripts/seed.ts`.

## 9g. Tenant credit reserve, max-drawdown & usage forecasting — **Special AI Notes** (2026-08-21)

Requested directly: "we dont want tenants buying separate credit for each
ai agent," a reserve so "key day to day features that need ai [keep]
working," and a way to "know exactly how much will each tenant use... for
daily and recurring tasks." No prior product-owner discussion of this
existed in the repo to build from, so this section is exactly what it's
labelled — **an AI-proposed default policy, not a business decision
confirmed with a human**, unlike the credit-pricing constants in §9f
above. Chosen from real research (common SaaS quota/reserve patterns —
cloud cost-budget systems commonly hold back 10-30% of a budget for
critical workloads; rate-limiting systems commonly cap bursts at 2-5x a
steady-state share) applied to this platform's own real cost structure.
**Revisit every threshold below once real tenant usage data exists to see
whether it binds too early, too late, or about right** — that's the one
piece of homework this note can't do for you.

**Finding #1 — the "separate credit per agent" problem doesn't exist.**
`credit_balances`/`credit_ledger` (§9f) are keyed by `tenant_id` only —
there is no `agent_id` column anywhere in the billing schema, and there
never has been. A tenant with five AI agents across three widgets already
draws every one of them from the exact same shared pool; nothing needed
to be built for this part of the ask, only confirmed. What *was* missing:
nothing stopped one low-value use of that shared pool (a tenant testing
prompts repeatedly in the agent builder) from draining it to zero and
taking real, revenue-critical customer conversations down with it — that
gap is what the rest of this note fixes.

**The model: three tiers, a reserve floor, and a daily burst cap**
(`src/modules/billing/reserve-policy.ts`). Every AI trigger type
(`AGENT_RUN_TRIGGERS` in `src/db/schema.ts`) is classified once:

| Trigger | Tier | Why |
|---|---|---|
| `INBOUND_MESSAGE` | **ESSENTIAL** | A real customer is on the other end of this conversation right now. |
| `FOLLOWUP` | **SEMI_ESSENTIAL** | Automated and revenue-relevant, but not a live customer. Not wired to a real AI call yet — the follow-up engine (`src/modules/followups/processor.ts`) currently sends template text, not AI-generated messages — classified now so the policy is ready the day that changes. |
| `SANDBOX_TEST` | **DISCRETIONARY** | Internal agent-builder testing. Never customer-facing — the safest thing to pause first. |

- **Reserve** — `RESERVE_PCT = 20%` of the tenant's monthly credit
  allotment is held back exclusively for ESSENTIAL usage. Once the
  balance drops at or below that line, DISCRETIONARY calls are refused
  with a clear reason (`reserve_protected`); SEMI_ESSENTIAL gets a
  smaller `SEMI_ESSENTIAL_BUFFER_PCT = 10%` buffer, pausing sooner than
  the hard floor but later than pure testing. **ESSENTIAL is never
  gated by the reserve** — refused only when the tenant is genuinely at
  or below zero credits, which is the exact, unchanged behavior the
  platform already had before this note (§9f's original `checkCredits()`
  is now the ESSENTIAL-tier case inside the new
  `checkCreditsForTrigger()`, not a new restriction).
- **Max drawdown** — even above the reserve line, a single day's
  DISCRETIONARY usage is capped at `DISCRETIONARY_DAILY_BURST_MULTIPLIER
  = 2x` its fair daily share of the monthly allotment (`monthlyAllotment
  / 30 × 2`); SEMI_ESSENTIAL gets a larger `4x` allowance. This is the
  literal "max draw down" from the request: it protects the *rest of the
  month's* runway from one unusually heavy day, independent of the
  reserve check.
- **The monthly reference figure** (`resolveMonthlyAllotment()`) a
  tenant's percentages are computed against is `creditBalances.plan ===
  "PAID" ? PAID_TOPUP_CREDITS : FREE_TIER_GRANT_CREDITS` by default —
  i.e. 2,500 or 1,000 — unless a platform admin sets an explicit
  `credit_balances.monthly_allotment` for a tenant with an unusual
  pattern (e.g. an enterprise deal). This is **not** a hard monthly
  reset — the balance stays the running total it always was (§9f) — the
  allotment is purely the denominator these percentages divide against.

**Usage forecasting** (`src/modules/billing/forecast.ts`) answers "how
much will this tenant use" from real trailing consumption, never a
plan-based guess:
- `predictTenantUsage()` — trailing 7-day and 30-day average daily
  credit consumption (from real `credit_ledger` CONSUMPTION rows,
  averaged over elapsed calendar days, not just days with activity — a
  quiet Sunday is a real zero). Prefers the 30-day window once at least
  14 days of real history exist (smooths a single unusual week); a
  tenant with under 2 days of any usage gets an honest **"not enough
  data yet"**, never a number extrapolated from one data point. Also
  returns days-of-runway, a breakdown by trigger type, and a breakdown
  by individual agent.
- `computeAgentCostBreakdown()` — real per-agent cost from
  `agent_runs.estimatedCostUsd` (despite the column name, this is the
  REAL post-call cost, not an estimate — see `execution-gateway.ts`),
  aggregated by `agentId`. This is the concrete "per-agent cost
  breakdown" now on the platform-admin Analytics page and the tenant's
  own Settings → Credits & Usage.
- `computePlatformTenantForecastSummary()` — a lighter, one-query,
  7-day-only version across every tenant at once, for the platform
  dashboard's "which tenants are trending over their monthly pace"
  table, deliberately separate from the fuller per-tenant function to
  keep a cross-tenant page fast.

**A real accuracy bug caught by this work's own verification, fixed
before shipping:** the first version of the per-agent/per-trigger
breakdown applied `computeCreditsCharged()`'s standard "always at least 1
credit" rounding (correct at actual charge time — see §9f — a call cheap
enough to round to 0 would otherwise be free forever) to *every*
`agent_run`, including ones from `MockAIProvider`, which costs genuinely
$0 and never calls `chargeUsage()` at all. That silently reported "1
credit" for runs that never touched the tenant's real balance — exactly
the kind of fabricated number this platform's own honesty discipline
exists to prevent. Fixed with a reporting-only variant,
`approxCreditsFromCost()` (`pricing.ts`), that reports 0 for a
genuinely-$0 run instead of flooring it — verified live before and after
the fix against the seeded tenant's mostly-mock-provider run history.

**Where this shows up:**
- Tenant-facing: Settings → Credits & Usage gets a new "Usage forecast &
  reserve" card (avg/day, projected monthly, days of runway, the reserve
  line, and cost-by-agent) — `GET /api/internal/billing/forecast`.
- Platform-admin: a new `/platform/analytics` page (separate from the
  basic `/platform/dashboard` KPIs — these are heavier cross-tenant
  queries answering a different question) with a per-agent cost
  leaderboard across every tenant, a per-tenant "on pace / over pace"
  usage-forecast table, and cohort retention (see below) —
  `GET /api/platform/analytics`.
- `runSandboxMessage()` (agent-builder testing) now surfaces the specific
  blocked reason (`OUT_OF_CREDITS` vs. `CREDITS_RESERVED`) instead of one
  generic "out of credits" message, so a tenant paused by the reserve
  understands *why* — and that their live customer conversations are
  unaffected.

**Cohort retention** (`src/modules/platform/cohorts.ts`, the other half
of "deep platform-admin analytics beyond the basic dashboard," alongside
per-agent cost above) — groups tenants by signup month, and for each
month-offset since signup reports the real % of that cohort with at
least one conversation in that offset month (the same "activity" bar
`activeTenants30d` on the basic dashboard already uses). A month-offset
that hasn't happened yet for a given cohort is reported as `null`, not
`0%` — "no data yet" and "churned" are different facts this doesn't
blur.

**Verified live** against the real database: forced a tenant's balance
into the reserve zone and confirmed `SANDBOX_TEST` was refused
(`reserve_protected`) while `INBOUND_MESSAGE` stayed allowed; forced the
balance to exactly zero and confirmed `INBOUND_MESSAGE` is the *only*
case that then refuses (`balance_exhausted`); ran the forecast, per-agent
breakdown, and cohort computations end to end and inspected the real
output (including catching and fixing the rounding bug above); confirmed
both new pages live in a real logged-in browser session
(`/settings` → Credits & Usage, `/platform/analytics`). `npm run build`,
`npm run demo-journey`, and `npm run demo-journey-phase2` all clean
afterward.

## 9h. Follow-up templates — tenant-owned, not AI-generated (2026-08-21)

Audit request: does the follow-up engine have user-configurable workflow
templates a tenant can set up themselves, deployed automatically on the
follow-up due date, so routine re-engagement doesn't depend on an AI call
succeeding? Answer at the time of asking: the scheduling/sending engine
was real (§ below, unchanged), but what it sent was two message strings
**hardcoded directly in `processor.ts`** — no template storage, no UI, no
way for a tenant to change a word of it. `opportunities.follow_up_channel`
and `follow_up_owner` were dead columns, never read or written anywhere.
This entry is what replaced the hardcoded strings with a real,
tenant-owned template library.

**Scope decision** (asked directly, user chose): build the template
library as a complete, real feature now; design the data model so a
later full multi-step workflow builder (arbitrary step count, reordering,
per-step channel, branch conditions) is a pure addition, not a migration.

- **Schema** — `follow_up_templates` (tenant-owned name + message body,
  supports `{{variables}}`), `follow_up_sequences` (a named, ordered
  container — every tenant gets exactly one auto-created "Default
  sequence"), `follow_up_sequence_steps` (ordered steps, each pointing at
  a template with its own `delayHours`), and
  `opportunities.follow_up_sequence_id` (nullable — null means "use my
  tenant's default sequence"). A step's `templateId` is `onDelete:
  "restrict"` — deleting a template still in use by a step is blocked at
  the DB level, backed by a friendlier pre-check at the API layer.
- **`modules/followups/templates.ts`** —
  `ensureDefaultFollowUpSequence()` auto-creates a tenant's default
  sequence + its 2 starter templates the first time anything asks for
  it, reproducing the OLD hardcoded wording and 48h cadence exactly —
  an untouched tenant's behavior doesn't change the moment this ships.
  `renderFollowUpTemplate()` does `{{variable}}` interpolation
  (`contact_name`, `objective`, `product`, `business_name`) with a
  natural-reading fallback for a missing value (never leaves a raw
  `{{var}}` in a sent message). `resolveStepForAttempt()` clamps to the
  sequence's last step once attempts exceed its step count — the same
  "any attempt after the first repeats message 2" behavior the old code
  had, generalized to N steps.
- **`processor.ts`** — the hardcoded ternary is gone. Each due follow-up
  now resolves the opportunity's sequence (or the tenant's default),
  picks the step for the current attempt number, and renders its
  template with real contact/opportunity/tenant data. The reschedule
  interval is now that step's own `delayHours`, not the old flat
  `REPEAT_INTERVAL_HOURS` constant — a tenant with a 3-day-then-7-day
  cadence in mind can actually build that now (by editing the 2 existing
  steps' delays; adding a 3rd step is the workflow-builder pass this
  schema is ready for but doesn't expose a UI for yet).
- **UI** — new Settings → Follow-up Templates tab: a template
  list (create/edit/delete, blocked with a clear message if a template
  is still in use), and a "your follow-up sequence" panel showing each
  attempt's template (dropdown) and delay (editable, saves on blur —
  fixed a real per-keystroke-API-call bug caught before shipping, see
  below).
- **Real bug caught and fixed before shipping:** the first version of the
  delay-hours input persisted to the API on every `onChange` — i.e. on
  every keystroke while typing a 2-digit number. Fixed by splitting
  local-state updates (immediate, for responsive typing) from the actual
  API persist (only on blur for the number field; still immediate for
  the template dropdown, which fires far less often).
- **Verified live** against the real database: confirmed the
  auto-seeded default sequence reproduces the old wording/48h cadence
  exactly; confirmed `{{variable}}` interpolation and its fallback
  behavior; assigned a custom template + a custom 24h delay to step 1 of
  a real opportunity and ran `runFollowUpCheck()` end to end — the sent
  message was the custom text (not the old hardcoded string), and the
  opportunity's `nextFollowUpAt` reflected the custom 24h delay (not the
  old flat 48h) — proof the engine is actually reading from the tenant's
  templates now, not still secretly hardcoded. Confirmed the new API
  routes return correct data live via a real logged-in session. `npm run
  build`, `npm run demo-journey`, and `npm run demo-journey-phase2` all
  clean afterward.

## 10. Pending / not yet implemented — team backlog

These are known, deliberate simplifications, not accidental gaps — each
one is functionally fine for the MVP today but is flagged here as an
explicit pending task rather than actioned, per a team decision on
2026-08-18 to document rather than build them out immediately. Picked up
in priority order below if/when someone starts on them.

1. **PENDING — Real WebSockets instead of polling.** Inbox and dashboard
   currently poll every 3.5–5s (`src/app/(app)/inbox/page.tsx`,
   `src/app/(app)/dashboard/page.tsx`, and the widget's `startPolling()` in
   `public/widget.js`) rather than pushing updates over a persistent
   connection. Works correctly today; will start to feel laggy and waste
   requests once there's real concurrent multi-agent traffic. No external
   credentials needed to do this one — it's a self-contained refactor
   (e.g. Socket.IO or a Postgres `LISTEN/NOTIFY`-backed channel), but it
   does need a long-running server process, which changes the deployment
   story (see section 13 — Netlify Functions can't hold a persistent
   WebSocket connection open the way a normal Node server can; would need
   a host that supports one, e.g. a small always-on VPS/Fly.io/Render
   instance instead of Netlify for this piece specifically).
2. **PENDING — Vector-based Knowledge Base (pgvector + embeddings).**
   Retrieval in `src/modules/knowledge/service.ts` is currently lexical
   (chunk + keyword-overlap scoring, section 2) — correct today, but will
   plateau on paraphrased customer questions that don't share literal
   keywords with what's in the Knowledge Base. Swapping in pgvector
   similarity search is a contained change (same
   `retrieveRelevantKnowledge(tenantId, query, limit)` signature), but
   needs: (a) confirming the `pgvector` extension is installed on
   whichever Postgres is used in production (Neon supports it), and (b) an
   embeddings API key (e.g. `OPENAI_API_KEY` for `text-embedding-3-small`,
   or Anthropic doesn't currently offer a public embeddings endpoint, so
   this would be a second provider) — not something to add without that
   credential in hand.
3. **PENDING — One real CRM or Ads connector.** Everything today runs
   against `MockCRMConnector` / `MockAdsConnector` (section 5) — the full
   interface is built and every write is logged, just not talking to a
   real HubSpot/Kommo/Salesforce/Zoho/Odoo or Google/Meta Ads account yet.
   Wiring up the first real one needs live API credentials for that
   specific provider from whoever owns that account — flagging here rather
   than guessing which provider to build first.
4. **PENDING — File/document upload for the Knowledge Base** (PDF parsing,
   website URL scraping). The "Add Knowledge" dialog already has Text/FAQ/
   Website URL/PDF as source-type options in the UI, but only "Text" is
   wired end-to-end today; PDF and URL ingestion are reasonable next
   additions behind the same `indexDocument()` entry point once someone
   picks a PDF-parsing library and decides on scraping/robots.txt policy
   for the URL case.

Two smaller structural notes, not really "pending work" so much as
scope decisions worth knowing about if requirements grow:

- The `Agent` and `AgentConfiguration` concepts from the spec were merged
  into a single `agents` table (`src/db/schema.ts`) since every field in
  both mapped 1:1 to one agent in this MVP's scope — split them back out
  if per-tenant agents ever need multiple configuration profiles.
- Follow-up scheduling fields live directly on `opportunities` rather than
  a separate follow-up-schedule table, for the same reason — revisit if
  follow-up rules need to become more complex than "one next follow-up per
  opportunity."

## 11. Self-audit checklist (spec section 40)

- [x] `npm run build` — clean, zero errors, zero warnings
- [x] `tsc --noEmit` — clean
- [x] Demo journey script runs end-to-end against real modules and
      produces the expected sale, attribution touches, and an approved
      "Increase Budget" recommendation
- [x] Tenant isolation — every internal query scoped by session tenant,
      never client input
- [x] Permission enforcement — role matrix checked server-side per route
- [x] API input validation — Zod schemas on all internal/v1/public routes
- [x] AI action logging — every tool call logged to `agent_actions`,
      every write to `audit_logs`
- [x] Widget installs and runs independently of the back-office app
      (Shadow DOM isolation, no external deps) — verified via `/demo`
- [x] CRM/Advertising flows use labelled mock connectors, not faked
      "success" responses
- [x] Attribution and advertising ROAS calculations verified against a
      real sale, not seeded/fabricated numbers

Nothing outstanding is blocking the MVP from being run and demoed as
described in spec section 31. See section 10 above for where to focus
next.

## 12. Visual preview

A set of screenshots of the running app (dashboard, inbox, leads Kanban,
the Knowledge Base "Add Knowledge" dialog, agent config, the advertising
table, and the widget running standalone on `/demo` — including a live
conversation, both before and after the duplicate-message fix) was
captured against the seeded RayGrid demo tenant and delivered alongside
this document. There's no hosted public URL for this build in the sandbox
it was built in (see section 13) — the screenshots are the closest thing
to "open it in a browser" available without deploying it somewhere first.

## 13. Deploying the widget for external review, and why Netlify specifically

The widget (`public/widget.js`) is a standalone, dependency-free script —
in that sense it's "deployable" on its own to any static host or CDN
right now. But it isn't self-contained data-wise: every call it makes
(`/api/public/agents/:id`, `/api/public/conversations`, `.../messages`)
goes back to wherever *this Next.js app* is running — `API_BASE` is
resolved directly from the `<script src="...">` origin (`widget.js`, top
of the file), by design, so there's no separate config to keep in sync.
So "deploy the widget for review" in practice means **deploy the whole
app somewhere with a public URL**, then the widget snippet from any
agent's **Widget & Embed** tab can be pasted into any real website and
it'll talk to that deployment.

### Why this wasn't deployed directly from this build session

This sandbox's outbound network is allowlisted at the proxy level —
confirmed directly (`curl -v https://api.netlify.com` returns `403
Forbidden` from the proxy itself, before it even reaches Netlify).
`api.vercel.com` is blocked the same way. `registry.npmjs.org` and
`api.github.com` **are** reachable, but Netlify's and Vercel's deploy
APIs are not, so this session cannot push a live deployment no matter
what credentials it's given — the connection itself is refused at the
network layer, not an auth problem. That's why the deliverable here is a
Netlify-ready repo (`netlify.toml` + a scheduled function, both added and
committed) plus these instructions, rather than a live URL.

### What's been prepared for Netlify (all untested against a real Netlify
### deploy — first-deploy checklist below)

- **`netlify.toml`** — build command, the official `@netlify/plugin-nextjs`
  runtime plugin, and a `[functions."followups-cron"]` schedule block.
- **`netlify/functions/followups-cron.mts`** — a Netlify Scheduled
  Function (runs every 5 minutes) that calls the same
  `runFollowUpCheck()` the BullMQ worker calls, so follow-ups still fire
  without a persistent worker process (Netlify Functions can't host one —
  see the WebSockets entry in section 10 for the same constraint applying
  there too). It imports through the `@/...` path alias exactly like the
  rest of the codebase; Netlify's esbuild function bundler is documented
  to pick up `tsconfig.json`'s `paths` automatically, but this specific
  function has not been exercised against a real Netlify build in this
  session — **first thing to check after connecting the repo.**
- **`@netlify/functions` and `@netlify/plugin-nextjs`** added as
  devDependencies so types resolve locally too.
- **README.md → "Deploy to Netlify"** — the full click-by-click steps
  (Neon for Postgres, Upstash for Redis, environment variables, one-time
  `db:push` + `seed` against the production database).

### What you need to actually finish this

Two things only you can provide, since neither is reachable or knowable
from inside this sandbox: a Netlify account to import the repo into (via
Netlify's own GitHub-connected UI — no token needs to be shared with this
session for that flow), and free-tier Neon + Upstash accounts for
Postgres/Redis (or your own hosted equivalents). Follow README.md's
"Deploy to Netlify" section end to end; report back anything that breaks
on the first deploy — most likely candidate is the scheduled function's
path-alias resolution called out above, with "switch to relative imports"
as the fallback fix already noted in that file.
