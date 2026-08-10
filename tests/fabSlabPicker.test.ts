import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseThicknessMm, thicknessPrefixes, qcSlabsUrl, QC_SLAB_PAGE,
} from "../src/lib/fab/qcSlabQuery.ts";

// The supervisor's slab picker read /api/fab/slabs, which returned every QC row
// ever written: 43,618 rows / ~8.4 MB, no take, no search, ordered by ASCENDING
// slab number. Over Vercel's 4.5 MB response cap, so the request failed as a
// platform error rather than returning slabs — and the one screen that guarded
// itself with a client-side .slice(0, 200) showed slabs 1..200, the oldest stock
// in the building, under a label reading "(200)".
//
// Paging it moved two things that used to run in the browser into SQL: the
// search, and the 3cm thickness filter. Both are covered here.

/* -- Thickness ------------------------------------------------------------- */

// Every distinct slab_thickness value in the live polish_qc table, with its row
// count, captured 2026-08-10. The column is free text typed by QC inspectors,
// so these are fixtures rather than a format anyone designed.
const LIVE_THICKNESS_VALUES: [string | null, number][] = [
  ["3 cm", 23910], ["2 cm", 16900], ["3 cm to 2 cm", 2052], ["12 mm", 475],
  ["2cm to 8mm", 133], ["2 cm to 1 cm", 83], ["2cm to 12 mm", 40], [null, 29],
  ["1.2 cm", 5], ["3cm to 8mm", 1],
];

test("parseThicknessMm handles the values the live table actually holds", () => {
  const got = new Map(LIVE_THICKNESS_VALUES.map(([v]) => [v, parseThicknessMm(v)]));
  // Note the spaces: "3 cm" misses the THICKNESS_MAP key "3cm" entirely and is
  // resolved by the parseFloat fallback. Changing that fallback silently
  // reclassifies 40,000+ slabs.
  assert.equal(got.get("3 cm"), 30);
  assert.equal(got.get("2 cm"), 20);
  assert.equal(got.get("12 mm"), 12);
  assert.equal(got.get("1.2 cm"), 12);
  assert.equal(got.get(null), null);
  // "X to Y" means the slab was reduced from X down to Y; the parser takes the
  // FIRST figure, so these count as their original thickness. Pinned as current
  // behaviour, not endorsed — see the note returned with this fix.
  assert.equal(got.get("3 cm to 2 cm"), 30);
  assert.equal(got.get("2cm to 8mm"), 20);
});

test("thicknessPrefixes admits every string that parses to the target", () => {
  // The SQL prefilter may over-admit (the exact parse runs afterwards) but must
  // never under-admit: a missed prefix hides real stock from the picker, which
  // on screen is indistinguishable from the slab not existing.
  for (const target of [30, 20, 12]) {
    const prefixes = thicknessPrefixes(target);
    for (const [value] of LIVE_THICKNESS_VALUES) {
      if (value === null) continue;
      if (parseThicknessMm(value) !== target) continue;
      assert.ok(
        prefixes.some(p => value.startsWith(p)),
        `thickness ${target}mm: SQL prefilter ${JSON.stringify(prefixes)} would hide ` +
        `${JSON.stringify(value)}, which parses to ${target}`
      );
    }
  }
});

test("thicknessPrefixes covers 3cm, the only bucket the picker constrains", () => {
  // thicknessBucket === 3 is the sole filtered case in all three pickers.
  const p = thicknessPrefixes(30);
  assert.ok(p.includes("3"), "must admit '3 cm'");
  assert.ok(p.includes("30"), "must admit a raw '30mm'");
  assert.deepEqual(thicknessPrefixes(12), ["12", "1.2"]);
});

/* -- Query building -------------------------------------------------------- */

test("qcSlabsUrl asks the server to do the filtering", () => {
  assert.equal(qcSlabsUrl("", null), "/api/fab/slabs");
  assert.equal(qcSlabsUrl("1350", null), "/api/fab/slabs?search=1350");
  assert.equal(qcSlabsUrl("", 30), "/api/fab/slabs?thickness=30");

  const both = new URL(qcSlabsUrl("Carrara", 30), "https://x");
  assert.equal(both.searchParams.get("search"), "Carrara");
  assert.equal(both.searchParams.get("thickness"), "30");
});

test("qcSlabsUrl trims and encodes what the operator typed", () => {
  // Typed on a shop-floor tablet: leading/trailing spaces are common, and a
  // blank-looking box must not send search= and match nothing.
  assert.equal(qcSlabsUrl("   ", null), "/api/fab/slabs");
  assert.equal(qcSlabsUrl("  1350  ", null), "/api/fab/slabs?search=1350");
  const u = new URL(qcSlabsUrl("Blue & Grey", null), "https://x");
  assert.equal(u.searchParams.get("search"), "Blue & Grey");
});

test("thickness is omitted rather than sent as a falsy value", () => {
  // 2cm and unknown buckets take any slab; sending thickness=0 or =null as text
  // would make the route filter on a bucket nothing parses to.
  for (const v of [null, 0]) {
    assert.equal(qcSlabsUrl("", v as number | null), "/api/fab/slabs");
  }
});

test("the client page size matches the route's default", () => {
  // useQcSlabs infers "there are more behind this" from a full page, so a
  // mismatch here shows a permanent, wrong "200+" or hides the hint entirely.
  assert.equal(QC_SLAB_PAGE, 200);
});
