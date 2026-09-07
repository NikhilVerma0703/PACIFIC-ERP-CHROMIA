# Commercial module — design and build contract

Status 2026-09-06: foundation built and applied (scripts/0076, Prisma models, pure rule modules, access wiring, layout, dashboard). This document is the contract the area builders work from. Read it whole before writing a file.

## 1. What it is

The office Commercial team's module: enquiry → internal sales order (the SOP checklist) → 5-day stock hold on specific slabs → production request when short → proforma invoice → packing list (per slab, per crate) → dispatch check by the dispatch team → invoice (DTA or export) → export document workbook → delivery challan. Lives at `/office/commercial/**` and `/api/office/commercial/**`.

It is **not** the ported International Sales module (`/sales`, `salesGate`, `users.sales_role`). That module matched none of these stages exactly and is left alone. Only the client master `sales_clients` is shared, by foreign key, with `commercial_client_ext` carrying GSTIN, PAN, state code, customer code and the printed address blocks.

## 2. Owner decisions (2026-09-05) and the defaults they set

| Decision | Effect in code |
|---|---|
| Order of steps and payment gating are undecided | `lib/commercial/stages.ts`: a pipeline with a timestamp per stage and **no gate**. `canEnter` is the one place a gate goes later. |
| Enquiry arrives by email to Commercial; no Marketing role | Enquiries are logged by hand; `source` defaults to `EMAIL`. |
| Stock check = pick slabs by batch, hold 5 days against a reference; short → production request | `inventory-bridge.ts` `searchAvailable` / `holdSlabs`; `settings.holdDays = 5`; `commercial_production_request`. |
| Requests land on a Production Planning page for admins before anyone is messaged; channel TBD | `notify.ts` sends only where `settings.notify.telegram/mail` is true (both false). Queue page is admin `plan`. |
| Commercial packs; the dispatch team checks each slab fit/unfit; customers may want their own slab numbers and batch | `commercial_packed_slab` has ours and `customerSlabNo`/`customerBatchNo`; `fit` per slab; STORE and LINE_MANAGER stand in for the dispatch team (`access-rules.ts`). |
| Export generates the CIOT-style workbook from root variables; DTA invoice for domestic; challans in scope | `commercial_export_doc_set`, `templates/commercial/export-docs-template.xlsx`, `exceljs` installed; `tax.ts`; `commercial_delivery_challan`. |
| Numbering owner (Tally vs ERP) undecided | `numbering.ts` + `sequence.ts`: real formats generated, every number overridable, counters editable in settings. |

Open questions for the owner are in `OPEN-QUESTIONS.md` beside this file. Do not resolve them in code; pick the default named there.

## 3. Access

* Pure rule: `src/lib/commercial/access-rules.ts` — actors ADMIN, COMMERCIAL, DISPATCH_CHECKER (STORE, LINE_MANAGER); actions `view write verify plan admin`. Middleware imports `maySeeCommercialModule`. Tested in `tests/commercialRules.test.ts`.
* Server gate: `src/lib/commercial/access.ts` — `const g = await commercialGate("write"); if (!g.ok) return deny(g);` at the top of **every** route handler. `g.user` is `{ id, name, email, role, branch }`; `g.actions` the user's actions; `actorStamp(g.user)` gives `{ id, name }` for the `*ById` / `*ByName` column pairs.
* Pages: `src/app/office/commercial/layout.tsx` already gates "may be here at all" and wraps `<Shell>`. Each `page.tsx` gates its own action (`view` for everything except `dispatch-check` which gates `verify`, `production-planning` which gates `view` and passes `actions` so the client hides reorder controls without `plan`, `settings` which gates `admin`).
* The dispatch team reaches ONLY `/office/commercial/dispatch-check/**` and `/api/office/commercial/dispatch-check/**`. Verification endpoints therefore live under that API segment, nowhere else.

## 4. Foundation API (import, do not re-implement)

