import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePoPieceTable, PO_TOTAL_SQFT_TOLERANCE_SQFT, PO_REQUIREMENT_SLAB_CODE,
  type PoPage, type PoTextItem,
} from "../src/lib/fab/poParser.ts";
import { flatRowLabel } from "../src/lib/fab/flatSheetParser.ts";

// The manager's PO intake reads ONE thing out of the purchase order: the page-2
// piece table. Page 1 is the commercial header and is never touched. What can
// go wrong here is not arithmetic — it is a row silently lost between the PDF's
// text runs and the requirement rows, which is exactly what the table's own
// totals row exists to catch. So these tests are mostly about refusing.

/* -- Building a page of PDF text runs --------------------------------------- */
//
// pdf.js hands each run a left edge and a BASELINE in PDF points, and poParser
// groups runs into lines by that baseline and into columns by horizontal centre.
// The fixtures below emit runs the way a real generator does: one run per cell,
// each centred under its column heading.

interface Col { label: string; x: number; w: number }

const COLS: Col[] = [
  { label: "Sr.No",  x: 60,  w: 26 },
  { label: "Length", x: 150, w: 32 },
  { label: "Width",  x: 240, w: 28 },
  { label: "Qty",    x: 330, w: 18 },
  { label: "SFT",    x: 420, w: 16 },
];

const CHAR_W = 5;                       // points per character in the fixtures
const HEADER_Y = 714;
const ROW_Y0 = 700;
const ROW_STEP = 14;

const centreOf = (c: Col) => c.x + c.w / 2;

/** One run, centred on its column, the way a generated table sets its cells. */
function cell(value: string, col: Col, y: number): PoTextItem {
  const width = value.length * CHAR_W;
  return { text: value, x: centreOf(col) - width / 2, y, width };
}

function headerRun(y: number): PoTextItem[] {
  return COLS.map(c => ({ text: c.label, x: c.x, y, width: c.w }));
}

/** A table row as five runs. "" emits nothing at all, which is what a blank
 *  cell in a generated PDF actually is. */
function rowRuns(values: string[], y: number): PoTextItem[] {
  const out: PoTextItem[] = [];
  for (let i = 0; i < COLS.length; i++) {
    if (values[i] === "" || values[i] === undefined) continue;
    out.push(cell(values[i], COLS[i], y));
  }
  return out;
}

/** Page 1 of the template: the commercial header. Nothing here may ever reach
 *  the result — it exists in these fixtures to prove it is ignored. */
function headerPage(): PoPage {
  const lines = [
    "Purchase Order# 10026",
    "Date: 6/17/2026",
    "Supplier: Pacific Engineered Surfaces Pvt Ltd.",
    "Description Slabs Quantity Unit Price Extended",
    "Arva White Prefab (2cm) 2,233.99 EA $7.81 $17,447.46",
    "Notes: Final Destination - POD Chicago 20 Ft container",
  ];
  return {
    pageNumber: 1,
    items: lines.map((text, i) => ({ text, x: 50, y: 720 - i * 14, width: text.length * CHAR_W })),
  };
}

interface TableSpec {
  /** [Sr.No, Length, Width, Qty, SFT] as printed, "" for a blank cell. */
  rows: string[][];
  /** The totals row's Qty and SFT as printed, or null for no totals row. */
  totals: { qty: string; sft: string } | null;
  /** Extra runs appended after the table, e.g. a page footer. */
  extra?: PoTextItem[];
  /** Leave the header line off entirely. */
  noHeader?: boolean;
}

function tablePage(spec: TableSpec, pageNumber = 2): PoPage {
  const items: PoTextItem[] = spec.noHeader ? [] : headerRun(HEADER_Y);
  let y = ROW_Y0;
  for (const r of spec.rows) {
    items.push(...rowRuns(r, y));
    y -= ROW_STEP;
  }
  if (spec.totals) {
    items.push(...rowRuns(["", "", "", spec.totals.qty, spec.totals.sft], y));
    y -= ROW_STEP;
  }
  if (spec.extra) items.push(...spec.extra);
  return { pageNumber, items };
}

