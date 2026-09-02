import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// THE STOCK REGISTER HAS TO ADD UP.
//
// Every grade column in /api/inventory/summary counts stock ON THE FLOOR:
// `status <> 'DISPATCHED'`, the same as the Slabs total they are read against.
// Trial was written without that filter, so a design whose trial slabs had all
// been dispatched printed Trial = 6 against Slabs = 0 and the row did not sum —
// and the one check the register exists to let a person do by eye (the grade
// columns add to the total) silently stopped working.
//
// Structural, because the failure is arithmetic in the reader's head rather
// than an exception anywhere: nothing throws, the number is simply not the
// number the column header claims.

const src = readFileSync(new URL("../src/app/api/inventory/summary/route.ts", import.meta.url), "utf8");

/** Each `count(*) FILTER (WHERE …)::int AS name` in the summary query. */
function filteredColumns(): { name: string; where: string }[] {
  return [...src.matchAll(/count\(\*\)\s*FILTER\s*\(WHERE\s+([^)]*(?:\([^)]*\)[^)]*)*)\)::int\s+AS\s+(\w+)/gi)]
    .map((m) => ({ name: m[2].toLowerCase(), where: m[1] }));
}

test("every stock column except `dispatched` counts only stock still on the floor", () => {
  const cols = filteredColumns();
  // Sanity: if the query is rewritten into a shape this regex cannot read, the
  // test must fail loudly rather than pass over an empty list.
  assert.ok(cols.length >= 15, `only ${cols.length} filtered columns parsed — the guard below would be vacuous`);
  assert.ok(cols.some((c) => c.name === "trial"), "the Trial column is gone from the register query");

  for (const c of cols) {
    if (c.name === "dispatched") {
      assert.match(c.where, /status\s*=\s*'DISPATCHED'/, "the dispatched column must count exactly the dispatched slabs");
      continue;
    }
    assert.match(
      c.where,
      /status\s*<>\s*'DISPATCHED'/,
      `column "${c.name}" counts dispatched slabs too, so it cannot be added to the Slabs total`,
    );
  }
});
