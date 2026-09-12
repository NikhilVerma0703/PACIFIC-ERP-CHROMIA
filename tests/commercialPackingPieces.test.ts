// The dispatch check over BOTH kinds of line (round four, answer 1: "a cut to
// size also gets a physical check piece by piece with mark crate as correct
// and even the slabs get slab by slab and mark crate as correct also a global
// mark all as correct"), RUN against real values:
//
//   what the verdicts add up to when a list carries slabs, pieces, or both
//   that a bulk "mark correct" touches PENDING lines only, and says what it left
//   that an unfit PIECE is never handed to the inventory bridge
//   which crate a line is checked under, and in what order the screen shows them
//   what a store login is handed about a cut-to-size line, and what it is not
//   and that the dispatch route actually asks the question, over both kinds
//   and that Commercial's own two screens count both kinds as well
//
// Import-free module, so node --test loads it bare (relative path, explicit
// .ts). Kept apart from commercialPacking.test.ts because it is one answer's
// worth of rules and reads as one argument; both exercise packing-rules.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fitCounts, verifyOutcome, verificationNote, rejectionNote, fitPatch, dispatchBlockers,
  recheckBanner, checkerCrateKey, checkerGroups, checkerPieceView, checkerListView,
  bulkFitPlan, bulkFitNote, parseBulkFitScope,
} from "../src/lib/commercial/packing-rules.ts";

// A packed slab and a packed piece, as far as a verdict is concerned.
const slab = (slabNumber: number, fit: string, unfitReason: string | null = null, crateId: string | null = "c1") =>
  ({ id: `s${slabNumber}`, crateId, slabNumber, fit, unfitReason });
const piece = (pieceNo: string, fit: string, unfitReason: string | null = null, crateNo: string | null = "1", crateId: string | null = "c1") =>
  ({ id: `p${pieceNo}`, crateId, crateNo, pieceNo, design: "CQBE", fit, unfitReason });

// ───────────────────────────── counting both kinds ──────────────────────────

test("fitCounts: one count over slabs and cut-to-size lines together", () => {
  // A list of slabs alone asks the question it always asked — every caller
  // written before there were pieces passes one array and still gets an answer.
  assert.deepEqual(fitCounts([{ fit: "FIT" }, { fit: "UNFIT" }, { fit: "PENDING" }]),
    { total: 3, fit: 1, unfit: 1, pending: 1 });

  // A list of pieces alone. This used to count 0 of everything, and the screen
  // drew a full progress bar over a container nobody had looked at.
  assert.deepEqual(fitCounts([], [{ fit: "FIT" }, { fit: "PENDING" }, { fit: "PENDING" }]),
    { total: 3, fit: 1, unfit: 0, pending: 2 });

  // And a mixed one — the totals are the lines of both kinds, not either.
  assert.deepEqual(fitCounts([{ fit: "FIT" }, { fit: "UNFIT" }], [{ fit: "FIT" }, { fit: "PENDING" }]),
    { total: 4, fit: 2, unfit: 1, pending: 1 });

  assert.deepEqual(fitCounts([], []), { total: 0, fit: 0, unfit: 0, pending: 0 });
});

// ───────────────────────────── the conclusion ───────────────────────────────

test("verifyOutcome: a list of slabs only concludes exactly as it did before", () => {
  const clean = verifyOutcome([slab(1, "FIT"), slab(2, "FIT")]);
  assert.equal(clean.ok, true);
  assert.equal(clean.pending, 0);
  assert.deepEqual(clean.unfit, []);
  assert.deepEqual(clean.unfitPieces, []);
  assert.equal(clean.nothingToVerify, false);
  assert.deepEqual(clean.pieces, { total: 0, fit: 0, unfit: 0, pending: 0 });

  const bad = verifyOutcome([slab(1, "FIT"), slab(150903, "UNFIT", "Crack")]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unfit, [{ id: "s150903", slabNumber: 150903, reason: "Crack" }]);
  assert.deepEqual(bad.unfitPieces, [], "there is no piece on this list to blame");
});