| Module | Exports | Use |
|---|---|---|
| `@/lib/commercial/http` | `json(body, status)`, `deny(g)`, `bad(msg, status)`, `fail(status, msg)`, `handle(fn)`, `readBody<T>(req)`, `plain(v)`, `num`, `int`, `str`, `dateOnly`, `paramId(params)` | Every handler: gate → `handle(async () => { … return json(plain(row)); })`. **Always `plain()` Prisma rows** — Decimal becomes number, Date becomes ISO. |
| `@/lib/commercial/settings` | `loadSettings()` (cached), `loadOverrides()`, `saveOverrides(data, byId)` | Company master, banks, default terms, hold days, tax rates, numbering specs, notify flags. |
| `@/lib/commercial/sequence` | `issueNumber(kind, date, override?)` → `{ number, seq, key, overridden }`; `peekNext(kind)`; `setNext(key, n)`; `listSequences()` | kinds: `order enquiry exportInvoice dtaInvoice challan packingList`. |
| `@/lib/commercial/numbering` | `fyLabel`, `yy`, `documentNumber`, `sequenceKey`, `cleanOverride` | Pure. |
| `@/lib/commercial/stages` | `ORDER_STAGES`, `canEnter`, `stagePatch`, `impliedStage`, `stageOf`, `isTerminal` | Pure. |
| `@/lib/commercial/order-stage` | `moveOrder(orderId, to, by, note?)`, `bumpOrder(orderId, implied, by, note?)` | Explicit stage move; automatic forward-only bump after a side effect (hold placed → `STOCK_CHECKED`, PI issued → `PI_ISSUED`, packing list submitted → `PACKING`, verified → `READY`, rejected → `moveOrder(…,"PACKING")`, invoice issued → `INVOICED`, slabs dispatched → `DISPATCHED`). |
| `@/lib/commercial/events` | `logOrderEvent(orderId, kind, { note, payload, by })` | Every write on an order logs one event. Kinds are the `OrderEventKind` union. |
| `@/lib/commercial/checklist` | `CHECKLIST_POINTS`, `defaultChecklist`, `prefillChecklist(existing, src)`, `outstandingPoints`, `parseChecklist(raw)` | The SOP sheet's 22 points. Always `parseChecklist` a row's JSON before use. |
| `@/lib/commercial/inventory-bridge` | `searchAvailable({design, thickness, grade, isAdmin})`, `readSlabs`, `holdSlabs`, `releaseHeld`, `packSlabs`, `unpackSlabs`, `dispatchSlabs`, `reconcileHold(holdId)` | The ONLY way to touch `fg_finished_slab`. `isAdmin = g.actor === "ADMIN"`. `by = g.user.name ?? g.user.email`. |
| `@/lib/commercial/words` | `foreignWords(amount, currency)`, `inrWords(amount)`, `amountInWords(amount, currency)` | PI/export: "USD Seventeen Thousand, … and Sixty Six Cent only."; INR: "… Rupees Only." |
| `@/lib/commercial/tax` | `computeTax({...})`, `stateCodeFromGstin`, `looksLikeGstin` | IGST / CGST+SGST / none, whole-rupee round-off on DTA. |
| `@/lib/commercial/measure` | `slabMeasure(lengthIn, widthIn, measured?)`, `sqmFromCm`, `sqftFromSqm`, `sqftFromIn`, `inToCm`, `sumTo` | 10.764 sqft/sqm, the company's own factor. |
| `@/lib/commercial/notify` | `notifyShortage(notice)` | Call after creating a production request. Off by default; never throws. |
| `@/lib/commercial/types` | `Party`, `DocLine`, `ProformaSnapshot`, `InvoiceSnapshot`, `ChallanItem`, `OrderDetail`, `OrderTabProps` and the `*Dto` types | The JSON column shapes and the order detail contract. |
| `@/lib/sales/pdf/common` | `buildPdf(docDef): Promise<Buffer>`, `docStyles` | pdfmake, Roboto, A4. **Do not use puppeteer** (not installed). |
| `@/lib/thickness` | `canonThickness`, `THICKNESS_OPTS` | Store thickness canonical ('2 cm'); print as the document needs ('20mm', '2 CM'). |
| `@/lib/fab/postJson`, `@/lib/readJson` | `getJson`, `postJson`, `patchJson`, `deleteJson`, `readJson` | Client fetches. Never `r.json()` directly. |
| `@/components/ui` | `Card`, `H2`, `Kpi`, `Empty`, `Badge`, `fmt` | Primitives. Buttons/inputs/tables are Tailwind class strings (see `src/components/office/FinanceBills.tsx`). |

Prisma: `import { prisma } from "@/lib/prisma"; const db = prisma as any;` (the house pattern while the generated client may lag). Models: `CommercialSetting CommercialSequence CommercialClientExt CommercialEnquiry CommercialEnquiryItem CommercialOrder CommercialOrderItem CommercialOrderEvent CommercialStockHold CommercialStockHoldSlab CommercialProductionRequest CommercialProforma CommercialPackingList CommercialCrate CommercialPackedSlab CommercialInvoice CommercialDeliveryChallan CommercialExportDocSet`. Read `prisma/schema.prisma` (search "COMMERCIAL MODULE") for every column.

