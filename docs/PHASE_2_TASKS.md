# Phase 2 task list — for whoever (Claude Code) executes this

This is the concrete, ordered backlog for `docs/PHASE_2_EXTENSIONS_SPEC.md`.
Read `HANDOFF.md` first — it has the reading order, the file map of
existing code to reuse, and the non-negotiable rules. This document is
the actual checklist to work through once you're ready to write code.

**Ground rule for using this list:** each task names exact files to touch,
the existing pattern in this codebase to mirror (so behavior stays
consistent instead of inventing a new convention per feature), and a
Definition of Done. Work top to bottom within a milestone — later tasks
depend on earlier ones in the same milestone. Milestones themselves are
ordered by priority, not by spec section number.

## Milestone 0 — baseline (do this first, every session)

- [ ] `npm install`, confirm Postgres + Redis are running, `npm run
      db:push`, `npm run seed`.
- [ ] `npm run demo-journey` passes with no errors (this is the original
      MVP's golden path — it must keep passing after every milestone
      below).
- [ ] `npm run build` is clean — zero ESLint errors, zero TypeScript
      errors.
- [ ] Re-run both of the above after every milestone in this document,
      before moving to the next one. If either breaks, fix it before
      adding more surface area — don't let regressions stack up.

## Milestone 1 — generic integration framework (Part A, sections 5–9)

No provider-specific code yet — just the reusable shape everything else
plugs into.

- [ ] **Schema**: add `integration_connections` table to
      `src/db/schema.ts`, following the field list in
      `docs/PHASE_2_EXTENSIONS_SPEC.md` section 5 (`id`, `tenantId`,
      `workspaceId`, `provider`, `integrationType`, `externalAccountId`,
      `externalAccountName`, `status`, `scopes` (jsonb array),
      `encryptedAccessToken`, `encryptedRefreshToken`, `tokenExpiresAt`,
      `webhookStatus`, `lastSyncAt`, `connectedByUserId`, `connectedAt`,
      `metadata` (jsonb), `createdAt`, `updatedAt`). Export an
      `INTEGRATION_CONNECTION_STATUSES` const array (`PENDING`,
      `CONNECTED`, `EXPIRED`, `REAUTH_REQUIRED`, `ERROR`,
      `DISCONNECTED`) following the existing pattern (see
      `ACTION_PERMISSION_MODES`, `LEAD_STAGES` in the same file). This is
      purely additive — no existing table changes, safe to `db:push`
      directly.
- [ ] **Capability registry**: add a `PROVIDER_CAPABILITIES` const array
      (`MESSAGING_RECEIVE`, `MESSAGING_SEND`, `LEAD_CAPTURE`,
      `ADVERTISING_READ`, `ADVERTISING_WRITE`, `ORGANIC_ANALYTICS`,
      `CONTENT_PUBLISH`, `WEBHOOKS`, `ATTRIBUTION`) plus a small static
      map of `provider -> capability[]` (what each of WhatsApp/
      Instagram/TikTok actually supports) in
      `src/integrations/capability-registry.ts`.
- [ ] **OAuth interface**: `src/integrations/oauth/types.ts` — the
      `OAuthConnector` interface from spec section 6
      (`getAuthorizationUrl`, `handleCallback`,
      `exchangeAuthorizationCode`, `refreshToken`, `revokeAccess`,
      `testConnection`, `getGrantedScopes`, `registerWebhooks`,
      `unregisterWebhooks`). Model it on the shape of
      `src/integrations/advertising/types.ts` (`AdsConnector`) — same
      spirit, this is the social/messaging equivalent.
- [ ] **Token encryption**: reuse `encryptSecret`/`decryptSecret` from
      `src/lib/crypto.ts` for `encryptedAccessToken`/
      `encryptedRefreshToken` — do not write a second encryption
      helper.
- [ ] **Definition of done**: the schema pushes cleanly, the interface
      compiles, nothing in the app calls it yet. Milestone 0 checks still
      pass.

## Milestone 2 — one real connector, end to end (Part A, sections 2, 10–13)

Prove the framework against exactly one provider before building three.
**WhatsApp first** — Part B's influencer attribution flow (section 24)
depends on it.

