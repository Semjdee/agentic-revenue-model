# Launch Checklist — ai-revenue-agent

Tracked, living punch list of what's between this app and accepting real, paying, external signups. Checked items are verified working (not just "code exists") — see the evidence note under each. Unchecked items link to the file(s) that own them.

Started 2026-08-22, after a full audit of the codebase against production behavior (not just reading source — several items below were confirmed or corrected by actually hitting the running app).

## 🔴 Core product — must work before any real customer gets value

- [x] **AI agent replies (Anthropic)** — real, confirmed live 2026-08-22: production sandbox test returned a genuine contextual LLM reply (not templated), and a completed production run shows real, non-round token counts (722 in / 97 out, $0.0012). `ANTHROPIC_API_KEY` is set and valid. Owns: `src/modules/ai/index.ts`.
- [ ] **WhatsApp — real send + receive** — inbound webhook shape is already Meta-compatible (`src/app/api/public/webhooks/whatsapp/route.ts`), but there is no real outbound send, no webhook signature verification, and the connect flow (`src/integrations/oauth/whatsapp-mock-connector.ts`) is fully mocked. **In progress now.**
- [ ] **Payments (Flutterwave)** — `FLUTTERWAVE_SECRET_KEY`/`FLUTTERWAVE_WEBHOOK_SECRET_HASH` gate real vs mock (`src/integrations/payments/flutterwave.ts:197`). Set the keys, then run one real sandbox transaction end-to-end before trusting it with real money — the connector's own comments flag it as never live-tested.
- [ ] **Instagram — real send + receive** — same gap as WhatsApp, currently `MockInstagramConnector` (`src/integrations/oauth/instagram-mock-connector.ts`), no real code path exists at all.
- [ ] **Ad platforms (Meta/Google Ads)** — `MockAdsConnector` unconditionally used (`src/integrations/advertising/mock-connector.ts:117`). No real connector exists yet. Needed for the Advertising/attribution pages to reflect real spend.
- [ ] **CRM integrations** — `MockCRMConnector` unconditionally used (`src/integrations/crm/mock-connector.ts:83`). No real HubSpot/Kommo/Salesforce/Zoho/Odoo connector exists yet.

## 🟠 Trust & safety — must have before accepting real signups

- [ ] **Terms of Service / Privacy Policy pages** — don't exist anywhere in the app, nothing linked from `/login` or `/register`.
- [ ] **Email sending** — no email library/SMTP anywhere in the codebase. Concretely blocks: email verification on signup, password reset (route doesn't exist), and secure team invites (temp passwords currently come back in the API response instead of being emailed — `src/app/api/internal/team/route.ts:30-32`).
- [ ] **Rate limiting / abuse protection on `/register`** — login and OTP endpoints are rate-limited (`src/lib/api.ts`'s `rateLimit()`), registration isn't (`src/app/api/internal/auth/register/route.ts` has no `rateLimit` call). No CAPTCHA anywhere.
- [ ] **Google OAuth token signature verification** — the id_token is decoded but not cryptographically verified against Google's JWKS (`src/app/api/internal/auth/google/callback/route.ts:45-49`, self-flagged in its own comment as the hardening step before real account security).
- [ ] **Error monitoring** — no Sentry/equivalent anywhere. No visibility into production errors right now.
- [ ] **General health/status endpoint** — the only health-check route is tenant-scoped onboarding logic (`src/app/api/internal/onboarding/health-check/route.ts`), not a `/healthz`-style liveness probe for uptime monitoring.
- [ ] **Rate limiter fail-open behavior** — if Redis is down, `rateLimit()` currently disables itself silently rather than blocking (`src/lib/api.ts:73-82`). Acceptable short-term, worth hardening before scale.

## 🟡 Mobile responsiveness — added 2026-08-22

Most of this product's real-world users will be on a phone. The dashboard rebuild (BUILD_NOTES.md §9l) already reflows on the standard `md:`/`lg:` breakpoints, but no dedicated page-by-page mobile pass has been done.

- [ ] **Full mobile audit, every page** — Dashboard, Inbox, Contacts, Leads, Follow-ups, AI Agents, Knowledge Base, Advertising, Influencers, Attribution, Reports, Integrations, Channels, Developers/API, Team, Settings, onboarding wizard, Platform Admin pages. For each: no horizontal scroll, tables/wide content usable on a narrow screen (stack, scroll-in-place, or card view — not a shrunk desktop table), forms and dialogs usable one-handed, tap targets sized for touch, the sidebar's existing mobile drawer confirmed working from every page, not just the dashboard.
- [ ] **Detail views on mobile** — anywhere a modal/dialog is used for a record (lead, contact, agent config), confirm it isn't clipped or unusably small below ~400px width.
- [ ] **Charts on mobile** — the dashboard's recharts components (revenue trend, channel bars) need to stay legible, not squished, on a phone-width viewport.

## 🟢 Lower priority / known, documented backlog

- [ ] Real-time inbox/dashboard updates use polling, not WebSockets (Netlify Functions can't hold persistent connections — needs a different host for this). See BUILD_NOTES.md §10.
- [ ] Knowledge Base vector search not implemented — only the "Text" source type is wired end-to-end; PDF/URL ingestion are UI-only stubs. See BUILD_NOTES.md §10.
- [ ] Currency/phone defaults are Uganda-biased (`UGX`, `+256` placeholder) but both are freely editable per-tenant fields, not a functional block for other countries.

---

**How to use this file**: check an item only once it's been verified working against the real running app (not just "the code was written") — this session's discipline throughout has been live HTTP/browser verification before marking anything done, and the AI-provider correction above is a good example of why that matters: static code reading alone said "mocked," live testing said "actually working." Update this file as items close.
