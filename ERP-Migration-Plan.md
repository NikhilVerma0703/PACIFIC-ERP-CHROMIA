# Pacific Surfaces ERP — Airtable → Next.js Migration Plan

**Prepared for:** Varun (vmundra@thepacific.group)
**Date:** 1 June 2026
**Scope:** Replace the Airtable-based production ERP (base `apppEYN8yX1wH3gwr`) with a full Next.js web application — all data (~139K records), all 37 automations, all forms, and every functionality — running locally first, then on Vercel with a managed Postgres database.

---

## 1. What we are building

A self-hosted-grade ERP web application that fully replaces Airtable as the system of record for Pacific Surfaces' quartz slab manufacturing operation. It must do everything Airtable does today and more, without Airtable's limits (record caps, automation run limits, API rate limits, rigid views):

- **Database of record** — every table and relationship from the 46-table Airtable base, holding ~139K records and growing.
- **Forms** — operator data-entry screens (Mixer Cycle entry, Press entry, Polish Entry, Polish QC, MIS/shift logs, SILO bag dumps, RM/consumables) that replace Airtable forms and interfaces.
- **Automations** — all 37 Airtable automations re-implemented as server-side jobs (grit/filler FIFO allocator, batch wastage rollup, Press Slab Update heartbeat, resin remaining-weight decrement, etc.).
- **Dashboards & reports** — everything in your existing read-only dashboard (Overview KPIs, Batch Lookup, Records Browser, Production Report) plus editable workflows.
- **Access control** — role-based logins for shop-floor operators (data entry) and managers/admins (edit, export, configure).

You already have a big head start: the read-only dashboard at `C:\Users\user\Desktop\production dashboard\` proves the data model is reverse-engineered, the wastage math is verified (batch D1310 = 9.97%), and the automation logic is documented in `DATA_MODEL.md`. We reuse all of that.

---

## 2. Migration approach — the three options explained

You asked me to explain the difference before choosing. Here is each approach, what it means for a *running factory* producing data every shift, and my recommendation.

### Option A — Parallel + sync, then cutover (recommended)
Build the new app while Airtable stays the live system of record. We run a two-way (or one-way) sync so the Postgres database mirrors Airtable continuously. Operators keep using Airtable as normal. Once the new app is trusted — data matches, automations produce identical results, operators are trained — you flip a switch and the new app becomes the source of truth.

- **Pro:** Zero production risk. If anything breaks in the new system, Airtable is still running and nobody on the shop floor is blocked. You can validate the new automations against the old ones side by side (e.g. confirm the new wastage rollup equals Airtable's for the same batches).
- **Con:** Most engineering effort — you build the app *and* a sync layer. The sync layer is throwaway code you delete after cutover.
- **Best when:** the system can't go dark, and you want to verify correctness against the live system before trusting it. This is your situation (Press Slab Update runs ~1,960×/month; the line never stops).

### Option B — Full cutover (big bang)
Migrate all 139K records once, rebuild all automations and forms, pick a go-live date, and switch everyone over on that date. Airtable is retired the same day.

- **Pro:** Cleanest end state, no sync code, fastest *to a finished state* on paper.
- **Con:** Highest risk. Any bug or missing automation on go-live day directly blocks production data entry. No fallback. You discover problems in production with operators standing at terminals.
- **Best when:** the system is small, low-volume, or non-critical. Not a great fit for a live manufacturing line.

### Option C — New data entry only (freeze + archive)
On a go-live date, Airtable becomes a read-only archive. All *new* production data is entered only in the new app from that day forward. Historical 139K records are imported once for reporting/lookup but never written back to Airtable.

- **Pro:** Much less code than full sync — it's a one-time historical import plus a clean forward-only start. No two-way sync to maintain.
- **Con:** Still a hard cutover for *data entry* (operators switch on day one with no fallback for entry), and you lose the ability to compare live automation output against Airtable. Reports that span the boundary date need to read both old (imported) and new data, which they will since it's all in one Postgres DB.
- **Best when:** you want a clean break and are confident in the new forms/automations, but still want all history queryable in the new system.

### My recommendation
**Option A (parallel + sync) for the cutover of the system of record, executed in phases.** With 139K records, an always-running line, and operators who depend on data entry every shift, the safety of keeping Airtable live while we validate is worth the extra sync code. We can actually combine A and C: build with parallel sync (A), and when confidence is high, do the forward-only freeze (C) as the final cutover step. I'll assume this combined path in the roadmap below, but it's a one-line config change to switch strategies if you prefer.

> Note on data volume: ~139K records is comfortable for Postgres (it handles hundreds of millions of rows). The number mostly affects the **one-time import** (a few minutes to a couple of hours depending on attachment downloads) and the **sync polling** design, not day-to-day performance.

---

## 3. Recommended technology stack

Chosen to match your decisions (PostgreSQL, Vercel + managed DB, operator + manager roles) and to keep everything portable so we are never locked to one host.

| Layer | Choice | Why |
|---|---|---|
| **Framework** | Next.js 15 (App Router) + TypeScript | Same stack as your existing dashboard; one app serves UI + API + jobs. |
| **Database** | PostgreSQL — local Docker for dev, **Neon** managed Postgres for Vercel | Same engine everywhere. Neon is the strongest managed Postgres for Vercel/Next.js (native serverless driver, no connection-pool headaches, instant DB branching for safe testing). Supabase is the alternative if you later want its built-in auth/storage. |
| **ORM / schema** | Prisma | Type-safe schema-as-code. Defines all 46 tables + relations in one `schema.prisma`, generates migrations, gives autocomplete across the whole data model. |
| **Auth + roles** | Auth.js (NextAuth v5) with a `role` field (`OPERATOR` / `MANAGER` / `ADMIN`) | Portable (works on Vercel and self-host), supports the role-based access you need without locking us to a platform's auth. |
| **Automations / jobs** | **Inngest** | This is the critical choice. Vercel serverless functions time out in 10–60s, so the heavy/scheduled automations (Press Slab Update, batch wastage rollup, FIFO grit allocator) can't just be cron functions. Inngest runs each step as its own short HTTP call with step-level retries and managed schedules — purpose-built for long/multi-step jobs on Vercel, no Redis to run. |
| **File storage** | Vercel Blob (or Cloudflare R2 / S3) | For Airtable attachment fields (e.g. LAB colour-test photos). Object storage replaces Airtable's attachment hosting. |
| **UI** | Tailwind + your existing components, charts via Recharts | Reuse what's already built in the dashboard. |
| **Local dev** | Docker Compose (Postgres + app) | One command spins up the whole stack on your machine; mirrors production. |
| **Deploy** | Vercel (app) + Neon (DB) + Inngest Cloud (jobs) | All three integrate natively; push to GitHub → auto-deploy. |

**Why not keep automations as Vercel Cron alone?** Vercel Cron can *trigger* jobs but the functions still hit the timeout. A FIFO allocator scanning SILO records, or a rollup across Mixer Cycle + Press for many batches, will exceed 60s. Inngest decouples each step so jobs can run for minutes/hours reliably. (Trigger.dev is a fine alternative; Inngest is the lighter fit for our job shapes.)

---

## 4. Architecture overview

```
                 ┌─────────────────────────────────────────────┐
                 │              Next.js app (Vercel)            │
                 │                                              │
  Operators  ──▶ │  Forms (data entry)   Dashboards / Reports   │ ◀── Managers/Admins
                 │        │                      ▲              │
                 │        ▼                      │              │
                 │   Server Actions / API ───────┘              │
                 │        │                                     │
                 └────────┼─────────────────────┬───────────────┘
                          │                     │
                          ▼                     ▼
                 ┌──────────────────┐   ┌──────────────────┐
                 │  Postgres (Neon) │   │  Inngest (jobs)  │
                 │  46 tables via   │◀─▶│  37 automations  │
                 │  Prisma          │   │  + schedules     │
                 └──────────────────┘   └──────────────────┘
                          ▲
                          │  (migration phase only)
                 ┌──────────────────┐
                 │  Airtable sync   │  one-way/two-way until cutover
                 └──────────────────┘
                          ▲
                          │
                    Airtable (current)
