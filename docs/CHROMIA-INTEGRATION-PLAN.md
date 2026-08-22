# Chromia module — integration plan

Bringing `CHROMIA_MODULE-main` into Pacific ERP as a gated shop-floor module,
on the pattern already set by Robo.

Source surveyed: `C:\Users\user\Downloads\CHROMIA_MODULE-main` (not a git repo —
a standalone Next.js app, 131 source files).

---

## 1. What is being integrated

A **complete, working application**, not a patch: slab lifecycle and process
traceability for the Chromia line. Intake → processing → QC → grade →
recalibration loop → dispatch / stock / sample cutting / waste, with a live
dashboard, slab search, Excel register import and reports.

| | Count |
| --- | --- |
| Source files (`src/**/*.ts,tsx`) | 131 |
| Prisma models | 33 |
| Prisma enums | 19 |
| Test files (Vitest) | 18 |
| Screens | 8 |
| Own migrations | 8 |

**It was built expecting this integration.** From its README:

> Authentication is deliberately not implemented — it is owned by the wider
> Pacific ERP. Actions are attributed to `CHROMIA_ACTING_USER` until it is
> connected.

`src/lib/current-user.ts` is the seam. This is the single biggest thing working
in our favour: there is no competing auth stack to unpick, only a stub to wire.

---

## 2. Where it lands — inside Production, exactly like Robo

**No separate tab.** This is the point most easily got wrong, so it is worth
being precise about what Robo actually does, because Chromia copies it:

- **For production staff, Robo is a row on the Data Entry page.**
  `src/app/entry/page.tsx:38` lists it in `SECTIONS` alongside Press, Oven,
  Kreos, Jot and Mixer — one item, `{ href: "/robo", label: "Robo entry (batch
  + slab)" }`. That is the whole entry point. Robo appears nowhere in the main
  nav for these users.
- **Only the dedicated `ROBO` login gets a nav entry**, and it is a nav of
  exactly one item — `src/components/Nav.tsx:138`, commented "the robo entry
  form is their whole ERP".
- **Reports are not a Robo screen.** Robo data surfaces through the existing
  reporting — `/tables`, `/records`, the production report — not a parallel
  reports section.

Chromia takes the same three positions:

| Concern | Robo | Chromia |
| --- | --- | --- |
| Entry point for production staff | a row in `/entry` `SECTIONS` | a **Chromia** section in the same list |
| Nav | none, except the one-item nav for the `ROBO` login | none, except the same for a `CHROMIA` login |
| Routes | `/robo`, `/api/robo/*` | `/chromia`, `/api/chromia/*` |
| Role | `ROBO` in the `Role` enum | `CHROMIA` |
| Gate | `middleware.ts` — ROBO-or-admin, and the ROBO role is capped to that module | identical block |
| Reporting | existing `/tables`, `/records`, `/report` | same — Chromia's 8 report views fold into these, see §6 Phase 3 |
| Schema | models namespaced `Robo*` | see §4 |
| Seed | `prisma/seed-robo.ts`, `npm run db:seed:robo` | `prisma/seed-chromia.ts` |

Branch is `SHOP_FLOOR`. The `CHROMIA` login sees the Chromia screens and
nothing else; everyone else with entry access reaches them from Data Entry.

Note the middleware ordering rule that already applies to Robo: the module gate
must sit **above** the branch blocks, because their generic `/api` allowances
would otherwise let other departments reach Chromia data.

Which rows appear on `/entry` is filtered by `entryAccess()` against the model
list, so the Chromia row inherits the same per-role visibility machinery as
every other station — nothing new to build for that.

---

## 3. Stack gap

Chromia is a generation ahead of the ERP on three axes:

| Layer | ERP | Chromia | Conversion |
| --- | --- | --- | --- |
| Prisma | 6.2 (default client) | 7.9, `@prisma/adapter-pg`, client generated to `@/generated/prisma/*` | **30 files** import the generated client; **19** run queries |
| Tailwind | 3.4, `tailwind.config.ts` | 4.1, CSS-first `@theme` | v4-only syntax is confined to `globals.css` (`@import 'tailwindcss'`, `@theme`) — utility classes in components are largely portable |
| Tests | `node --test` | Vitest | 18 files to port |
| Auth | next-auth v5 + `lib/rbac.ts` | stub, by design | wire `current-user.ts` → `currentUser()` |

**Inngest is not a gap.** The ERP already runs it (`lib/automations.ts`,
`lib/sales/paymentReminderJob.ts`, `lib/sales/productionNotifierJob.ts` and two
sales routes), so Chromia's background jobs have a home and an existing client
to join.

---

## 4. Schema — only four names actually collide

Measured, not assumed. Chromia's 33 models and 19 enums against the ERP's 112
and 26:

