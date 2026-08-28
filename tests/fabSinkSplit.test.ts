import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planSinkSplit, sideOf, describeSinkSplit, tallySinkDecisions, rowsForBulkSink,
  planSinkMerge, draftCards, draftChanges, draftValue, draftShape,
} from "../src/lib/fab/sinkSplit.ts";

// The owner's flow, in his words: "with sink and without sink can be separate a
// step ahead, while adding the PO itself — so you get new rows as well, now same
// size and thickness and colour but a different row due to sink present or no.
// Default is full."
//
// The point of splitting at the ORDER is that every row downstream is then
// homogeneous: one size, one thickness, one routing. Nothing after this has to
// ask "which 30 of the 60".

test("a row is only SINK when every piece carries one", () => {
  assert.equal(sideOf(60, 60), "sink");
  assert.equal(sideOf(60, 0), "plain");
  assert.equal(sideOf(60, null), "plain");
  // A legacy partial row is plain — so a split carves the sink pieces OUT of
  // it, which is the direction that leaves the letter meaning what it meant.
  assert.equal(sideOf(60, 30), "plain");
  assert.equal(sideOf(0, 0), "plain");
});

test("THE WHOLE ROW, EITHER WAY, IS NOT A SPLIT — that is the default gesture", () => {
  // "Default is full": clicking a row moves all of it, and a row that is
  // entirely one thing needs no second row to describe it.
  const all = planSinkSplit({ quantity: 60, currentSinkQuantity: 0, wantSinkQuantity: 60 });
  assert.equal(all.ok && all.action, "mark");
  if (all.ok && all.action === "mark") {
    assert.equal(all.side, "sink");
    assert.equal(all.sinkQuantity, 60);
  }

  const none = planSinkSplit({ quantity: 60, currentSinkQuantity: 60, wantSinkQuantity: 0 });
  assert.equal(none.ok && none.action, "mark");
  if (none.ok && none.action === "mark") assert.equal(none.sinkQuantity, 0);

  // Idempotent: asking for what is already true is not an error and not a write.
  assert.equal(planSinkSplit({ quantity: 60, currentSinkQuantity: 60, wantSinkQuantity: 60 }).ok, true);
  const same = planSinkSplit({ quantity: 60, currentSinkQuantity: 60, wantSinkQuantity: 60 });
  assert.equal(same.ok && same.action, "none");
  const same2 = planSinkSplit({ quantity: 60, currentSinkQuantity: null, wantSinkQuantity: 0 });
  assert.equal(same2.ok && same2.action, "none");
});

test("A PARTIAL MAKES A SECOND ROW, and the original stays where it was", () => {
  // Row C, 60 plain pieces, 20 of them now need sinks.
  // C keeps its 40 plain; a new row takes the 20 with sinks.
  const p = planSinkSplit({ quantity: 60, currentSinkQuantity: 0, wantSinkQuantity: 20 });
  assert.equal(p.ok && p.action, "split");
  if (p.ok && p.action === "split") {
    assert.deepEqual(p.keep, { quantity: 40, side: "plain", sinkQuantity: 0 });
    assert.deepEqual(p.create, { quantity: 20, side: "sink", sinkQuantity: 20 });
    // Nothing is lost or invented in the split.
    assert.equal(p.keep.quantity + p.create.quantity, 60);
  }
});

test("A SINK ROW REDUCED KEEPS ITS SINK PIECES — the letter does not change meaning", () => {
  // Row D, 20 pieces all with sinks, now only 10 should have them.
  // D stays the sink row with 10; the 10 that lost their sink become a new row.
  // Doing it the other way would turn D from a sink row into a plain one under
  // the manager's hands, which is how a letter stops naming a kind of piece.
  const p = planSinkSplit({ quantity: 20, currentSinkQuantity: 20, wantSinkQuantity: 10 });
  assert.equal(p.ok && p.action, "split");
  if (p.ok && p.action === "split") {
    assert.deepEqual(p.keep, { quantity: 10, side: "sink", sinkQuantity: 10 });
    assert.deepEqual(p.create, { quantity: 10, side: "plain", sinkQuantity: 0 });
  }
});

