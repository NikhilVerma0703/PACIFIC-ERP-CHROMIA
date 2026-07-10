# Pacific ERP

Next.js web application replacing the Airtable production ERP for Pacific Surfaces.
This is **Phase 0** — the foundation: app + database + role-based auth + jobs engine.
See `ERP-Migration-Plan.md` for the full roadmap.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind
- **PostgreSQL** (local via Docker; Neon when deployed to Vercel)
- **Prisma** ORM
- **Auth.js (NextAuth v5)** — email + password, roles: OPERATOR / MANAGER / ADMIN
- **Inngest** — background jobs engine for the production automations

## Prerequisites (install once on Windows)

1. **Node.js 20+** — https://nodejs.org (LTS)
2. **Docker Desktop** — https://www.docker.com/products/docker-desktop (runs the local Postgres)

## First-time setup

Easiest: double-click **`setup.bat`**. Or run the steps manually:

```bat
:: 1. Install dependencies
npm install

:: 2. Start the local Postgres database (needs Docker Desktop running)
docker compose up -d

:: 3. Create the database tables
npm run db:push

:: 4. Create the first admin login
npm run db:seed

:: 5. Start the app
npm run dev
```

Then open **http://localhost:3000**.

## Default login

After seeding, sign in with the credentials from `.env.local`:

- **Email:** `admin@thepacific.group`
- **Password:** `changeme`  ← change `SEED_ADMIN_PASSWORD` in `.env.local` and re-seed, or change after the user-management screen is built.

## Background jobs (Inngest)

In a second terminal, run the Inngest dev server to see and trigger automations locally:

```bat
npm run inngest:dev
```

It auto-discovers functions at `http://localhost:3000/api/inngest` and gives you a dashboard at `http://localhost:8288`.

## Project layout

```
prisma/
  schema.prisma        Database schema (Phase 0: User + Role; Phase 1 adds 46 ERP tables)
  seed.ts              Creates the admin user
src/
  auth.ts              Auth.js config (credentials + roles)
  middleware.ts        Protects every route except /login
  lib/prisma.ts        Prisma client singleton
  inngest/             Jobs client + functions (automations land here in Phase 4)
  app/
    login/             Login page + sign-in action
    page.tsx           Protected home (shows the logged-in user + role)
    api/auth/...        Auth.js route handlers
    api/inngest/        Inngest endpoint
docker-compose.yml     Local Postgres
.env.local             Local secrets (gitignored)
```

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app (http://localhost:3000) |
| `npm run build` | Production build |
| `npm run db:push` | Sync schema → database (dev) |
| `npm run db:migrate` | Create a versioned migration |
| `npm run db:seed` | Create/refresh the admin user |
| `npm run inngest:dev` | Start the Inngest dev server |
| `docker compose up -d` | Start Postgres |
| `docker compose down` | Stop Postgres (data is kept in ./pgdata) |

## Next phases

1. **Phase 1** — translate the 46 Airtable tables into `schema.prisma`.
2. **Phase 2** — import all ~139K records (+ attachments).
3. **Phase 3** — read-only dashboard parity.
4. **Phase 4** — port the 37 automations into `src/inngest/`.
5. **Phase 5** — operator data-entry forms.
6. **Phase 6** — Airtable parallel sync.
7. **Phase 7** — deploy to Vercel + Neon.
8. **Phase 8** — cutover.