test("verifyOutcome: a list of pieces only is a real check now, not a rubber stamp", () => {
  // Before answer 1 a cut-to-size list reached the checker with an empty slab
  // table and passed itself the moment it was opened. Every piece is a line to
  // be looked at, so an unticked one holds the list exactly as a slab does.
  const untouched = verifyOutcome([], [piece("1", "PENDING"), piece("2", "PENDING")]);
  assert.equal(untouched.ok, false, "nobody has looked at it");
  assert.equal(untouched.pending, 2);
  assert.equal(untouched.nothingToVerify, false, "there is plenty to verify — it is all pieces");

  const done = verifyOutcome([], [piece("1", "FIT"), piece("2", "FIT")]);
  assert.equal(done.ok, true);
  assert.equal(done.pending, 0);
  assert.deepEqual(done.slabs, { total: 0, fit: 0, unfit: 0, pending: 0 });
  assert.deepEqual(done.pieces, { total: 2, fit: 2, unfit: 0, pending: 0 });

  const refused = verifyOutcome([], [piece("1", "FIT"), piece("12", "UNFIT", "Size short")]);
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.unfit, [], "AND NOTHING GOES TO THE BRIDGE — a piece is not a slab");
  assert.deepEqual(refused.unfitPieces, [{ id: "p12", label: "crate 1 · piece 12 · CQBE", reason: "Size short" }]);
});

test("verifyOutcome: the pending count is across both kinds, and says which", () => {
  const half = verifyOutcome(
    [slab(1, "FIT"), slab(2, "PENDING"), slab(3, "PENDING")],
    [piece("1", "FIT"), piece("2", "PENDING")],
  );
  assert.equal(half.ok, false);
  assert.equal(half.pending, 3, "two slabs and one piece");
  assert.equal(half.slabs.pending, 2);
  assert.equal(half.pieces.pending, 1);

  // Every slab done and a piece outstanding still holds the list. This is the
  // case the check used to pass: the slab table was complete, so it concluded.
  const slabsDone = verifyOutcome([slab(1, "FIT")], [piece("1", "PENDING")]);
  assert.equal(slabsDone.ok, false);
  assert.equal(slabsDone.pending, 1);
  assert.equal(slabsDone.slabs.pending, 0);

  // And the other way round, which it never got wrong.
  const piecesDone = verifyOutcome([slab(1, "PENDING")], [piece("1", "FIT")]);
  assert.equal(piecesDone.ok, false);
  assert.equal(piecesDone.pending, 1);
});

test("verifyOutcome: one unfit line of either kind rejects the list", () => {
  assert.equal(verifyOutcome([slab(1, "FIT")], [piece("1", "UNFIT", "Chipped edge")]).ok, false);
  assert.equal(verifyOutcome([slab(1, "UNFIT", "Crack")], [piece("1", "FIT")]).ok, false);
  assert.equal(verifyOutcome([slab(1, "FIT")], [piece("1", "FIT")]).ok, true);

  // A mixed rejection keeps the two apart all the way out, because the slabs
  // are what the verify route hands unpackSlabs and the pieces must not be.
  const both = verifyOutcome(
    [slab(150903, "UNFIT", "Crack")],
    [piece("12", "UNFIT", null)],
  );
  assert.deepEqual(both.unfit, [{ id: "s150903", slabNumber: 150903, reason: "Crack" }]);
  assert.deepEqual(both.unfitPieces, [{ id: "p12", label: "crate 1 · piece 12 · CQBE", reason: "no reason given" }]);
  assert.equal(both.unfit.length + both.unfitPieces.length, 2);
});

test("verifyOutcome: nothingToVerify means neither kind, not an empty slab table", () => {
  const none = verifyOutcome([], []);
  assert.equal(none.nothingToVerify, true);
  assert.equal(none.ok, true, "there is nothing pending and nothing unfit");
  assert.equal(verifyOutcome([], [piece("1", "PENDING")]).nothingToVerify, false);
  assert.equal(verifyOutcome([slab(1, "PENDING")], []).nothingToVerify, false);
});

test("fitPatch is the one verdict body, and it no longer says 'slab'", () => {
  // The same function takes a piece's verdict, so its refusal has to read
  // correctly beside a cut-to-size line as well as beside a slab.
  assert.deepEqual(fitPatch("UNFIT", "Size short"), { ok: true, fit: "UNFIT", unfitReason: "Size short" });
  const noWhy = fitPatch("UNFIT", "  ");
  assert.equal(noWhy.ok, false);
  assert.doesNotMatch((noWhy as { reason: string }).reason, /slab/i);
});