## 5. The order detail contract

`GET /api/office/commercial/orders/[id]` (orders builder) returns `plain()` of:

```ts
db.commercialOrder.findUnique({
  where: { id },
  include: {
    client: { include: { commercialExt: true } },
    enquiry: { select: { id: true, number: true } },
    items: { orderBy: { lineNo: "asc" } },
    holds: { include: { slabs: { orderBy: { slabNumber: "asc" } } }, orderBy: { placedAt: "desc" } },
    productionRequests: { orderBy: { raisedAt: "desc" } },
    proformas: { orderBy: [{ number: "asc" }, { revision: "desc" }] },
    packingLists: { include: { crates: { orderBy: { crateNo: "asc" } }, slabs: { orderBy: { sortOrder: "asc" } } }, orderBy: { createdAt: "desc" } },
    invoices: { include: { exportDocSet: true }, orderBy: { invoiceDate: "desc" } },
    challans: { orderBy: { challanDate: "desc" } },
    events: { orderBy: { at: "desc" }, take: 100 },
  },
})
```
with `checklist` replaced by `parseChecklist(row.checklist)`. The TypeScript shape is `OrderDetail` in `types.ts`. Every tab receives `OrderTabProps { order, actions, refresh }`.

Order workspace: `src/app/office/commercial/orders/[id]/page.tsx` (server, gates `view`) renders `<OrderWorkspace orderId actions />` (`src/components/commercial/order/OrderWorkspace.tsx`, client) which fetches the detail, shows the header (number, client, kind, stage strip from `ORDER_STAGES`, stage buttons via `PATCH …/stage`) and tabs `overview items stock pi packing invoice documents log`, selected by `?tab=`. Each tab is a fixed file the owning builder writes:

| Tab file (`src/components/commercial/order/`) | Owner |
|---|---|
| `OrderWorkspace.tsx`, `OverviewTab.tsx` (order fields + checklist + check/approve), `ItemsTab.tsx`, `LogTab.tsx` | orders |
| `StockTab.tsx` (search stock, pick slabs, place/release holds, raise requests) | stock |
| `PiTab.tsx` (issue/revise/accept PI, PDF link) | proforma |
| `PackingTab.tsx` (build packing lists, crates, slabs, submit, PDFs) | packing |
| `InvoiceTab.tsx` (issue DTA/export invoice, challans for this order, PDFs) | invoices |
| `DocumentsTab.tsx` (export document set: root variables, download workbook) | export |

Until a tab file exists, `OrderWorkspace` must render a placeholder for it (dynamic import with a fallback), so builders can work in parallel.

## 6. Routes and pages by builder

All routes: `export const dynamic = "force-dynamic"; export const runtime = "nodejs";` gate first, `handle()` around the body, `json(plain(...))` out, JSON errors with status. Lists paginate (`?page=&limit=` default 50) and filter by the obvious fields.

### clients + enquiries
* `GET/POST /api/office/commercial/clients` — list (search `?q=`, active only by default), create (`name`, `country` default "", `createdById = g.user.id`, plus ext fields). `GET/PATCH /api/office/commercial/clients/[id]` — read/update `sales_clients` fields **and** upsert `commercial_client_ext`. Duplicate warning on case-insensitive name match (not a block).
* `GET/POST /api/office/commercial/enquiries`, `GET/PATCH /api/office/commercial/enquiries/[id]`, `POST …/[id]/items`, `PATCH/DELETE …/items/[itemId]`, `POST …/[id]/convert` → creates a DRAFT order from the enquiry (number via `issueNumber("order", now, body.numberOverride)`, items copied, `enquiry.status = ORDERED`, `enquiry.orderId` set, event `created`), returns `{ orderId }`.
* Pages: `/office/commercial/clients`, `/office/commercial/clients/[id]`, `/office/commercial/enquiries`, `/office/commercial/enquiries/new`, `/office/commercial/enquiries/[id]`.

