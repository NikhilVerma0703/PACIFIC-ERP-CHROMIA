// Cut-to-size packing lines (round three, answer 5), RUN against real values
// off his three workbooks: what a typed line is and what refuses it, the area
// of a piece from its millimetres, the per-crate and whole-list TOTAL rows, the
// rows the two sheets print, and the millimetre/unit lens the screen and the
// PDFs look through. Import-free module, so node --test loads it bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sqftFromMm, sqftForLine, sizeFromMm, sizeToMm, pieceSize, MM_PER_IN,
  parsePiece, piecePatch, pieceLabel, MAX_PIECE_QUANTITY, PIECE_FIELDS,
  crateKey, compareCrateNo, orderedPieces, matchCrate,
  pieceTotals, pieceSheet, sizeHeading,
  type PieceInput, type PieceLike,
} from "../src/lib/commercial/pieces-rules.ts";

// ───────────────────────────── the area of a piece ──────────────────────────

test("sqftFromMm: one piece, through the company's own 10.764", () => {
  // "DS - Thresholds (103 x 11)" — 1030 × 110 mm is 0.1133 sqm.
  assert.equal(sqftFromMm(1030, 110), 1.22);
  // A window sill at 1010 × 195 — his "WINDOW SILLS 101x19.5x2": 0.197 sqm.
  assert.equal(sqftFromMm(1010, 195), 2.119);
  // A whole slab's worth, so a piece line and a slab line agree: 3470 × 2010 mm
  // is the 347 × 201 cm of the CIOT measurement list, 6.9747 sqm, 75.076 sqft.
  assert.equal(sqftFromMm(3470, 2010), 75.076);
});

test("sqftFromMm: a missing or impossible side is no area, not zero by luck", () => {
  assert.equal(sqftFromMm(null, 110), 0);
  assert.equal(sqftFromMm(1030, null), 0);
  assert.equal(sqftFromMm(1030, 0), 0);
  assert.equal(sqftFromMm(-1030, 110), 0);
  assert.equal(sqftFromMm(undefined, undefined), 0);
});

test("sqftForLine: the quantity is scaled BEFORE the rounding, not after", () => {
  // 360 thresholds of 1030 × 110. The true area is 103 × 11 / 10000 × 360 ×
  // 10.764 = 439.042 sqft; rounding one piece to 1.22 and multiplying says
  // 439.2 — a fifth of a square foot invented on a customs sheet.
  assert.equal(sqftForLine(1030, 110, 360), 439.042);
  assert.notEqual(sqftForLine(1030, 110, 360), sqftFromMm(1030, 110) * 360);
  // One piece agrees with sqftFromMm, so a line of one and a slab line match.
  assert.equal(sqftForLine(1030, 110, 1), sqftFromMm(1030, 110));
  // Nothing to measure is nought, never a guess.
  assert.equal(sqftForLine(null, 110, 10), 0);
  assert.equal(sqftForLine(1030, 110, 0), 0);
  assert.equal(sqftForLine(1030, 0, 10), 0);
});

test("sizeFromMm / sizeToMm: millimetres through the list's own unit", () => {
  assert.equal(sizeFromMm(1030, "cm"), 103);
  assert.equal(sizeFromMm(1030, "in"), 40.55);
  // Inches carry two decimals: an 11 mm threshold edge is 0.43 in, and one
  // decimal would print it as 0.4.
  assert.equal(sizeFromMm(110, "in"), 4.33);
  assert.equal(sizeFromMm(11, "in"), 0.43);
  assert.equal(sizeFromMm(null, "cm"), null, "a blank stays blank in either unit");
  assert.equal(sizeFromMm("" as unknown as number, "cm"), null, "an emptied cell is no measurement");

  assert.equal(sizeToMm(103, "cm"), 1030);
  assert.equal(sizeToMm(40.55, "in"), 1029.97);
  assert.equal(sizeToMm("103", "cm"), 1030, "a string off a form field is a number here");
  assert.equal(sizeToMm("", "cm"), null);
  assert.equal(sizeToMm(null, "in"), null);
  assert.equal(MM_PER_IN, 25.4);
});

