# Pacific ERP

Next.js 15 (App Router) + React 19 + Prisma 6 + TypeScript ERP for Pacific Surfaces
(quartz/stone slab manufacturing). Postgres on Neon. Auth via next-auth v5 beta.
Deployed on Vercel.

## Commands

```bash
npm run dev            # next dev
npm run build          # prisma generate && next build
npm test               # node --test over tests/*.test.ts
npm run test:chromia   # vitest over tests/chromia/** (the Chromia module's own suite)
npm run db:push        # prisma db push
npm run db:migrate     # prisma migrate dev
npm run db:seed        # tsx prisma/seed.ts
npm run db:seed:robo   # tsx prisma/seed-robo.ts
npm run db:seed:chromia # tsx prisma/seed-chromia.ts (Chromia master data)
npm run import         # tsx scripts/import.ts
```

`gen:schema` invokes `python3`, which does not resolve on Windows — use `py` or `python`
(Python 3.14 is installed for the finance engine in `automation/`).

## Finding code — read this first

This repo is indexed by CodeGraph (`.codegraph/` at root). **Use it before grep/find or
reading files.**

```bash
codegraph explore "<question or symbol names>"   # source + call paths in one shot
codegraph query "<symbol>"                       # locate a symbol
codegraph impact "<symbol>"                      # blast radius before a change
```

CodeGraph indexes `.ts .tsx .js .py .yaml` only. It does **not** parse `.prisma` —
use the model index below for schema lookups.

## Prisma schema — do not read the whole file

`prisma/schema.prisma` is **165 KB / ~45k tokens / 111 models / 26 enums**. Reading it
whole burns a fifth of the context window. Jump to the line numbers below instead:

```bash
sed -n '3285,3320p' prisma/schema.prisma      # e.g. RoboBatchRecipe
```

### Core / reference
`User` 55 · `GritMaster` 83 · `SupplierMaster` 106 · `ResinStorage` 138 · `DailyResinTank` 159
`Rm` 192 · `UnassignedRm` 244 · `UsedBags` 274 · `SyncState` 2000 · `ActionLog` 1982
`DesignAlias` 2474 · `SummaryTable` 1952

### Production line — machines & cycles
`Silo` 323 · `SiloEmptyingLog` 527 · `MixerCycle` 384 *(137 fields — largest model)*
`Distributor` 629 · `Robot` 737 · `Kreos` 834 · `Press` 941 · `Oven` 1043
`RoyMixerCycle` 1091 · `MixerCycleSummary` 1962

Machine change-parameter models: `ChangeParametersDistributor` 689 ·
`ChangeParametersRobot` 789 · `ChangeParametersKreos` 895 · `ChangeParametersPress` 996 ·
`ChangeParametersOven` 1070 · `ChangeParametersRoyMixerCycle` 1417 ·
`ChangeParametersPigment` 1480

### Robo module (namespaced `Robo*`, added commit `9d36ae7`)
`RoboMachine` 3203 · `RoboDesign` 3213 · `RoboProgram` 3222 · `RoboTool` 3231 ·
`RoboLiquid` 3237 · `RoboPowder` 3243 · `RoboOperator` 3249 · `RoboDelayCode` 3256 ·
`RoboShift` 3266 · `RoboBatchRecipe` 3285 · `RoboBatchRecipeEntry` 3303 ·
`RoboProductionRecord` 3320 · `RoboDelayLog` 3339 · `RoboImportLog` ~3357

### Chromia module (namespaced `Chromia*`, tables `chromia_*`)
Mounted at `/chromia` — Shop Floor → Chromia. Ported from the CHROMIA_MODULE
standalone app; gated by the `CHROMIA` role exactly like Robo. Not to be confused
with the legacy Airtable mirrors `Chromia1` / `ChromiaPar1` below.

Masters: `ChromiaUser` 4338 *(dormant)* · `ChromiaAuditLog` 4359 · `ChromiaBaseMaterial` 4379 ·
`ChromiaDesign` 4400 · `ChromiaMachine` 4422 · `ChromiaLocation` 4444 · `ChromiaStageDefinition` 4474 ·
`ChromiaDefectType` 4492 · `ChromiaRecalibrationReason` 4513 · `ChromiaSupplier` 4531 · `ChromiaCustomer` 4550

