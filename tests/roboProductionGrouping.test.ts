import test from "node:test";
import assert from "node:assert/strict";

import { assembleContinuous, assembleByBatch, type ExportRecord } from "../src/lib/robo/productionGrouping.ts";

/* The Complete Production sheet's two layouts (change 6):
   • a batch chosen → one continuous list, stored S.No. preserved;
   • only a date filter → grouped by batch, S.No. restarting per group with
     blank rows and a total between them.
   The S.No. reset is display-only — nothing here touches the stored value. */

const rec = (o: Partial<ExportRecord>): ExportRecord => ({
  serialNumber: null,
  productionDate: "2026-08-01",
  designName: "BANYAN",
  thickness: null,
  batchNo: "D-1372",
  slabNumber: "140000",
  roymixBodyWeight: null,
  roymixCycleTime: null,
  inTime: null,
  outTime: null,
  remarks: "-",
  createdAtMs: 0,
  ...o,
});

/* ── continuous (a batch is selected) ─────────────────────────────────────── */

test("continuous keeps the stored S.No. and flows dates together with no blanks", () => {
  // One batch, 18 Jul then 19 Jul — the change (6) example: S.No. 121 → 18 Jul,
  // 122 → 19 Jul, straight on.
  const s121 = rec({ serialNumber: 121, slabNumber: "A121", productionDate: "2026-07-18", createdAtMs: 100 });
  const s122 = rec({ serialNumber: 122, slabNumber: "A122", productionDate: "2026-07-19", createdAtMs: 200 });
  const rows = assembleContinuous([s122, s121]); // deliberately out of order

  assert.equal(rows.length, 4); // two records, a blank, a total
  assert.equal(rows[0]["S.No."], 121);
  assert.equal(rows[0]["Production Date"], "2026-07-18");
  assert.equal(rows[1]["S.No."], 122);
  assert.equal(rows[1]["Production Date"], "2026-07-19");
  // No blank row BETWEEN the two records, and no S.No. reset — continuous.
  assert.deepEqual(rows[2], {});
  assert.equal(rows[3]["Slab No."], "TOTAL");
  assert.equal(rows[3]["Remarks"], "2 records");
});

test("continuous shows a slab's own S.No. even when it carries none (position fallback)", () => {
  const rows = assembleContinuous([rec({ serialNumber: null, slabNumber: "X", createdAtMs: 1 })]);
  assert.equal(rows[0]["S.No."], 1); // fallback to position, never blank
});

/* ── grouped by batch (only a date filter) ─────────────────────────────────── */

test("date-only groups by batch, restarts S.No. at 1, and totals each group", () => {
  // Filter "31 Aug", no batch: Batch A continued past midnight (3 slabs on the
  // 31st), Batch B is new (2 slabs). Group by batch; S.No. restarts per group.
  const a = [1, 2, 3].map((i) =>
    rec({ serialNumber: 200 + i, slabNumber: `A${i}`, batchNo: "A-1001", designName: "ALPHA", productionDate: "2026-08-31", createdAtMs: 100 + i }),
  );
  const b = [1, 2].map((i) =>
    rec({ serialNumber: 300 + i, slabNumber: `B${i}`, batchNo: "B-2002", designName: "BETA", productionDate: "2026-08-31", createdAtMs: 500 + i }),
  );
  const rows = assembleByBatch([...b, ...a]); // out of order

  assert.equal(rows.length, 15);

  // Group A: header, three records with S.No. 1-3 (reset, NOT 201-203), 2 blanks, total.
  assert.deepEqual(rows[0], { "S.No.": "BATCH", "Batch No.": "A-1001", "Design Name": "ALPHA" });
  assert.equal(rows[1]["S.No."], 1);
  assert.equal(rows[1]["Slab No."], "A1");
  assert.equal(rows[2]["S.No."], 2);
  assert.equal(rows[3]["S.No."], 3);
  assert.deepEqual(rows[4], {});
  assert.deepEqual(rows[5], {});
  assert.equal(rows[6]["Slab No."], "Total");
  assert.equal(rows[6]["Remarks"], "3 records");
  assert.deepEqual(rows[7], {}); // spacing before the next batch
  assert.deepEqual(rows[8], {});

  // Group B: header, two records with S.No. 1-2, 2 blanks, total. No trailing spacing.
  assert.deepEqual(rows[9], { "S.No.": "BATCH", "Batch No.": "B-2002", "Design Name": "BETA" });
  assert.equal(rows[10]["S.No."], 1);
  assert.equal(rows[10]["Slab No."], "B1");
  assert.equal(rows[11]["S.No."], 2);
  assert.deepEqual(rows[12], {});
  assert.deepEqual(rows[13], {});
  assert.equal(rows[14]["Remarks"], "2 records");
});

test("grouping folds case/format spellings of one batch together (canonical)", () => {
  // "D-1372" and "d1372" are one batch — grouping uses canonBatchNo, a proper
  // equivalence (fold case and hyphens), so they share a group. (A BARE "1372"
  // is a different canonical key and its own group: the bare-number match rule
  // is not transitive, so it cannot define groups — that is deliberate.)
  const rows = assembleByBatch([
    rec({ serialNumber: 5, slabNumber: "s1", batchNo: "D-1372", createdAtMs: 1 }),
    rec({ serialNumber: 6, slabNumber: "s2", batchNo: "d1372", createdAtMs: 2 }),
  ]);
  // header + 2 records + 2 blanks + total = 6 rows, ONE group.
  assert.equal(rows.length, 6);
  assert.equal(rows[0]["S.No."], "BATCH");
  assert.equal(rows[0]["Batch No."], "D-1372"); // the first (newest-sorted) spelling labels it
  assert.equal(rows[1]["S.No."], 1);
  assert.equal(rows[2]["S.No."], 2);
  assert.equal(rows[5]["Remarks"], "2 records");
});

test("slabs with no batch fall into their own labelled group", () => {
  const rows = assembleByBatch([rec({ serialNumber: 9, slabNumber: "n1", batchNo: null, createdAtMs: 1 })]);
  assert.equal(rows[0]["Batch No."], "(no batch)");
  assert.equal(rows[1]["S.No."], 1);
});

test("both layouts leave an empty set as an empty (or near-empty) sheet", () => {
  assert.deepEqual(assembleByBatch([]), []);
  // Continuous still closes with its total line, showing zero.
  const rows = assembleContinuous([]);
  assert.equal(rows[rows.length - 1]["Remarks"], "0 records");
});
