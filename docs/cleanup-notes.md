# Module 1 cleanup notes — shared libraries (behavior-frozen)

Date: 2026-07-10 · Branch: main · Scope: `src/lib/tables.ts`, `src/app/tables/actions.ts`,
`src/lib/silo.ts`, `src/lib/rbac.ts`, `src/lib/branch.ts`, `src/lib/stationAccess.ts`,
`src/lib/recordSmart.ts`. Constraints honoured: identical behavior, same-or-stronger
security, no DB schema/index changes, no API shape changes, no edits outside scope.
Verified: `npx tsc --noEmit` clean after every file; `node --experimental-strip-types
--test tests/*.test.ts` 10/10 pass; hostile line-by-line diff review (gate truth tables,
error paths, anonymous-session behavior, NUL-escape source text) found one issue —
an accidental CRLF→LF flip in stationAccess.ts — which was fixed before commit.

## Per-file changes

### src/lib/rbac.ts — reviewed, intentionally untouched
Already tight: `currentUser` is `react.cache()`-wrapped (one auth + one User query per
request shared by every gate), roles/ranks are data-driven, no duplication worth the
churn in the auth core. Zero-diff is the right diff here.

### src/lib/branch.ts (−14 lines)
- Collapsed the three private one-shot helpers (`isAdminSession`, `isSalesSession`,
  `isStoreSession`) into pure `roleOf(u)` / `branchOf(u)` accessors; `canWriteModel`
  and `canSeeModel` now resolve the session user once and test the same predicates in
  the same order (HIDDEN → STORE → SALES/COMMERCIAL → admin-only gates → branch).
- Merged the two identical admin-gated `return false` lines in `canWriteModel` into one
  `(READONLY_TABLES || ADMIN_ONLY_TABLES) && rank < ADMIN` check — same truth table.
- `currentBranchName()` delegates to `branchOf` (same mapping, unknown/absent branch
  still falls back to SHOP_FLOOR).
- Moved the stray "Retired tables" doc comment to sit on HIDDEN_TABLES, which it
  actually describes. Killed 5 `as any` casts.

### src/lib/stationAccess.ts (11/11 lines)
- Extracted pure `accessOf(user)` from `entryAccess()`; `canUseEntryModel` now derives
  the entry map from its already-fetched user instead of a second `currentUser()` round
  trip through `entryAccess()`. Same MIN_ENTRY_RANK check, same office/sales/incharge/
  station branches. Killed 4 `as any` casts.

### src/lib/recordSmart.ts (+9 lines)
- New exported `nextIncrementValue(model, field, where)` — the max+1 aggregate that was
  copy-pasted between `recordDefaults` and actions' `stampIncrements`. Returns null on
  lookup failure so both callers keep their "leave the field unset" semantics.
- `recordDefaults` now fires the clone-source `findFirst` and the increment aggregate in
  PARALLEL (they were sequential and independent). Failure semantics preserved exactly:
  sync/async errors in either query resolve to null/skip, as the old try/catch did
  (`Promise.resolve().then(...)` wrapper keeps even a missing-delegate TypeError inside
  the rejection path).

### src/lib/tables.ts (~0 net)
- `listRows`: `tableMeta(model)` was called up to 3× per request (search, empty-filter,
  sort); hoisted to one lookup. Empty-filter existence check simplified `find`→`some`
  (same truthiness). The empty-filter still overwrites a search OR, as before.
- `coerceField`: number/int parsed once instead of twice per value.
- `selectOptions`: replaced three `any[]` row types with `Record<string, unknown>[]` /
  `{ v: unknown }[]` (annotations only — zero runtime change).
- fieldmap.json parsing: confirmed already memoized at module level (`_meta` in
  `load()`), so no change needed — every `tableMeta`/`allTables` call after the first
  is a map lookup. The 5-minute `selectOptions` cache is likewise already in place.

### src/app/tables/actions.ts (−3 lines, the risk-dense file — smallest possible diff)
- `stripNuls(values)` helper replaces the two byte-identical NUL-sweep loops (buildData
  + the pre-INSERT choke point). Same regex-free `replaceAll("\u0000")` behavior; both
  call sites still run at the same points in the flow.
- `stampIncrements` now uses shared `nextIncrementValue` (identical where-construction,
  identical skip-on-failure).
- `saveRow`: `currentUser()` was awaited up to 3× (operator check, photo stamp, QC
  autolink `by`); now fetched once after the branch gate and passed down. Gate ORDER
  unchanged: canWriteModel → canRectify → operator self-edit check.