/* -- The real sample -------------------------------------------------------- */
//
// 24 rows exactly as printed on the customer's PO, TWELVE of them Qty 0.
// 780 pieces over the 12 live rows; 2,233.9931 sqft unrounded, printed 2,233.99.

const SAMPLE_ROWS: Array<[number, number, number, number]> = [
  [1, 25, 22.5, 0], [2, 25, 4, 0],
  [3, 28, 22.5, 60], [4, 28, 4, 60],
  [5, 31, 22.5, 0], [6, 31, 4, 0],
  [7, 34, 22.5, 60], [8, 34, 4, 60],
  [9, 37, 22.5, 0], [10, 37, 4, 0],
  [11, 43, 22.5, 60], [12, 43, 4, 60],
  [13, 43, 22.5, 60], [14, 43, 4, 60],
  [15, 49, 22.5, 0], [16, 49, 4, 0],
  [17, 61, 22.5, 30], [18, 61, 4, 30],
  [19, 61, 22.5, 0], [20, 61, 4, 0],
  [21, 61, 22.5, 0], [22, 61, 4, 0],
  [23, 21.75, 4, 200], [24, 128, 4, 40],
];

const SAMPLE_TOTAL_PIECES = 780;
const SAMPLE_TOTAL_SQFT_PRINTED = "2,233.99";
const SAMPLE_TOTAL_SQFT_EXACT = 2233.9930555555557;
/** What summing the already-rounded per-row SFTs gives. NOT what we reconcile
 *  against — 0.017 sqft away from the printed total, which would refuse a
 *  perfect PO. Pinned here so a future change cannot quietly swap the two. */
const SAMPLE_TOTAL_SQFT_ROUNDED_SUM = "2,234.01";

/** The printed SFT for a row: the exact product rounded to 2dp, as the
 *  generator prints it. */
function printedSft(l: number, w: number, q: number): string {
  return ((l * w * q) / 144).toFixed(2);
}

function sampleRows(
  override?: { srNo: number; quantity: number },
): string[][] {
  return SAMPLE_ROWS.map(([sr, l, w, q]) => {
    const qty = override && override.srNo === sr ? override.quantity : q;
    return [String(sr), String(l), String(w), String(qty), printedSft(l, w, qty)];
  });
}

function samplePages(spec?: Partial<TableSpec>): PoPage[] {
  return [
    headerPage(),
    tablePage({
      rows: sampleRows(),
      totals: { qty: String(SAMPLE_TOTAL_PIECES), sft: SAMPLE_TOTAL_SQFT_PRINTED },
      ...spec,
    }),
  ];
}

/* -- The happy path --------------------------------------------------------- */

test("the real 24-row sample gives 12 live rows, 780 pieces and 2,233.9931 sqft", () => {
  const out = parsePoPieceTable(samplePages());

  assert.deepEqual(out.errors, []);
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 12);
  assert.equal(out.totals.rowCount, 12);
  assert.equal(out.totals.totalPieces, SAMPLE_TOTAL_PIECES);
  assert.ok(Math.abs(out.totals.totalSqft - SAMPLE_TOTAL_SQFT_EXACT) < 1e-9);
  assert.equal(out.totals.totalSqftRounded, 2233.99);
  assert.deepEqual(out.stated, { totalPieces: 780, totalSqft: 2233.99 });
});

test("row count is never assumed — a 23-row PO with different quantities parses too", () => {
  // A different real PO: the same template, one row fewer, everything live.
  const rows = [
    ["1", "30", "25", "10", printedSft(30, 25, 10)],
    ["2", "30", "4", "10", printedSft(30, 4, 10)],
    ["3", "48", "25", "5", printedSft(48, 25, 5)],
  ];
  const pieces = 25;
  const exact = (30 * 25 * 10 + 30 * 4 * 10 + 48 * 25 * 5) / 144;

  const out = parsePoPieceTable([
    headerPage(),
    tablePage({ rows, totals: { qty: String(pieces), sft: exact.toFixed(2) } }),
  ]);

  assert.deepEqual(out.errors, []);
  assert.equal(out.rows.length, 3);
  assert.equal(out.totals.totalPieces, 25);
});

