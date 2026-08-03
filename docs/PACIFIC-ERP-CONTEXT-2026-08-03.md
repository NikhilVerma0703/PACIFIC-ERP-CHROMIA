# Pacific ERP — Context: Robo Module + Bill Automation

**Written:** 3 August 2026
**Repo:** https://github.com/vmundra-pacific/Pacific-ERP (branch `main`)
**Relevant commits:** `9d36ae7` (Robo), `3af8ec1` (Bill Automation)
**Status:** both merged and pushed; neither is production-live yet (see §9)

This file is the handover record for two modules merged into the ERP. It is written
to be read cold — by another developer or a fresh AI session — with no other context.

---

## 1. ⚠️ FIRST: the local working copy is gone

At the end of this work the folder `C:\Users\user\Desktop\ERP` **no longer exists on
this machine**, and so do `C:\Users\user\Downloads\ROBO_MODULE-main` and
`C:\Users\user\Downloads\automation-main`. They were present and in use minutes
earlier (builds, tests and the final `git push` all ran from `Desktop\ERP`).
Nothing in this work deleted them — the only deletions performed were
`ERP/.next` (build cache), the superseded standalone Robo pages inside
`ERP/src/app/robo/`, and one temp script. Cause unknown; a cleanup/sync tool or a
manual move are the likely candidates.

**All committed code is safe on GitHub.** Verified against the remote after the fact:
`3af8ec1` and `9d36ae7` are both present.

### Recover with

```bash
cd ~/Desktop && git clone https://github.com/vmundra-pacific/Pacific-ERP.git ERP
```

Then restore the things git deliberately does **not** carry:

| Missing after clone | How to restore |
|---|---|
| `.env.local` | Recreate — needs `DATABASE_URL` (Neon), `NEXTAUTH_*`, and the two `FINANCE_ENGINE_*` vars from §6. Copy from Vercel → Project → Settings → Environment Variables. |
| `node_modules` | `npm install` |
| `automation/data/` | Finance engine runtime data: SQLite DB, bill images, `MASTER.xml`, trial balance. **Gone locally.** Re-export All Masters from Tally (§9 item 5). No bills had been processed yet, so nothing of value was lost. |
| `db-archives/`, `docs/consumables-integration-plan.md`, `chk4-tmp.cjs`, `pi-tmp.cjs`, `CRM Cost comparison.docx` | These were untracked in the working copy and are **not** in git. If they mattered, they need recovering from backup. |

The Neon database is untouched by any of this — all schema changes described below
are already applied there and survive independently of the local folder.

---

## 2. What the two modules are

### Robo module — shop floor
The Robo line sits inside the existing production flow:

```
Silos → Mixer → Distributor/Kreos → ROBO → Press → Oven → …
```

Robo does not run in every production. When it does, an operator sets up a **batch**
once (design, thickness, per-machine program/tool/liquid/powder/cycle-time for
Roycut-1, Roymix, Roycut-2, Roycut-3) and then logs each **slab** against it
(slab number, in/out times, RoyMix weight and cycle time, plus any delays).

Delivered as **one page, two forms** — `/robo`.

### Bill Automation — office
Staff pay for things out of pocket and hand in bills. The system reads each bill
(OCR), works out which expense ledger it belongs to, checks it is not a duplicate,
a human confirms three fields, and one Tally-importable Journal XML comes out per
batch:

```
Dr  <expense ledger>      the cost
Cr  <the person>          what the company owes them
```

The existing payment run settles the person against the bank afterwards, unchanged.
No LLM is involved — all matching is deterministic (fuzzy distance, TF-IDF cosine,
character n-grams, plus memory of past confirmations), so any coding decision can be
explained to an auditor and there is no per-bill cost.

---

## 3. Architecture — and why

### Robo: native, in-process
Everything is ordinary ERP code. The original standalone Next.js app was **not**
kept as a separate app; it was dismantled and rebuilt as one page inside the ERP
shell so the UI matches the rest of the system.

| Path | What |
|---|---|
| `src/app/robo/page.tsx` | The only Robo page. Server component → `<Shell>` + `<RoboEntryForm>` |
| `src/components/robo/RoboEntryForm.tsx` | Both forms — batch setup (collapses after save) + slab entry with inline delays |
| `src/components/robo/SearchableSelect.tsx` | Reusable combobox: search a master list, and "+ Add ⟨typed text⟩" when nothing matches |
| `src/app/api/robo/**` | 28 route handlers (kept from the original app, Prisma accessors renamed) |
| `prisma/seed-robo.ts` | Master data seed — `npm run db:seed:robo` |