- `SLAB_STATIONS` set hoisted to module scope (was rebuilt on every create).
- Deleted the `prismaTx()` identity wrapper (3 `$transaction` sites now use `prisma`
  directly) and the dead `createdAirtableId` variable + `void` suppression.
- Untouched on purpose: every validation message, every dupe guard, the Silo/RM atomic
  transaction, advisory-lock keys, Telegram alerts, revalidatePath calls, deleteRow.

### src/lib/silo.ts (−6 lines)
- `supplierOf` + `toRmBagOption` extracted: `getAvailableRmBags` and
  `searchAvailableRmBags` had byte-identical 20-line mapper/label blocks; both now
  `rows.map(toRmBagOption)`. Labels, fallbacks and the parameterized SQL unchanged.
- `emptyFormInfo(s)` replaces four copies of the empty SiloFormInfo literal
  (`siloKind(s)` provably returns the same kind the literals hardcoded: GRIT list →
  "grit", filler buffers match /filler|buffer/i).
- `getSiloFormStatus`: the deficit-placeholder query now runs in PARALLEL with the
  live-bags query. Failure semantics preserved: deficit failure still leaves
  `deficitKg` undefined (consumers all use `?? 0`); bags failure still returns the
  grit-only fallback (the pre-fired deficit promise carries a `.catch` so it can never
  surface as an unhandled rejection).

## Measured / estimated query & latency reductions
- No DB query-count change from the `currentUser()` consolidation in normal request
  flow — `react.cache()` already deduped it to 1 auth + 1 User row per request. The win
  is structural (fewer await chains, no reliance on cache semantics) — claimed honestly
  as 0 queries saved, ~2 promise hops removed per save.
- `recordDefaults` (every smart-form load & key change): 2 sequential Neon round trips
  → parallel; saves ~1 RTT (est. 50–150 ms cold, 20–50 ms warm).
- `getSiloFormStatus` (every silo/emptying form load): 2 sequential round trips →
  parallel; saves ~1 RTT of the same order.
- `listRows`: 2 redundant (memoized) `tableMeta` map lookups removed — negligible, but
  free.
- Everything else (selectOptions TTL cache, fieldmap memoization) was already in place;
  verified rather than re-invented.

## Security review statement
Every gate was preserved verbatim in predicate and order; I verified truth-table
equivalence case-by-case for `canWriteModel`, `canSeeModel`, `canUseEntryModel`,
`entryAccess`, and the saveRow/createRow/deleteRow gate chains, including the
anonymous-session (null user) and role-less edge cases — outputs are identical to the
old code for every (role, branch, station, model) combination. Nothing was widened; no
new inputs are trusted; the only raw SQL (`searchAvailableRmBags`) keeps its `$1`
parameterization and `selectOptions`' interpolated identifiers still come only from
deploy-time fieldmap.json. NUL-byte stripping (22021 protection) is now one shared
helper applied at exactly the same two points. Operator self-edit restriction, STORE
production-entry block, admin-only delete, and the atomic Silo/RM double-dump guard are
untouched.

## Index candidates (NOT applied — for later approval; would need `prisma db push`/migration)
1. `Mis (date, hour)` — the one-row-per-hour dupe guard runs `findFirst` on every MIS
   create against a date-range + hour predicate.
2. `Press/Oven/Jot/Distributor/Kreos (batchKey, slabNumber)` — double-entry guard on
   every slab-station create.
3. `PolishEntry (slabNumber)`, `PolishQc (slabNumber)` — dupe guard + QC autolink
   lookups.
4. `MixerCycle (batchKey, cycle)` — cycle dupe guard.
5. `Silo (siloNo, remainingWeight)` — silo overview / form status / emptying FIFO all
   filter on this pair; today they scan by siloNo only.
6. `Silo (airtableId text_pattern_ops)` if `airtableId` is not already usable for the
   `startsWith "deficit_"` prefix scans (unique index exists but prefix match needs
   pattern-ops class under non-C collation).
7. `rm (cardinality(silo)) WHERE status IS NULL OR status='Accepted'` partial/expression
   index — powers both the picker (`siloIds isEmpty`) and the ILIKE search's base
   filter; plus `rm (date DESC)` for its ordering.
8. `ResinStorage (tankNo, date, resinId)` — FIFO lot selection per prep.
9. `PolishQc (importedAt, qualityGrade)` — the daily C-grade alert count.