test("page 1 is ignored entirely — the PO parses with no header page at all", () => {
  const withHeaderPage = parsePoPieceTable(samplePages());
  const tableOnly = parsePoPieceTable([samplePages()[1]]);

  assert.equal(tableOnly.ok, true);
  assert.deepEqual(tableOnly.rows, withHeaderPage.rows);
  assert.deepEqual(tableOnly.stated, withHeaderPage.stated);
});

test("nothing from page 1 leaks into the result — no header, no material, no price", () => {
  const out = parsePoPieceTable(samplePages()) as unknown as Record<string, unknown>;
  for (const forbidden of ["header", "poNumber", "material", "thicknessMm", "unitPriceUsd", "destination"]) {
    assert.equal(forbidden in out, false, `${forbidden} must not be in the manager's result`);
  }
});

test("repeated (Length, Width) pairs stay separate rows, keyed by their row number", () => {
  const out = parsePoPieceTable(samplePages());

  const fortyThrees = out.rows.filter(r => r.lengthIn === 43 && r.widthIn === 22.5);
  assert.equal(fortyThrees.length, 2);
  assert.deepEqual(fortyThrees.map(r => r.rowNumber), [11, 13]);
  // The row number is what the supervisor later puts a sink on, and it rides
  // onto fab_requirement.piece_label through this helper.
  assert.deepEqual(fortyThrees.map(r => flatRowLabel(r.rowNumber)), ["Row 11", "Row 13"]);
});

test("a producer that emits a whole row as one run reads the same", () => {
  // Same table, but every row is a single text run with layout spaces — the
  // other shape pdf.js hands back, and the one that exercises tokenise().
  const LINE_CHARS = 80;
  const oneRun = (values: string[], y: number): PoTextItem => {
    const buf = new Array<string>(LINE_CHARS).fill(" ");
    for (let i = 0; i < COLS.length; i++) {
      const v = values[i];
      if (!v) continue;
      const centreChar = (centreOf(COLS[i]) - 60) / CHAR_W;
      const start = Math.round(centreChar - v.length / 2);
      for (let k = 0; k < v.length; k++) buf[start + k] = v[k];
    }
    return { text: buf.join(""), x: 60, y, width: LINE_CHARS * CHAR_W };
  };

  const rows = sampleRows();
  const items: PoTextItem[] = headerRun(HEADER_Y);
  let y = ROW_Y0;
  for (const r of rows) { items.push(oneRun(r, y)); y -= ROW_STEP; }
  items.push(oneRun(["", "", "", String(SAMPLE_TOTAL_PIECES), SAMPLE_TOTAL_SQFT_PRINTED], y));

  const out = parsePoPieceTable([{ pageNumber: 2, items }]);

  assert.deepEqual(out.errors, []);
  assert.equal(out.rows.length, 12);
  assert.equal(out.totals.totalPieces, 780);
});

/* -- The Qty-0 rows --------------------------------------------------------- */

test("the twelve Qty-0 rows are skipped, counted, and named", () => {
  const out = parsePoPieceTable(samplePages());

  assert.equal(out.skippedZeroQtyRows.length, 12);
  assert.deepEqual(
    out.skippedZeroQtyRows.map(r => r.rowNumber),
    [1, 2, 5, 6, 9, 10, 15, 16, 19, 20, 21, 22],
  );
  for (const r of out.skippedZeroQtyRows) assert.equal(r.reason, "ZERO_QTY");

  // The count is said out loud. A manager who uploads 24 rows and is shown 12
  // with no explanation reasonably concludes the upload lost his data.
  const said = out.warnings.filter(w => w.includes("12 rows had Qty 0"));
  assert.equal(said.length, 1);
  assert.ok(said[0].includes("row 1, 2, 5, 6, 9, 10, 15, 16, 19, 20, 21, 22"));

  // Skipped rows are not requirements and are not counted anywhere else.
  assert.equal(out.rows.some(r => r.quantity === 0), false);
  assert.equal(out.totals.rowCount, 12);
});