- [ ] `MockWhatsAppConnector implements OAuthConnector` in
      `src/integrations/oauth/whatsapp-mock-connector.ts`, labelled
      DEMO/MOCK in a comment exactly like
      `src/integrations/advertising/mock-connector.ts` already does —
      simulates the Embedded Signup exchange without calling a real Meta
      endpoint (no live credentials in this environment; see
      BUILD_NOTES.md section 5 for the established pattern).
- [ ] API routes: `src/app/api/internal/integrations/whatsapp/connect/
      route.ts` (redirects to `getAuthorizationUrl()`) and
      `.../callback/route.ts` (calls `handleCallback()`, then
      `exchangeAuthorizationCode()`, writes the `integration_connections`
      row, encrypts tokens before storing). **Callback route must
      implement spec section 12 in full**: state validation, CSRF
      protection, tenant/workspace context validated server-side (never
      trust a tenant id from a query/body param — resolve it from the
      signed session, same discipline as `requireTenantSession()` in
      `src/lib/api.ts`), redirect URI validation, auth-code validation,
      audit logging via `logAudit()` (`src/lib/audit.ts`).
- [ ] Webhook registration: after a successful callback,
      `registerWebhooks()` + a test call before marking status
      `CONNECTED` (spec section 13) — mirror the "don't fake it" pattern:
      if webhook verification fails, the connection stays `PENDING`/
      `ERROR`, never `CONNECTED`.
- [ ] Inbound webhook handler: `src/app/api/public/webhooks/whatsapp/
      route.ts` — normalizes an inbound WhatsApp payload into the
      existing `Message`/`Conversation` shape and calls
      `handleCustomerMessage()` (`src/modules/conversations/engine.ts`),
      exactly the same function the widget already uses. This is the
      "WhatsApp message → Meta webhook → WhatsApp adapter → normalized
      Message → Conversation → AI Agent" path from spec section 13.
- [ ] **Definition of done**: from the UI (next milestone) or a script,
      a fake inbound WhatsApp message reaches `handleCustomerMessage()`
      and gets a real AI reply, logged to the same `messages` table the
      widget uses. Milestone 0 checks still pass.

## Milestone 3 — integrations UI (Part A, sections 1, 8, 10)

- [ ] Extend the existing `/integrations` page
      (`src/app/(app)/integrations/page.tsx`) with a "Connect WhatsApp"
      card behind a `SELF_SERVICE_SOCIAL_INTEGRATIONS_ENABLED` feature
      flag (env var, checked server-side — see spec's Feature Flags
      section). Status card shows real state from
      `integration_connections` (Connected/Pending/Error, last event,
      AI responses on/off) — never a hardcoded "Connected."
- [ ] Integration Permission Centre view: a panel/page showing granted
      capabilities as ✓/✗ **derived from the connection's actual
      `scopes` field** cross-referenced against
      `PROVIDER_CAPABILITIES` — not a static mock list (spec section 8's
      explicit warning: "do not hard-code misleading checkmarks").
- [ ] Agent Action Permission layer: on the same page (or Settings),
      let the tenant set `AUTOMATIC` / `APPROVAL_REQUIRED` / `DISABLED`
      per WhatsApp action type (e.g. "marketing broadcast"), reusing
      `ACTION_PERMISSIONS`-style config from `src/modules/ai/actions.ts`
      — this is layer two from spec section 9, separate from what Meta's
      API technically permits.
- [ ] **Definition of done**: a user can click Connect, complete the
      mock OAuth flow, see the connection go PENDING → CONNECTED with
      real permissions displayed, and toggle at least one agent action
      permission for that channel.

## Milestone 4 — influencer data model + tracking links (Part B, sections 17–23)

- [ ] **Schema**: add `Influencer`, `InfluencerIdentity`,
      `InfluencerCampaignMember`, `InfluencerContent`, `TrackingLink`,
      `ReferralClick`, `InfluencerCost`, `InfluencerMetricSnapshot`,
      `InfluencerPerformanceScore` tables per spec sections 19–20 field
      lists. All additive. Reuse existing `campaigns`, `contacts`,
      `attributionTouches`, `products`, `advertisingRecommendations`
      (as the base for influencer recommendations — see Milestone 6),
      `approvals`, `auditLogs` tables — do not create parallel versions
      of any of these.