## Next-module suggestions
1. **Backfill & store flows** (`src/lib/backfill.ts`, `/store` actions): the 60-line
   SiloEmptyingLog and DailyResinTank FIFO blocks inside `createRow` mirror logic that
   lives there; extracting them next to `absorbSiloDeficit`/`writeOffSiloDeficit` would
   shrink actions.ts by ~120 lines behavior-frozen.
2. **Batch actions** (`src/app/batch/*`): same rbac/gate call patterns as tables
   actions; likely the same currentUser/tableMeta duplication.
3. **Entry & tables pages** (`src/app/entry/page.tsx`, `src/app/tables/*`): they loop
   `canSeeModel`/`canUseEntryModel` per table — a batched `visibleModels(u)` helper
   (one user fetch, N set lookups) would cut dozens of awaits per page render.
4. **createRow decomposition**: per-model post-create hooks (Jot alert, QC autolink,
   silo absorb, tank deduct) behind a small registry — biggest readability win left in
   this file, still behavior-frozen.


## International Sales batch — 2026-07-10 (7 user-reported items, one commit each)

Scope: /sales + /api/sales only. Every commit tsc-clean, tests 10/10, verified
against the LIVE Neon DB where a claim depended on data. SP/user ids remain
plain TEXT resolved via lib/sales/spLookup (no relation includes were added
anywhere); all raw SQL stays parameterized ($1…).

