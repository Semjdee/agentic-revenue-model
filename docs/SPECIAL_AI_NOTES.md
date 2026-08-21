# Special AI Notes

## Tenant credit reserve, max-drawdown policy & usage forecasting

*Prepared 21 August 2026. Also recorded in [`BUILD_NOTES.md`](../BUILD_NOTES.md) §9g, right after the credit-pricing entry (§9f) it builds on.*

> **This document is an AI-proposed default policy — research-based, not
> a business decision confirmed with a human product owner** (unlike the
> credit-pricing constants it sits alongside in the build notes). Every
> threshold here should be revisited once real tenant usage data exists.

Requested directly: "we dont want tenants buying separate credit for each
ai agent," a reserve so "key day to day features that need ai [keep]
working," and a way to "know exactly how much will each tenant use... for
daily and recurring tasks." No prior product-owner discussion of this
existed in the repo to build from, so this note is exactly what it's
labelled — an AI-proposed default policy, not a business decision
confirmed with a human, unlike the credit-pricing constants documented
alongside it (`BUILD_NOTES.md` §9f). Chosen from real research (common
SaaS quota/reserve patterns — cloud cost-budget systems commonly hold
back 10-30% of a budget for critical workloads; rate-limiting systems
commonly cap bursts at 2-5x a steady-state share) applied to this
platform's own real cost structure. **Revisit every threshold below once
real tenant usage data exists** to see whether it binds too early, too
late, or about right — that's the one piece of homework this note can't
do for you.

## Finding #1 — the "separate credit per agent" problem doesn't exist

`credit_balances`/`credit_ledger` (§9f) are keyed by `tenant_id` only —
there is no `agent_id` column anywhere in the billing schema, and there
never has been. A tenant with five AI agents across three widgets already
draws every one of them from the exact same shared pool; nothing needed
to be built for this part of the ask, only confirmed. What *was* missing:
nothing stopped one low-value use of that shared pool (a tenant testing
prompts repeatedly in the agent builder) from draining it to zero and
taking real, revenue-critical customer conversations down with it — that
gap is what the rest of this note fixes.

## The model: three tiers, a reserve floor, and a daily burst cap

`src/modules/billing/reserve-policy.ts`. Every AI trigger type
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

## Usage forecasting

`src/modules/billing/forecast.ts` answers "how much will this tenant use"
from real trailing consumption, never a plan-based guess:

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

## A real accuracy bug caught by this work's own verification, fixed before shipping

The first version of the per-agent/per-trigger breakdown applied
`computeCreditsCharged()`'s standard "always at least 1 credit" rounding
(correct at actual charge time — see §9f — a call cheap enough to round
to 0 would otherwise be free forever) to *every* `agent_run`, including
ones from `MockAIProvider`, which costs genuinely $0 and never calls
`chargeUsage()` at all. That silently reported "1 credit" for runs that
never touched the tenant's real balance — exactly the kind of fabricated
number this platform's own honesty discipline exists to prevent. Fixed
with a reporting-only variant, `approxCreditsFromCost()` (`pricing.ts`),
that reports 0 for a genuinely-$0 run instead of flooring it — verified
live before and after the fix against the seeded tenant's
mostly-mock-provider run history.

## Where this shows up

- **Tenant-facing:** Settings → Credits & Usage gets a new "Usage
  forecast & reserve" card (avg/day, projected monthly, days of runway,
  the reserve line, and cost-by-agent) — `GET /api/internal/billing/forecast`.
- **Platform-admin:** a new `/platform/analytics` page (separate from
  the basic `/platform/dashboard` KPIs — these are heavier cross-tenant
  queries answering a different question) with a per-agent cost
  leaderboard across every tenant, a per-tenant "on pace / over pace"
  usage-forecast table, and cohort retention (see below) —
  `GET /api/platform/analytics`.
- `runSandboxMessage()` (agent-builder testing) now surfaces the
  specific blocked reason (`OUT_OF_CREDITS` vs. `CREDITS_RESERVED`)
  instead of one generic "out of credits" message, so a tenant paused by
  the reserve understands *why* — and that their live customer
  conversations are unaffected.

## Cohort retention

`src/modules/platform/cohorts.ts`, the other half of "deep platform-admin
analytics beyond the basic dashboard," alongside per-agent cost above —
groups tenants by signup month, and for each month-offset since signup
reports the real % of that cohort with at least one conversation in that
offset month (the same "activity" bar `activeTenants30d` on the basic
dashboard already uses). A month-offset that hasn't happened yet for a
given cohort is reported as `null`, not `0%` — "no data yet" and
"churned" are different facts this doesn't blur.

## Verified live

Against the real database: forced a tenant's balance into the reserve
zone and confirmed `SANDBOX_TEST` was refused (`reserve_protected`)
while `INBOUND_MESSAGE` stayed allowed; forced the balance to exactly
zero and confirmed `INBOUND_MESSAGE` is the *only* case that then
refuses (`balance_exhausted`); ran the forecast, per-agent breakdown,
and cohort computations end to end and inspected the real output
(including catching and fixing the rounding bug above); confirmed both
new pages live in a real logged-in browser session (`/settings` →
Credits & Usage, `/platform/analytics`). `npm run build`,
`npm run demo-journey`, and `npm run demo-journey-phase2` all clean
afterward.