test("a PO whose every row is Qty 0 is refused, not imported as nothing", () => {
  const rows = [
    ["1", "25", "22.5", "0", "0.00"],
    ["2", "25", "4", "0", "0.00"],
  ];
  const out = parsePoPieceTable([tablePage({ rows, totals: { qty: "0", sft: "0.00" } })]);

  assert.equal(out.ok, false);
  assert.equal(out.rows.length, 0);
  assert.ok(out.errors.some(e => e.includes("Every row has Qty 0")), out.errors.join(" | "));
});

/* -- Reconciliation against the totals row ---------------------------------- */

test("reconciliation is against the UNROUNDED sum — the rounded sum is refused", () => {
  // Summing the twelve already-rounded row SFTs gives 2,234.01 against a
  // printed 2,233.99. Reconciling against that sum would refuse a perfect PO,
  // so a PO that PRINTS it must be the thing that fails.
  const printedRoundedSum = parsePoPieceTable(
    samplePages({ totals: { qty: "780", sft: SAMPLE_TOTAL_SQFT_ROUNDED_SUM } }),
  );

  assert.equal(printedRoundedSum.ok, false);
  assert.ok(
    printedRoundedSum.errors.some(e => e.includes("2,234.01") && e.includes("sqft")),
    printedRoundedSum.errors.join(" | "),
  );
  // And the honest figure still passes.
  assert.equal(parsePoPieceTable(samplePages()).ok, true);
});

test("a totals row inside tolerance passes; one just outside it is refused", () => {
  const inside = (2233.9930555555557 + PO_TOTAL_SQFT_TOLERANCE_SQFT * 0.9).toFixed(4);
  const outside = (2233.9930555555557 + PO_TOTAL_SQFT_TOLERANCE_SQFT * 2).toFixed(4);

  assert.equal(parsePoPieceTable(samplePages({ totals: { qty: "780", sft: inside } })).ok, true);
  assert.equal(parsePoPieceTable(samplePages({ totals: { qty: "780", sft: outside } })).ok, false);
});

test("a hand-edited quantity is caught, and the message names the figure and the gap", () => {
  // Row 17 goes from 30 pieces to 40 without its SFT or the totals row moving:
  // exactly what changing a number in a PDF editor looks like.
  const tampered = [
    headerPage(),
    tablePage({
      rows: SAMPLE_ROWS.map(([sr, l, w, q]) => {
        const qty = sr === 17 ? 40 : q;
        return [String(sr), String(l), String(w), String(qty), printedSft(l, w, q)];
      }),
      totals: { qty: String(SAMPLE_TOTAL_PIECES), sft: SAMPLE_TOTAL_SQFT_PRINTED },
    }),
  ];

  const out = parsePoPieceTable(tampered);

  assert.equal(out.ok, false);
  // Nothing may be written, and the screen has to be able to say WHAT disagreed.
  const pieces = out.errors.find(e => e.includes("pieces"));
  assert.ok(pieces, out.errors.join(" | "));
  assert.ok(pieces!.includes("780"));       // what the document claims
  assert.ok(pieces!.includes("790"));       // what the rows add up to
  assert.ok(pieces!.includes("10 pieces too many"));
  assert.ok(pieces!.includes("Nothing was imported."));

  const sqft = out.errors.find(e => e.includes("sqft"));
  assert.ok(sqft, out.errors.join(" | "));
  assert.ok(sqft!.includes("2,233.99"));
  assert.ok(sqft!.includes(String(PO_TOTAL_SQFT_TOLERANCE_SQFT)));

  // The rows are still handed back so the preview can show them — but ok is
  // false, and ok is the only thing a caller may key off.
  assert.equal(out.rows.length, 12);
});

test("a piece count that disagrees by one is still refused", () => {
  const out = parsePoPieceTable(samplePages({ totals: { qty: "779", sft: SAMPLE_TOTAL_SQFT_PRINTED } }));

  assert.equal(out.ok, false);
  assert.ok(
    out.errors.some(e => e.includes("779") && e.includes("780") && e.includes("1 piece too many")),
    out.errors.join(" | "),
  );
});