// ───────────────────────────── what the notes say ───────────────────────────

test("rejectionNote names the unfit pieces AND says they are staying", () => {
  // With no piece in it the note is word for word what it was.
  assert.equal(
    rejectionNote([{ slabNumber: 150903, reason: "Crack" }]),
    "Rejected — 1 unfit: #150903 (Crack)",
  );

  const pieces = [{ id: "p12", label: "crate 1 · piece 12 · CQBE", reason: "Size short" }];
  const both = rejectionNote([{ slabNumber: 150903, reason: "Crack" }], null, pieces);
  assert.match(both, /#150903 \(Crack\)/);
  assert.match(both, /crate 1 · piece 12 · CQBE \(Size short\)/);
  // The one thing Commercial cannot work out from the list itself: the slabs
  // went back to stock and the pieces did not, so a flagged line still sitting
  // there is not one the rejection missed.
  assert.match(both, /still on the list/i);

  const piecesOnly = rejectionNote([], "reload tomorrow", pieces);
  assert.match(piecesOnly, /^Rejected — 1 unfit cut-to-size line\(s\)/);
  assert.doesNotMatch(piecesOnly, /#/, "a piece has no slab number to print");
  assert.match(piecesOnly, /reload tomorrow$/);
});

test("verificationNote records the pieces that were actually ticked", () => {
  assert.equal(verificationNote(0, null, 40), "All 40 cut-to-size line(s) checked fit");
  assert.equal(verificationNote(12, null, 40), "All 12 slab(s) and 40 cut-to-size line(s) checked fit");
  assert.equal(verificationNote(47), "All 47 slab(s) checked fit", "a slab list reads as it always did");
});

// ───────────────────────────── the crate a line is in ───────────────────────

test("checkerCrateKey: a crate row, a number only the cut-to-size sheet knows, or none", () => {
  assert.equal(checkerCrateKey({ crateId: "c1" }), "crate:c1");
  assert.equal(checkerCrateKey({ crateId: "c1", crateNo: "9" }), "crate:c1",
    "the link wins — the crate row is the thing on the floor, whatever the sheet printed");
  // pieces-rules matchCrate drops the link when the typed number is not a crate
  // of ours ("1A", or a sheet whose crates nobody entered). Such a line is still
  // a box the checker is standing in front of.
  assert.equal(checkerCrateKey({ crateId: null, crateNo: "1A" }), "no:1A");
  assert.equal(checkerCrateKey({ crateId: null, crateNo: "  " }), "");
  assert.equal(checkerCrateKey({}), "");
});

test("checkerGroups: the screen's crates, in the order it shows them", () => {
  const crates = [{ id: "c1", crateNo: 1 }, { id: "c2", crateNo: 2 }, { id: "c3", crateNo: 3 }];
  const groups = checkerGroups(
    crates,
    [slab(1, "FIT", null, "c2"), slab(2, "PENDING", null, "c1"), slab(3, "PENDING", null, null)],
    [piece("7", "PENDING", null, "1A", null), piece("8", "UNFIT", "Crack", "2", "c2")],
  );
  assert.deepEqual(groups.map((g) => g.key), ["crate:c1", "crate:c2", "no:1A", ""],
    "the list's own crates by crate number, then the numbers only a piece knows, then no crate at all");
  // c3 holds nothing, so it is not a heading with no work under it — and its
  // "mark crate as correct" would have been a button that did nothing.
  assert.equal(groups.some((g) => g.key === "crate:c3"), false);

  const c2 = groups.find((g) => g.key === "crate:c2")!;
  assert.equal(c2.slabs.length, 1);
  assert.equal(c2.pieces.length, 1, "both kinds under one heading — that is how they are stacked");
  assert.deepEqual(c2.fit, { total: 2, fit: 1, unfit: 1, pending: 0 });
  assert.equal(c2.onList, true);
  assert.equal(c2.crateNo, "2");

  const typed = groups.find((g) => g.key === "no:1A")!;
  assert.equal(typed.onList, false, "so the screen can say where the number came from");
  assert.equal(typed.crateNo, "1A");
  assert.equal(typed.crateId, null);

  const loose = groups.find((g) => g.key === "")!;
  assert.equal(loose.slabs.length, 1);
  assert.equal(loose.crateNo, null);
});

test("checkerGroups: crate 2 comes before crate 10, and the whole order is total", () => {
  // The crate rows follow the order they arrive in, which the route reads by
  // crateNo — so "10" cannot sort above "2" the way a string sort would.
  const crates = [{ id: "a", crateNo: 2 }, { id: "b", crateNo: 10 }];
  const byRow = checkerGroups(crates, [slab(1, "FIT", null, "b"), slab(2, "FIT", null, "a")], []);
  assert.deepEqual(byRow.map((g) => g.crateNo), ["2", "10"]);

  // And the numbers only the cut-to-size sheet knows are ordered by the same
  // rule pieces-rules prints them with.
  const typed = checkerGroups([], [], [
    piece("a", "FIT", null, "10", null), piece("b", "FIT", null, "2", null), piece("c", "FIT", null, "1A", null),
  ]);
  assert.deepEqual(typed.map((g) => g.crateNo), ["1A", "2", "10"]);
});

// ───────────────────────────── the two bulk marks ───────────────────────────

test("bulkFitPlan: 'mark all as correct' takes the PENDING lines of both kinds", () => {
  const plan = bulkFitPlan(
    [slab(1, "PENDING"), slab(2, "FIT"), slab(3, "PENDING")],
    [piece("7", "PENDING"), piece("8", "PENDING")],
  );
  assert.deepEqual(plan.slabIds, ["s1", "s3"]);
  assert.deepEqual(plan.pieceIds, ["p7", "p8"]);
  assert.equal(plan.marked, 4);
  assert.equal(plan.skippedUnfit, 0);
  assert.equal(plan.alreadyFit, 1, "counted apart, so the answer does not claim work it did not do");
});

test("bulkFitPlan: a bulk mark NEVER overwrites an unfit line, and counts what it left", () => {
  // The whole reason the check exists is to produce findings. A "mark all as
  // correct" that silently erased two of them would send a cracked slab and a
  // short-cut piece to a customer with the record saying both were passed.
  const plan = bulkFitPlan(
    [slab(1, "PENDING"), slab(150903, "UNFIT", "Crack"), slab(3, "PENDING")],
    [piece("7", "UNFIT", "Size short"), piece("8", "PENDING")],
  );
  assert.deepEqual(plan.slabIds, ["s1", "s3"], "the unfit slab is not in the update");
  assert.deepEqual(plan.pieceIds, ["p8"], "nor the unfit piece");
  assert.equal(plan.marked, 3);
  assert.equal(plan.skippedUnfit, 2);
  assert.equal(bulkFitNote(plan), "3 marked correct, 2 left unfit");

  // A crate that is nothing but findings marks nothing and says so, rather than
  // reporting a cheerful nought.
  const allBad = bulkFitPlan([slab(1, "UNFIT", "Crack")], [piece("7", "UNFIT", "Size short")]);
  assert.deepEqual(allBad.slabIds, []);
  assert.deepEqual(allBad.pieceIds, []);
  assert.equal(allBad.marked, 0);
  assert.equal(bulkFitNote(allBad), "0 marked correct, 2 left unfit");
});

test("bulkFitPlan: 'mark crate as correct' stops at the crate", () => {
  const slabs = [slab(1, "PENDING", null, "c1"), slab(2, "PENDING", null, "c2"), slab(3, "PENDING", null, null)];
  const pieces = [
    piece("7", "PENDING", null, "1", "c1"),
    piece("8", "UNFIT", "Crack", "1", "c1"),
    piece("9", "PENDING", null, "1A", null),
  ];

  const crate1 = bulkFitPlan(slabs, pieces, { kind: "crate", key: "crate:c1" });
  assert.deepEqual(crate1.slabIds, ["s1"]);
  assert.deepEqual(crate1.pieceIds, ["p7"]);
  assert.equal(crate1.marked, 2);
  assert.equal(crate1.skippedUnfit, 1, "the finding in this crate is reported, not carried to the next one");

  // A crate number only the cut-to-size sheet knows is a scope of its own — the
  // lines under that heading and nothing else.
  const typed = bulkFitPlan(slabs, pieces, { kind: "crate", key: "no:1A" });
  assert.deepEqual(typed.slabIds, []);
  assert.deepEqual(typed.pieceIds, ["p9"]);

  // "" is the lines in no crate, which is a real heading on the screen and not
  // a missing argument.
  const loose = bulkFitPlan(slabs, pieces, { kind: "crate", key: "" });
  assert.deepEqual(loose.slabIds, ["s3"]);
  assert.deepEqual(loose.pieceIds, []);

  // A crate with nothing left to do marks nothing and touches nothing.
  const gone = bulkFitPlan([slab(1, "FIT", null, "c1")], [], { kind: "crate", key: "crate:c9" });
  assert.deepEqual(gone, { slabIds: [], pieceIds: [], marked: 0, skippedUnfit: 0, alreadyFit: 0 });
  assert.equal(bulkFitNote(gone), "Nothing here to mark");
});

test("bulkFitNote always reports the skipped half", () => {
  assert.equal(bulkFitNote({ slabIds: [], pieceIds: [], marked: 38, skippedUnfit: 2, alreadyFit: 0 }),
    "38 marked correct, 2 left unfit");
  assert.equal(bulkFitNote({ slabIds: [], pieceIds: [], marked: 38, skippedUnfit: 0, alreadyFit: 0 }),
    "38 marked correct");
  assert.equal(bulkFitNote({ slabIds: [], pieceIds: [], marked: 4, skippedUnfit: 2, alreadyFit: 6 }),
    "4 marked correct, 2 left unfit, 6 already correct");
});

test("parseBulkFitScope: which of the three ways was asked for", () => {
  assert.deepEqual(parseBulkFitScope({ scope: "all" }), { ok: true, scope: { kind: "all" } });
  assert.deepEqual(parseBulkFitScope({ scope: "ALL" }), { ok: true, scope: { kind: "all" } });
  assert.deepEqual(parseBulkFitScope({ scope: "crate", crate: "crate:c1" }), { ok: true, scope: { kind: "crate", key: "crate:c1" } });
  // The lines in no crate are a heading the checker can tap, so an empty key is
  // an answer and not an omission.
  assert.deepEqual(parseBulkFitScope({ scope: "crate", crate: "" }), { ok: true, scope: { kind: "crate", key: "" } });

  const noCrate = parseBulkFitScope({ scope: "crate" });
  assert.equal(noCrate.ok, false);
  assert.match((noCrate as { reason: string }).reason, /which crate/i);
  assert.equal(parseBulkFitScope({}).ok, false, "a body with no scope does not mark the whole list by default");
  assert.equal(parseBulkFitScope({ scope: "everything" }).ok, false);
});

// ───────────────────────────── what the floor is handed ─────────────────────

test("checkerPieceView: a whitelist, so tomorrow's column does not leak onto a floor screen", () => {
  const v = checkerPieceView({
    id: "p1", packingListId: "pl1", crateId: "c1", crateNo: "1", drawingNo: "D-4", pieceNo: "12",
    design: "CQBE", lengthMm: 1030, widthMm: 110, thicknessMm: 20, sqft: 439.042, quantity: 360,
    room: "KITCHEN", weightKg: 812.5, notes: "polish two edges",
    fit: "UNFIT", unfitReason: "Size short", checkedAt: new Date("2026-09-12T12:00:00Z"),
    checkedById: "u9", createdAt: new Date(), updatedAt: new Date(),
    // the kind of column this table will grow, and must not hand out
    ratePerSqft: 14.5,
  });
  assert.equal(v.design, "CQBE");
  assert.equal(v.pieceNo, "12");
  assert.equal(v.quantity, 360);
  assert.equal(v.lengthMm, 1030, "sizes stay in the millimetres the row stores");
  assert.equal(v.fit, "UNFIT");
  assert.equal(v.unfitReason, "Size short");
  assert.equal(v.checkedAt, "2026-09-12T12:00:00.000Z");
  for (const key of ["ratePerSqft", "checkedById", "packingListId", "createdAt", "updatedAt"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(v, key), false, `${key} has no business on a floor screen`);
  }

  // A half-filled line still answers a shape the screen can render.
  const bare = checkerPieceView({ id: "p2", design: "CQBE" });
  assert.equal(bare.fit, "PENDING");
  assert.equal(bare.quantity, 1);
  assert.equal(bare.crateNo, null);
  assert.equal(bare.checkedAt, null);
});

test("checkerListView carries the cut-to-size lines, and counts them in its progress", () => {
  const loaded = {
    id: "pl1", number: "PL/26-27/0009", status: "SUBMITTED", measurementUnit: "cm",
    crates: [{ id: "c1", crateNo: 1, kind: "Wooden Crate" }],
    slabs: [{ id: "s1", crateId: "c1", slabNumber: 150903, fit: "FIT", sortOrder: 1 }],
    pieces: [
      { id: "p1", crateId: "c1", crateNo: "1", design: "CQBE", pieceNo: "12", quantity: 360, fit: "PENDING" },
      { id: "p2", crateId: "c1", crateNo: "1", design: "CQBE", pieceNo: "13", quantity: 12, fit: "UNFIT", unfitReason: "Size short" },
    ],
    order: { number: "SAL-ORD/26-27/01642", kind: "EXPORT", client: { name: "CIOT LLC", commercialExt: { gstin: "33AALCP2750N1Z3" } } },
  };
  const view = checkerListView(loaded);
  assert.equal(view.pieces.length, 2);
  assert.equal(view.pieces[0].pieceNo, "12");
  // The bar the checker watches counts every line there is to look at. Counting
  // the slab alone drew it full over a crate two-thirds unchecked.
  assert.deepEqual(view.fit, { total: 3, fit: 1, unfit: 1, pending: 1 });

  // And the whitelist still holds with a second table in it.
  assert.equal(JSON.stringify(view).includes("33AALCP2750N1Z3"), false);

  // A list with no cut-to-size line answers a shape the screen can render.
  assert.deepEqual(checkerListView({ id: "x", number: "PL/1", status: "SUBMITTED" }).pieces, []);
});

// ───────────────────────────── nothing ships on a finding ───────────────────

test("dispatchBlockers: an unfit or unchecked PIECE stops the truck too", () => {
  const clean = dispatchBlockers([{ slabNumber: 1, fit: "FIT" }], [piece("7", "FIT")]);
  assert.equal(clean.ok, true);
  assert.equal(clean.reason, "");

  const refused = dispatchBlockers([{ slabNumber: 1, fit: "FIT" }], [piece("12", "UNFIT", "Size short")]);
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.unfit, [], "no slab is to blame, so none is named");
  assert.deepEqual(refused.unfitPieces, ["crate 1 · piece 12 · CQBE"]);
  assert.match(refused.reason, /^Nothing ships until the list is corrected\./);
  assert.match(refused.reason, /crate 1 · piece 12 · CQBE \(Size short\)/);
  // There is no shelf of replacement pieces: a cut piece is recut, not swapped.
  assert.match(refused.reason, /recut/i);
  assert.doesNotMatch(refused.reason, /same design and thickness/,
    "that sentence is the slab's swap, and offering it for a piece sends Commercial looking for stock that cannot exist");

  const unchecked = dispatchBlockers([], [piece("7", "PENDING"), piece("8", "PENDING")]);
  assert.equal(unchecked.ok, false);
  assert.equal(unchecked.uncheckedPieces, 2);
  assert.match(unchecked.reason, /2 cut-to-size line\(s\) not yet checked/);

  // A caller with only slabs in its hand asks the old question and gets the old
  // answer — the pieces argument is optional.
  assert.equal(dispatchBlockers([{ slabNumber: 1, fit: "FIT" }]).ok, true);
});

// ──────────────────── and the one caller has to ask it ──────────────────────

// The rule above was enforced by the pure function and then dropped by its only
// production caller: the dispatch route passed `list.slabs` alone, so the piece
// arm never ran and a mixed container left with a line the checker had refused
// while the pieces route was logging "nothing ships until it is recut and
// repacked". A pure-function test cannot see that gap by construction — the
// function was right — and the route imports Prisma and Next, so node --test
// cannot load it. So this reads the route's source the way
// creditNoteRoleGate.test.ts reads its page: the call has to be handed the
// pieces, and the refusal has to name them, because the dispatch screen draws a
// swap for a refused slab and must not draw one for a piece.

/** The text of the route's one dispatchBlockers(...) call, parens balanced. */
function blockersCall(source: string): string {
  const at = source.indexOf("dispatchBlockers(");
  assert.notEqual(at, -1, "the dispatch route must still ask dispatchBlockers whether the list may leave");
  let depth = 0;
  for (let i = source.indexOf("(", at); i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(at, i + 1);
  }
  return assert.fail("the dispatchBlockers call has unbalanced parentheses");
}

test("the dispatch route asks about the pieces, not about the slabs alone", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../src/app/api/office/commercial/packing-lists/[plId]/dispatch/route.ts", import.meta.url)),
    "utf8",
  );
  const call = blockersCall(src);

  assert.match(call, /\blist\.pieces\b/,
    "the dispatch route must hand dispatchBlockers the list's cut-to-size lines; with the slabs alone an UNFIT piece does not stop the truck");
  assert.match(call, /\bfit\b/,
    "the pieces are mapped with their verdict — a mapping without fit reaches dispatchBlockers as undefined and reads as unchecked, not as fit");
  assert.match(src, /blockers\.unfitPieces/,
    "the 409 has to name the refused cut-to-size lines, or the screen shows a refusal with nothing to act on");
  assert.match(src, /blockers\.uncheckedPieces/,
    "and has to say how many nobody has looked at, for the same reason it says so for the slabs");
});