### 1. Quartz/Granite filter did nothing (f967fb9)
`proforma_invoices.product_type` in the live DB is the `"ProductType"` enum —
the route comments claimed TEXT, and the four raw filter queries compared
`product_type = $1` with a text parameter → Postgres 42883 ("operator does not
exist: ProductType = text"). Effect: clicking Quartz/Granite on the PI or
Orders list 500'd, the client's `Array.isArray` guard turned it into an empty
list; on the dashboard the `.catch(() => [])` around the same query silently
collapsed Commercial/Accounts counts to `id IN ()` = zeros. Fix: compare
`product_type::text = $1` in all four sites (api/sales/pi, api/sales/orders,
lib/sales/dashboardData ×2) — works whether the column is enum or text.
Verified live: 23 QUARTZ / 151 GRANITE PIs match.

### 2. Part payments (5329d49)
New nullable `sales_payment_divisions.amount_received double precision`
(scripts/0024-payment-partial-amount.sql, APPLIED to live Neon 2026-07-10 —
trivially additive, no approval needed per the additive-only rule; recorded
here). Following the 0019 convention it is NOT in the Prisma model — raw SQL
read/write only, so stale deploys can't P2022.
- PATCH /api/sales/payments/[id] accepts `{ amountReceived }` = CUMULATIVE
  amount received. Below the installment amount: division stays
  PENDING/OVERDUE, paidAt stays null, balance tracked, order does NOT
  auto-advance. At/above: identical to Mark Paid (paidAt + status PAID + the
  existing all-advances-paid → PENDING_STOCK_CHECK hook). Gate unchanged
  (SALES_ADMIN/ACCOUNTS). Mark Paid/Undo sync amount_received to full/NULL, so
  Undo returns a division to cleanly-unpaid (a pre-existing partial is not
  reconstructed — documented trade-off, no history table).
- Payments tab: Part Pay button + modal (validates 0 < x ≤ balance, sends the
  new cumulative total), "Received X · Bal Y" line on partially-paid rows,
  and the Pending/Overdue/Received cards + By-Customer grouping now count
  outstanding balances / include partial receipts instead of face amounts.
- Order detail Payment Schedule shows "Part paid: X received · balance Y" and
  the progress bar includes partial receipts (GET orders/[id] and GET payments
  expose amountReceived via the existing raw-extras SELECT).
- Order log gets PAYMENT_PARTIAL entries with amounts.

### 3. Dashboard clickable (28f7cfd)
All 8 KPI cards are now Links: orders cards → /sales/orders(?status=…), PI
cards → /sales/pi(?status=…); Recent Orders order numbers → order detail.
The orders/PI lists initialize their status tab from ?status= (validated
against the page's known filter tabs) via useSearchParams, with the page
wrapped in the Suspense boundary Next 15 requires for prerender. Visuals kept
(only a hover affordance added). Note: the dashboard has no clients/payments
KPI cards today, so there was nothing to wire for those two — the Pending
Payment card deep-links to the orders list (works for every role; SALESPERSON
has no /sales/payments access).

### 4. "PDF engine not installed" on PI PDFs (7ac5991)
Both PI templates (Quartz piPdf.ts, Granite piGranitePdf.ts) render HTML via
puppeteer, which is deliberately not a dependency — on Vercel every PI
download AND every PI send/resend (attachment) threw the engine error. New
lib/sales/pdf/piPdfmake.ts renders the PI through pdfmake (already a
dependency; powers CI/packing/stuffing docs) with the per-productType company
block (PESPL vs PGI), and `generatePiPdfAuto()` picks the engine: puppeteer
HTML template when installed, pdfmake when absent or when the HTML render
fails at runtime (e.g. no Chrome). The catchable error now only surfaces with
truly no engine. pdf/send/resend routes switched to it. Side fix: send/resend
always used the Quartz template even for Granite PIs; via the auto function
they now get the correct PGI layout. Verified with puppeteer absent against
live data: IMP-PGI-P0002 (13 items) + PI-ADM-0174 render valid PDFs.
Note: the pdfmake layout is a clean equivalent, not pixel-identical to the
HTML reference; installing puppeteer on a server restores the exact templates
automatically.

### 5. Orders page validation (de6f14f + fixup d670ccc)
Read list + detail + every routed action end-to-end. Broken and fixed:
- The "Delayed" filter chip and empty PI/SP cells were plain JS strings
  containing HTML entities (&#x26A0;, &#x2014;) — React escapes JS strings, so
  the UI showed the raw entity text. Replaced with real characters (payments
  page had the same bug, fixed in item 2's commit; my own new Suspense
  fallbacks briefly reintroduced the class as JSX-text \u2026 — caught in
  self-review, fixup d670ccc).
- Generic PATCH /api/sales/orders/[id] accepted a `status` write from ANY
  sales session, bypassing the duty gate + advance-paid PACKING block that the
  dedicated /status route (used by every UI action) enforces. Status via the
  generic PATCH now requires the same duties; deliveryTerms/notes unchanged.
  No UI caller exists (verified by grep).
Validated-fine (no change): SP/RM scoping via spLookup stitching, Load More
dedupe, date filters, StatusFlow advance/cancel + ADVANCE_UNPAID 422 banner,
stock-check → PACKING / PENDING_PRODUCTION transitions, payment-division
extend/waive/reminder actions, credit-note lifecycle incl. apply/unapply,
packing-list, commercial invoice, shipping docs, port arrival wiring.
Known limitation (unchanged): the Delayed chip filters only the loaded page
(client-side over paginated data) — a server-side delayed filter would be a
behavior change beyond this pass.

### 6. Delete PI (fa45488)
DELETE /api/sales/pi/[id]: salesAuth (salesGate-backed) + duty check —
SALES_ADMIN and REPORTING_MANAGER delete any PI; SALESPERSON only their own
(pi.spId === session id, plain TEXT compare); Commercial/Accounts 403. A PI
referenced by an order (pi.orderId or order-side relation, both checked) is
never deleted: 409 explaining the order number and that deleting a PI never
deletes an order. Children with real DB FKs (pi_rejection_logs, pi_revisions —
0019) are deleted with the PI in one $transaction; verified live with a
throwaway PI+log+revision. UI: Delete PI button on the detail page (rendered
from /api/sales/me role + ownership, server re-checks), confirm() dialog,
order-linked PIs get the explanation instead of a delete, success returns to
/sales/pi.

### 7. Clients "could not be added" (4343204)
They WERE added — Vercel runtime logs (7d) show a lone 201 and zero 4xx/5xx on
/api/sales/clients, and a live create with the exact route payload succeeds.
Root cause: GET /api/sales/clients defaulted to limit=10 (name-ASC) and both
UI callers (clients page, PI form client dropdown) fetch with NO params — with
227 clients in the DB, any new client past the first ten alphabetical never
appeared anywhere, indistinguishable from "add failed". Fix: no limit param →
return the FULL scoped list (explicit limit/page still honoured; SP/RM/admin
scoping untouched). Same-path repairs found while diagnosing:
- Edit modal has no address input, but PATCH blanked address to "" on every
  save (unconditional field spread) → PATCH now only updates fields present in
  the body.
- The form's City input was silently discarded (no DB column, route stripped
  it) → added nullable sales_clients.city (scripts/0025-sales-client-city.sql,
  APPLIED live 2026-07-10; in the Prisma model — safe because the column
  landed before any dependent code deploys) and wired create/edit/table.
- POST coerces the NOT NULL country ("" fallback) and returns the real
  failure reason instead of an opaque 500; the form surfaces it (and no longer
  dies on a non-JSON error body).
- Client delete used to 500 silently on the PI/order FK and the row "came
  back" on reload → 409 "This client has PIs or orders and cannot be
  deleted.", alerted in the UI.

### DB changes (all applied, all additive)
- scripts/0024-payment-partial-amount.sql — sales_payment_divisions.amount_received
  double precision NULL (raw-SQL-only, not in Prisma model). Applied 2026-07-10.
- scripts/0025-sales-client-city.sql — sales_clients.city text NULL (in Prisma
  model; column applied before code). Applied 2026-07-10.
No SQL is awaiting approval — nothing non-trivially-additive was needed.

### Deferred / not done
- Server-side "delayed" filter for the orders list (see item 5).
- Payments/clients KPI cards on the dashboard (none exist to wire; item 3).
- Part-payment history (multiple receipts per division are accumulated into
  one cumulative figure; individual receipts live only in the order log).
- Legacy imported records store salesperson NAMES in created_by_id/sp_id
  ("import:PGI:ABHI", …) — spLookup already degrades gracefully; a backfill to
  real user ids would make RM/SP scoping cover imported rows, needs a mapping
  decision from the business.
- GET /api/sales/pi/[id] has no per-SP ownership scoping (any sales session
  can open any PI by id) — pre-existing, left untouched in this batch; flag
  for a dedicated pass if it should be tightened.

# Telegram /ask quality packs — slab + design subjects (2026-07-11)

Scope: `src/lib/telegramAsk.ts` only. Extends the f09ba16 batch bad-vs-good
COMPARISON PACK to two more subjects behind the same trigger words
(defect|reject|qc|grade|param|why|cause|analy|compare): named slab numbers
(5-7 digits, up to 3) each get "SLAB n VS ITS BATCH'S GOOD SLABS" — the slab's
own press row + JOT thickness/bend vs the batch good-group mean (slab itself
excluded), top 10 by |relative diff| with the ±2% floor, plus its QC
grade/JOT defect status (works for good slabs too); a named design (matched
against the fg catalogue) gets "DESIGN COMPARISON PACK" — its last-60-days
press batches (cap 10) pooled through the same delta math, led by a per-batch
bad-rate line. Batch block unchanged (live-verified, ~766 tok). Slab/design
blocks deliberately carry no per-batch mixer/line/silo context. Refactored
in place: badGoodPools / pressJotRows / qcGradesAndDefects / evenSample are
shared by all three subjects; rankDeltas gained minBad (=1 for single-slab).
Caps: subject blocks 6000 chars (~1.5k tok) each; combined quality section
12000 chars (~3k tok) — the noted modest raise over the single-subject 9000,
which the batch block still keeps internally.

Hostile review fixes (all live-tested against Neon):
- Design subject took the first catalogue hit: prefix design "Carrara Royal"
  shadowed "Carrara Royale" and the block silently vanished → longest hit
  first, falling through until a design yields data.
- Design catalogue LIMIT 300 vs 408 live designs: later-alphabet designs
  (e.g. Super White) could never match — also broke the pre-existing ASKED
  DESIGNS lines → shared catalogue query, LIMIT 1000.
- Per-batch bad-rate denominator was the 60-day-windowed press count →
  impossible "1278: 15/13 bad" for re-imported old batches → all-time press
  count per selected batch ("15/72").
- Degenerate "none of the 0 comparable parameters" wording when one side has
  <3 parameter rows → explicit too-few-rows message (batch/slab/design).

Verified: tsc --noEmit clean; tests 10/10; live sizes — batch 1376 block
2989 chars (~766 tok), slab 146816 block 895 (~229), design Carrara Royale
block 1295 (~332); combined batch+slab+design pack 11698 chars < 12000 cap;
nonexistent batch/slab/design degrade to the normal pack (max_tokens stays
400); model stays claude-haiku-4-5; webhook flow untouched.

Deferred:
- Multiple named slabs from the same batch re-fetch that batch's pools (≤3
  subjects, 2 extra round-trips worst case); a per-request cache would fix.
- Design→batch linkage is press.design_name = catalogue name (exact,
  case-insensitive); renamed/misspelled press design names won't pool.
- Bad rates use pressed slabs as denominator; a batch with incomplete QC
  coverage understates its true rate.
- entry_hour_ist still participates in delta ranking (inherited from the
  batch design): a lone slab pressed at an odd hour tops its list —
  informative, but it can crowd out physical parameters at rank 1.
