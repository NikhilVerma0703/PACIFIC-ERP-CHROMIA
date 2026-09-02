import test from "node:test";
import assert from "node:assert/strict";

import { reportQuery } from "../src/lib/robo/reportQuery.ts";

/* One query string for both the preview (summary) and the download (exports),
   so the two screens and their two endpoints can never disagree about the
   current filter. Two independent dimensions — Production Date and Batch No. —
   that compose. */

const base = { mode: "ALL" as const, date: "", from: "", to: "", batch: "" };

test("no filter is an empty string, not a bare '?'", () => {
  assert.equal(reportQuery(base), "");
});

test("Date Wise sends only the day", () => {
  assert.equal(reportQuery({ ...base, mode: "DATE", date: "2026-08-13" }), "?date=2026-08-13");
});

test("Date Range sends from and to, either bound omittable", () => {
  assert.equal(
    reportQuery({ ...base, mode: "RANGE", from: "2026-08-01", to: "2026-08-31" }),
    "?from=2026-08-01&to=2026-08-31",
  );
  assert.equal(reportQuery({ ...base, mode: "RANGE", from: "2026-08-01" }), "?from=2026-08-01");
  assert.equal(reportQuery({ ...base, mode: "RANGE", to: "2026-08-31" }), "?to=2026-08-31");
  // A range with neither bound filled is no date filter at all.
  assert.equal(reportQuery({ ...base, mode: "RANGE" }), "");
});

test("the date fields of the OTHER modes are ignored", () => {
  // A stale `date` while in RANGE, or stale range bounds while in DATE, never
  // leak — only the active mode's fields are read.
  assert.equal(reportQuery({ ...base, mode: "RANGE", date: "2026-08-13", from: "2026-08-01" }), "?from=2026-08-01");
  assert.equal(reportQuery({ ...base, mode: "DATE", date: "2026-08-13", from: "2026-08-01", to: "2026-08-31" }), "?date=2026-08-13");
});

test("Batch No. rides along in every mode, independent of the date", () => {
  assert.equal(reportQuery({ ...base, batch: "D-1372" }), "?batch=D-1372");
  assert.equal(reportQuery({ ...base, mode: "DATE", date: "2026-08-13", batch: "D-1372" }), "?date=2026-08-13&batch=D-1372");
  assert.equal(
    reportQuery({ ...base, mode: "RANGE", from: "2026-08-01", to: "2026-08-31", batch: "D-1372" }),
    "?from=2026-08-01&to=2026-08-31&batch=D-1372",
  );
});

test("every field is trimmed, and whitespace-only is nothing", () => {
  assert.equal(reportQuery({ ...base, mode: "DATE", date: " 2026-08-13 ", batch: "  D-1372  " }), "?date=2026-08-13&batch=D-1372");
  assert.equal(reportQuery({ ...base, mode: "DATE", date: "   " }), "");
  assert.equal(reportQuery({ ...base, batch: "   " }), "");
});
