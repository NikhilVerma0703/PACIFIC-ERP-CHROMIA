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