**Deleted deliberately** (the original app's separate chrome): its own `layout.tsx`,
dark sidebar, dashboard, reports, masters admin pages, shift pages, delay-code admin.
The APIs behind them were kept so analytics can be wired into the ERP's existing
Live Status / Report / Lookup tabs later.

**There is no shift UI.** The schema requires every batch and slab to reference a
`RoboShift` row, so the form creates/reuses one silently per day and closes a stale
one when the date rolls over. Operators never see the word "shift".

### Bill Automation: separate service, proxied
The finance engine is Python (FastAPI) and **cannot run on Vercel** — it needs
Tesseract, OpenCV/scikit-learn, local disk for bill images, and LAN access to Tally.
It runs on the office PC next to Tally; the ERP talks to it server-side.

```
Browser  →  ERP (Vercel)  →  /api/office/finance/*  →  Finance engine /api/v1/*
                              adds X-API-Key + X-User      (office PC, Tally)
```

| Path | What |
|---|---|
| `automation/` | The Python engine (~7,000 lines). Its own README, API.md, SPEC.md, HANDOVER.md, DEPLOY-ERP.md |
| `src/app/office/finance/page.tsx` | The ERP page (server component; re-checks the role) |
| `src/components/office/FinanceBills.tsx` | The whole UI: upload → poll → review → confirm → preview → export |
| `src/app/api/office/finance/[...path]/route.ts` | The proxy. Holds the API key, stamps `X-User`, allow-lists six engine resources |

**The API key never reaches the browser.** That is the entire point of the proxy —
`API.md` specifies it and the implementation honours it. Do not add client-side
`fetch` calls to the engine.

`X-User` carries the logged-in ERP username into the engine, which records it
against every confirmation, override and export. That is what makes the audit trail
say "SHALMAN approved this" rather than "the system did".

---

## 4. Access control

Enforced in four places for each module: `src/middleware.ts`, the API route, the
page itself, and `src/components/Nav.tsx` (so no dead links are shown).

| Who | Robo (`/robo`, `/api/robo/*`) | Bill Automation (`/office/finance`, `/api/office/finance/*`) |
|---|---|---|
| `ADMIN` | ✅ | ✅ |
| `ROBO` (shop floor) | ✅ — **and nothing else** | ❌ |
| `FINANCE` (office) | ❌ | ✅ |
| `ACCOUNTS` (office) | ❌ | ✅ |
| Everyone else (`OPERATOR`, `INCHARGE`, `LINE_MANAGER`, `STORE`, `MAINTENANCE`, `COMMERCIAL`, `SALES`, all Fabrication and International Sales) | ❌ | ❌ |

### The new `ROBO` role
- Postgres enum value `ROBO` added to `Role` (additively — see §5)
- `src/lib/rbac.ts`: added to `RoleName`, `ROLE_RANK` (rank 1, same tier as OPERATOR),
  `ROLE_LABEL` ("Robo Operator"), and `creatableRoles` for the shop-floor branch —
  so any Incharge or above can create one in Users & Roles
- Middleware caps the role to `/robo` + `/api`; every other URL redirects back to `/robo`
- `Nav.tsx` gives it a single "Robo Entry" link — the form is its entire ERP

Both gates run **before** the branch blocks in `middleware.ts`. This is deliberate:
those blocks contain broad `if (p.startsWith("/api")) return;` allowances that would
otherwise let other departments reach these APIs.

---

## 5. Database state (Neon) — ALREADY APPLIED

All of this is live on the Neon database and independent of the local folder:

- **13 `Robo*` tables** — 34 SQL statements (13 tables, 9 unique indexes, 12 foreign keys)
- **`ROBO` added to the `Role` enum** — `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ROBO'`
- **Seed data**: 4 machines, 4 operators, 6 designs, 11 programs, 10 tools, 8 liquids,
  6 powders, 62 delay codes

The finance engine has its **own** SQLite database (`automation/data/finance.db`) and
stores nothing in Neon. The ERP holds no bill data at all — it renders what the engine
returns.

### 🚨 NEVER run `prisma db push` against this database

The Neon database has **drifted** from `prisma/schema.prisma`. It contains tables and
columns the schema does not know about:

- Tables: `downtime_response`, `entry_photo`, `login_attempt`, `sales_notifications`,
  `fg_dispatch_invoice`, `fg_sales_approved_batch`, `fg_sales_hidden_design`,
  `batch_range_edit`, plus manual backups `autofill_date_backup_0026`,
  `year_typo_backup_0027`, `date_fix_backup_0028`
- Columns: `sales_payment_divisions.amount_received`, `sales_packing_lists.accepted_at`,
  `sales_credit_notes.applied_at`, `sales_shipment_docs.discount_amount`,
  `proforma_invoices.payment_terms_data`, `sales_config.invoice_config_granite`,
  and several `updatedAt` defaults

Some are read by live code via raw SQL (`src/lib/downtimeResponse.ts`,
`src/lib/entryPhoto.ts`). `prisma db push` computes a full diff and **wants to drop all
of them** — it refused without `--accept-data-loss`, which would have destroyed
production data.

**The safe pattern used for both merges:**

```bash
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > diff.sql
# then filter to ONLY the intended statements, verify none reference other tables
npx prisma db execute --url "$DATABASE_URL" --file filtered.sql
```

Reconciling this drift properly is outstanding work (§9 item 7).

---

## 6. Environment variables

Added to `.env.local` (and needed in Vercel for production):

```bash
FINANCE_ENGINE_URL="http://localhost:8080"   # where the engine is reachable FROM the ERP server
FINANCE_ENGINE_KEY=""                        # must equal FINANCE_ENGINE_KEY in the engine's env
```

Generate the key with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

An empty key now means the engine **refuses** every request (see §8), unless
`api.allow_unauthenticated: true` is set for local development.

---

## 7. Defects found and fixed during the merge

### Robo module
| Defect | Impact |
|---|---|
| Next 15 route handlers used non-Promise `params` | Build failure |
| **9 call sites wrote `(prisma as any).tool/.liquid/.powder`** | The cast dodged both the rename and TypeScript. Tools/Liquids/Powders masters would have 500'd at runtime |
| `/api/robo/*` had no RBAC at all | Every signed-in user of any role could read and mutate Robo data |
| Shift creation was check-then-create | Two devices could create two ACTIVE shifts |
| Delays could not cross midnight | Night shift could not log a 23:50→00:10 delay |
| Slab + its delays saved non-transactionally | A mid-write failure duplicated the slab on retry |
| Shift date used `toISOString()` | Night shift got tomorrow's date (UTC vs IST) |
| `batchRecipes` returned with no `orderBy` | "Latest batch" was unspecified order — slabs could link to the wrong batch |

Also fixed: `src/app/mis/DowntimeLogCard.tsx` was missing `typeTotals` in its
destructuring — a **pre-existing** break in `HEAD` that stopped every build.

### Finance engine — 11 confirmed by adversarial review
These were found by reviewing the merged code against the money paths. Every one is
now fixed **and covered by a regression check** (the suite stands at 299).

| # | Defect | Why it mattered |
|---|---|---|
| 1 | **API key check failed OPEN** when no key was configured — and `config.yaml` ships with `key: ""` | As delivered, every accounting write was anonymous |
| 2 | `/export` accepted any bill IDs with **no status or duplicate check** | An unconfirmed machine guess, or a bill flagged as a duplicate payment, could reach Tally by naming its ID |
| 3 | XML escaping missed **quotes and control characters** | Names go into XML *attributes* (`LEDGER NAME="…"`); one apostrophe in `Prop's Travels` closed the attribute and corrupted the whole import file. Tesseract's `\x0c` did the same |
| 4 | Export refs had **minute granularity**, and the file was written *before* the DB row | Two exports in the same minute: the second overwrote the first one's XML, then failed on the UNIQUE constraint — books and records disagreeing |
| 5 | Batch and single-post duplicate guards were **disjoint** (`export_bills` vs `vouchers`) | The same bill could reach Tally twice — a duplicate payment |
| 6 | Vouchers named ledgers with a **different spelling** than the master they created (identity was whitespace-collapsed, output was raw) | Tally matches byte-for-byte; the import is rejected |
| 7 | Numeric character references were **deleted**, not decoded | "Caf&#233;" silently became "Caf" — a renamed ledger that no longer matches Tally |
| 8 | Exported bills were **locked forever** with no way back | If Tally refused the file, the reimbursement simply never happened |
| 9 | Uploads had **no size or type limit** | One mistaken huge upload fills the disk that holds the audit trail |
| 10 | The built-in Jinja UI has **no login at all**, on the same port as the key-protected API | Anyone on the office LAN could confirm bills and post to Tally, bypassing every ERP role check |
| 11 | `.gitignore` had an **inline comment** on the `data/ledgers.json` line | `#` only starts a comment at line start, so the pattern matched nothing — 1.3 MB of the live chart of accounts would have been committed. Caught on a dry-run before staging |

New engine surface added while fixing these:
- `POST /api/v1/exports/{ref}/void` — releases a batch Tally rejected (refused once
  marked imported; requires a reason; surfaced in the ERP UI as "Tally rejected it — void")
- `app.ui_enabled` in `config.yaml` — set `false` and only `/api/v1` is served
- `api.allow_unauthenticated` — explicit opt-in for keyless local dev

### ⚠️ ~27 findings were never verified
The review workflow hit session limits partway through. Those findings are **neither
confirmed nor dismissed** — treat them as open. The three worth looking at first,
because all would produce *silently wrong* data rather than visible errors:

1. Amount extraction may capture **"Total Qty" / "Total Items"** lines as the net amount
2. The **auto-approval guards** — which bands can skip human review, and what slips through
3. **Vendor-memory short-circuit** overriding text evidence for vendors used across
   multiple expense categories

---

## 8. Traps to know about

- **Never `prisma db push`** against Neon — see §5.
- **Never run `npm run build` while `npm run dev` is running.** Both write `.next`; the
  dev server then serves corrupted assets and pages render unstyled. This happened twice.
  Fix: kill the dev server, `rm -rf .next`, restart.
- **`.gitignore` has no inline comments.** A trailing `# …` becomes part of the pattern
  and silently matches nothing. Cost: nearly committed the chart of accounts.
- **`automation/data/` is real financial data** — SQLite DB, bill images, `MASTER.xml`
  (29 MB), the trial balance. Never commit it. Always dry-run
  `git add -An automation/` before staging.
- **The engine's built-in UI is unauthenticated by design.** In production
  `app.ui_enabled: false` is not optional.
- **Windows strips trailing spaces from directory names.** The engine's own test suite
  crashed on this (a test folder named `"  VARUN MUNDRA  "`); fixed by rebinding to the
  directory Windows actually created.
- Prisma's engine DLL is locked while the dev server runs — `prisma generate` fails with
  `EPERM`. Stop the dev server first.

---

## 9. Outstanding work

### Blocking production for Bill Automation
1. **Decide where the engine runs.** Needs Tally access and local disk — assumed to be
   the office PC. Confirm whether it is reachable from Vercel; if not, a **Cloudflare
   Tunnel** is the recommended answer (no inbound firewall changes).
2. **Set `FINANCE_ENGINE_URL` and `FINANCE_ENGINE_KEY` in Vercel**, matching the
   `FINANCE_ENGINE_KEY` set in the engine's own environment. Do not put the key in
   `automation/config.yaml` — that file is tracked in git.
3. ~~Set `app.ui_enabled: false`~~ — **done**, along with `app.host: 127.0.0.1` and
   `api.allow_unauthenticated: false`. These now ship locked down; see §8.
4. **Install Tesseract** on the engine machine: `winget install UB-Mannheim.TesseractOCR`.
   (Was installed on the dev box — v5.4.0 — but that box no longer has the repo.)
5. **Place a current `MASTER.xml`** (Tally → All Masters export) in `automation/data/`.
   The trial-balance bootstrap omits ~510 real ledgers; stale names cause import rejections.
6. **Back up `automation/data/`** — SQLite DB plus every bill image. It is the audit trail
   and it is not in git.

### Not blocking
7. **Reconcile the Prisma/Neon drift** (§5) — needed before anyone does routine schema work.
8. **Triage the ~27 unverified engine findings** (§7).
9. **Robo analytics** — live status, production report, batch/slab lookup for the Robo
   line were deliberately deferred. The APIs exist; wire them into the existing tabs.
10. **Re-clone the working copy** and restore `.env.local` (§1).

---

## 10. Command reference

```bash
# ERP
npm install
npm run dev                     # localhost:3000 — do NOT build while this runs
npm run build
npm test                        # 13 tests
npm run db:seed:robo            # Robo master data (already applied on Neon)
npx prisma generate             # stop the dev server first (DLL lock)

# Finance engine (from automation/)
pip install -r requirements.txt
python run.py                   # preflights Tesseract + ledger master, then serves :8080
python tests.py                 # 299 checks, all must pass
python -m uvicorn app.main:app --host 127.0.0.1 --port 8080   # skip preflight

# Safety check before any commit touching automation/
git add -An automation/ | grep -E "data/|\.xlsx|\.db$|MASTER\.xml|__pycache__"   # must be empty
```

---

## 11. Where to read more

| Topic | File |
|---|---|
| Engine ↔ ERP HTTP contract | `automation/API.md` |
| Engine production setup | `automation/DEPLOY-ERP.md` |
| Engine design rationale | `automation/README.md`, `SPEC.md`, `HANDOVER.md` |
| Why the Tally XML looks the way it does | module docstrings in `automation/app/export_batch.py` and `app/tally.py` — they record what was verified against live PESPL data on 30 July 2026 |
| Access rules | `src/middleware.ts`, `src/lib/rbac.ts` |
