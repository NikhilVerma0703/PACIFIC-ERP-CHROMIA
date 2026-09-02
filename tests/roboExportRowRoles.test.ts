import test from "node:test";
import assert from "node:assert/strict";

import { productionRowRole, delayRowRole, byDateRowRole } from "../src/lib/robo/exportRowRoles.ts";

/* The styling pass highlights header, section and total rows. These pin which
   rows are which, by the exact labels the export builders write — so a data row
   is never mistaken for a total, and vice versa. */

test("production: batch header vs group total vs grand total vs plain data", () => {
  assert.equal(productionRowRole({ "S.No.": "BATCH", "Batch No.": "D-1372" }), "section");
  assert.equal(productionRowRole({ "Slab No.": "Total", "Remarks": "3 records" }), "summary");
  assert.equal(productionRowRole({ "Slab No.": "TOTAL", "Remarks": "9 records" }), "grandTotal");
  assert.equal(productionRowRole({ "Slab No.": "GRAND TOTAL", "Remarks": "20 records" }), "grandTotal");
  assert.equal(productionRowRole({ "S.No.": 12, "Slab No.": "140748" }), null); // a real slab
  assert.equal(productionRowRole({}), null); // a blank spacer
});

test("delay list: the two total lines are summaries, real delays are not", () => {
  assert.equal(delayRowRole({ "Description": "TOTAL DELAY DURATION", "Duration": 120 }), "summary");
  assert.equal(delayRowRole({ "Description": "Delay Events", "Duration": 4 }), "summary");
  assert.equal(delayRowRole({ "Description": "Distributor jam", "Duration": 30 }), null);
  assert.equal(delayRowRole({}), null);
});

test("date-wise totals: only the closing TOTAL line", () => {
  assert.equal(byDateRowRole({ "Production Date": "TOTAL", "Delay Events": 10 }), "grandTotal");
  assert.equal(byDateRowRole({ "Production Date": "2026-09-01", "Delay Events": 3 }), null);
  assert.equal(byDateRowRole({}), null);
});