Core: `ChromiaBatch` 4571 · `ChromiaSlab` 4599 *(the hub)* · `ChromiaProcessCycle` 4678 ·
`ChromiaStageRecord` 4729 · `ChromiaSlabEvent` 4779 *(append-only)* · `ChromiaSlabMovement` 4811

Stage details: `ChromiaIncomingDetail` 4837 · `ChromiaPrimerDetail` 4858 · `ChromiaPrintingDetail` 4878 ·
`ChromiaMouldingDetail` 4905 · `ChromiaCoolingDetail` 4923 · `ChromiaPolishingDetail` 4941 ·
`ChromiaUvPolishingDetail` 4958

Outcome: `ChromiaQcRecord` 4981 · `ChromiaQcDefect` 5017 · `ChromiaGradeDecision` 5037 ·
`ChromiaRecalibrationCycle` 5072 · `ChromiaDispatch` 5137 · `ChromiaStockEntry` 5163 ·
`ChromiaSampleCutting` 5185 · `ChromiaWasteRecord` 5207 · `ChromiaImportBatch` 5236

### Quality / lab / polish
`Lab` 1138 · `Jot` 1188 · `PolishEntry` 543 · `PolishQc` 573 · `Chromia1` 1901 ·
`ChromiaPar1` 1933 · `NazzBhai` 1877

### Slabs & inventory
`SlabWiseInventory` 1512 · `SlabSegregation` 1596 · `SlabSummary` 1637 *(93 fields)* ·
`SlabEvent` 2485 · `BatchShadeGroupTable` 1621 · `FinishedSlab` 2427 · `CuttingEntry` 2021
`Inventory` 1451 · `InventoryStock` 2570 · `InventoryEntry` 2627 · `OpClStock` 1735
`Wastage` 1402 · `BatchWastage` 1786

### Fabrication (`Fab*`)
`FabProject` 2135 · `FabMachine` 2108 · `FabMachineSession` 2121 · `FabDrawing` 2152 ·
`FabSlab` 2170 · `FabSlabJob` 2195 · `FabRequirement` 2215 · `FabRequirementAllocation` 2250 ·
`FabPiece` 2262 · `FabSlabAllocation` 2293 · `FabOperation` 2305 · `FabPieceOperation` 2324 ·
`FabPackage` 2341 · `FabPackagePiece` 2352 · `FabDispatch` 2363 · `FabResidualBag` 2377 ·
`FabResidualPiece` 2390

### Sales & shipping (`Sales*`)
`SalesClient` 2755 · `SalesManagerAssignment` 2743 · `SalesOrder` 2859 · `SalesOrderLog` 3138 ·
`SalesPaymentTerms` 2891 · `SalesPaymentDivision` 2919 · `SalesStockCheck` 2942 ·
`SalesProductionJob` 2965 · `SalesPackage` 2985 · `SalesPackingList` 3002 ·
`SalesContainer` 3017 · `SalesShipmentDocs` 3036 · `SalesPortArrival` 3097 ·
`SalesAdminAlert` 3120 · `SalesConfig` 3151 · `SalesCreditNote` 3176
`ProformaInvoice` 2784 · `PIRevision` 2833 · `PIRejectionLog` 2848 · `ShippingInvoice` 1806 ·
`DebitNote` 1751

### Consumables & costing
`ConsumablesAndRate` 1222 · `RmAndConsumablesConsumption` 1315 *(81 fields)* ·
`ConsumableDepartment` 2509 · `ConsumptionEntry` 2608 · `ProductionConsumable` 2539 ·
`PolishingConsumable` 2555 · `DirectMaterial` 2521 · `FilmRoll` 2593
`Costing` 1280 · `Mis` 1537 · `ProductionReport` 1851
`CostingRate` (hand-written, end of file) — the effective-dated rate card behind
/office/costing; `consumables_and_rate` and `costing` are Airtable mirrors, do not write to them