test("pieceSize: L × W × T in the printed unit, skipping what is not measured", () => {
  assert.equal(pieceSize({ lengthMm: 1030, widthMm: 110, thicknessMm: 20 }, "cm"), "103 × 11 × 2");
  assert.equal(pieceSize({ lengthMm: 1030, widthMm: 110, thicknessMm: null }, "cm"), "103 × 11");
  assert.equal(pieceSize({ lengthMm: null, widthMm: null, thicknessMm: null }, "cm"), "");
});

test("sizeHeading: the unit is in the heading, so it cannot disagree with the figure", () => {
  assert.equal(sizeHeading("Length", "cm"), "Length\n(cm)");
  assert.equal(sizeHeading("Width", "in"), "Width\n(in)");
});

// ───────────────────────────── a typed line ─────────────────────────────────

const line = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  crateNo: "1", drawingNo: "D-12", pieceNo: "7", design: "CPKT12412A",
  lengthMm: 1030, widthMm: 110, thicknessMm: 20, quantity: 35, room: "KITCHEN", weightKg: 240.5, ...over,
});

test("parsePiece: a full line off his sheet", () => {
  const r = parsePiece(line());
  assert.equal(r.ok, true);
  const v = (r as { value: PieceInput }).value;
  assert.equal(v.design, "CPKT12412A");
  assert.equal(v.crateNo, "1");
  assert.equal(v.drawingNo, "D-12");
  assert.equal(v.pieceNo, "7");
  assert.equal(v.lengthMm, 1030);
  assert.equal(v.widthMm, 110);
  assert.equal(v.thicknessMm, 20);
  assert.equal(v.quantity, 35);
  assert.equal(v.room, "KITCHEN");
  assert.equal(v.weightKg, 240.5);
});

