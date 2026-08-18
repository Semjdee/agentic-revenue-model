# Handoff — start here

You're picking up the **AI Revenue Agent Platform** after its MVP build.
This file is the entry point. Read it fully before touching code.

## ⚠️ Current top priority (as of 2026-08-19): Zero-to-Live Self-Onboarding

The product owner re-prioritized development on 2026-08-19. **Before
touching `docs/PHASE_2_TASKS.md`, read:**

1. **`docs/ONBOARDING_SPEC.md`** — the current #1 priority: a self-service
   onboarding wizard so a business owner can sign up, configure, test, and
   activate their AI sales operation with zero SMS Consult staff
   involvement. Includes an addendum on preserving the existing manual AI
   Agent creation workflow alongside the new guided path.
2. **`docs/ONBOARDING_TASKS.md`** — the ordered milestone checklist to
   execute, same format as `docs/PHASE_2_TASKS.md`.

**Phase 2 (below) is not cancelled** — it's now P2 priority
(`docs/ONBOARDING_SPEC.md` section 37), and Milestone 8 of the onboarding
tasks directly reuses Phase 2 Milestone 1's integration framework for
WhatsApp self-connect. Read the rest of this file for context on what
exists, then go to `docs/ONBOARDING_TASKS.md` to start working.

## Read in this order (original Phase 2 handoff — now secondary priority)

1. **This file** — orientation and ground rules.
2. **`README.md`** — how to install, run, seed, and demo the app.
3. **`BUILD_NOTES.md`** — everything about how the MVP was actually built:
   tech stack decisions (and why they deviate from the original spec),
   what's real vs. mock, every bug found and fixed, and a small backlog
   of technical-debt items (section 10 — WebSockets, pgvector-based
   knowledge retrieval, a first real CRM/Ads connector). Those are minor
   compared to what's below — pick them up opportunistically, not first.
4. **`docs/PHASE_2_EXTENSIONS_SPEC.md`** — the full product spec for two
   extensions: self-service WhatsApp/Instagram/TikTok onboarding, and
   Influencer Attribution & AI Performance Intelligence. Read it in full
   before writing any code — it's long and precise for a reason, and it
   repeatedly warns against the most tempting shortcuts (building a
   separate influencer CRM, faking OAuth, faking metrics, letting the
   LLM calculate ROAS itself).
5. **`docs/PHASE_2_TASKS.md`** — **this is what you actually execute**,
   once the onboarding priority above is solid. The spec above, broken
   into an ordered, checkable task list — exact files to create/touch per
   task, which existing code to mirror so patterns stay consistent, and a
   Definition of Done for each milestone. Work through it top to bottom.

## What already exists (don't rebuild it)

The MVP is a working Next.js 14 (App Router) + TypeScript app, Drizzle
ORM + PostgreSQL, Redis + BullMQ, JWT sessions, Zod validation
throughout. Run `npm run seed && npm run demo-journey` to see the whole
existing revenue loop execute against real code — that script is your
regression baseline; it must still pass after Phase 2 work lands.

Things Phase 2 will extend rather than duplicate — file locations so you
don't have to rediscover them:

| Concept | Where it lives |
|---|---|
| Tenant/Workspace/RBAC | `src/db/schema.ts` (tenants, workspaces, users), `src/lib/permissions.ts` |
| Contacts/Conversations/Leads/Opportunities/Sales | `src/db/schema.ts`, `src/modules/conversations/engine.ts` |
| AI tool/action + approval system | `src/modules/ai/actions.ts` (`ACTION_PERMISSIONS`, `executeToolCalls`) |
| Attribution engine | `src/modules/attribution/service.ts` (`AttributionTouch`-equivalent is `attributionTouches` in schema) |
| CRM connector interface + mock | `src/integrations/crm/types.ts`, `mock-connector.ts` |
| Ads connector interface + mock | `src/integrations/advertising/types.ts`, `mock-connector.ts` — **this is the closest existing analog to the `OAuthConnector` interface Part A asks for; look here first** |
| Webhook dispatch | `src/modules/webhooks/dispatch.ts` |
| Audit log | `src/lib/audit.ts` |
| Encryption at rest for credentials | `src/lib/crypto.ts` (AES-256-GCM) — reuse this for the new `IntegrationConnection` token fields |
| Rate limiting (Redis-backed, shared across instances) | `src/lib/api.ts` |
| Background jobs | `src/modules/followups/queue.ts` + `worker.ts` (BullMQ pattern to follow for the Daily AI Influencer Report job) |
| Back-office nav/shell | `src/components/shell.tsx` — add the new **Integrations** connect UX and **Influencers** section here, behind feature flags |