## Layout

```
src/app/          22 route groups: (dash) admin api batch consumables cutting entry fab
                  inventory live login mis office records report resin robo sales silo
                  slab store tables
src/components/   shared UI + chromia/ consumables/ inventory/ office/ robo/
src/lib/          domain logic + chromia/ consumables/ fab/ inventory/ sales/
                  chromia/ holds the whole ported module: config/ constants/ types/
                  validation/ server/{actions,services,repositories,exports} plus the
                  seams db.ts, current-user.ts, logger.ts, actors.ts, access.ts, tier.ts
src/types/
prisma/           schema.prisma, seed.ts, seed-robo.ts, seed-chromia.ts (no migrations dir — schema
                  changes go to Neon out-of-band; db push is BLOCKED by drift, see note)
automation/       Bill Automation finance engine (Tally XML, OCR); data/ holds MASTER.xml,
                  finance.db, ledgers.json — runtime data, not code
scripts/          import.ts, gen-schema.py, fieldmap.json
tests/            node --test, *.test.ts; tests/chromia/ is the module's own
                  vitest suite (26 files, 352 assertions) — `npm run test:chromia`
docs/             PACIFIC-ERP-CONTEXT-2026-08-03.md is the module handover record
```

## Context docs at repo root

`context.md` (140 KB — large, read selectively), `ERP-Migration-Plan.md`,
`review-fix-plan.md`, `audit-triage.md`, `DEPLOY.md`, `RTA_REQUEST_SUMMARY.md`.

## Notes

- Robo module and Bill Automation are merged (`9d36ae7`, `3af8ec1`) but **not production-live**.
  See `docs/PACIFIC-ERP-CONTEXT-2026-08-03.md` §9 for remaining items.
- **Chromia replaced its earlier integration.** The first attempt wired it as a
  department (`Branch.CHROMIA`, the Fabrication shape): 10 hand-written pages, its
  own `src/lib/chromia` domain layer, `scripts/0039-chromia-module.sql`, a
  provisioning script and a GitHub workflow. All of that is gone. The module is now
  the standalone CHROMIA_MODULE app ported in whole and mounted the way Robo is: a
  capped `CHROMIA` **role**, routes under `/chromia`, APIs under `/api/chromia`,
  models `Chromia*`, module code under `src/lib/chromia` + `src/components/chromia`.
  Neon: `scripts/0045-drop-chromia-module.sql` (destructive) → `0046-chromia-module.sql`
  → `0047-migrate-chromia-branch-users.sql`. Not yet production-live.
- `Branch.CHROMIA` is retained **only** so logins created by the old integration
  still decode; it is offered nowhere in the UI. `middleware.ts`, `Nav.tsx` and
  `branch.ts` carry clearly-marked transitional clauses that go once 0046 has run
  and no user carries that branch.
- `chk4-tmp.cjs`, `pi-tmp.cjs`, `db-archives/` are untracked local files, not part of the repo.
- Neon database holds all schema changes already; it is independent of this working copy.
- **Schema drift is reconciled as of 2026-08-12 — `db push` no longer proposes anything
  destructive.** It previously wanted to DROP five whole tables created by other sessions
  (`fg_dispatch_invoice`, `fg_sales_approved_batch`, `fg_sales_hidden_design`,
  `login_attempt`, `sales_notifications`) plus **16 Sales columns** that existed in Neon and
  not in this file — `sales_shipment_docs` alone was missing seven. All are now modelled,
  each describing the column exactly as it already exists.

  Verify before any push, and read the output rather than trusting this note:

  ```bash
  npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
  ```

  What remains is safe: 24 foreign-key constraint renames, `updated_at DROP DEFAULT` on 19
  Sales tables (Prisma manages `@updatedAt` in the app, not the DB), and 3 index tweaks.
  **Zero `DROP TABLE`, zero `DROP COLUMN`.** If that command ever prints one again, a table
  or column was created out-of-band and must be modelled here before anyone pushes.

  `costing_rate` and `RoboImportLog` were created with hand-written SQL matching Prisma's
  DDL while push was unusable; both are modelled now.
