---
name: salesforce-link-build-state
description: "Salesforce↔ERP build progress — Part B (boxes and stands) shipped 2026-09-16 as scripts/0086; DESIGN.md's script numbers 0084/0085 are WRONG, the proforma work took them."
metadata: 
  node_type: memory
  type: project
  originSessionId: 10143026-5554-4a83-93c5-54e7462fd1b1
  modified: 2026-09-16T08:02:06.593Z
---

`docs/salesforce-link/DESIGN.md` is the plan of record, written 2026-09-14 and
still accurate on **everything except the script numbers**.

* **DESIGN.md says `scripts/0084-sampling-units.sql` (Part B) and `0085`
  (Part C). Both numbers were taken the next day** by the proforma work —
  0084 is `pi-salesperson`, 0085 is `pi-seller`. Part B shipped as
  **`scripts/0086-sampling-units.sql`**; **Part C must be `0087`.** Do not
  trust the numbers in the design doc.

**Part B — boxes and stands — BUILT and applied to Neon 2026-09-16.**
Four unit types seeded mirroring Salesforce `Stand_Type__c` (Sample Kit Box
counted; Floor Stand / Wall Display / Counter Display serialised). New:
`src/lib/sampling/unit-rules.ts` (pure), `src/lib/sampling/release.ts`,
`/api/sampling/units` + `/ledger` + `/serials/[serialId]`,
`/sampling/units`, a "Packed in" picker on the dispatch form, and a new
`manageUnits` action (SAMPLING+ADMIN only — deliberately **not** `addStock`,
which admits the fabrication floor).

* **`releasePackage(tx, …)` in `lib/sampling/release.ts` is now the ONLY place
  sampling stock leaves the shelf.** Extracted from `POST /api/sampling/dispatch`.
  Shelves lock in sorted (sizeId, colourFinishId) order; **the unit locks LAST**,
  or a package taking a shelf-then-box deadlocks against one taking box-then-shelf.
  Part C's pack route must call this, never its own decrement.
* On hand for a serialised type is `count(*) WHERE status='IN_STOCK'` — computed,
  never stored. Only counted types have a `sampling_unit_stock` row.
* `unitNeeded()` gives **three** answers: Sample Kit → box, New Stand → stand
  (asks which variant when the rep left it blank — never a silent Floor Stand),
  **Stand Top-up → nothing** (it refills a stand the customer already has).

**Parts A and C are BLOCKED on the Salesforce admin**, not on ERP work: both
need the Connected App (consumer key + secret), an integration user, and a
permission set with Modify All on `Sample_Dispatch__c`. Nothing in the ERP can
reach the org until those exist.

Sixteen open questions in `docs/salesforce-link/OPEN-QUESTIONS.md` all carry
defaults and the build runs on them — none blocks.

See [[salesforce-org-state]] for what the org actually contains.