// ───────────── and the list's own screen has to carry the news ──────────────

// A late verdict lands on a list the check has already concluded: the pieces
// route writes fit onto the line, logs "nothing ships until it is recut and
// repacked", and leaves the list FINAL with its green verification note intact.
// The only place Commercial finds out is the packing list itself, so what that
// screen says is a rule, not a decoration — and it is tested here as one.

test("recheckBanner: a refused cut-to-size line reaches Commercial's own screen", () => {
  // THE CASE THAT WENT SILENT. Twelve slabs all fit and one piece refused at
  // loading: the banner was drawn off a count taken over the slabs alone, so
  // the screen the recut has to be started from showed nothing at all.
  const allFit = [slab(1, "FIT"), slab(2, "FIT")];
  const late = recheckBanner("FINAL", allFit, [piece("12", "UNFIT", "Size short")]) ?? "";
  assert.notEqual(late, "", "a refused piece has to put something on the packing list");
  assert.match(late, /1 cut-to-size line\(s\) refused/);
  // Named, not counted: a cut line has no slab number to look up, and the table
  // under the banner may hold forty of them.
  assert.match(late, /crate 1 · piece 12 · CQBE \(Size short\)/);
  assert.match(late, /recut/i);
  assert.doesNotMatch(late, /same design and thickness/,
    "that sentence is the slab's swap; offering it for a cut piece sends Commercial looking for stock that cannot exist");
});

