# Build Notes — tools, decisions, and challenges

This is the running log for the team on how this MVP was actually built,
what deviates from the original spec and why, what's real vs. mocked, and
what to look at first if something looks wrong. Read this before reading
code.

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
