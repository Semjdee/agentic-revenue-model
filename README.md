# AI Revenue Agent Platform

A multi-tenant SaaS platform that connects **Advertising → Conversation → AI
Sales Agent → CRM → Follow-up → Sale → Revenue Attribution → Advertising
Intelligence** into one closed loop, built from the MVP Build Instruction spec.

An embeddable AI sales agent talks to customers on your website (or any
channel you wire up), qualifies them, recommends products from your real
catalogue, hands off to a human when needed, and everything it does is
tracked back to the ad campaign that paid for it — so you know which ads
are actually making you money, not just generating clicks.

See **[BUILD_NOTES.md](./BUILD_NOTES.md)** for the tools used, the
decisions made, every deviation from the spec, and the known gaps — read
that first if you're picking this project up.

## Quick start

### 1. Prerequisites

- Node.js 20+
- PostgreSQL 16+ running and reachable
- Redis running and reachable

### 2. Install

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# edit .env — at minimum set DATABASE_URL, REDIS_URL, JWT_SECRET, ENCRYPTION_KEY
```

### 4. Create the database schema

```bash
npm run db:push
```

This applies `src/db/schema.ts` (34 tables) directly to your Postgres
database via Drizzle Kit — no migration files needed for local dev.

### 5. Seed demo data

```bash
npm run seed
```

Creates a believable demo tenant — **RayGrid Solar Energy** — with an
owner + sales user, a 5-product catalogue, knowledge base articles, an AI
agent ("Amara"), 21 days of ad campaign metrics across Google + Meta, and
a few extra demo contacts/conversations. Login credentials are printed at
the end of the seed script:

```
owner@raygrid.demo / password123
sales@raygrid.demo / password123
```

### 6. Run the app

```bash
npm run dev
```

Open http://localhost:3000 — you'll be redirected to `/login`.

### 7. (Optional) Run the background worker

The follow-up engine's scheduled/repeating checks run through BullMQ. In a
second terminal:

```bash
npm run worker
```

### 8. Watch the full golden-path demo

Rather than clicking through everything by hand, run the scripted
end-to-end journey from spec section 31 — ad click → widget conversation →
AI qualification → product recommendation → lead → CRM opportunity →
follow-up scheduled → sale → attribution → AI ad recommendation → human
approval — against the real application code (no HTTP server needed):

```bash
npm run demo-journey
```

Then open `/inbox` and `/dashboard` in the app to see the same data
reflected in the UI.

### 9. Try the embeddable widget standalone

The customer-facing widget (`public/widget.js`) is a dependency-free,
Shadow-DOM-isolated script — it works independently of the back-office app,
exactly as a real customer's website would embed it:

```
http://localhost:3000/demo?agent=<publicAgentId>
```

(the seed script prints the `publicAgentId`, or copy the installation
snippet from **Agents → your agent → Widget & Embed** in the app).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build (also runs TypeScript + ESLint checks) |
| `npm start` | Start the production server (after `build`) |
| `npm run lint` | ESLint only |
| `npm run worker` | Start the follow-up engine's BullMQ worker process |
| `npm run seed` | Seed the RayGrid Solar Energy demo tenant |
| `npm run demo-journey` | Run the scripted end-to-end demo scenario |
| `npm run db:push` | Push the Drizzle schema to Postgres |
| `npm run db:studio` | Open Drizzle Studio to browse the database |

## Tech stack

Next.js 14 (App Router, TypeScript) as a modular monolith — route handlers
under `src/app/api/**` serve as the "backend." PostgreSQL via Drizzle ORM.
Redis + BullMQ for the follow-up engine. JWT session cookies for
back-office auth. Zod validation on every API route. AES-256-GCM
encryption for integration credentials at rest. See BUILD_NOTES.md for why
Drizzle was used instead of the spec's suggested Prisma, and for the full
list of architectural decisions.

## Project structure

```
src/
  app/
    (auth)/            Login / register pages
    (app)/              The 14-section back-office (dashboard, inbox,
                         contacts, leads, agents, knowledge, followups,
                         advertising, attribution, reports, integrations,
                         developers, team, settings)
    api/
      internal/         Back-office API (session-cookie auth, tenant-scoped)
      v1/                Public developer API (API-key auth)
      public/            Unauthenticated widget-facing endpoints
    demo/               Standalone page hosting the embeddable widget
  db/                   Drizzle schema + client
  lib/                  Auth, permissions, crypto, audit log, API helpers
  modules/
    ai/                 AIProvider abstraction (Mock + Anthropic), tool/
                         action executor with approval gating
    conversations/      Conversation engine + intelligence
    knowledge/           Knowledge base indexing + retrieval (RAG)
    attribution/         First/last-touch attribution engine
    advertising/          AI Advertising Analyst
    followups/            Follow-up engine (BullMQ)
    webhooks/              Outbound webhook dispatch
  integrations/
    crm/                 CRM connector interface + mock connector
    advertising/          Ads connector interface + mock connector
  components/            Shared UI (shell, dialogs, charts, form controls)
public/
  widget.js              The embeddable customer-facing widget (vanilla JS)
scripts/
  seed.ts                 Demo data seeder
  demo-journey.ts          End-to-end scripted demo
  worker.ts                Standalone BullMQ worker entry point
```

## Deploy to Netlify

This app can be hosted on Netlify (via the official Next.js Runtime), but
Netlify only hosts the app itself — Postgres and Redis need to come from
an external provider, since Netlify doesn't offer managed databases. The
simplest free-tier combination:

1. **Database:** create a free [Neon](https://neon.tech) Postgres project
   and copy its connection string into `DATABASE_URL`.
2. **Redis:** create a free [Upstash](https://upstash.com) Redis database
   and copy its connection string into `REDIS_URL`.
3. **Push this code to a Git repo** (GitHub/GitLab/Bitbucket) if it isn't
   already, then in Netlify choose **Add new site → Import an existing
   project** and select that repo. Netlify auto-detects `netlify.toml`
   (already in this repo) and installs the Next.js Runtime plugin.
4. In **Site settings → Environment variables**, add every variable from
   `.env.example` (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`,
   `ENCRYPTION_KEY`, `APP_URL` = your Netlify URL, etc.).
5. Deploy. Then run the schema push and seed **once**, pointed at your
   production database (from your own machine, with `DATABASE_URL` set to
   the Neon connection string):
   ```bash
   DATABASE_URL="<your neon url>" npm run db:push
   DATABASE_URL="<your neon url>" npm run seed
   ```
6. The follow-up engine's recurring check runs as a **Netlify Scheduled
   Function** on Netlify (`netlify/functions/followups-cron.mts`, every 5
   minutes) instead of the standalone `npm run worker` process, since
   Netlify Functions can't run a persistent process — no extra setup
   needed, it's already wired in `netlify.toml`.

This deployment path was prepared and documented but **not deployed or
verified from inside the sandbox this project was built in** — that
sandbox's network is allowlisted and doesn't reach `api.netlify.com`. See
BUILD_NOTES.md → "Deploying to Netlify" for the full detail and what to
double-check on your first deploy.

## Multi-tenancy & security

Every table carries a `tenantId`; every internal API route resolves the
tenant from the signed session (never from client input) and filters every
query by it server-side. Role-based access control (8 roles) is enforced
through a static permission matrix (`src/lib/permissions.ts`). Integration
credentials are encrypted at rest (AES-256-GCM). Every AI tool call and
every write the AI agent makes is logged to `agent_actions` and, where it
mutates data, to the central `audit_logs` table. See BUILD_NOTES.md →
"Security & multi-tenancy" for the full self-audit.
