import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPeriodReport, perPieceCharge } from "../src/lib/fab/periodReport.ts";

// The owner: "there is report in the full project, same like I need that type
// for my fabrication module — day wise, month wise, weekly, along with pricing."
//
// And, on the dashboard this replaces: "same piece is being cut, polished,
// sinked, fabricated and packaged but added as 4-5 times." That is why
// operations and piecesPacked are two columns and never one.

const stage = (dayKey: string, c = 0, p = 0, s = 0, f = 0, k = 0) =>
  ({ dayKey, cutting: c, polishing: p, sinkCutting: s, fabrication: f, packaging: k });

test("OPERATIONS ARE STAGE COMPLETIONS, PIECES ARE PIECES — never one column", () => {
  // 50 pieces crossing five stages in a day: 250 operations, 50 packed.
  const r = buildPeriodReport(
    [stage("2026-08-25", 50, 50, 50, 50, 50)],
    [{ dayKey: "2026-08-25", edgeCost: 3787.5, sinkCost: 6900, piecesPacked: 50 }],
    "day",
  );
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.equal(row.operations, 250, "five stages of fifty pieces");
  assert.equal(row.piecesPacked, 50, "and fifty pieces actually left");
  assert.notEqual(row.operations, row.piecesPacked);
  assert.equal(row.total, 10687.5);
  assert.equal(row.edgeCost + row.sinkCost, row.total);
});

test("operations is DERIVED, so it cannot disagree with its own columns", () => {
  const r = buildPeriodReport([stage("2026-08-25", 1, 2, 3, 4, 5)], [], "day");
  const row = r.rows[0];
  assert.equal(row.operations, 15);
  assert.equal(
    row.cutting + row.polishing + row.sinkCutting + row.fabrication + row.packaging,
    row.operations,
  );
});

test("A WEEK IS MONDAY TO SUNDAY, and days fold into it", () => {
  // 24 Aug 2026 is a Monday; 30 Aug is the Sunday that closes that week.
  const r = buildPeriodReport(
    [stage("2026-08-24", 10), stage("2026-08-26", 5), stage("2026-08-30", 3)],
    [
      { dayKey: "2026-08-24", edgeCost: 100, sinkCost: 0, piecesPacked: 2 },
      { dayKey: "2026-08-30", edgeCost: 50, sinkCost: 25, piecesPacked: 1 },
    ],
    "week",
  );
  assert.equal(r.rows.length, 1, "all three days are one week");
  assert.equal(r.rows[0].cutting, 18);
  assert.equal(r.rows[0].total, 175);
  assert.equal(r.rows[0].piecesPacked, 3);
  // 31 Aug is the next Monday and must NOT join it.
  const two = buildPeriodReport([stage("2026-08-30", 1), stage("2026-08-31", 1)], [], "week");
  assert.equal(two.rows.length, 2);
});

test("a month is a calendar month, and the grains nest", () => {
  const rows = [stage("2026-08-01", 1), stage("2026-08-31", 1), stage("2026-09-01", 1)];
  assert.equal(buildPeriodReport(rows, [], "month").rows.length, 2);
  assert.equal(buildPeriodReport(rows, [], "day").rows.length, 3);
  // Whatever the grain, the work is the same work.
  for (const g of ["day", "week", "month"] as const) {
    assert.equal(buildPeriodReport(rows, [], g).totals.cutting, 3, g);
  }
});

test("A DAY WITH NOTHING ON IT STILL APPEARS", () => {
  // "A shop that cut nothing on Thursday needs to see Thursday." A report that
  // skips an empty day makes a bad week look like a short one.
  const r = buildPeriodReport(
    [stage("2026-08-24", 10), stage("2026-08-27", 4)],
    [], "day", "2026-08-24", "2026-08-28",
  );
  assert.equal(r.rows.length, 5, "24th to 28th inclusive");
  assert.deepEqual(r.rows.map(x => x.period.key),
    ["2026-08-24","2026-08-25","2026-08-26","2026-08-27","2026-08-28"]);
  assert.equal(r.rows[1].operations, 0);
  assert.equal(r.rows[1].total, 0);
  // Oldest first, always — a report read top to bottom is read forwards.
  const keys = r.rows.map(x => x.period.startDayKey);
  assert.deepEqual([...keys].sort(), keys);
});