| Kind | Colliding name | Resolution |
| --- | --- | --- |
| model | `User` | **Drop Chromia's.** Point its relations at the ERP `User`. |
| model | `SlabEvent` | Rename → `ChromiaSlabEvent` (the ERP's is the production-line slab event). |
| enum | `Role` | **Drop Chromia's.** Its 7 roles become app-level constants, not DB values — see §5. |
| enum | `SlabStatus` | Rename → `ChromiaSlabStatus` (the ERP's belongs to finished-goods inventory). |

Everything else is free — including the generic-sounding `Slab`, `Batch`,
`Machine`, `Design`, `Location`, `Supplier`, `Customer`, `Dispatch`,
`StockEntry` and `AuditLog`, none of which exist in the ERP schema today.

**Unrelated but adjacent:** the ERP already has `Chromia1` and `ChromiaPar1` —
legacy Airtable imports for this same line (`slab_number`, `in_time_at_drone`,
`cooking_time`, `temp_in/out`). They do not collide with any new name and are
left alone. Whether the new module supersedes them is a data question to settle
separately, not a blocker for the port.

### The namespacing decision

Because only four names collide, prefixing everything `Chromia*` is a **choice,
not a necessity**:

- **Minimal (4 renames).** Smallest diff, fastest to working. Cost: a bare
  `Slab`, `Batch` and `Machine` sitting in a 112-model schema next to
  `SlabWiseInventory`, `FabMachine` and `RoboMachine` — a reader can no longer
  tell which line a model belongs to from its name.
- **Full namespace (33 renames).** Matches Robo, keeps the schema legible at
  its current size. Cost: every query in the 19 query-bearing files changes, and
  the model-index section of `CLAUDE.md` grows a Chromia block.

Recommendation: **full namespace.** The schema is already at 112 models; the
one-time mechanical cost is smaller than the standing cost of ambiguous names,
and it matches the precedent a future reader will expect after seeing `Robo*`.

---

## 5. Roles

Chromia ships 7 internal roles — `ADMIN`, `PRODUCTION_MANAGER`, `SUPERVISOR`,
`OPERATOR`, `QUALITY_INSPECTOR`, `STORE_KEEPER`, `VIEWER` — with guards already
written against them (`src/constants/roles.ts`: `MANAGEMENT_ROLES`,
`PRODUCTION_ROLES`, `QUALITY_ROLES`, `STORE_ROLES`).

**Default taken here: one `CHROMIA` role**, exactly like `ROBO`. It is what was
asked for ("just like robo's… separate logins and restrictions to that login"),
it adds one enum value instead of six, and it does not pre-commit the ERP's
`Role` enum to a role taxonomy the line may not use.

Chromia's role constants stay in the code, unused at first. If the line later
wants QC inspectors barred from recording dispatch, the guards are already
written and only need real values behind them — no rework of what is built here.

---

## 6. Phases

Each phase builds, typechecks and is reviewable on its own.

**Phase 1 — schema and gate.** Namespace the models per §4, merge into
`prisma/schema.prisma`, `db push` to Neon, add `CHROMIA` to the `Role` enum,
add the middleware block, and add the **Chromia row to `SECTIONS` in
`src/app/entry/page.tsx`** (plus the one-item nav for the `CHROMIA` login, as
`Nav.tsx:138` does for Robo). No new tab. Nothing renders behind the row yet.

**Phase 2 — server layer.** Port `server/actions`, `server/services`,
`server/repositories` and `lib/` off Prisma 7 onto `@/lib/prisma`. Wire
`current-user.ts` to `currentUser()` so actions attribute to a real ERP user
instead of `CHROMIA_ACTING_USER`. This is the bulk of the work.

**Phase 3 — entry screens, then reporting.** Move the operating screens under
`src/app/chromia/`, convert `globals.css` off Tailwind 4, reconcile the
component kit against the ERP's `components/ui`.

Chromia's own `/dashboard` and `/reports` screens are **not** ported as-is —
that would be the parallel reports section this integration is meant to avoid.
Its report queries move behind the existing surfaces instead: the models become
visible to `/tables` and `/records` through the normal model registry, and any
Chromia-specific figures that belong in the production report go into `/report`.
Its Excel export can stay, since export is a function rather than a tab.

**Phase 4 — tests and jobs.** Port 18 Vitest files to `node --test`; join the
existing Inngest client.

---

## 7. Open questions

1. **Data relationship to `Chromia1` / `ChromiaPar1`.** Does the new module
   replace those legacy tables, read from them, or run alongside? Affects
   whether a backfill is needed.
2. **Migrations.** Chromia carries 8 of its own; the ERP works by `db push`
   against Neon, which already holds the live schema. The Chromia migrations
   are almost certainly not replayable here and should be treated as history,
   not as something to run.
3. **Whether the 7-role granularity is wanted** on day one (§5 assumes not).

---

*Written before any code was changed. No schema, route or enum has been
modified by this document.*
