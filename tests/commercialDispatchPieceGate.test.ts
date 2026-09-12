// THE DISPATCH ROUTE HAS TO ASK ABOUT BOTH KINDS OF LINE, NOT ONLY THE SLABS
// (round four, answer 1: "one UNFIT line still rejects the whole list").
//
// dispatchBlockers was given a second parameter for the cut-to-size lines and a
// second pair of fields to report them with, and every assertion about that
// rule lives in commercialPackingPieces.test.ts — where the test hands it the
// pieces itself. The only caller in the app did not. It called
// dispatchBlockers(slabs) and the parameter took its `= []` default, so the
// rule was asked about the slabs alone and answered truthfully: ok. The whole
// piece branch was dead in production while the pure test passed, which is the
// shape of failure a default parameter produces and a type checker cannot see.
//
// What that cost: a FINAL packing list with one piece the checker marked UNFIT
// at the loading bay dispatched. That late verdict is deliberate — canRecheck
// admits it on a VERIFIED or FINAL list, the piece route records it and logs
// "nothing ships until it is recut and repacked", and it leaves the list FINAL
// on purpose because this refusal is the one that was supposed to stop the
// truck. Nothing below it could: the pre-flight, the inventory bridge and the
// hold stamps all work off slab numbers, and a piece cut to a customer's size
// has none, so it is invisible to every one of them by construction. The list
// went DISPATCHED, the order moved, and the refused piece left in the crate.
//
// These assertions are structural — they read the route rather than call it —
// because what broke was not a wrong value but an argument that was never
// passed, and no call of the rule can detect a caller that does not make it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dispatchBlockers } from "../src/lib/commercial/packing-rules.ts";

const ROUTE_URL = new URL("../src/app/api/office/commercial/packing-lists/[plId]/dispatch/route.ts", import.meta.url);
const route = readFileSync(ROUTE_URL, "utf8");

/**
 * The arguments of the route's dispatchBlockers call, split at depth nought.
 * A regular expression cannot do this: both arguments are `.map()` calls whose
 * arrow bodies are full of parentheses, braces and commas of their own, and a
 * pattern loose enough to match them is loose enough to match the wrong thing.
 */
function blockersArgs(): string[] {
  const open = route.indexOf("dispatchBlockers(");
  assert.notEqual(open, -1, "the dispatch route no longer calls dispatchBlockers at all");
  let depth = 0;
  let quote = "";
  const args: string[] = [];
  let current = "";
  for (let i = open + "dispatchBlockers".length; i < route.length; i++) {
    const ch = route[i];
    if (quote) {
      if (ch === quote && route[i - 1] !== "\\") quote = "";
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; current += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      if (depth === 1) continue; // the call's own opening bracket
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) { args.push(current); return args.map((a) => a.trim()).filter((a) => a.length); }
    } else if (ch === "," && depth === 1) {
      args.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  assert.fail("the dispatchBlockers call in the dispatch route is unbalanced — the test cannot read it");
}

test("the dispatch route hands dispatchBlockers the pieces as well as the slabs", () => {
  const args = blockersArgs();
  assert.ok(
    args.length >= 2,
    "dispatchBlockers is called with the slabs alone, so its `pieces = []` default applies and an UNFIT " +
    "cut-to-size line cannot stop the truck — this is the one gate that sees a piece at all",
  );
  assert.match(args[0], /list\.slabs/, "the first argument is still the packed slabs");
  assert.match(args[1], /list\.pieces/,
    "the second argument must come off list.pieces — PL_INCLUDE already loads them with the slabs, so a " +
    "gate built from anything else is reading a different list than the one being dispatched");

  // A piece with no verdict on it reads as unchecked and would stop every list
  // that carries one, and a piece with no reason on it refuses without saying
  // why — the two fields that make the 409 worth sending.
  assert.match(args[1], /\bfit\b/, "the piece mapping must carry fit, or every line looks unchecked");
  assert.match(args[1], /\bunfitReason\b/, "the refusal names why each line was refused, and that reason lives on the row");
});

test("the refusal names the cut-to-size lines to Commercial, not only the slabs", () => {
  const refusal = route.slice(route.indexOf("if (!blockers.ok)"), route.indexOf("Answer 2 and round two answer 11"));
  assert.ok(refusal.length > 0, "the blockers refusal block is no longer where this test looked for it");
  for (const field of ["blockers.unfit", "blockers.unchecked", "blockers.unfitPieces", "blockers.uncheckedPieces"]) {
    assert.ok(
      refusal.includes(field),
      `the 409 body does not report ${field}, so a refusal caused by a cut-to-size line reaches the screen ` +
      "as a sentence with no lines behind it",
    );
  }
});

test("the state that shipped: every slab FIT, one piece UNFIT", () => {
  // The rule's own answer to the exact row shape the route now passes it, kept
  // here beside the wiring so that neither half can be weakened on its own.
  const blockers = dispatchBlockers(
    [{ slabNumber: 150903, fit: "FIT", unfitReason: null }, { slabNumber: 150904, fit: "FIT", unfitReason: null }],
    [{ id: "p1", crateNo: "1", pieceNo: "12", design: "CQBE", fit: "UNFIT", unfitReason: "Size short" }],
  );
  assert.equal(blockers.ok, false, "one refused line rejects the whole list — DECISIONS-4, answer 1");
  assert.deepEqual(blockers.unfit, [], "no slab is to blame, so the refusal must not send anyone looking for one");
  assert.deepEqual(blockers.unfitPieces, ["crate 1 · piece 12 · CQBE"]);
  assert.match(blockers.reason, /Size short/);
});
