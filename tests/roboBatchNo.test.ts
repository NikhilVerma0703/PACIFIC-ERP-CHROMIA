import test from "node:test";
import assert from "node:assert/strict";

import { canonBatchNo, batchNosMatch, matchingBatchRecipeIds } from "../src/lib/robo/batchNo.ts";

/* The register writes one batch a dozen ways — "D1372", "d1372", "D-1372",
   "d-1372", and often the bare "1372" — and a search for any of them has to
   return all of them. But a prefix that means something must survive: "A-1248"
   and "D-1248" are two different batches and may never be merged. batchNo.ts
   folds away exactly case and non-alphanumeric formatting, keeps the prefix,
   and treats a bare number as the series-less form of a prefixed one. */

test("canon folds case and strips hyphens, spaces and dots — nothing else", () => {
  assert.equal(canonBatchNo("D-1372"), "D1372");
  assert.equal(canonBatchNo("d1372"), "D1372");
  assert.equal(canonBatchNo("d-1372"), "D1372");
  assert.equal(canonBatchNo("  D 1372 "), "D1372");
  assert.equal(canonBatchNo("d.1372"), "D1372");
  assert.equal(canonBatchNo("1372"), "1372");
  assert.equal(canonBatchNo(null), "");
  assert.equal(canonBatchNo(undefined), "");
  assert.equal(canonBatchNo("   "), "");
});

test("case and hyphen differences are the same batch", () => {
  assert.ok(batchNosMatch("D-1372", "d1372"));
  assert.ok(batchNosMatch("d-1372", "D1372"));
  assert.ok(batchNosMatch("D1372", "D1372"));
});

test("a bare number is the same batch as the same number with a prefix", () => {
  assert.ok(batchNosMatch("1372", "D1372"));
  assert.ok(batchNosMatch("D1372", "1372"));
  assert.ok(batchNosMatch("1372", "d-1372"));
});

test("two DIFFERENT meaningful prefixes are never the same batch", () => {
  assert.ok(!batchNosMatch("A-1248", "D-1248"));
  assert.ok(!batchNosMatch("A1248", "D1248"));
  // The whole point: a bare number matches either series, but that never makes
  // the two series match each other.
  assert.ok(batchNosMatch("1248", "A-1248"));
  assert.ok(batchNosMatch("1248", "D-1248"));
  assert.ok(!batchNosMatch("A-1248", "D-1248"));
});

test("different numbers never match, prefix or not", () => {
  assert.ok(!batchNosMatch("D1372", "D1373"));
  assert.ok(!batchNosMatch("1372", "1373"));
  assert.ok(!batchNosMatch("D-1372", "1373"));
});

test("a search for a bare number returns a stem match even against a longer prefix", () => {
  // "B" and "BX" are different prefixes, so BX-1372 is not D-1372's batch...
  assert.ok(!batchNosMatch("B-1372", "BX-1372"));
  // ...but a bare 1372 still reaches BX-1372, because it carries no series to
  // disagree with.
  assert.ok(batchNosMatch("1372", "BX-1372"));
});

test("a blank on either side matches nothing — an empty box is not a filter", () => {
  assert.ok(!batchNosMatch("", "D1372"));
  assert.ok(!batchNosMatch("D1372", ""));
  assert.ok(!batchNosMatch(null, "D1372"));
  assert.ok(!batchNosMatch("   ", "D1372"));
});

/* matchingBatchRecipeIds is the bridge to a Prisma `batchRecipeId: { in: [...] }`
   filter: which setups on file does the typed number name? */

const RECIPES = [
  { id: "r_d1372", batchNo: "D1372" },
  { id: "r_d1372_dash", batchNo: "d-1372" },
  { id: "r_bare1372", batchNo: "1372" },
  { id: "r_a1248", batchNo: "A-1248" },
  { id: "r_d1248", batchNo: "D-1248" },
  { id: "r_nobatch", batchNo: null },
];

test("resolving a prefixed number gathers every spelling of that batch, plus the bare form", () => {
  assert.deepEqual(
    matchingBatchRecipeIds("D-1372", RECIPES).sort(),
    ["r_bare1372", "r_d1372", "r_d1372_dash"].sort(),
  );
});

test("resolving a bare number reaches the prefixed spellings too", () => {
  assert.deepEqual(
    matchingBatchRecipeIds("1372", RECIPES).sort(),
    ["r_bare1372", "r_d1372", "r_d1372_dash"].sort(),
  );
});

test("resolving one series never pulls in another", () => {
  assert.deepEqual(matchingBatchRecipeIds("A-1248", RECIPES), ["r_a1248"]);
  assert.deepEqual(matchingBatchRecipeIds("d1248", RECIPES), ["r_d1248"]);
  // A bare 1248 names both series — the ambiguity the operator typed.
  assert.deepEqual(matchingBatchRecipeIds("1248", RECIPES).sort(), ["r_a1248", "r_d1248"].sort());
});

test("a blank query resolves to no filter, a hit-less query to an empty filter", () => {
  assert.deepEqual(matchingBatchRecipeIds("", RECIPES), []);
  assert.deepEqual(matchingBatchRecipeIds("   ", RECIPES), []);
  assert.deepEqual(matchingBatchRecipeIds(null, RECIPES), []);
  // A real batch number that names nothing on file — an empty set, which the
  // caller turns into `{ in: [] }`, i.e. zero rows, not "no filter".
  assert.deepEqual(matchingBatchRecipeIds("Z-9999", RECIPES), []);
});