test("a legacy partial row splits into two clean ones", () => {
  // The state this whole change exists to remove: 60 ordered, 30 sinks, one row.
  // Asking for the same 30 now SPLITS it, so the row stops being two things.
  const p = planSinkSplit({ quantity: 60, currentSinkQuantity: 30, wantSinkQuantity: 30 });
  assert.equal(p.ok && p.action, "split");
  if (p.ok && p.action === "split") {
    assert.deepEqual(p.keep, { quantity: 30, side: "plain", sinkQuantity: 0 });
    assert.deepEqual(p.create, { quantity: 30, side: "sink", sinkQuantity: 30 });
  }
});

test("PIECES ALREADY CUT CANNOT BE SPLIT, and the refusal says why", () => {
  const p = planSinkSplit({
    quantity: 60, currentSinkQuantity: 0, wantSinkQuantity: 20, releasedPieces: 60,
  });
  assert.equal(p.ok, false);
  if (!p.ok) {
    assert.match(p.reason, /already been sent to cutting/);
    assert.match(p.reason, /60 pieces/);
    assert.match(p.reason, /before the row goes to the floor/);
  }
  // AND NEITHER CAN THE WHOLE ROW BE RE-MARKED. This assertion used to say the
  // opposite — that marking a released row all-sink was fine, because it moves
  // no quantity between rows. It moves money instead, which is worse for being
  // invisible.
  //
  // has_sink is stamped on each piece at release and never changes; the row's
  // sink_quantity stayed editable. The Overview board prices from the ROW and
  // the period report earns from the PIECES, so a released 60/30 row marked
  // "all sink" reads ₹21,375 on one screen and ₹10,687.50 on the other. Both
  // are defensible and neither can be checked against the stone.
  const whole = planSinkSplit({
    quantity: 60, currentSinkQuantity: 0, wantSinkQuantity: 60, releasedPieces: 60,
  });
  assert.equal(whole.ok, false);
  if (!whole.ok) {
    assert.match(whole.reason, /already on the floor/);
    assert.match(whole.reason, /re-prices work that is already done/);
  }

  // Re-saving the board WITHOUT changing this row must still pass, or nobody
  // can save any row on a project that has started cutting.
  assert.equal(planSinkSplit({
    quantity: 60, currentSinkQuantity: 60, wantSinkQuantity: 60, releasedPieces: 60,
  }).ok, true);
  assert.equal(planSinkSplit({
    quantity: 60, currentSinkQuantity: 0, wantSinkQuantity: 0, releasedPieces: 60,
  }).ok, true);
});

test("a row on a slab cannot be split until it comes off", () => {
  const p = planSinkSplit({
    quantity: 60, currentSinkQuantity: 0, wantSinkQuantity: 20, allocatedQuantity: 15,
  });
  assert.equal(p.ok, false);
  if (!p.ok) {
    assert.match(p.reason, /15 pieces of this row are already on a slab/);
    assert.match(p.reason, /Take the row off the slab board first/);
  }
  // Singular reads properly too — an error nobody can parse gets ignored.
  const one = planSinkSplit({
    quantity: 60, currentSinkQuantity: 0, wantSinkQuantity: 20, allocatedQuantity: 1,
  });
  assert.equal(one.ok, false);
  if (!one.ok) assert.match(one.reason, /1 piece of this row is already on a slab/);
});