- [ ] Extend attribution source values: add an
      `ATTRIBUTION_SOURCE_TYPES` const array (`PAID_AD`, `INFLUENCER`,
      `ORGANIC_SOCIAL`, `SEO`, `REFERRAL`, `DIRECT`) to
      `src/db/schema.ts`. Note: `attributionTouches.source` is already a
      free-text column (see `src/modules/attribution/service.ts` —
      currently written as `"google"`/`"meta"`/`"direct"`), so this is a
      type-safety addition, not a destructive migration — no existing
      row or column changes.
- [ ] Tracking link service: `src/modules/influencers/tracking-links.ts`
      — `createTrackingLink()` (generates a short code + full
      `go.<domain>/<code>` URL, per section 23), and
      `resolveTrackingLink(code)`.
- [ ] Redirect route: `src/app/go/[code]/route.ts` — resolves the code,
      logs a `ReferralClick`, redirects to the link's destination
      (WhatsApp deep link with the prefilled `Ref: <token>` message per
      section 24, or website/landing/product/lead-form/booking page).
- [ ] **Definition of done**: creating a tracking link and visiting its
      `/go/<code>` URL logs a click and redirects correctly for at least
      the WhatsApp destination type.

## Milestone 5 — WhatsApp influencer attribution, end to end (Part B, section 24)

This is the thin slice that proves Part A and Part B actually connect —
treat it as the single most important milestone to get right.