test("parsePiece: the design is the only field a line cannot do without", () => {
  const bare = parsePiece({ design: "Alabaster Noir" });
  assert.equal(bare.ok, true);
  const v = (bare as { value: PieceInput }).value;
  assert.equal(v.quantity, 1, "one piece unless the sheet says otherwise");
  assert.equal(v.crateNo, null);
  assert.equal(v.sqft, null, "no size, no area — not a zero");

  for (const bad of [{}, { design: "" }, { design: "   " }, { design: null }]) {
    const r = parsePiece(bad as Record<string, unknown>);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} should be refused`);
    assert.match((r as { reason: string }).reason, /design/i);
  }
});

test("parsePiece: the quantity is a whole number of pieces, and it is sane", () => {
  assert.equal(parsePiece(line({ quantity: 0 })).ok, false);
  assert.equal(parsePiece(line({ quantity: -3 })).ok, false);
  assert.equal(parsePiece(line({ quantity: 2.5 })).ok, false);
  assert.equal(parsePiece(line({ quantity: "abc" })).ok, false);
  assert.equal(parsePiece(line({ quantity: MAX_PIECE_QUANTITY + 1 })).ok, false, "a decimal point gone missing");
  const ok = parsePiece(line({ quantity: "360" }));
  assert.equal(ok.ok, true);
  assert.equal((ok as { value: PieceInput }).value.quantity, 360, "a string off a form field counts");
});

test("parsePiece: a size that is typed must be positive millimetres", () => {
  for (const key of ["lengthMm", "widthMm", "thicknessMm"]) {
    const r = parsePiece(line({ [key]: 0 }));
    assert.equal(r.ok, false, `${key} of nought should be refused`);
    const neg = parsePiece(line({ [key]: -5 }));
    assert.equal(neg.ok, false);
  }
  const blank = parsePiece(line({ lengthMm: "", widthMm: null }));
  assert.equal(blank.ok, true, "a size still being measured is allowed to be missing");
  assert.equal((blank as { value: PieceInput }).value.lengthMm, null);
});

test("parsePiece: a typed size that is not a number is REFUSED, not read as blank", () => {
  // The clerk's typo. Storing null here wrote a sizeless line that printed with
  // a blank Length and a blank Sqft and left the sheet's TOTAL short by the
  // whole line — money and stone, on a customs document, with nothing in the
  // route's `refused` list to say so.
  for (const bad of ["1030 mm", "10.3.0", "O30", "abc", "--", "1030mm"]) {
    const r = parsePiece(line({ lengthMm: bad }));
    assert.equal(r.ok, false, `Length of "${bad}" should be refused`);
    assert.match((r as { reason: string }).reason, /Length must be a number/i);
    assert.match((r as { reason: string }).reason, new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the refusal quotes the typo back");
  }
  assert.equal(parsePiece(line({ widthMm: "twelve" })).ok, false);
  assert.equal(parsePiece(line({ thicknessMm: "2 cm" })).ok, false);

  // A thousands comma is still a figure, the way every other cell reads one.
  const comma = parsePiece(line({ lengthMm: "1,030" }));
  assert.equal(comma.ok, true);
  assert.equal((comma as { value: PieceInput }).value.lengthMm, 1030);
});

test("parsePiece: an unparseable sqft or weight is refused too", () => {
  const s = parsePiece(line({ sqft: "439.2 sqft" }));
  assert.equal(s.ok, false);
  assert.match((s as { reason: string }).reason, /Sqft must be a number/i);

  const w = parsePiece(line({ weightKg: "240 kg" }));
  assert.equal(w.ok, false);
  assert.match((w as { reason: string }).reason, /Weight must be a number/i);

  // Blank still means blank in both columns.
  assert.equal(parsePiece(line({ sqft: "", weightKg: "" })).ok, true);
  assert.equal((parsePiece(line({ weightKg: null })) as { value: PieceInput }).value.weightKg, null);
});

test("parsePiece: sqft is THE LINE's area — the size times the quantity", () => {
  // 360 thresholds at 1030 × 110: 439.042 for the line, scaled before the
  // rounding (sqftForLine). A per-piece figure in a column his TOTAL row adds
  // would understate the shipment by a factor of 360; a rounded piece
  // multiplied out overstates it by 0.158 sqft.
  const r = parsePiece(line({ quantity: 360 }));
  assert.equal((r as { value: PieceInput }).value.sqft, 439.042);
  assert.equal((r as { value: PieceInput }).value.sqft, sqftForLine(1030, 110, 360));

  // Nothing to derive it from leaves it blank rather than nought.
  const noSize = parsePiece({ design: "CQBE", quantity: 12 });
  assert.equal((noSize as { value: PieceInput }).value.sqft, null);
});

test("parsePiece: a typed sqft is kept exactly as typed", () => {
  const r = parsePiece(line({ quantity: 360, sqft: 438.75 }));
  assert.equal((r as { value: PieceInput }).value.sqft, 438.75, "the sheet in his hand wins over our arithmetic");
  assert.equal(parsePiece(line({ sqft: -1 })).ok, false);
  assert.equal(parsePiece(line({ weightKg: -1 })).ok, false);
});

test("piecePatch: the whole line is re-validated, so an edit cannot make it illegal", () => {
  const current = (parsePiece(line()) as { value: PieceInput }).value;

  const blanked = piecePatch(current, { design: "" });
  assert.equal(blanked.ok, false);
  assert.match((blanked as { reason: string }).reason, /design/i);

  const ok = piecePatch(current, { room: "BATH ROOM VANITY" });
  assert.equal(ok.ok, true);
  assert.deepEqual((ok as { fields: string[] }).fields, ["room"], "only what actually moved is written");

  const nothing = piecePatch(current, { room: "KITCHEN" });
  assert.deepEqual((nothing as { fields: string[] }).fields, [], "a re-typed identical value is no change");
});

test("piecePatch: a resized line re-derives its area, unless the clerk typed one", () => {
  const current = (parsePiece(line({ quantity: 10 })) as { value: PieceInput }).value;
  assert.equal(current.sqft, sqftForLine(1030, 110, 10));

  // The size moved and no sqft came with it: keeping the old area would print
  // the 1030 × 110 figure against a 2000 × 300 line.
  const resized = piecePatch(current, { lengthMm: 2000, widthMm: 300 });
  assert.equal(resized.ok, true);
  assert.equal((resized as { value: PieceInput }).value.sqft, sqftForLine(2000, 300, 10));
  assert.ok((resized as { fields: string[] }).fields.includes("sqft"));

  // The quantity alone moving is the same thing.
  const requantified = piecePatch(current, { quantity: 20 });
  assert.equal((requantified as { value: PieceInput }).value.sqft, sqftForLine(1030, 110, 20));

  // A typed sqft still wins.
  const typed = piecePatch(current, { lengthMm: 2000, widthMm: 300, sqft: 60 });
  assert.equal((typed as { value: PieceInput }).value.sqft, 60);

  // An edit that touches neither size nor quantity leaves the area alone.
  const renamed = piecePatch(current, { pieceNo: "9" });
  assert.equal((renamed as { value: PieceInput }).value.sqft, sqftForLine(1030, 110, 10));
  assert.deepEqual((renamed as { fields: string[] }).fields, ["pieceNo"]);
});

test("piecePatch: every field of a line can be edited", () => {
  const current = (parsePiece(line()) as { value: PieceInput }).value;
  for (const f of PIECE_FIELDS) {
    if (f === "design") continue;
    const r = piecePatch(current, { [f]: current[f] });
    assert.equal(r.ok, true, `${f} should be patchable`);
  }
});

test("pieceLabel: what the log calls a line", () => {
  assert.equal(pieceLabel({ crateNo: "1", pieceNo: "7", design: "CQBE" }), "crate 1 · piece 7 · CQBE");
  assert.equal(pieceLabel({ crateNo: null, pieceNo: null, design: "CQBE" }), "CQBE");
  assert.equal(pieceLabel({ crateNo: null, pieceNo: null, design: "" }), "piece line");
});

// ───────────────────────────── crates and ordering ──────────────────────────

test("compareCrateNo: 2 before 10, and the pieces in no crate last", () => {
  assert.ok(compareCrateNo("2", "10") < 0, "crate numbers sort as numbers, not as text");
  assert.ok(compareCrateNo("1", "1A") < 0);
  assert.ok(compareCrateNo("", "1") > 0, "no crate goes last, where the measurement list puts an unassigned slab");
  assert.ok(compareCrateNo("1", "") < 0);
  assert.equal(compareCrateNo("3", "3"), 0);

  // TWO SPELLINGS OF ONE NUMBER must still sort together and always the same
  // way round: "01" and "1" are equal both numerically and to localeCompare's
  // numeric collation, and a tie left them wherever they were typed — which
  // printed crate 01's subtotal twice on the sheet.
  assert.notEqual(compareCrateNo("01", "1"), 0);
  assert.equal(Math.sign(compareCrateNo("01", "1")), -Math.sign(compareCrateNo("1", "01")), "the order is the same read either way");
});

test("crateKey / orderedPieces: the sheet's own order, twice the same", () => {
  const rows: PieceLike[] = [
    { crateNo: "10", pieceNo: "1", design: "B", lengthMm: null, widthMm: null, thicknessMm: null, sqft: null, quantity: 1, weightKg: null },
    { crateNo: null, pieceNo: "1", design: "C", lengthMm: null, widthMm: null, thicknessMm: null, sqft: null, quantity: 1, weightKg: null },
    { crateNo: " 2 ", pieceNo: "2", design: "A", lengthMm: null, widthMm: null, thicknessMm: null, sqft: null, quantity: 1, weightKg: null },
    { crateNo: "2", pieceNo: "1", design: "A", lengthMm: null, widthMm: null, thicknessMm: null, sqft: null, quantity: 1, weightKg: null },
  ];
  assert.equal(crateKey(rows[2]), "2", "the typed number is trimmed before it is compared");
  assert.deepEqual(orderedPieces(rows).map((p) => `${crateKey(p)}/${p.pieceNo}`), ["2/1", "2/2", "10/1", "/1"]);
});

test("matchCrate: the link follows the typed number, and is dropped when it does not match", () => {
  const crates = [{ id: "c1", crateNo: 1 }, { id: "c2", crateNo: 2 }];
  assert.equal(matchCrate("2", crates), "c2");
  assert.equal(matchCrate(" 1 ", crates), "c1");
  assert.equal(matchCrate("9", crates), null, "his sheet numbers crates we have no row for");
  assert.equal(matchCrate("1A", crates), null);
  assert.equal(matchCrate(null, crates), null);
  assert.equal(matchCrate("", crates), null);
});

// ───────────────────────────── the TOTAL rows ───────────────────────────────

const p = (crateNo: string | null, quantity: number, sqft: number | null, weightKg: number | null, over: Partial<PieceLike> = {}): PieceLike => ({
  crateNo, design: "CPKT12412A", lengthMm: 1030, widthMm: 110, thicknessMm: 20, sqft, quantity, weightKg, ...over,
});

test("pieceTotals: sqft, pieces and weight, per crate and for the sheet", () => {
  const rows = [p("1", 35, 42.7, 240.5), p("1", 10, 12.2, 70), p("2", 5, 6.1, 35.25)];
  const t = pieceTotals(rows);
  assert.deepEqual(t.crates.map((c) => c.crateNo), ["1", "2"]);
  assert.deepEqual(t.crates[0], { crateNo: "1", lines: 2, pieces: 45, sqft: 54.9, weightKg: 310.5 });
  assert.deepEqual(t.crates[1], { crateNo: "2", lines: 1, pieces: 5, sqft: 6.1, weightKg: 35.25 });
  assert.equal(t.total.lines, 3);
  assert.equal(t.total.pieces, 50);
  assert.equal(t.total.sqft, 61);
  assert.equal(t.total.weightKg, 345.75);
});

test("pieceTotals: one unweighed line and the weight is unknown, not understated", () => {
  const t = pieceTotals([p("1", 35, 42.7, 240.5), p("1", 10, 12.2, null)]);
  assert.equal(t.crates[0].weightKg, null, "counting an unweighed line as nought kilograms is a short customs figure");
  assert.equal(t.total.weightKg, null);
  assert.equal(t.crates[0].sqft, 54.9, "the area is still known");
});

test("pieceTotals: the pieces in no crate are their own group, last", () => {
  const t = pieceTotals([p(null, 3, 3.66, 20), p("1", 1, 1.22, 7)]);
  assert.deepEqual(t.crates.map((c) => c.crateNo), ["1", null]);
  assert.equal(t.total.pieces, 4);
});

test("pieceTotals: an empty list totals to nothing, with no weight to claim", () => {
  const t = pieceTotals([]);
  assert.deepEqual(t.crates, []);
  assert.deepEqual(t.total, { crateNo: null, lines: 0, pieces: 0, sqft: 0, weightKg: null });
});

test("pieceTotals: the sheet total is added from the LINES, not from the subtotals", () => {
  // Three lines whose areas each round up in the third decimal. Adding the
  // rounded subtotals is what made two sheets of one envelope disagree.
  const rows = [p("1", 1, 1.2225, 1), p("2", 1, 1.2225, 1), p("3", 1, 1.2225, 1)];
  const t = pieceTotals(rows);
  assert.equal(t.total.sqft, 3.667);
  assert.notEqual(t.total.sqft, t.crates.reduce((a, c) => a + c.sqft, 0));
});

// ───────────────────────────── the printed sheet ────────────────────────────

test("pieceSheet: lines in crate order, a subtotal after each crate, then the TOTAL", () => {
  const sheet = pieceSheet([
    p("2", 5, 6.1, 35, { pieceNo: "1" }),
    p("1", 35, 42.7, 240.5, { pieceNo: "1", drawingNo: "D-12", room: "KITCHEN" }),
    p("1", 10, 12.2, 70, { pieceNo: "2", drawingNo: "D-13", room: "KITCHEN" }),
  ]);
  assert.deepEqual(sheet.rows.map((r) => (r.kind === "piece" ? `${r.crateNo}/${r.pieceNo}` : `sub:${r.crateNo}`)),
    ["1/1", "1/2", "sub:1", "2/1", "sub:2"]);
  const sl = sheet.rows.filter((r) => r.kind === "piece").map((r) => (r as { sl: number }).sl);
  assert.deepEqual(sl, [1, 2, 3], "the serial runs down the sheet, not down each crate");
  assert.equal(sheet.totals.pieces, 50);
  assert.equal(sheet.totals.sqft, 61);
  assert.equal(sheet.hasDrawings, true);
  assert.equal(sheet.hasRooms, true);
  assert.equal(sheet.hasWeights, true);
});

test("pieceSheet: a sheet with no drawings or buildings says so, so no empty column prints", () => {
  const sheet = pieceSheet([p("1", 2, 2.44, null)]);
  assert.equal(sheet.hasDrawings, false);
  assert.equal(sheet.hasRooms, false);
  assert.equal(sheet.hasWeights, false);
  assert.equal(sheet.totals.weightKg, null);
});

test("pieceSheet: nothing packed prints nothing", () => {
  const sheet = pieceSheet([]);
  assert.deepEqual(sheet.rows, []);
  assert.equal(sheet.totals.lines, 0);
});

test("pieceSheet: a crate spelt two ways prints ONE block each, and the subtotals add to the TOTAL", () => {
  // Rows typed as crate "01", "1", "01" on one list. The sheet used to read
  // [01][sub 01: 2 lines][1][sub 1: 1 line][01][sub 01: 2 lines] — subtotals
  // adding to 5 lines under a TOTAL of 3, on a customs sheet.
  const sheet = pieceSheet([
    p("01", 1, 1.22, 7, { pieceNo: "a" }),
    p("1", 1, 1.22, 7, { pieceNo: "b" }),
    p("01", 1, 1.22, 7, { pieceNo: "c" }),
  ]);
  const subs = sheet.rows.filter((r) => r.kind === "subtotal") as Array<{ crateNo: string | null; lines: number; sqft: number }>;
  assert.equal(subs.length, 2, "one subtotal per crate key, however it is spelt");
  assert.deepEqual(subs.map((s) => s.crateNo).sort(), ["01", "1"]);
  assert.equal(subs.reduce((a, s) => a + s.lines, 0), sheet.totals.lines, "the subtotals reconcile to the TOTAL");
  assert.equal(subs.reduce((a, s) => a + s.sqft, 0), sheet.totals.sqft);
  // Each block's lines sit together above their own subtotal.
  assert.deepEqual(
    sheet.rows.map((r) => (r.kind === "piece" ? `${r.crateNo}/${r.pieceNo}` : `sub:${r.crateNo}`)),
    ["01/a", "01/c", "sub:01", "1/b", "sub:1"],
  );
});

test("pieceSheet: every crate on the sheet gets its own subtotal row", () => {
  const sheet = pieceSheet([p("1", 1, 1.22, 7), p("2", 1, 1.22, 7), p(null, 1, 1.22, 7)]);
  const subs = sheet.rows.filter((r) => r.kind === "subtotal");
  assert.equal(subs.length, 3);
  assert.deepEqual(subs.map((s) => (s as { crateNo: string | null }).crateNo), ["1", "2", null]);
});