test("the count is refused by NAME, not with 'invalid quantity'", () => {
  const over = planSinkSplit({ quantity: 10, currentSinkQuantity: 0, wantSinkQuantity: 12 });
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.match(over.reason, /has 10 pieces/);
    assert.match(over.reason, /12 of them cannot carry a sink/);
  }
  // NOT SAID IS NOT ZERO. Number(null) and Number("") are both 0, so a bare
  // coercion would read "nobody chose" as "no sinks" and quietly route a whole
  // row plain. Every one of these is refused instead.
  for (const bad of [-1, 1.5, NaN, "three", null, undefined, "", true, {}, []]) {
    const r = planSinkSplit({
      quantity: 10, currentSinkQuantity: 0, wantSinkQuantity: bad as unknown as number,
    });
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  // A missing count is refused with the question, not with arithmetic.
  const missing = planSinkSplit({
    quantity: 10, currentSinkQuantity: 0, wantSinkQuantity: null as unknown as number,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.reason, /How many pieces carry a sink/);

  // The CURRENT count, by contrast, may legitimately be null — "not decided
  // yet" — and reads as a plain row without being refused.
  const fine = planSinkSplit({ quantity: 10, currentSinkQuantity: null, wantSinkQuantity: 4 });
  assert.equal(fine.ok, true);
  if (fine.ok && fine.action === "split") assert.equal(fine.keep.side, "plain");
  const empty = planSinkSplit({ quantity: 0, currentSinkQuantity: 0, wantSinkQuantity: 0 });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.reason, /no quantity/);
});

test("the sentence beside the button says a row is about to become two", () => {
  const p = planSinkSplit({ quantity: 60, currentSinkQuantity: 0, wantSinkQuantity: 20 });
  const s = describeSinkSplit(p, "Row C");
  assert.match(s, /Row C keeps 40 plain/);
  assert.match(s, /a new row takes 20 with sink/);
  assert.match(s, /a different row because the routing differs/);

  const all = planSinkSplit({ quantity: 60, currentSinkQuantity: 0, wantSinkQuantity: 60 });
  assert.match(describeSinkSplit(all, "Row C"), /All 60 pieces of Row C will carry a sink/);

  const none = planSinkSplit({ quantity: 60, currentSinkQuantity: 60, wantSinkQuantity: 0 });
  assert.match(describeSinkSplit(none, "Row C"), /will carry no sinks/);

  const already = planSinkSplit({ quantity: 60, currentSinkQuantity: 60, wantSinkQuantity: 60 });
  assert.match(describeSinkSplit(already, "Row C"), /already all sink pieces/);

  // A refusal is shown as itself, not wrapped in cheer.
  const bad = planSinkSplit({ quantity: 10, currentSinkQuantity: 0, wantSinkQuantity: 12 });
  assert.equal(describeSinkSplit(bad, "Row C"), bad.ok ? "" : bad.reason);
});

/* ── DOING A WHOLE PO AT ONCE ───────────────────────────────────────────────
 * The owner: "current model feels so heavy work to do — make it easy for apply
 * and splitting the sink and non sink." A 28-row PO meant 28 clicks before
 * anything could move, and on a real order most rows are plain.
 */

const PO = [
  { quantity: 60, sinkQuantity: null },        // nobody asked
  { quantity: 40, sinkQuantity: null },        // nobody asked
  { quantity: 20, sinkQuantity: 0 },           // plain, decided
  { quantity: 10, sinkQuantity: 10 },          // sink, decided
  { quantity: 30, sinkQuantity: 12 },          // legacy mixed row
  { quantity: 15, sinkQuantity: null, locked: true },  // on the cutter
];