- [ ] Referral token detection: when an inbound WhatsApp message (from
      Milestone 2's webhook handler) contains `Ref: <token>`, resolve it
      to an influencer/campaign/content via the tracking link, **before**
      handing off to `handleCustomerMessage()`.
- [ ] On resolution: create an `AttributionTouch` row with
      `source: "INFLUENCER"`, attach it to the (possibly new) contact/
      conversation, matching the spec's 5-step flow in section 24
      exactly (detect token → resolve influencer/campaign/content →
      create attribution touch → attach to
      existing conversation/contact → continue normal AI sales workflow
      unchanged).
- [ ] `scripts/demo-journey-phase2.ts`: a scripted end-to-end proof,
      modeled directly on `scripts/demo-journey.ts` — create an
      influencer + campaign + content + tracking link, simulate a click
      + inbound WhatsApp message with the referral token, run it through
      qualification to a WON sale, and print the resulting
      `AttributionTouch` (confirming `source: "INFLUENCER"` and the
      correct influencer/campaign linkage) — the same way the original
      script proves the ad-attribution path.
- [ ] **Definition of done**: `npm run demo-journey-phase2` (add the
      script to `package.json`) runs clean and prints a sale correctly
      attributed to an influencer, contact, and campaign.

## Milestone 6 — deterministic scoring + AI Influencer Analyst (Part B, sections 25–31, 34)

- [ ] `src/modules/influencers/metrics.ts` — pure functions computing
      the commercial metrics from spec section 26 (tracking clicks,
      conversation starts, click-to-conversation rate, leads, qualified
      leads, opportunities, sales, revenue, AOV, lead-to-sale
      conversion, CPL, cost per qualified lead, cost per sale, ROAS,
      ROI) from real data — same discipline as
      `computeCampaignPerformance()` in
      `src/modules/advertising/analyst.ts`. **No LLM call in this
      file.**
- [ ] `src/modules/influencers/scoring.ts` — deterministic
      `computePublicityScore()` and `computeCommercialScore()` (0–100,
      configurable weights per spec sections 27–28) and
      `classifyCreator()` deriving one of `SALES_DRIVER`,
      `PUBLICITY_DRIVER`, `FULL_FUNNEL_PERFORMER`,
      `ENGAGEMENT_SPECIALIST`, `EMERGING_PERFORMER`, `UNDERPERFORMER`,
      `INSUFFICIENT_DATA` from those scores (section 29). **No LLM call
      in this file either** — this is the one rule the whole spec
      repeats most (section 38): the platform calculates, the AI only
      explains.
- [ ] `src/modules/influencers/analyst.ts` — the AI Influencer Analyst.
      Takes the verified output of the two files above and generates
      recommendation rows (`SCALE`/`RENEW`/`MAINTAIN`/`USE_FOR_SALES`/
      `USE_FOR_PUBLICITY`/`USE_FOR_FULL_FUNNEL`/
      `TEST_DIFFERENT_CONTENT`/`CHANGE_OFFER`/`REDUCE_ALLOCATION`/
      `PAUSE`/`DO_NOT_RENEW`/`INSUFFICIENT_DATA`) with finding/evidence/
      recommendation/confidence/risk, reusing the existing
      `advertisingRecommendations`-style table/`Approval` architecture
      (mirror `generateAdvertisingRecommendations()`'s structure exactly
      — same duplicate-guard pattern, same "creates NEW recommendations"
      approach).
- [ ] **Definition of done**: given the data from Milestone 5's demo
      script, the analyst produces at least one sensible recommendation
      referencing real computed scores, not invented numbers.

## Milestone 7 — Influencers section UI + daily report job (Part B, sections 16, 31–32)

- [ ] Nav + pages under `src/app/(app)/influencers/`: Overview,
      Creators, Campaigns, Content, Tracking Links, Performance,
      Leaderboard, AI Insights — behind `INFLUENCER_INTELLIGENCE_ENABLED`.
      Follow the existing page patterns (e.g. `src/app/(app)/
      advertising/page.tsx` for the general shape of a metrics+table
      page, `src/app/(app)/leads/page.tsx` for a Kanban-style view if
      useful for Content/Campaigns).
- [ ] Leaderboard: sortable/filterable by the fields in spec section 32
      (Publicity Score, Commercial Score, Overall Score, Revenue, Sales,
      ROAS, Qualified Leads, Conversion, CPA, Clicks, Conversations,
      Views, Reach, Engagement; filters: Campaign, Date, Platform,
      Product, Objective, Creator category).
- [ ] Daily AI Influencer Report background job: a BullMQ recurring job
      following the exact pattern in `src/modules/followups/queue.ts` +
      `worker.ts` (`upsertJobScheduler`, not the deprecated `.add()`
      with `repeat` — see BUILD_NOTES.md section 9 for why). At
      configured end-of-day: aggregate → score → classify → compare
      campaign objectives → call the AI Influencer Analyst → store a
      report row → surface a dashboard notification (mirror the
      "Needs Attention" panel already on `/dashboard`).
- [ ] **Definition of done**: the Leaderboard renders real seeded/demo
      data correctly sorted, and manually triggering the report job
      (mirror the "Run follow-up check now" pattern in Settings)
      produces a stored report with the example format from spec
      section 31.

## Backlog (explicitly deferred — document, don't silently skip)

- [ ] Instagram connector (spec section 3) — same `OAuthConnector`
      pattern as Milestone 2, second priority after WhatsApp.
- [ ] TikTok connector (spec section 4) — same pattern; note TikTok's
      capability differences (Ads/Lead Gen/Organic Metrics/Content
      Posting are separate from Messaging — don't imply DM support
      without confirming the approved API capability exists).
- [ ] Multi-touch attribution beyond first/last (assisted attribution —
      spec section 33). The existing engine already computes first/last
      touch; assisted attribution is new logic in
      `src/modules/attribution/service.ts`.
- [ ] Future Marketing Investment Intelligence cross-channel comparison
      (spec section 35) — depends on Milestone 6/7 being solid across
      enough campaigns/creators to be meaningful; revisit once real
      data volume exists.
- [ ] CSV import / manual entry path for social metrics that aren't
      available via API (`MANUAL`/`CSV_IMPORT`/`ESTIMATED` sources from
      section 25) — needed for platforms/metrics without a live
      integration yet.

If time runs out mid-milestone, stop at the nearest **Definition of
Done** checkpoint above and update this file (check off what's done,
leave the rest) plus add a note to `BUILD_NOTES.md` — same discipline
the original MVP build followed. Don't leave partially-wired features
that look connected in the UI but aren't real (spec's repeated warning
against faking integrations applies here just as much as to the
external OAuth providers).