/* -- Malformed documents fail loudly ---------------------------------------- */

test("a PDF with no text at all is refused by name", () => {
  for (const pages of [[], [{ pageNumber: 1, items: [] }] as PoPage[]]) {
    const out = parsePoPieceTable(pages);
    assert.equal(out.ok, false);
    assert.equal(out.rows.length, 0);
    assert.ok(out.errors.length >= 1, "an empty PDF must say something");
  }
  assert.ok(parsePoPieceTable([]).errors[0].includes("no readable text"));
});

test("a PDF that is not this template is refused, and says which table it wanted", () => {
  const notThePo: PoPage[] = [
    headerPage(),
    {
      pageNumber: 2,
      items: ["Invoice", "Item Description Amount", "1 Slab polishing 400.00"].map((text, i) => ({
        text, x: 50, y: 700 - i * 14, width: text.length * CHAR_W,
      })),
    },
  ];

  const out = parsePoPieceTable(notThePo);

  assert.equal(out.ok, false);
  assert.equal(out.rows.length, 0);
  assert.ok(out.errors.some(e => e.includes("Sr.No") && e.includes("SFT")), out.errors.join(" | "));
  assert.ok(out.errors.some(e => e.includes("nothing was imported")), out.errors.join(" | "));
});

test("the piece table with no rows under it is refused", () => {
  const out = parsePoPieceTable([tablePage({ rows: [], totals: { qty: "0", sft: "0.00" } })]);

  assert.equal(out.ok, false);
  assert.ok(out.errors.some(e => e.includes("no piece rows")), out.errors.join(" | "));
});

test("a piece table with no totals row is refused — there is nothing to reconcile against", () => {
  const out = parsePoPieceTable([headerPage(), tablePage({ rows: sampleRows(), totals: null })]);

  assert.equal(out.ok, false);
  assert.equal(out.stated, null);
  assert.ok(out.errors.some(e => e.includes("no totals row")), out.errors.join(" | "));
});

test("a row the extractor could not read is never quietly dropped", () => {
  // Row 11's Width comes back as "22.5*" — one glyph of noise, the kind a font
  // or a stamped overlay produces. The row cannot be read, so it is left out of
  // the table, and the totals row is what refuses the import.
  const rows = sampleRows().map(r => (r[0] === "11" ? [r[0], r[1], "22.5*", r[3], r[4]] : r));
  const out = parsePoPieceTable([
    headerPage(),
    tablePage({ rows, totals: { qty: String(SAMPLE_TOTAL_PIECES), sft: SAMPLE_TOTAL_SQFT_PRINTED } }),
  ]);

  assert.equal(out.ok, false);
  assert.ok(out.warnings.some(w => w.includes("not a piece row")), out.warnings.join(" | "));
  assert.ok(
    out.errors.some(e => e.includes("pieces") && e.includes("60 pieces missing")),
    out.errors.join(" | "),
  );
});

test("a page footer inside the table is ignored without a warning", () => {
  const footer: PoTextItem = { text: "Page 2 of 2", x: 250, y: 60, width: 55 };
  const out = parsePoPieceTable(samplePages({
    rows: sampleRows(),
    totals: { qty: String(SAMPLE_TOTAL_PIECES), sft: SAMPLE_TOTAL_SQFT_PRINTED },
    extra: [footer],
  }));

  assert.equal(out.ok, true);
  assert.equal(out.warnings.some(w => w.includes("Page 2 of 2")), false);
});

/* -- What a PO requirement is written with ---------------------------------- */

test("PO requirements get a slab_code placeholder that reads as a decision not yet made", () => {
  // fab_requirement.slab_code is NOT NULL and a purchase order has no slab code:
  // the slab is the supervisor's choice, later. The constant is the only thing
  // the import route may put there.
  assert.equal(PO_REQUIREMENT_SLAB_CODE, "UNASSIGNED");
});
