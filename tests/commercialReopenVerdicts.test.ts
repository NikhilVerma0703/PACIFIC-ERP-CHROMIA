// WHAT A REOPENED PACKING LIST STILL REMEMBERS.
//
// Reopen pulls a list back to DRAFT so Commercial can rebuild it, and it is the
// only route that does: nothing else writes a packing list back to DRAFT, so a
// DRAFT list carrying a dispatch-check verdict got that verdict here. The head
// comment on the route states the rule the whole screen depends on — a list
// that is about to change is not a list the dispatch team has checked — and the
// order log it writes says "all checks cleared".
//
// IT CLEARED THE SLABS ONLY. scripts/0082 gave commercial_packed_piece the same
// four verdict columns the slab has carried since 0076 (round four, answer 1:
// "a cut to size also gets a physical check piece by piece"), and reopen kept
// resetting the one table it knew about. Piece rows are never deleted by
// reopen, so the stale verdict survived the rebuild on the same row, and both
// halves of that are a real failure on a customer's container:
//
//   an UNFIT piece is recut and resubmitted and the list rejects itself again,
//   over a fault nobody can find, and no bulk "mark correct" can clear it
//   because both bulk marks refuse to overwrite an UNFIT by design;
//
//   a FIT piece whose size is then edited on the DRAFT list still reads FIT,
//   with the old checker's name and the old timestamp on it, and the next
//   verify passes a line nobody has looked at.
//
// STRUCTURAL, because the route imports Prisma and Next and node --test cannot
// load it, and because what is being protected is not a wrong value but a
// missing statement — the pure rules were right throughout. The verdict columns
// are read out of the schema rather than typed here, so a fifth one added to
// both models is covered without anyone remembering this file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyOutcome, bulkFitPlan } from "../src/lib/commercial/packing-rules.ts";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const route = read("../src/app/api/office/commercial/packing-lists/[plId]/reopen/route.ts");
const schema = read("../prisma/schema.prisma");

/** The text between a balanced pair of `open`/`close` starting at `from`. */
function balanced(src: string, from: number, open: string, close: string): string {
  let depth = 0;
  for (let i = src.indexOf(open, from); i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(from, i + 1);
  }
  return assert.fail(`unbalanced ${open}${close} from ${from}`);
}

/** The one `db.<model>.updateMany(...)` in the route, with a `data:` that names
 *  a shared object spliced back in. The route is free to hoist the reset into a
 *  const — both tables must get the same one — and a test that recognised only
 *  an inline literal would pass a route that resets nothing. */
function resetOf(model: string): string {
  const needle = `db.${model}.updateMany(`;
  const at = route.indexOf(needle);
  assert.notEqual(at, -1, `reopen no longer resets ${model} at all`);
  const call = balanced(route, at, "(", ")");
  const named = /data:\s*([A-Za-z_$][\w$]*)\s*[,})]/.exec(call);
  if (!named) return call;
  const decl = route.indexOf(`const ${named[1]} =`);
  assert.notEqual(decl, -1, `${model}'s reset is handed ${named[1]}, which this file cannot find`);
  return call + balanced(route, decl, "{", "}");
}

/** The verdict fields of one Prisma model: the one on the CommercialFitStatus
 *  enum, and the columns that record who said so, why and when. */
function verdictFields(model: string): string[] {
  const at = schema.indexOf(`model ${model} {`);
  assert.notEqual(at, -1, `model ${model} is gone from the schema`);
  const block = balanced(schema, at, "{", "}");
  return [...block.matchAll(/^\s{2}(\w+)\s+(\S+)/gm)]
    .filter(([, name, type]) => type.startsWith("CommercialFitStatus") || /^(unfit|checked)/.test(name))
    .map(([, name]) => name);
}

// ───────────────────────── the reset the route owes both tables ─────────────

test("reopen clears the verdict on the cut-to-size lines as well as on the slabs", () => {
  const slabs = resetOf("commercialPackedSlab");
  const pieces = resetOf("commercialPackedPiece");

  for (const [what, reset] of [["slab", slabs], ["piece", pieces]] as const) {
    assert.match(reset, /packingListId/, `the ${what} reset must be scoped to this list and no other`);
    assert.match(reset, /fit:\s*"PENDING"/, `the ${what} verdict must go back to PENDING, which is what "not yet looked at" is called`);
  }
});