test("THE TALLY IS WHAT THE BUTTON PROMISES", () => {
  const t = tallySinkDecisions(PO);
  assert.equal(t.total, 6);
  assert.equal(t.undecided, 3, "two open rows plus the locked one, which is also unset");
  assert.equal(t.plain, 1);
  assert.equal(t.sink, 1);
  assert.equal(t.mixed, 1, "12 of 30 — only possible on a row predating the split");
  assert.equal(t.locked, 1);
  // A locked row is undecided but NOT changeable, so the button says 2, not 3.
  assert.equal(t.changeable, 2);
  const empty = tallySinkDecisions([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.changeable, 0);
});

test("CLEARING THE BACKLOG TOUCHES THE BACKLOG, and nothing else", () => {
  // The gesture a manager actually wants: the PDF landed, most rows are plain,
  // clear them in one click WITHOUT disturbing the ones already marked.
  const undecided = rowsForBulkSink(PO, "plain", "undecided");
  assert.equal(undecided.length, 2);
  assert.ok(undecided.every(r => r.sinkQuantity == null && !r.locked));
  // The already-decided plain row is not in it — doing nothing to it is not a
  // change, and counting it would make the button overpromise.
  assert.ok(!undecided.some(r => r.quantity === 20));
});

test("the blunt version still refuses a row on the cutter", () => {
  const all = rowsForBulkSink(PO, "plain", "all");
  // Everything not already plain and not locked: the two unset, the sink row,
  // and the legacy mixed row.
  assert.equal(all.length, 4);
  assert.ok(!all.some(r => r.locked), "pieces exist and carry this row's code");
  assert.ok(!all.some(r => r.quantity === 20), "already plain — not a change");
  // THE MIXED ROW IS IN IT. sideOf() calls 12-of-30 "plain", so filtering by
  // side would skip the very rows a bulk clean-up exists to fix — and leave the
  // manager to hunt them one at a time. 12 sinks coming off IS a change.
  assert.ok(all.some(r => r.quantity === 30), "12 of 30 is not already plain");

  const allSink = rowsForBulkSink(PO, "sink", "all");
  assert.ok(!allSink.some(r => r.quantity === 10), "already sink — not a change");
  assert.ok(!allSink.some(r => r.locked));
  assert.equal(allSink.length, 4);
});

test("a bulk action is only ever a MARK — it never splits", () => {
  // Bulk means "all of these one way". Every row it picks must therefore plan to
  // a whole-row mark, never to a split: a split invents a row, and inventing 28
  // rows from one button is not something anybody asked for.
  for (const target of ["plain", "sink"] as const) {
    for (const r of rowsForBulkSink(PO, target, "all")) {
      const plan = planSinkSplit({
        quantity: r.quantity,
        currentSinkQuantity: r.sinkQuantity,
        wantSinkQuantity: target === "sink" ? r.quantity : 0,
      });
      assert.equal(plan.ok, true, JSON.stringify(r));
      if (plan.ok) assert.notEqual(plan.action, "split", JSON.stringify(r));
    }
  }
});

/* ── PUTTING A SPLIT BACK ───────────────────────────────────────────────────
 * The board promises "undo, and dragging back, both work". A whole-row move
 * undoes itself; a split made a second row, so undoing it is a merge.
 */

const C = { id: "c", quantity: 40, lengthIn: 28, widthIn: 22.5, poId: "po1" };
const D = { id: "d", quantity: 20, lengthIn: 28, widthIn: 22.5, poId: "po1" };

test("A SPLIT CAN BE PUT BACK — that is what makes it safe to try", () => {
  const m = planSinkMerge(C, D);
  assert.equal(m.ok, true);
  if (m.ok) {
    assert.equal(m.intoId, "c");
    assert.equal(m.fromId, "d");
    assert.equal(m.quantity, 60, "40 + 20 — exactly the row that was split");
  }
});

test("TWO DIFFERENT SIZES ARE NOT A SPLIT PAIR — merging them reprices the order", () => {
  // The check is on the DIMENSIONS, not on a "these came from each other" flag
  // nobody would maintain. Folding a 28×22.5 row into a 28×4 one does not undo
  // anything; it silently changes what the customer is getting.
  const other = { ...D, widthIn: 4 };
  const m = planSinkMerge(C, other);
  assert.equal(m.ok, false);
  if (!m.ok) {
    assert.match(m.reason, /not the same size/);
    assert.match(m.reason, /change what was ordered/);
  }
  const longer = { ...D, lengthIn: 34 };
  assert.equal(planSinkMerge(C, longer).ok, false);
  // Same size across null-vs-null is still the same size.
  assert.equal(planSinkMerge(
    { id: "x", quantity: 5, lengthIn: null, widthIn: null },
    { id: "y", quantity: 5, lengthIn: null, widthIn: null },
  ).ok, true);
  // But null against a number is not.
  assert.equal(planSinkMerge(
    { id: "x", quantity: 5, lengthIn: null, widthIn: 22.5 },
    { id: "y", quantity: 5, lengthIn: 28, widthIn: 22.5 },
  ).ok, false);
});

test("a row that has moved on cannot be merged away", () => {
  const cut = planSinkMerge(C, { ...D, releasedPieces: 20 });
  assert.equal(cut.ok, false);
  if (!cut.ok) assert.match(cut.reason, /already been sent to cutting/);

  const onSlab = planSinkMerge(C, { ...D, allocatedQuantity: 5 });
  assert.equal(onSlab.ok, false);
  if (!onSlab.ok) assert.match(onSlab.reason, /already on a slab/);

  // BOTH rows are checked, not just the one being folded away — the keeper's
  // quantity changes too, and a slab holding part of it would be left short.
  const keeperBusy = planSinkMerge({ ...C, allocatedQuantity: 3 }, D);
  assert.equal(keeperBusy.ok, false);
});

test("the obvious nonsense is refused by name", () => {
  assert.equal(planSinkMerge(C, C).ok, false);
  const self = planSinkMerge(C, C);
  if (!self.ok) assert.match(self.reason, /cannot be merged into itself/);

  const crossPo = planSinkMerge(C, { ...D, poId: "po2" });
  assert.equal(crossPo.ok, false);
  if (!crossPo.ok) assert.match(crossPo.reason, /different purchase orders/);

  assert.equal(planSinkMerge(C, { ...D, id: "" }).ok, false);
  assert.equal(planSinkMerge(
    { ...C, quantity: 0 }, { ...D, quantity: 0 },
  ).ok, false);
});

test("split then merge is a round trip — the order comes back the size it was", () => {
  const before = 60;
  const p = planSinkSplit({ quantity: before, currentSinkQuantity: 0, wantSinkQuantity: 20 });
  assert.equal(p.ok && p.action, "split");
  if (!p.ok || p.action !== "split") return;
  const m = planSinkMerge(
    { id: "keep", quantity: p.keep.quantity, lengthIn: 28, widthIn: 22.5 },
    { id: "made", quantity: p.create.quantity, lengthIn: 28, widthIn: 22.5 },
  );
  assert.equal(m.ok, true);
  if (m.ok) assert.equal(m.quantity, before, "nothing invented, nothing lost");
});

/* ── THE DRAFT ──────────────────────────────────────────────────────────────
 * The owner found the flaw in saving on every click: "you make it again to
 * unsink or no sink, it doesn't go to original, instead stays where they are."
 * A split wrote a real row the moment it was typed, and dragging that row back
 * only marked it plain — 40 + 20 plain rows where the order has one row of 60.
 * Nothing is written now until he saves, so a row that was never created cannot
 * be left behind.
 */

const ROW = { id: "c", label: "C", quantity: 60, sinkQuantity: null as number | null };

test("NOTHING DECIDED YET IS ONE CARD, and it says so", () => {
  const [card, ...rest] = draftCards([ROW]);
  assert.equal(rest.length, 0);
  assert.equal(card.side, "plain");
  assert.equal(card.quantity, 60);
  assert.equal(card.isNew, false);
  assert.equal(card.undecided, true);
});

test("A DRAFT SPLIT SHOWS TWO CARDS, and marks the one that does not exist yet", () => {
  const draft = new Map([["c", 20]]);
  const cards = draftCards([ROW], draft);
  assert.equal(cards.length, 2);
  const plain = cards.find(c => c.side === "plain")!;
  const sink = cards.find(c => c.side === "sink")!;
  assert.equal(plain.quantity, 40);
  assert.equal(sink.quantity, 20);
  assert.equal(plain.isNew, false, "the original keeps the side it is on today");
  assert.equal(sink.isNew, true, "this one appears on save");
  // Nothing invented on screen either.
  assert.equal(plain.quantity + sink.quantity, 60);
  // Both cards trace back to the one ordered row.
  assert.ok(cards.every(c => c.sourceId === "c"));
  assert.notEqual(plain.key, sink.key, "two cards, two React keys");
});

test("CHANGING YOUR MIND MERGES ITSELF — the bug that started this", () => {
  // Split to 20, then move it back to none. With the old save-on-click board
  // this left TWO plain rows behind. Here the number simply goes back and there
  // is one card again, because the second row was never created.
  const cards = draftCards([ROW], new Map([["c", 0]]));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].side, "plain");
  assert.equal(cards[0].quantity, 60);
  assert.equal(cards[0].isNew, false);
  // And all the way across is also one card.
  const all = draftCards([ROW], new Map([["c", 60]]));
  assert.equal(all.length, 1);
  assert.equal(all[0].side, "sink");
  assert.equal(all[0].quantity, 60);
});

