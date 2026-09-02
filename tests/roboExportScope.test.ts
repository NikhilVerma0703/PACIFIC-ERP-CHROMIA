import test from "node:test";
import assert from "node:assert/strict";

import { exportScopeTag } from "../src/lib/robo/exportScope.ts";

/* The scope tag in a downloaded workbook's name, shared by both export routes
   so `Complete_Production_*` and `Delay_List_*` name the same filter the same
   way. */

const base = { date: "", from: "", to: "", hasBatch: false };

test("no filter is All", () => {
  assert.equal(exportScopeTag(base), "All");
});

test("a single day is the day", () => {
  assert.equal(exportScopeTag({ ...base, date: "2026-08-13" }), "2026-08-13");
});

test("a range reads from_to, with open ends spelled out", () => {
  assert.equal(exportScopeTag({ ...base, from: "2026-08-01", to: "2026-08-31" }), "2026-08-01_to_2026-08-31");
  assert.equal(exportScopeTag({ ...base, from: "2026-08-01" }), "2026-08-01_to_end");
  assert.equal(exportScopeTag({ ...base, to: "2026-08-31" }), "start_to_2026-08-31");
});

test("a batch appends _batch rather than the raw number, in any date scope", () => {
  assert.equal(exportScopeTag({ ...base, hasBatch: true }), "All_batch");
  assert.equal(exportScopeTag({ ...base, date: "2026-08-13", hasBatch: true }), "2026-08-13_batch");
  assert.equal(
    exportScopeTag({ ...base, from: "2026-08-01", to: "2026-08-31", hasBatch: true }),
    "2026-08-01_to_2026-08-31_batch",
  );
});

test("a single day beats a range if both are somehow present", () => {
  // date is the more specific pick, so it wins the tag.
  assert.equal(exportScopeTag({ ...base, date: "2026-08-13", from: "2026-08-01", to: "2026-08-31" }), "2026-08-13");
});

test("fields are trimmed", () => {
  assert.equal(exportScopeTag({ ...base, date: " 2026-08-13 " }), "2026-08-13");
  assert.equal(exportScopeTag({ ...base, from: " 2026-08-01 ", to: " 2026-08-31 " }), "2026-08-01_to_2026-08-31");
});