test("recheckBanner: a list of slabs alone reads exactly as it always did", () => {
  assert.equal(
    recheckBanner("FINAL", [slab(1, "FIT"), slab(2, "UNFIT", "Crack")]),
    "1 slab(s) refused by the dispatch check — nothing ships until each is swapped for a slab of the same design and thickness (Swap beside the slab).",
  );
  assert.equal(
    recheckBanner("VERIFIED", [slab(1, "FIT"), slab(2, "PENDING")]),
    "1 swapped-in slab(s) await the dispatch check — nothing ships until they are marked fit.",
  );
});

test("recheckBanner: both kinds refused gets both sentences, and each its own remedy", () => {
  const both = recheckBanner("FINAL", [slab(150903, "UNFIT", "Crack")], [piece("12", "UNFIT", null)]) ?? "";
  assert.match(both, /1 slab\(s\) refused/);
  assert.match(both, /swapped for a slab of the same design and thickness/);
  assert.match(both, /1 cut-to-size line\(s\) refused/);
  assert.match(both, /crate 1 · piece 12 · CQBE/);
  assert.match(both, /recut and repacked/);

  // A piece nobody has looked at is news too, when nothing worse is outstanding.
  const waiting = recheckBanner("FINAL", [slab(1, "FIT")], [piece("12", "PENDING")]) ?? "";
  assert.match(waiting, /1 cut-to-size line\(s\) await the dispatch check/);
});