test("a SINK row split in the draft keeps its sink pieces, same as the write would", () => {
  // What is drawn has to be what lands, or the board is lying about the save.
  const sinkRow = { id: "d", label: "D", quantity: 20, sinkQuantity: 20 };
  const cards = draftCards([sinkRow], new Map([["d", 10]]));
  const kept = cards.find(c => !c.isNew)!;
  const made = cards.find(c => c.isNew)!;
  assert.equal(kept.side, "sink");
  assert.equal(kept.quantity, 10);
  assert.equal(made.side, "plain");
  assert.equal(made.quantity, 10);
  // The planner agrees, which is the point of asserting it here.
  const plan = planSinkSplit({ quantity: 20, currentSinkQuantity: 20, wantSinkQuantity: 10 });
  assert.ok(plan.ok && plan.action === "split");
  if (plan.ok && plan.action === "split") {
    assert.equal(plan.keep.quantity, kept.quantity);
    assert.equal(plan.create.quantity, made.quantity);
    assert.equal(plan.keep.side, kept.side);
    assert.equal(plan.create.side, made.side);
  }
});

test("A ROW ON THE CUTTER IS NEVER SPLIT IN THE DRAFT EITHER", () => {
  const locked = { id: "e", label: "E", quantity: 15, sinkQuantity: 0, locked: true };
  const cards = draftCards([locked], new Map([["e", 7]]));
  assert.equal(cards.length, 1, "a draft cannot pretend to split it");
  assert.equal(cards[0].locked, true);
  assert.equal(cards[0].quantity, 15);
  // And it is never counted as pending work.
  assert.equal(draftChanges([locked], new Map([["e", 7]])).length, 0);
});

