# Zero-to-Live self-onboarding — task list (current top priority)

This is the concrete, ordered backlog for `docs/ONBOARDING_SPEC.md`. Read
that spec (and its addendum on preserving manual AI Agent creation) in
full before writing any code — this doc is the actual checklist.

**Ground rule, same as `docs/PHASE_2_TASKS.md`:** each task names exact
files to touch, the existing pattern to mirror, and a Definition of Done.
Work top to bottom within a milestone. Milestones are ordered by
dependency + spec section 37's P0/P1/P2/P3 priority, not by spec section
number.

**Relationship to Phase 2:** `docs/PHASE_2_TASKS.md` is not cancelled —
it's lower priority right now (spec section 28/37). Milestone 8 below
(WhatsApp self-connect) directly reuses Phase 2 Milestone 1's
`integration_connections` schema + `OAuthConnector` interface, so
building that piece here also advances Phase 2. Don't duplicate it if
Phase 2 Milestone 1 already landed by the time you reach Milestone 8 —
check first.

## Milestone 0 — baseline (do this first, every session)

Same as `docs/PHASE_2_TASKS.md` Milestone 0: `npm install`, confirm
Postgres + Redis, `npm run db:push`, `npm run seed`, `npm run
demo-journey` passes, `npm run build` clean. Re-run after every
milestone below — this is the regression gate for spec section 38's
unchanged MVP success condition.

## Milestone 1 — schema foundations

No UI yet — the data model everything else plugs into.

- [ ] **Agent lifecycle status**: extend `agents.status` in
      `src/db/schema.ts` from `ACTIVE | PAUSED` to `DRAFT | READY |
      ACTIVE | PAUSED` (export `AGENT_STATUSES` const array, same
      pattern as `INTEGRATION_CONNECTION_STATUSES` if Phase 2 Milestone 1
      already exists, else same pattern as `LEAD_STAGES`). Existing rows
      default/migrate to `ACTIVE` — purely additive, no data loss. Spec
      addendum §A14.
- [ ] **Business profile fields**: add to `tenants` (or `workspaces`,
      whichever already holds the "one business" concept — check current
      schema before choosing): `industry`, `country`, `currency`,
      `timezone`, `websiteUrl`, `description`, `primaryObjective`,
      `primaryChannel`. Additive columns, nullable.
- [ ] **Onboarding progress tracking**: add an `onboarding_progress`
      table — `id`, `tenantId`, `currentStep`, `completedSteps` (jsonb
      array), `startedAt`, `completedAt`, `updatedAt`. Backs spec
      section 22 (save & resume). One row per tenant.
- [ ] **Onboarding funnel events**: add an `onboarding_events` table —
      `id`, `tenantId`, `event` (text — the `signup_started` /
      `channel_connected` / etc. vocabulary from spec section 19),
      `metadata` (jsonb), `createdAt`. Simple append-only log, separate
      from `audit_logs` (that one's for compliance/security actions on
      real business data, this one's product analytics — don't conflate
      them).
- [ ] **Definition of done**: schema pushes cleanly, `AGENT_STATUSES`
      exported and used nowhere destructive yet. Milestone 0 checks pass.

## Milestone 2 — onboarding wizard shell + save/resume + event logging

- [ ] `src/modules/onboarding/service.ts` — `getOnboardingProgress(tenantId)`,
      `advanceOnboardingStep(tenantId, step)`,
      `logOnboardingEvent(tenantId, event, metadata?)` (writes to
      `onboarding_events`, mirrors `logAudit()` in `src/lib/audit.ts` for
      calling convention). Single chokepoint every wizard step calls
      through — no step should write progress/events ad hoc.
- [ ] `src/app/(app)/onboarding/page.tsx` (or `src/app/onboarding/page.tsx`
      if it should run before a tenant is fully "inside" the app shell —
      decide based on whether Step 1 (account creation) precedes tenant
      existence; it does, so account creation stays in `(auth)/register`
      unchanged, and this wizard starts *after* registration) — a
      step-router shell reading `onboarding_progress` and rendering the
      right step, with a persistent "You're N steps away from going
      live" checklist per spec section 22.
- [ ] Wire `logOnboardingEvent` calls for `signup_completed` (in the
      existing register route) and `workspace_created` at minimum in
      this milestone — the rest get added as their steps are built.
- [ ] **Definition of done**: registering a new account lands on
      `/onboarding`, refreshing mid-way resumes at the right step (not
      step 1), `onboarding_events` has rows. Milestone 0 checks pass.