test("every verdict column the schema gives a packed line is one reopen resets", () => {
  // Answer 1 put a piece on the same enum as a slab on purpose: "one job, one
  // enum; two enums with the same three labels would drift". The two models
  // therefore carry the same verdict, and a column added to both later is a
  // column this route has to clear, or half a verdict outlives the rebuild —
  // a line reading PENDING with last week's checker still stamped on it.
  const slabFields = verdictFields("CommercialPackedSlab");
  const pieceFields = verdictFields("CommercialPackedPiece");
  assert.ok(slabFields.length >= 4, "the slab's verdict columns are no longer readable from the schema");
  assert.deepEqual(pieceFields, slabFields, "a packed piece is checked exactly like a packed slab, on the same four columns");

  const slabs = resetOf("commercialPackedSlab");
  const pieces = resetOf("commercialPackedPiece");
  for (const field of slabFields) {
    assert.match(slabs, new RegExp(`\\b${field}\\b`), `reopen leaves ${field} on the slab as the check left it`);
    assert.match(pieces, new RegExp(`\\b${field}\\b`), `reopen leaves ${field} on the cut-to-size line as the check left it`);
  }
});

test("reopen deletes no line, which is why the reset is the only thing that can clear a verdict", () => {
  // The route says so itself — "nothing is deleted here" — and it must stay
  // true: a packed piece points at no finished-goods row, so deleting one to
  // clear its verdict would throw away a line Commercial typed rather than
  // unchecking it. The verdict lives on a row that survives the rebuild.
  assert.doesNotMatch(route, /commercialPackedPiece\.delete/, "a cut-to-size line is rebuilt by Commercial, not discarded by reopen");
  assert.doesNotMatch(route, /commercialPackedSlab\.delete/, "the slab rows stay on the list too — reopen returns the stock, it does not empty the list");
  assert.match(route, /status:\s*"DRAFT"/, "and this is still the route that hands the list back to Commercial");
});

// ───────────────────────── why a carried verdict matters ────────────────────

test("a verdict carried across a reopen decides the next check by itself", () => {
  // These are the two lists the route above produces if it forgets one table.
  // Both go through verifyOutcome untouched by anyone, and both conclude.
  const stale = verifyOutcome([{ id: "s1", slabNumber: 150903, fit: "FIT" }], [
    { id: "p12", crateNo: "3", pieceNo: "12", design: "CQBE", fit: "UNFIT", unfitReason: "Size short" },
  ]);
  assert.equal(stale.ok, false, "the recut piece rejects the list again, over last round's finding");
  assert.equal(stale.pending, 0, "and it does not even ask to be looked at — it reads as already checked");
  assert.deepEqual(stale.unfitPieces, [{ id: "p12", label: "crate 3 · piece 12 · CQBE", reason: "Size short" }]);

  // And nothing on the check screen can clear it: both bulk marks take PENDING
  // lines only, which is answer 1's rule and not an oversight. Without the
  // reset the only way out is a checker hunting down that one line by hand.
  const bulk = bulkFitPlan([], [{ id: "p12", crateId: "c3", crateNo: "3", fit: "UNFIT", unfitReason: "Size short" }]);
  assert.deepEqual(bulk.pieceIds, []);
  assert.equal(bulk.skippedUnfit, 1);

  // The other half is the quiet one. A piece marked FIT before the reopen, recut
  // to a new size on the DRAFT list — the packing-lists piece PATCH writes the
  // size and has no business writing a verdict — verifies with nobody having
  // looked at the stone that is actually in the crate.
  const quiet = verifyOutcome([{ id: "s1", slabNumber: 150903, fit: "FIT" }], [
    { id: "p12", crateNo: "3", pieceNo: "12", design: "CQBE", fit: "FIT", unfitReason: null },
  ]);
  assert.equal(quiet.ok, true);
  assert.equal(quiet.pending, 0, "there is nothing to hold it, and that is the failure");
});