test("THE TOTAL EQUALS THE SUM OF THE COLUMN, to the paisa", () => {
  // The failure this whole module exists to avoid repeating: a footer that does
  // not equal what is above it.
  const r = buildPeriodReport(
    [stage("2026-08-24", 3, 3), stage("2026-08-25", 4, 4), stage("2026-08-26", 5, 5)],
    [
      { dayKey: "2026-08-24", edgeCost: 1234.56, sinkCost: 230, piecesPacked: 1 },
      { dayKey: "2026-08-25", edgeCost: 99.99,   sinkCost: 300, piecesPacked: 2 },
      { dayKey: "2026-08-26", edgeCost: 0.01,    sinkCost: 0,   piecesPacked: 1 },
    ],
    "day",
  );
  assert.equal(r.totals.operations, r.rows.reduce((a, x) => a + x.operations, 0));
  assert.equal(r.totals.total, r.rows.reduce((a, x) => a + x.total, 0));
  assert.equal(r.totals.piecesPacked, 4);
  assert.equal(r.totals.edgeCost, 1334.56);
  assert.equal(r.totals.sinkCost, 530);
  assert.equal(r.totals.total, 1864.56);
});

test("AN UNREADABLE DAY IS DROPPED AND COUNTED, never moved to today", () => {
  const r = buildPeriodReport(
    [stage("2026-08-25", 5), stage("not-a-day", 99), stage("", 7)],
    [{ dayKey: "25/08/2026", edgeCost: 500, sinkCost: 0, piecesPacked: 9 }],
    "day",
  );
  assert.equal(r.dropped, 3, "two stage rows and one money row");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].cutting, 5, "the 99 did not land anywhere");
  assert.equal(r.totals.total, 0, "and neither did the 500");
});

test("money arriving as several rows on one day is summed", () => {
  // One row per ordered row per day is how the route emits it.
  const r = buildPeriodReport([], [
    { dayKey: "2026-08-25", edgeCost: 100, sinkCost: 230, piecesPacked: 1 },
    { dayKey: "2026-08-25", edgeCost: 50,  sinkCost: 0,   piecesPacked: 1 },
    { dayKey: "2026-08-25", edgeCost: 25,  sinkCost: 300, piecesPacked: 2 },
  ], "day");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].edgeCost, 175);
  assert.equal(r.rows[0].sinkCost, 530);
  assert.equal(r.rows[0].total, 705);
  assert.equal(r.rows[0].piecesPacked, 4);
});

test("an empty floor reports zero rather than nothing", () => {
  const r = buildPeriodReport([], [], "day");
  assert.deepEqual(r.rows, []);
  assert.equal(r.totals.operations, 0);
  assert.equal(r.totals.total, 0);
  assert.equal(r.dropped, 0);
  assert.equal(r.grain, "day");
});