## Milestone 3 — business profile step

- [ ] Wizard step UI collecting exactly the spec section 4 Step 2 fields
      (business name, industry, country, currency, timezone, website
      URL, description, primary objective, primary channel) — a short
      form, not a long one (spec: "do not overwhelm the user").
      `PATCH /api/internal/onboarding/business-profile` writes to the
      tenant/workspace columns from Milestone 1, calls
      `advanceOnboardingStep` + `logOnboardingEvent("business_profile_completed")`.
- [ ] **Definition of done**: submitting the form persists real data
      (verify via `db:studio` or a direct query, not just "the UI showed
      a success toast"), advances the wizard, event logged.

## Milestone 4 — knowledge import step

Scope this milestone to what's realistically buildable now; the rest is
explicitly backlog (see bottom of this file) — don't silently skip
without noting it here, per this project's own documentation discipline.

- [ ] Wizard step offering `Add Products Manually` and `Skip for Now` as
      the two working options for this milestone (mirrors the existing
      `AddKnowledgeDialog` pattern in `src/app/(app)/knowledge/page.tsx`
      and `src/modules/knowledge/service.ts` — reuse `indexDocument()`,
      do not duplicate). `Scan My Website` / `Upload Product Catalogue` /
      `Upload Price List` / `Upload Business Documents` are stubbed as
      visibly "Coming soon" (not hidden, not fake-working — spec section
      35's "do not build a fake onboarding" applies to a disabled button
      with an honest label just as much as to a fake "Connected" badge).
- [ ] Extracted-info review UI ("We found the following information
      about your business" / Confirm / Edit / Remove) only applies once
      auto-extraction (website scan / catalogue upload) is built — note
      as a follow-on task in Milestone 4b (backlog), not fake it now with
      manually-entered data pretending to be "found".
- [ ] `logOnboardingEvent("knowledge_import_started"/"knowledge_import_completed")`.
- [ ] **Definition of done**: a user can add ≥1 product/knowledge item or
      explicitly skip, both advance the wizard, events logged.

## Milestone 5 — guided AI Agent creation (dual-path, spec addendum)

The most architecturally important milestone in this doc — get the
"same production entity, two creation paths" rule right (addendum §A2,
§A8, §A9).

- [ ] Extend `src/app/(app)/agents/page.tsx`'s "New Agent" entry point to
      offer **Create with Guided Setup** / **Create Manually** /
      (if ≥1 agent already exists) **Use Existing Agent** — addendum §A1,
      §A9. Manual path = today's existing flow, untouched.
- [ ] `src/modules/ai/guided-setup.ts` — pure mapping function per
      addendum §A3's table (business tone → `tone`, what to collect →
      `qualificationQuestions`, handoff rules → `escalationConditions`,
      products/services → `productIds`, restricted promises →
      `restrictedTopics`/`salesRules`, business hours → `businessHours`,
      follow-up preferences → `followUpRules`). Takes the wizard's
      business-question answers, returns a partial `agents` row — no DB
      writes in this file, keep it a pure function (same discipline as
      `src/modules/advertising/analyst.ts`'s calculation/AI split).
- [ ] Guided wizard step: business questions from spec section 11 /
      addendum §A3 → review screen (addendum §A4) with Edit / Create
      Agent → `POST /api/internal/agents` (existing route,
      `src/app/api/internal/agents/route.ts` — reuse, don't fork) with
      `status: "DRAFT"`.
- [ ] Confirm the created agent opens in the **existing**
      `src/app/(app)/agents/[id]/page.tsx` with full editability
      (addendum §A5) — if that page currently hides any fields for
      simplicity, it must not start doing so for guided-created agents;
      audit it now to make sure there's no per-path branching that
      locks anything down.
- [ ] `logOnboardingEvent("agent_generated")`.
- [ ] **Definition of done**: guided path produces a normal `agents` row
      indistinguishable in the DB from a manually-created one (same
      columns populated, just via mapping instead of direct form input),
      opens fully editable, manual path still works unchanged, existing
      agents from before this milestone are untouched (addendum §A7 —
      write a quick check: seed + guided-create, confirm the seeded
      "Amara" agent's row is byte-identical before/after).

## Milestone 6 — agent test sandbox

- [ ] `src/modules/ai/sandbox.ts` — runs the same `getAIProvider()` →
      `generateReply()` → `executeToolCalls()` pipeline the real
      conversation engine uses (`src/modules/conversations/engine.ts`),
      but against an ephemeral/flagged conversation that never writes to
      `contacts`/`leads`/`opportunities` — reuse the engine, don't fork
      it; gate the CRM-writing tool calls behind a `sandbox: true` flag
      threaded through `executeToolCalls()`.
- [ ] `Test Agent` button/panel available both inline in the onboarding
      wizard (spec section 14) **and** persistently on
      `src/app/(app)/agents/[id]/page.tsx` (addendum §A13) — same
      component, two entry points, not two implementations.
- [ ] Correction loop UI (spec section 15): `Good Response` /
      `Needs Improvement` → free-text explanation → stored as a
      reviewable suggestion (new `agent_test_feedback` table:
      `id, tenantId, agentId, testMessage, aiResponse, verdict,
      correctionNote, createdAt, appliedAt`) — **do not auto-apply** to
      the agent's config; a human reviews and applies manually (or via a
      later "Apply suggestion" action that's explicit, not automatic).
- [ ] `logOnboardingEvent("agent_test_started"/"agent_test_completed")`.
- [ ] **Definition of done**: sandbox conversation produces a real AI
      reply using real agent config + real knowledge base, zero rows
      appear in `contacts`/`leads`/`conversations` from a sandbox run,
      feedback is stored but never silently changes the agent.

## Milestone 7 — website widget connect step

- [ ] Wizard step showing the existing widget snippet (reuse whatever
      `Agents → Widget & Embed` already generates — don't build a second
      snippet generator).
- [ ] `GET /api/internal/onboarding/verify-widget?agentId=` — a real
      check: does a request against
      `/api/public/agents/:publicAgentId` succeed for this tenant's
      agent right now (spec section 35 — "Widget installed" must mean
      verification succeeded, not a hardcoded checkmark).
- [ ] `logOnboardingEvent("channel_connected", {channel: "website"})` on
      verified success.
- [ ] **Definition of done**: verification genuinely fails if the
      snippet isn't installed anywhere reachable, succeeds once it is.

## Milestone 8 — WhatsApp self-connect

**Reuses Phase 2 Milestone 1 + 2 directly** — `integration_connections`
schema, `OAuthConnector` interface, `MockWhatsAppConnector`, the
`/api/internal/integrations/whatsapp/connect` + `.../callback` routes,
and the inbound webhook handler. If those don't exist yet when you reach
this milestone, build them here (following `docs/PHASE_2_TASKS.md`
Milestones 1–2 exactly) rather than inventing a parallel connection
model — this is precisely the convergence point `docs/HANDOFF.md`
anticipated.

- [ ] Wizard step wraps the existing (or newly-built) WhatsApp connect
      flow behind the business-friendly UX from spec section 6 — no
      "Enter Meta App ID" ever shown to the user (spec section 3).
- [ ] Real status card per spec section 6 (Connected/number/message
      readiness/AI active/webhook health) sourced from the actual
      `integration_connections` row — never hardcoded.
- [ ] `logOnboardingEvent("channel_connect_started"/"channel_connected"/"channel_connect_failed")`.
- [ ] **Definition of done**: same as Phase 2 Milestone 2's DoD, plus:
      reachable from the onboarding wizard with zero technical fields
      exposed.

## Milestone 9 — pre-launch health check + Go Live

- [ ] `src/modules/onboarding/health-check.ts` — pure function checking
      real state: business profile complete, ≥1 knowledge item OR
      explicit skip acknowledged, ≥1 channel connected + healthy, agent
      config valid (has qualification questions + at least one
      knowledge source OR product), CRM pipeline ready (always true —
      it's the existing default, spec section 24), permissions valid
      (`ACTION_PERMISSIONS` defaults from spec section 25 applied on
      agent creation in Milestone 5). Returns a structured pass/fail per
      category, never a raw exception.
- [ ] Health check UI (spec section 16) rendering that structured result
      — failures show the translated business-language message + a fix
      action (spec section 31), never a raw error/stack trace.
- [ ] `POST /api/internal/onboarding/go-live` — re-runs the health check
      server-side (never trust a client-side "all green" alone), then
      atomically: `agents.status → ACTIVE`, enable the connected
      channel's processing, `logAudit()` (this one **is** a real
      business action, goes to `audit_logs` not just
      `onboarding_events`), `logOnboardingEvent("go_live_clicked"/"agent_activated")`,
      mark `onboarding_progress.completedAt`.
- [ ] **Definition of done**: Go Live is blocked with a specific,
      actionable reason if any check fails; succeeds and flips real
      state (agent genuinely starts responding on the connected channel)
      when all pass.

## Milestone 10 — TTFV + funnel analytics (admin-facing) ✅ done, scoped tenant-level

- [x] Wired the remaining events from spec section 19:
      `first_real_conversation`, `first_contact_created` (both in
      `src/modules/conversations/engine.ts`'s `startConversation()` and
      the new `startChannelConversation()`), `first_lead_created`,
      `first_qualified_lead`, `first_sale` (`src/modules/ai/actions.ts`),
      `first_attributed_sale` (`src/modules/attribution/service.ts`).
      Each guarded by `logOnboardingEventOnce()` so it fires at most once
      per tenant.
- [x] `src/modules/onboarding/metrics.ts` — `getTenantOnboardingMetrics()`
      (TTFV + Account→GoLive/FirstSale) and `getStepCompletion()`. No LLM
      call.
- [x] **Deviation from this task's original wording**: built as a
      tenant-scoped "Activation" tab on `/settings`
      (`src/app/(app)/settings/page.tsx`), not a cross-tenant
      `/admin/onboarding` page. This codebase has no "platform staff"
      auth concept distinct from per-tenant roles —
      `src/lib/permissions.ts` is entirely tenant-scoped by design, for
      multi-tenant isolation. Building real cross-tenant admin access
      (spec section 33's actual ask: SMS Consult staff viewing every
      tenant's funnel) needs that auth concept designed first, not
      bolted on under time pressure with an inadequately-secured
      shortcut — see backlog below.
- [x] **Definition of done**: verified against the demo-journey run and
      manual test-tenant onboarding — metrics reflect real event
      timestamps, not placeholder numbers.

## Milestone 11 — mobile, low-bandwidth, error-experience polish pass

- [ ] Manual pass of every onboarding step at mobile viewport widths
      (spec section 29) — fix any layout that breaks, don't just note it.
- [ ] Image/asset audit for the wizard specifically (spec section 30) —
      compress anything large, lazy-load anything non-essential to the
      current step.
- [ ] Error-message audit (spec section 31): grep the onboarding module
      for any place a raw error/exception message could reach the UI,
      replace with the business-language + action-button pattern.
- [ ] **Definition of done**: onboarding is usable start-to-finish on a
      375px-wide viewport with network throttling, and no step can
      surface a raw stack trace or provider error code to a non-admin
      user.

## Backlog (explicitly deferred — document, don't silently skip)

- [ ] **Cross-tenant platform-admin analytics** (spec section 33's
      literal ask — SMS Consult staff viewing every tenant's onboarding
      funnel/drop-off, not just their own). Needs a "platform staff" auth
      concept designed first (distinct from the existing per-tenant
      `src/lib/permissions.ts` roles) — Milestone 10 shipped the
      tenant-scoped version (`/settings` → Activation tab) using existing
      session auth safely instead of guessing at cross-tenant access
      control under time pressure.
- [ ] **Knowledge auto-extraction** (Scan My Website / Upload Product
      Catalogue / Upload Price List / Upload Business Documents, spec
      section 4) — needs a PDF-parsing library and a
      scraping/robots.txt policy decision, same open item
      `BUILD_NOTES.md` §10 already flags for the base Knowledge Base.
      Do this once Milestone 4's manual/skip path is solid.
- [ ] Google/Passkey auth for account creation (spec section 4 Step 1) —
      email/password already works; OAuth providers are additive.
- [ ] Industry starter templates (spec sections 12, addendum §A11).
- [ ] Instagram self-connect, CRM connector onboarding, Google Ads
      self-connect + attribution, billing/subscription self-service —
      all P1 per spec section 37, after every P0 milestone above is
      solid.
- [ ] TikTok, Advanced Attribution, Influencer Intelligence, Revenue
      Goal Agent, Additional AI Agents — P2, same as
      `docs/PHASE_2_TASKS.md`'s existing backlog for these.
- [ ] Autonomous Ad Optimization — P3.
- [ ] Onboarding assistant AI (spec section 23) — nice-to-have layered on
      top once the deterministic wizard flow itself is solid; per spec
      section 39, don't add this before the core flow works without it.

If time runs out mid-milestone, stop at the nearest Definition of Done
checkpoint, check off what's done here, and add a note to
`BUILD_NOTES.md` — same discipline as every other doc in this repo.