### orders
* `GET/POST /api/office/commercial/orders` — list with `?status=&kind=&q=&clientId=`, create (`kind`, `clientId`, header fields; `number` via `issueNumber("order", …, numberOverride)`; `checklist = prefillChecklist(null, src)`; `createdById/Name`; event `created`).
* `GET/PATCH /api/office/commercial/orders/[id]` — detail (§5) / header edit (re-run `prefillChecklist(existing, src)` after edit; event `edited`).
* `POST/PATCH/DELETE …/[id]/items[/[itemId]]` — line items; `amount = round(qty × rate, 3)` unless `amount` given explicitly (the reference PI's total is not qty×rate at printed precision — keep what was typed).
* `PATCH …/[id]/checklist` — body `{ items: ChecklistItem[] }` (values/ok), `{ check: true }` stamps `checkedBy*`, `{ approve: true }` stamps `approvedBy*` (event `checklist` / `approved`).
* `PATCH …/[id]/stage` — `{ to, note? }` → `moveOrder`; `{ to: "CANCELLED", reason }` sets `cancelReason`.
* `GET …/[id]/events` — paged log.
* Pages: `/office/commercial/orders` (board by stage + list), `/office/commercial/orders/new`, `/office/commercial/orders/[id]` (workspace).

### stock + production planning
* `GET /api/office/commercial/stock?design=&thickness=&grade=` → `searchAvailable` result (`groups` by batch with slabs). Design picker source: `GET /api/inventory/filters` (COMMERCIAL passes it) `designs[]`.
* `POST /api/office/commercial/orders/[id]/holds` — `{ slabNumbers, reference?, days?, notes? }`; reference defaults to the order number, days to `settings.holdDays`, customer to the client name; calls `holdSlabs`, writes `commercial_stock_hold` + `_slab` rows from `before` (skipped/missing reported back), `bumpOrder(…,"STOCK_CHECKED")`, event `hold_placed`. Also `POST /api/office/commercial/holds` for an enquiry-referenced hold (`{ enquiryId, … }`).
* `POST /api/office/commercial/holds/[id]/release` — `{ slabNumbers?, reason }` → `releaseHeld` on the hold's own reference, then `reconcileHold`; event `hold_released`. `POST /api/office/commercial/holds/[id]/extend` — `{ days }` → re-reserve still-held slabs with new expiry (call `changeSlabStatus` through a new bridge function if needed, or release+hold), update `expiresAt`.
* `GET /api/office/commercial/holds` — list with `?status=`; on read, `reconcileHold` each ACTIVE hold shown (cheap, and keeps the module truthful about lapsed holds).
* `POST /api/office/commercial/orders/[id]/production-requests` — `{ orderItemId?, design, thickness, finish?, qtyRequired, qtyAvailable, notes? }` → `qtyShort = required − available`, `priority = max(priority)+1`, event `production_requested`, then `notifyShortage`. The StockTab offers this when a search finds fewer than the item's `qtySlabs`.
* `GET /api/office/commercial/production-requests?status=` — the queue (with order number + client). `PATCH …/production-requests/reorder` — `{ ids: string[] }` full order → priorities 1..n (**plan** action). `PATCH …/production-requests/[id]` — `{ status, cleaningNote?, plannedBatch?, notes?, producedBatchKeys? }` (status changes need **plan**; notes need **write**); PRODUCED stamps `producedAt/ById` and logs `production_produced` on the order. `GET …/production-requests/[id]/suggest` → count of `fg_finished_slab` rows with `source = QC_AUTOLINK`, canonical design match, `canonThickness` match, `firstSeenAt >= raisedAt` — the hint that production has run.
* Pages: `/office/commercial/production-planning` — ordered queue, drag to reorder (native HTML5 drag as `src/components/fab/SinkBoard.tsx` does, plus ▲▼ buttons for touch), status buttons, cleaning note per row, "produced?" hint. Gates `view`; reorder/status controls only when `actions` includes `plan`.

### proforma
* `POST /api/office/commercial/orders/[id]/proformas` — builds a `ProformaSnapshot` from the order + `loadSettings()` (bank = Kotak on a proforma of EITHER kind — OPEN-QUESTIONS §23 puts ICICI on the DTA invoice only, and a proforma is a PI whatever it sells; `amountInWords`; lines from items with `thickness` printed as `30mm`-style for export, `2 CM` for domestic), `number = order.number`, `revision = max+1` (0 first), status DRAFT; `POST …/proformas/[piId]/issue` → ISSUED, `issuedAt`, `validUntil = +settings.piValidityDays`, supersedes earlier ISSUED revisions (SUPERSEDED), `bumpOrder(…,"PI_ISSUED")`, event `pi_issued`; `POST …/accept` → ACCEPTED (event `pi_accepted`); `PATCH` notes.
* `GET /api/office/commercial/proformas/[piId]/pdf` — pdfmake, A4 portrait, laid out like the reference `1404 Surfaces by Pacific,.pdf` (see `OPEN-QUESTIONS.md` §Documents and the field spec in the discovery notes: title PROFORMA INVOICE, exporter/consignee/notify left, invoice no/date, buyer's PO, RBI code, GSTIN, customs office, buyer-if-not-consignee, countries, terms right; routing grid; payment terms; bank; routing bank; 9-column item table Item Code | Color | Thick | No of Slabs | HSN/SAC | Unit | Quantity | Rate | Amount; totals; amount in words; gross/net weight; discount; declaration; Accept By Customer / Authorised Signatory). Numbers: qty and amount 3 dp, rate as typed. Response: `Content-Type: application/pdf`, `Content-Disposition: inline; filename="<number>-R<rev>.pdf"`.

### packing + dispatch check
* `POST /api/office/commercial/orders/[id]/packing-lists` — `{ slabNumbers?, fromHoldId? }` → number via `issueNumber("packingList")`, `commercial_packed_slab` rows from `readSlabs` (measure via `slabMeasure`), `sortOrder` by slab number, DRAFT; event `packing_created`.
* `PATCH /api/office/commercial/packing-lists/[plId]` — header fields (container, seal, OTL, vehicle, weights, packages summary, notes). `POST …/crates`, `PATCH/DELETE …/crates/[crateId]`; `POST …/slabs` (add slab numbers), `PATCH …/slabs/[slabId]` (crate assignment, customer slab no/batch, measured cm), `DELETE …/slabs/[slabId]`; `PATCH …/slabs/assign` — `{ slabIds, crateId }`.
* `POST …/submit` → `packSlabs` for every slab (skipped reported; a slab that cannot be packed is removed from the list with an event), status SUBMITTED, `submittedAt/ById`, `bumpOrder(…,"PACKING")`, event `packing_submitted`.
* `POST …/finalise` (after VERIFIED) → FINAL, `finalisedAt`, `bumpOrder(…,"READY")`, event `packing_final`. `POST …/dispatch` → `dispatchSlabs` under the order number + client name, status DISPATCHED, `dispatchedAt`, hold slabs `packedAt`, `bumpOrder(…,"DISPATCHED")`, event `dispatched`. `POST …/reopen` (from REJECTED) → `unpackSlabs`, DRAFT.
* **Dispatch check** (the only paths the dispatch team reaches): `GET /api/office/commercial/dispatch-check` — SUBMITTED lists (oldest first) with order number, client, slab counts. `GET /api/office/commercial/dispatch-check/[plId]` — the list with slabs. `PATCH /api/office/commercial/dispatch-check/[plId]/slabs/[slabId]` — `{ fit: "FIT"|"UNFIT", unfitReason? }` stamps `checkedBy/At`. `POST /api/office/commercial/dispatch-check/[plId]/verify` — `{ note? }`, refused while any slab is PENDING; all FIT → VERIFIED, `verifiedBy*`, `bumpOrder(…,"DISPATCH_CHECK")` then `"READY"`; any UNFIT → REJECTED with the unfit list in the note, `moveOrder(…,"PACKING")`, `unpackSlabs` for the UNFIT slabs only (they go back to stock as AVAILABLE; FIT ones stay PACKED), event `packing_rejected`. All gate **verify**.
* PDFs: `GET /api/office/commercial/packing-lists/[plId]/pdf` (packing list: exporter block, invoice/PI refs, consignee/notify, marks & nos, per-crate rows: crate no, kind, design/SKU, thickness, net weight, slabs, sqm; totals; container/seal/vehicle; LUT text; declaration) and `…/measurement-list.pdf` (per slab: Sl, design/SKU, batch, slab no (customer's if set, ours otherwise — both columns when both exist), thickness, length cm, width cm, sqm, crate no; crate subtotals; grand total) — both A4, pdfmake.
* Pages: `/office/commercial/packing-lists` (all lists by status), `/office/commercial/packing-lists/[plId]` (edit; same component as PackingTab's detail), `/office/commercial/dispatch-check` (queue), `/office/commercial/dispatch-check/[plId]` (per-slab fit/unfit, big touch targets — this is a floor screen — verify/reject buttons).

### invoices + challans
* `POST /api/office/commercial/orders/[id]/invoices` — `{ kind, packingListId?, invoiceDate, numberOverride?, vehicleNo?, transporter?, lrNo?, ewayBillNo?, exchangeRate?, lines? }` → number via `issueNumber(kind === "DTA" ? "dtaInvoice" : "exportInvoice")`; lines default from the order items (or from the packing list's slabs grouped by design/thickness when given); `computeTax` with buyer state from `client.commercialExt.stateCode ?? stateCodeFromGstin(ext.gstin)`; `InvoiceSnapshot` built from order + settings (bank domestic for DTA, export otherwise; LUT text on export); `amountInWords`; DRAFT. `POST …/invoices/[invId]/issue` → ISSUED, `issuedAt`, `bumpOrder(…,"INVOICED")`, event `invoice_issued`. `POST …/cancel` — `{ reason }`. `PATCH` header/transport fields while DRAFT.
* `GET /api/office/commercial/invoices?kind=&from=&to=` — register. `GET …/invoices/[invId]/pdf` — DTA layout per the JB Homes reference (title DTA INVOICE, company block, TAN, GSTIN, commissionerate/division/range/location code, tariff head, invoice no & date, PI no & date, sales person, commodity, consignee block with GSTIN and state code, table Material Description | HSN | No of Slabs | Thickness | Quantity SQFT/NOS | Rate | Amount, delivery & payment terms, Total / IGST or CGST+SGST rows / Round Off / Grand Total, amount in words, bank (ICICI), declaration, vehicle no, signatory, "Goods once sold…", "E. & O. E") or export commercial invoice layout (exporter/consignee/notify, IEC, GSTIN, buyer's PO + PI ref, terms, ports, marks & nos, line table with sqm/sqft, LUT text, bank with AD code and routing bank, declaration).
* Challans: `GET/POST /api/office/commercial/challans`, `GET/PATCH /api/office/commercial/challans/[id]`, `POST …/issue`, `POST …/cancel`; number via `issueNumber("challan")`; `totalAmount = Σ amount`; `amountInWords = inrWords(total)`; `GET …/[id]/pdf` — the PGI reference layout (DELIVERY CHALLAN title, company block, DC no & date, PO no ('Verbal'), commodity, consignee with GSTIN, commissionerate block, tariff head, table Material Description | No | Thickness/Unit | Quantity SQFT | Rate | Amount Approx, the two notes, TOTAL, Grand Total, amount in words, time of removal, lorry no, declaration, signatory) — **four copies on four pages**, each carrying its label: Original – Buyer Copy, Duplicate – Transporter Copy, Triplicate – Central Excise Copy, Quadruplicate – Assessee Copy.
* Pages: `/office/commercial/invoices`, `/office/commercial/invoices/[invId]`, `/office/commercial/challans`, `/office/commercial/challans/new`, `/office/commercial/challans/[id]`.

### export document workbook
* Template: `templates/commercial/export-docs-template.xlsx` (the CIOT workbook, 14 sheets, formulas intact). Library: `exceljs` 4.4 (installed). First task: analyse the template (openpyxl locally or exceljs) to map every root input cell — literal cells that formulas or other sheets depend on, and header literals duplicated by hand across sheets (invoice no, date, PI/PO ref, consignee, notify, ports, container, seal, OTL, vehicle, weights, LUT, marks & nos, per-slab rows on Measmt List with crate subtotals, per-crate rows on the packing lists). Note the `Invoice (R)` sheet is stale in the source (carries PESPL/1891) — treat it as another output sheet to fill, not as truth. Record the mapping in `src/lib/commercial/export-workbook/mapping.ts` (pure, tested).
* `src/lib/commercial/export-workbook/build.ts` — `buildExportWorkbook(rootVariables, slabs): Promise<Buffer>`: load template with exceljs, write root cells, add/remove Measmt List slab rows by duplicating the last slab row's formulas and re-summing crate subtotals, preserve every formula, merged range, print area and image, return xlsx buffer. Verify fidelity by re-opening the output (a test that loads the buffer back with exceljs and checks formula counts per sheet and that root values landed).
* Routes: `GET /api/office/commercial/invoices/[invId]/export-docs` → the saved root variables (or a default set derived from the invoice snapshot + packing list) ; `PUT` saves them (`commercial_export_doc_set`); `GET …/export-docs/workbook` → `Content-Disposition: attachment; filename="<invoice no>-export-docs.xlsx"`, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
* `DocumentsTab.tsx` — root-variable form grouped by sheet, prefilled, Save, Download workbook.

### settings
* `GET/PUT /api/office/commercial/settings` (**admin**) — overrides + merged view; `GET/PATCH /api/office/commercial/settings/sequences` — `listSequences`, `setNext(key, n)`; preview via `peekNext(kind)`.
* Page: `/office/commercial/settings` — hold days, PI validity, numbering templates with live preview and "next number" per counter, company master, both banks, default terms, tax rates, notify flags.

## 7. Conventions every builder follows

* **Files you own only.** The ownership table in §5/§6 is exclusive. Never edit `middleware.ts`, `routeCaps.ts`, `Nav.tsx`, `office/page.tsx`, `schema.prisma`, `package.json`, anything under `src/lib/commercial/` that already exists, or another builder's files. If you need a foundation change, write it in your report instead.
* **No git, no `next build`, no `prisma db push`, no `prisma generate`, no `npm install`.** Run `npx tsc --noEmit` (whole project) and `node --experimental-strip-types --disable-warning=ExperimentalWarning --test tests/<yours>.test.ts` before you finish. Both must pass.
* Pages are server components that gate and render one client component from `src/components/commercial/<area>/`. Client components fetch with `readJson`/`getJson`/`postJson`/`patchJson`, show errors inline, and use `Card`/`Badge`/`Empty`/`Kpi` plus Tailwind class strings. Page header pattern: `<div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight text-gray-900">…</h1><p className="mt-1 max-w-2xl text-sm text-gray-500">…</p></div>`. Do not wrap in `<Shell>` — the layout does.
* Every write on an order logs an event and stamps `*ById`/`*ByName` from `actorStamp(g.user)`.
* Money and quantities: keep the precision typed (rates 4 dp, amounts 3 dp); never recompute a stored amount on display.
* Dates: store `@db.Date` columns via `dateOnly()`; display `toLocaleDateString("en-IN")`; documents print `DD-MM-YYYY` (PI) / `DD/MM/YYYY` (DTA, challan).
* Tests: put decision logic (snapshot builders, line mapping, workbook cell mapping, verify rules) in import-free modules under `src/lib/commercial/<area>-rules.ts` or similar and RUN them in `tests/commercial<Area>.test.ts`. A test that only matches source text is not a test.
* Report back: files written, routes added, what you could not finish, and any foundation change you needed.

## 8. The owner's 31 answers (2026-09-07) — what changes, builder by builder

DECISIONS.md is the record; this section is the contract. Everything below
is ALREADY in the foundation (schema 0079 applied, Prisma models generated,
pure rules and tests updated, `COMMERCIAL_MANAGER` threaded through roles,
rbac, routeCaps, middleware, Nav, login). Builders code against it; they do
not re-decide it.

### Foundation facts every builder relies on

- **Roles.** `Role.COMMERCIAL_MANAGER` exists. `commercialActorOf` maps it to
  actor `COMMERCIAL_MANAGER`; the action table gives it `plan`, `approve` and
  `cancel` on top of Commercial's `view / write / verify`; `admin` stays ADMIN.
  Gate with `commercialGate("approve")`, `commercialGate("cancel")`,
  `commercialGate("plan")` — never on the role string.
- **Stages.** `canEnter(from, to, facts)` now refuses three moves when the
  fact is explicitly false: `PI_ISSUED` without `stockChecked`, `INVOICED`
  without `approved`, `DISPATCHED` without `advanceReceived`. Every caller of
  `moveOrder`/`bumpOrder` that can reach one of those stages must pass the
  facts (order-stage.ts is to be extended to load them: stockCheckedAt set
  and an ACTIVE hold; approvedAt set; a receipt of kind ADVANCE exists).
- **Hold expiry.** `reconcileHold` already sends an order whose last live
  hold lapsed from STOCK_CHECKED / PI_ISSUED back to CONFIRMED with a
  `hold_expired` event. There is NO extension (answer 11): delete the extend
  route and its button.
- **Numbering.** Seven counters. The order is `ORD/{fy}/N{seq}`; the PI has
  its own `SAL-ORD/{fy}/N{seq}`; export invoice `PESPL/N{seq}` runs on across
  years; DTA, challan, enquiry, packing list reset per FY. All carry an N and
  no padding (answer 8). Nothing aligns with Tally (answer 4).
- **Settings.** `piValidityDays` 0 = forever (default); `measurementUnitDefault`
  cm/in; `planning.cleaningHoursDefault` 3 / `cleaningHoursAbrupt` 6;
  `tax.alwaysIgst` true; `company.alternateGstins` are "Label | GSTIN" lines
  parsed by `gstinChoices(company)`; `notify.telegramPrivate` /
  `mailFromCommercialLogin` on.
- **DTOs.** `ReceiptDto`, `DesignCodeDto`, `PlanChangeDto` in types.ts;
  `ProductionRequestDto` carries `plannedSlabs / plannedHours / cleaningHours /
  shade / changes`; `PackingListDto.measurementUnit`; `OrderDetail.receipts`
  and `OrderDetail.advanceReceived`.
- **Events.** New kinds: `pi_revised`, `receipt_recorded`, `receipt_deleted`,
  `plan_changed`, `slab_swapped`.

### orders (+ receipts, approval)

- Receipts: `GET/POST /api/office/commercial/orders/[id]/receipts`,
  `DELETE …/receipts/[receiptId]` (write; delete is admin or manager). A
  Receipts card on the order page: kind, amount, currency, date, mode,
  reference. The order loader fills `receipts` and `advanceReceived`.
- Approval (answer 10): the checklist's "Approved by" is `commercialGate("approve")`
  — the manager or an admin. Commercial still fills and checks. Prepared-by
  defaults to the signed-in name; the screen labels the two roles.
- The stage strip shows why a move is refused (canEnter's reason) instead of
  hiding the button.
- Cancel an order: `commercialGate("cancel")`.

### stock + production planning

- No enquiry holds (answer 12): the hold routes refuse `enquiryId` without an
  order; the enquiry page loses its hold button.
- No extension (answer 11): remove `holds/[id]/extend`; the hold card says
  "expires <date>; on expiry the order returns to the stock check".
- Design master (answer 20): `commercial_design_code` — an admin/manager
  editor under settings (design, code, shade LIGHT/MEDIUM/DARK, confirmed).
  Seed rows for every distinct FG design name with `shade_confirmed=false`
  and a first-guess shade from the name (white/bianco/carrara/calacatta/
  ivory/cream = LIGHT; black/nero/grey/charcoal/dark/brown = DARK; else
  MEDIUM). The queue reads the shade from here.
- Planning figures (answer 13): a request gets `plannedSlabs` (= qtyShort at
  creation), `plannedHours`, `cleaningHours` (3, or 6 when the previous row
  in queue order is DARK and this one LIGHT — recomputed on reorder). Edit
  hours / slabs is `commercialGate("plan")`. A REDUCTION writes a
  `commercial_production_plan_change` row (OPEN); the planning page shows
  "Planned but not scheduled" with Add back / Remove per row.
- Sequencing hint: the queue shows the shade per row and warns on an abrupt
  DARK → LIGHT.
- Delete + edit a request by hand (answer 15): `PATCH` and `DELETE` on
  `production-requests/[id]` (write).

### proforma

- Own counter `numbering.proforma`. A revision (answer 24) issues a NEW
  number and cancels the old PI (status CANCELLED, `pi_revised` on the
  order); nothing is re-numbered. Cancel is `commercialGate("cancel")`.
- No validity when `piValidityDays` is 0: `validUntil` null, nothing printed.
- Bank dropdown (answer 23): the PI carries the chosen bank key (export =
  Kotak, domestic = ICICI by default) in its snapshot; editable before issue.
- Issue is gated on the stock check (`canEnter(..., "PI_ISSUED", { stockChecked })`).

### packing + dispatch check

- One packing list per order (answer 18): creating a second is refused while
  one exists that is not REJECTED/cancelled.
- Unit toggle (answer 17): `measurementUnit` on the list, default from
  settings; the screen shows cm or in and lets the clerk edit sizes.
- Swap on FINAL (answer 30): `POST packing-lists/[plId]/slabs/swap` replaces
  a refused slab with another of the same design/thickness (bridge: release
  one, pack the other); `slab_swapped` event.
- Nothing ships until the list is corrected (answer 31): dispatch refuses a
  list with any unfit slab; the dispatch move also needs `advanceReceived`.

### invoices + challans + export workbook

- One invoice per order (answer 18) — a second is refused while one is not
  cancelled; the final invoice needs `approvedAt` (answer 10).
- GSTIN dropdown (answer 21) from `gstinChoices(settings.company)`; bank
  dropdown (answer 23); both stored in the invoice snapshot.
- Always IGST on domestic (answer 22): pass `alwaysIgst` into `computeTax`.
- Design codes on export lines (answer 20) from `commercial_design_code`.
- The date prints under the number on the invoice and the register
  (answer 6); export invoices show the FY beside the continuous number.

### settings

- Screen fields for every new leaf (proforma numbering, unit default,
  cleaning hours, alwaysIgst, alternate GSTIN lines, telegramPrivate,
  mailFromCommercialLogin); the design-code editor lives here too.
- The PI validity hint reads "0 = valid forever".