test("TWO DIVISORS — edge money over edge pieces, sink money over sink pieces", () => {
  // THIS TEST ASSERTED THE OPPOSITE and was left behind by the split: it said
  // "edge work IS fabrication work, so only the 30 earn". Hand edge polish
  // stopped following the sink, and the FOUR-argument form below — which the
  // only production caller uses (api/fab/ceo) — had no coverage at all until an
  // audit found it. The whole change turns on this arithmetic.
  //
  // Row A: 60 ordered, all four edges, 30 with sinks. ₹7,575 edge + ₹6,900 sink.
  const per = perPieceCharge(7575, 6900, 60, 30);
  assert.equal(per.edge, 126.25, "₹7,575 over the 60 that carry edge work");
  assert.equal(per.sink, 230, "₹6,900 over the 30 that carry a sink");

  // Packing the whole row rebuilds it exactly — no paise lost, nothing double
  // counted. A sink piece earns BOTH shares; a plain piece earns only the edge.
  assert.equal(per.edge * 60 + per.sink * 30, 7575 + 6900);

  // THE OLD ANSWER, pinned as the thing this is not: one divisor gave the 30
  // plain pieces nothing and landed their edge money on the sink pieces. The
  // project total was right; every per-piece and per-DAY figure was wrong.
  const wrong = perPieceCharge(7575, 6900, 30, 30);
  assert.notEqual(wrong.edge, per.edge);
  assert.equal(wrong.edge, 252.5, "double what a piece is actually worth");

  // Each count guards its own share; a zero on one side does not zero the other.
  assert.deepEqual(perPieceCharge(7575, 0, 60, 0), { edge: 126.25, sink: 0 });
  assert.deepEqual(perPieceCharge(0, 6900, 0, 30), { edge: 0, sink: 230 });
  assert.deepEqual(perPieceCharge(0, 0, 0, 0), { edge: 0, sink: 0 });
  assert.deepEqual(perPieceCharge(500, 500, -3, -3), { edge: 0, sink: 0 });

  // THE THREE-ARGUMENT FORM IS THE OLD BEHAVIOUR, deliberately: a caller that
  // has not been updated keeps the answer it always had rather than silently
  // getting a new one. sinkPieces falls back to edgePieces.
  assert.deepEqual(perPieceCharge(3787.5, 6900, 30), perPieceCharge(3787.5, 6900, 30, 30));
  assert.deepEqual(perPieceCharge(0, 0, 0), { edge: 0, sink: 0 });
  assert.deepEqual(perPieceCharge(500, 0, 0), { edge: 0, sink: 0 });
  assert.deepEqual(perPieceCharge(500, 0, -3), { edge: 0, sink: 0 });
});

test("PACKED AND CHARGED ARE TWO COUNTS — a mixed row bills once, not twice", () => {
  // The bug this guards: a row of 60 pieces with 30 sinks. perPieceCharge
  // spreads the row's WHOLE charge over the 30, so adding that share to all 60
  // packed pieces billed the row at exactly 2x — and the two halves are the
  // same size, colour and thickness, so nothing on the screen looked wrong.
  const per = perPieceCharge(3787.5, 6900, 30);

  // What the route now emits: sixty pieces reached the end, thirty earned.
  const r = buildPeriodReport([], [{
    dayKey: "2026-08-25",
    edgeCost: per.edge * 30,
    sinkCost: per.sink * 30,
    piecesPacked: 60,
    piecesCharged: 30,
  }], "day");

  assert.equal(r.rows[0].piecesPacked, 60, "output is every packed piece");
  assert.equal(r.rows[0].piecesCharged, 30, "money is only the fabrication ones");
  assert.equal(r.rows[0].total, 10687.5, "the row's own charge, not double it");
  assert.notEqual(r.rows[0].total, 21375);
  assert.equal(r.totals.piecesCharged, 30);
  assert.ok(r.rows[0].piecesCharged <= r.rows[0].piecesPacked);
});

test("a caller that never heard of piecesCharged reports zero, not a guess", () => {
  // Optional on the way in: a stale caller under-reports what earned rather
  // than silently claiming every packed piece did.
  const r = buildPeriodReport([], [
    { dayKey: "2026-08-25", edgeCost: 100, sinkCost: 230, piecesPacked: 4 },
  ], "day");
  assert.equal(r.rows[0].piecesPacked, 4);
  assert.equal(r.rows[0].piecesCharged, 0);
  assert.equal(r.totals.piecesCharged, 0);
});

test("per-piece is NOT rounded — the rounding happens once, at the sum", () => {
  // ₹100 over 3 pieces is 33.333…, and three of those must still be ₹100.
  // Rounding each to 33.33 and summing loses a paisa here and a rupee across a
  // project, which is how a total stops equalling its own column.
  const per = perPieceCharge(100, 0, 3);
  assert.ok(Math.abs(per.edge * 3 - 100) < 1e-9);
  assert.notEqual(per.edge, 33.33);
});