test("THE SAVE BUTTON'S COUNT IS ONLY WHAT MOVED", () => {
  const rows = [
    { id: "a", label: "A", quantity: 60, sinkQuantity: null },
    { id: "b", label: "B", quantity: 40, sinkQuantity: 0 },
    { id: "c", label: "C", quantity: 10, sinkQuantity: 10 },
  ];
  // b is dragged to the value it already holds — not a change.
  const draft = new Map([["a", 20], ["b", 0], ["c", 0]]);
  const ch = draftChanges(rows, draft);
  assert.equal(ch.length, 2);
  assert.deepEqual(ch.map(c => c.id), ["a", "c"]);
  const a = ch.find(c => c.id === "a")!;
  assert.equal(a.from, null, "nobody had decided");
  assert.equal(a.to, 20);
  assert.equal(a.splits, true, "a partial makes a second row");
  const c = ch.find(c => c.id === "c")!;
  assert.equal(c.splits, false, "all the way across is not a split");
  // No draft at all is no work.
  assert.equal(draftChanges(rows).length, 0);
  assert.equal(draftChanges(rows, new Map()).length, 0);
});

test("draftValue prefers the draft, and null still means nobody decided", () => {
  assert.equal(draftValue(ROW, undefined), null);
  assert.equal(draftValue(ROW, new Map()), null);
  assert.equal(draftValue(ROW, new Map([["c", 0]])), 0, "0 is a decision, not an absence");
  assert.equal(draftValue(ROW, new Map([["c", 20]])), 20);
  assert.equal(draftValue({ ...ROW, sinkQuantity: 5 }, new Map()), 5);
});