test("recheckBanner: nothing to say means no banner", () => {
  // Every line of both kinds fit — the list is simply clean.
  assert.equal(recheckBanner("FINAL", [slab(1, "FIT")], [piece("12", "FIT")]), null);
  assert.equal(recheckBanner("FINAL", [], []), null);
  // And a list that is not open to a late verdict says nothing either: while it
  // is SUBMITTED the checker is still working, and the check screen is where
  // the verdicts are read. Only VERIFIED and FINAL take a recheck.
  assert.equal(recheckBanner("SUBMITTED", [], [piece("12", "UNFIT", "Size short")]), null);
  assert.equal(recheckBanner("DRAFT", [], [piece("12", "UNFIT", "Size short")]), null);
  assert.equal(recheckBanner("DISPATCHED", [], [piece("12", "UNFIT", "Size short")]), null);
});

// ──────────────── and the two screens have to ask it, too ───────────────────

// Same shape of gap the dispatch route had, in the two places Commercial
// actually looks. fitCounts takes the pieces as a SECOND, DEFAULTED argument,
// so a caller written before there were pieces goes on compiling and goes on
// answering — about the slabs. That is not something a test of fitCounts can
// see, and neither file can be loaded bare (React, Next, Prisma), so these read
// the source the way the dispatch-route test above does.