```

- Forms write to Postgres through Prisma (via Server Actions).
- Writes that should trigger automation emit an Inngest **event** (e.g. `press.record.created`); the matching Inngest function runs the automation logic (replacing the Airtable script).
- Scheduled automations (every 6h / every 15 min) become Inngest **cron functions**.
- During migration, a sync worker keeps Postgres and Airtable aligned; it's removed at cutover.

---

## 5. The hard parts (and how we handle each)

1. **Re-implementing 37 automations.** This is the bulk of the work. We already have `DATA_MODEL.md` documenting all 37, plus the actual JavaScript source for the key ones (the ~450-line FIFO grit/filler allocator with smart-delink logic, the batch wastage rollup with its `normalizeBatch` regex, Press Slab Update). We port these to TypeScript Inngest functions, one at a time, each validated against Airtable's output. The `normalizeBatch` and `perMixerWeights` helpers already exist and are verified.

2. **Faithful relational model.** Airtable's "link to another record" fields become real foreign keys / join tables in Postgres. The two-stream batch numbering (`C1185`/`D1310` vs `1185`/`1310`) is handled by storing a normalized batch key, so joins are exact instead of string-matched.

3. **Forms that match operator habits.** Operators currently enter silo *names as text* + weights, and the automation resolves links. We replicate that exact UX so retraining is minimal, then the server-side job does the resolution.

4. **Empty/under-populated tables Airtable never filled** (Batch Wastage, Slab Summary at ~6%, Production Report at 0 rows). In the new system these get populated correctly because the automations actually run — fixing problems you couldn't fix in Airtable.

5. **139K-record import + attachments.** One-time bulk import via the Airtable API into Postgres, downloading attachments to object storage. Idempotent and re-runnable.

---

## 6. Phased roadmap

Each phase is a working, testable milestone. We don't move on until the prior phase is verified.

**Phase 0 — Foundations (local)**
Scaffold Next.js + TypeScript + Tailwind, Docker Compose with Postgres, Prisma, Auth.js with roles, Inngest dev server. Login screen with OPERATOR/MANAGER/ADMIN roles. *Deliverable: app runs locally, you can log in.*

**Phase 1 — Data model in Postgres**
Translate all 46 Airtable tables into `schema.prisma` with proper relations, normalized batch keys, and indexes. Generate migrations. *Deliverable: empty but complete schema, reviewable as code.*

**Phase 2 — Data import**
Build the idempotent Airtable→Postgres importer (all 139K records + attachments to object storage). Run it, verify counts and spot-check batches (D1310 must reconcile to 9.97%). *Deliverable: full historical data in Postgres.*

**Phase 3 — Read-only parity**
Port your existing dashboard (Overview, Batch Lookup, Records Browser, Production Report) to read from Postgres instead of Airtable. *Deliverable: new app shows the same numbers as the current dashboard — proves data correctness.*

**Phase 4 — Automations**
Port the 37 automations to Inngest functions, prioritized by importance (Press Slab Update heartbeat → grit/filler allocator → wastage rollup → resin decrement → the rest). Each validated against Airtable output for the same inputs. *Deliverable: automations run server-side, Batch Wastage / Slab Summary / Production Report finally populate correctly.*

**Phase 5 — Forms & write workflows**
Build operator entry forms (Mixer Cycle, Press, Polish Entry, Polish QC, MIS, SILO, RM) with validation, replacing Airtable forms/interfaces. Writes trigger the Phase 4 automations. *Deliverable: operators can enter a full batch end-to-end in the new app.*

**Phase 6 — Sync + parallel run**
Stand up the Airtable↔Postgres sync. Run both systems in parallel; compare outputs daily. Train operators on a few terminals. *Deliverable: confidence that new = old.*

**Phase 7 — Production deploy**
GitHub repo → Vercel (app) + Neon (DB) + Inngest Cloud (jobs) + Blob (files). Env vars, backups, monitoring. *Deliverable: live URL, optionally embedded at `pacific-surfaces.com/production` like today.*

**Phase 8 — Cutover**
Flip Postgres to system of record (forward-only freeze of Airtable per Option A→C). Decommission sync. Airtable kept read-only as archive. *Deliverable: new ERP is live; Airtable retired.*

---

## 7. Local-first → production path

You start entirely on your machine: `docker compose up` gives you Postgres + the app + Inngest dev server, no cloud needed. Everything in Phases 0–6 is developed and tested locally against a local copy of the imported data. Only at Phase 7 do we push to Vercel + Neon. Because the engine (Postgres) and job system (Inngest) are identical locally and in the cloud, "works on my machine" means "works in production."

---

## 8. Risks & mitigations

- **Automation fidelity** — porting 37 scripts is error-prone. *Mitigation:* port one at a time, diff output against Airtable on real batches before trusting each.
- **Serverless timeouts** — already designed around via Inngest steps.
- **Attachment volume** — large image sets slow the import. *Mitigation:* import in batches, store in object storage, run overnight if needed.
- **Operator adoption** — *Mitigation:* forms mirror current Airtable UX; parallel run lets operators learn without pressure.
- **Cost creep** — see below; all chosen services have free/low tiers that cover this workload initially.

---

## 9. Cost estimate (live, monthly)

Rough, USD, for this workload:

- **Vercel** — Pro ~$20/user/mo (Hobby free tier may suffice initially for one project; Pro needed for frequent cron + longer functions).
- **Neon** — Free tier ($5 spend cap) likely covers early use; Launch/Scale ~$19–49/mo as data/compute grows.
- **Inngest** — generous free tier; paid from ~$20/mo at higher volumes.
- **Object storage (Blob/R2)** — a few dollars/mo for typical attachment volume.

Early on this can run near-free; budget roughly **$40–100/mo** once fully live with headroom. Self-hosting the whole thing on a single VPS (~$10–40/mo) remains an option later since the stack is Docker-portable.

---

## 10. Immediate next steps (Phase 0)

Once you approve this plan, I will:

1. Create the workspace under `C:\Users\user\Desktop\ERP\` (or a new repo) and scaffold Next.js 15 + TypeScript + Tailwind.
2. Add Docker Compose with Postgres and wire up Prisma.
3. Set up Auth.js with OPERATOR / MANAGER / ADMIN roles and a login screen.
4. Start the Prisma schema from your existing `DATA_MODEL.md` and the Airtable schema (I can read it live via the Airtable connector).
5. Hand you a running local app to log into before we touch data.

---

## 11. Open questions to confirm before Phase 1

- **Attachments:** Which tables have attachment fields we must migrate (e.g. LAB colour-test photos)? Affects storage setup.
- **Sync direction:** During parallel run, one-way (Airtable→Postgres, read-only mirror) or two-way? One-way is simpler and usually enough.
- **Repo/hosting account:** Reuse the `vmundra-pacific` GitHub/Vercel accounts from the dashboard work, or a fresh one?
- **Auth method:** Email+password, magic link, or Google sign-in for staff?

These don't block Phase 0 — we can start scaffolding immediately and answer these by the time we hit data import.