## Non-negotiable rules (repeated from the spec because they're the ones
## most likely to get shortcut under time pressure)

- **Reuse, don't duplicate.** No separate influencer CRM, no second
  attribution engine, no parallel auth system. Extend the tables and
  services listed above.
- **The platform calculates, the AI interprets.** Revenue, sales, ROAS,
  CPA, conversion rate, publicity score, commercial score, integration
  status, granted permissions — all computed by deterministic backend
  code. The AI's job is to explain what the numbers mean and what to do
  next, never to compute or invent them. This is the same discipline the
  MVP already follows in `src/modules/advertising/analyst.ts` — mirror
  it exactly for the new AI Influencer Analyst.
- **Never fake a completed integration.** If you don't have live
  WhatsApp/Instagram/TikTok developer credentials, build the real
  `OAuthConnector` interface and connector classes, and ship a clearly
  labelled mock implementation — exactly the pattern already used in
  `src/integrations/*/mock-connector.ts`. Do not simulate a successful
  OAuth callback as if it were real.
- **Least-privilege scopes, real permission display.** The Integration
  Permission Centre's checkmarks must derive from actually-granted
  scopes stored on the connection record — never hard-coded.
- **Two permission layers, don't conflate them.** External provider
  permission (what Meta/TikTok allow) vs. Agent Action Permission (what
  the tenant allows the AI to do) — reuse the existing
  `AUTOMATIC` / `APPROVAL_REQUIRED` / `DISABLED` modes from
  `src/modules/ai/actions.ts` for the second layer.
- **Feature-flag both extensions.** `SELF_SERVICE_SOCIAL_INTEGRATIONS_ENABLED`
  and `INFLUENCER_INTELLIGENCE_ENABLED`. If a full implementation would
  take a while, build the migration-safe schema + connector interfaces +
  auth framework + feature-flagged routes/nav first, and document what's
  left — don't let partial work destabilize the existing MVP demo path.
- **The original MVP success condition still has to pass.** Both golden
  paths — the full advertising→sale→attribution→AI-recommendation loop,
  and the standalone widget→AI→inbox path — must keep working
  end-to-end. `npm run demo-journey` and `npm run build` are your
  regression gates; don't merge anything that breaks either.

## Where to actually start

Don't try to ship all of Part A and Part B at once. `docs/PHASE_2_TASKS.md`
breaks this into 7 ordered milestones — schema/framework first, then one
real connector (WhatsApp) end to end, then the influencer data model and
tracking links, then the WhatsApp-influencer attribution path (the
single most important milestone — it's the thin slice proving Part A and
Part B actually connect), then scoring/AI-analyst, then the UI and
report job. Instagram, TikTok, assisted attribution, and cross-channel
marketing intelligence are explicitly deferred to a backlog section at
the end rather than attempted alongside everything else.

Work through it top to bottom, check off each Definition of Done, run
Milestone 0's regression checks after every milestone.

## Questions you can't resolve from the code or the spec

If something is genuinely ambiguous (e.g. exact scoring weights for
Publicity/Commercial Score, which TikTok API tier to target), don't
guess silently — leave a clearly marked `TODO` with the question, and
note it in an update to this file or `BUILD_NOTES.md` so it surfaces in
review, the same way the original MVP build documented every deviation.