const sourceOf = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Every fitCounts(...) call in a file, parentheses balanced. */
function fitCountsCalls(source: string): string[] {
  const out: string[] = [];
  for (let at = source.indexOf("fitCounts("); at !== -1; at = source.indexOf("fitCounts(", at + 1)) {
    let depth = 0;
    for (let i = source.indexOf("(", at); i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) { out.push(source.slice(at, i + 1)); break; }
    }
  }
  return out;
}

test("the packing list editor counts both kinds of line, and says so in both places", () => {
  const editor = sourceOf("../src/components/commercial/packing/PackingListEditor.tsx");
  const calls = fitCountsCalls(editor);
  assert.equal(calls.length, 1, "the editor takes one count of the list, and it is the one below");
  assert.match(calls[0], /\bpieces\b/,
    "the editor must count the cut-to-size lines as well; over the slabs alone the Checked KPI reads 12/12 all fit on a list with a refused piece on it");

  // The banner is the rule module's sentence now, not one built here out of a
  // slab count. Re-inlining it is how the piece variant gets lost again: a
  // refused piece would be told to find a slab of the same design and thickness.
  assert.match(editor, /recheckBanner\(/,
    "the amber banner is recheckBanner's answer — the screen renders it, it does not decide it");
  assert.doesNotMatch(editor, /same design and thickness/,
    "the swap sentence belongs to the rule module, where a cut-to-size line gets its own wording");

  // The verdict has to survive the trip to the client or none of the above can
  // be counted: the row type the editor holds is PiecesTable's PieceRow.
  assert.match(sourceOf("../src/components/commercial/packing/PiecesTable.tsx"), /\bfit:\s*"PENDING"\s*\|\s*"FIT"\s*\|\s*"UNFIT"/,
    "a packed piece carries the same verdict a packed slab does (round four, answer 1); dropped from the row type it cannot be counted or shown");
});

test("the packing list register counts both kinds of line as well", () => {
  const register = sourceOf("../src/app/api/office/commercial/packing-lists/route.ts");
  const calls = fitCountsCalls(register);
  assert.equal(calls.length, 1, "one count per row of the register");
  assert.match(calls[0], /\bpieces\b/,
    "the register's 'N to check' chip is this count; over the slabs alone a cut-to-size list looks like it has nothing left to check");
  // And the count needs rows to count: a select that never asks for the pieces
  // hands fitCounts an empty array and answers cleanly about nothing.
  assert.match(register, /pieces:\s*\{\s*select:\s*\{\s*fit:\s*true/,
    "the query has to fetch the pieces' verdicts, or the count above is taken over an array that is always empty");
});