/* ── A CARD IS NOT A ROW ────────────────────────────────────────────────────
 * The owner, looking at a PO of 18 rows beside a board reading "Piece rows
 * (14)": "this type of data is not synced and realtime with the actual data we
 * make on PO."
 *
 * It was not a sync problem. The header printed `cards.length` under the word
 * "rows", and a row split in the draft draws TWO cards while still being ONE
 * ordered row — so the board reported an order that does not exist. Rows are
 * counted here; cards are counted where cards are drawn; never the same figure.
 */

const PO18 = [
  { id: "1",  label: "Row 1",  quantity: 40,  sinkQuantity: null as number | null },
  { id: "2",  label: "Row 2",  quantity: 25,  sinkQuantity: 0 },
  { id: "3",  label: "Row 3",  quantity: 60,  sinkQuantity: null },
  { id: "4",  label: "Row 4",  quantity: 60,  sinkQuantity: null },
  { id: "2s", label: "Row 2 (sink)", quantity: 15, sinkQuantity: 15 },
];

test("THE ROW COUNT RECONCILES WITH THE ORDER, split or not", () => {
  const clean = draftShape(PO18);
  assert.equal(clean.rows, 5, "five ordered rows, whatever the board draws");
  assert.equal(clean.pieces, 40 + 25 + 60 + 60 + 15);
  assert.equal(clean.cards, 5, "no split yet, so one card each");
  assert.equal(clean.sinkRows, 1);
  assert.equal(clean.plainRows, 4);
  assert.equal(clean.undecidedRows, 3);
  assert.equal(clean.sinkPieces, 15);

  // Now split Row 3 in the draft: 20 of its 60 get sinks.
  const split = draftShape(PO18, new Map([["3", 20]]));
  assert.equal(split.rows, 5, "STILL FIVE ORDERED ROWS — nothing is saved yet");
  assert.equal(split.pieces, 200, "and the same 200 pieces");
  assert.equal(split.cards, 6, "but six cards, because one row draws two");
  assert.equal(split.splitRows, 1);
  assert.equal(split.sinkPieces, 15 + 20);
  // The bug in one assertion: cards and rows must not be interchangeable.
  assert.notEqual(split.cards, split.rows);
  // And draftCards agrees with the count.
  assert.equal(draftCards(PO18, new Map([["3", 20]])).length, split.cards);
});

test("pieces are never invented or lost by a draft", () => {
  // Whatever the manager does, the order is still the order. This is the
  // arithmetic that catches a split going wrong before it is ever saved.
  for (const n of [0, 1, 17, 30, 59, 60]) {
    const s = draftShape(PO18, new Map([["3", n]]));
    assert.equal(s.rows, 5, `n=${n}`);
    assert.equal(s.pieces, 200, `n=${n}`);
    const cards = draftCards(PO18, new Map([["3", n]]));
    assert.equal(cards.reduce((a, c) => a + c.quantity, 0), 200, `n=${n}`);
  }
});

test("a locked row is counted as a row and never split", () => {
  const rows = [{ id: "L", label: "L", quantity: 15, sinkQuantity: 0, locked: true }];
  const s = draftShape(rows, new Map([["L", 7]]));
  assert.equal(s.rows, 1);
  assert.equal(s.cards, 1, "a draft cannot make it two");
  assert.equal(s.splitRows, 0);
  assert.equal(s.lockedRows, 1);
  assert.equal(s.undecidedRows, 0);
  assert.equal(s.pieces, 15);
});

test("an empty order has an empty shape rather than a wrong one", () => {
  const s = draftShape([]);
  assert.equal(s.rows, 0);
  assert.equal(s.pieces, 0);
  assert.equal(s.cards, 0);
  assert.equal(s.undecidedRows, 0);
});
