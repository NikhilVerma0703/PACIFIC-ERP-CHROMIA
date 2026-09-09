/* eslint-disable @typescript-eslint/no-explicit-any */
// The two labels off a packing list (round three, answer 4) — pdfmake, the
// same path every other document in this module takes (buildPdf, Roboto, one
// Buffer back).
//
//   CRATE label   one per crate and article: the item code, the description,
//                 "BARCODE: <ean>" with the bars drawn under it, the quantity
//                 in that crate and the shipping date. One label per page,
//                 100 × 70 mm — the size of the sleeve on a wooden crate.
//   PIECE label   the item code and the size alone, once per piece, on an A4
//                 sheet of 24 to be guillotined. His DS-Thresholds file is 360
//                 of them off a single line.
//
// EVERY DECISION about WHAT is on a label — which lines, which quantity, which
// article, what a line with no article prints — is in ../articles-rules, which
// is pure and tested. This file only places the results on the page.
//
// THE BARS ARE RECTANGLES, not an image: ../barcode.ean13Bars hands over the
// 95 modules and pdfmake draws them. No barcode library, no raster step, no
// font — and the same 95 modules the test decodes back to the code.
import { buildPdf } from "@/lib/sales/pdf/common";
import {
  ean13Bars, ean13Text, ean13ModuleMm,
  EAN13_LABEL_MAGNIFICATION, EAN13_QUIET_LEFT_MODULES, EAN13_DRAWN_MODULES,
} from "@/lib/commercial/barcode";
import type { CrateLabel, PieceLabel } from "@/lib/commercial/articles-rules";

const MM = 2.834645669;   // points per millimetre

/** 100 × 70 mm, landscape — the crate-sleeve label. */
const CRATE_PAGE: [number, number] = [100 * MM, 70 * MM];
const CRATE_MARGIN = 8 * MM;

// THE SYMBOL'S SIZE IS THE SYMBOL'S, NOT THE PAGE'S (see ../barcode: an EAN-13
// is specified between magnification 0.80 and 2.00 of a 0.33 mm module). The
// first cut of this file drew a flat 2.1 pt module — 0.74 mm, i.e. 2.24× —
// above the top of that range, and let the 8 mm page margin stand in for the
// left quiet zone, which is 10.8 modules where EAN-13 needs 11. Both are read
// at the customer's gate, not here, so both are fixed at the source: the width
// comes from the magnification, and the quiet zones are drawn INSIDE the
// canvas so they cannot be eaten by a change to the page.
const MODULE_W = ean13ModuleMm(EAN13_LABEL_MAGNIFICATION) * MM;   // ≈ 1.40 pt
const QUIET_LEFT_W = EAN13_QUIET_LEFT_MODULES * MODULE_W;
const SYMBOL_W = EAN13_DRAWN_MODULES * MODULE_W;                  // ≈ 158.6 pt

const BAR_H = 34;
const GUARD_EXTRA = 5;    // the guard bars run below the rest, as EAN prints them

/** The guard positions in the 95-module row: start, centre, end. Drawn taller
 *  so a scanner's eye — and a person's — can find the ends of the symbol. */
function isGuard(i: number): boolean {
  return (i >= 0 && i < 3) || (i >= 45 && i < 50) || (i >= 92 && i < 95);
}

/**
 * The modules as pdfmake rectangles, runs of 1s merged so a symbol is ~30
 * shapes rather than 95.
 *
 * The first shape is a WHITE rectangle the full width of the symbol including
 * both quiet zones. It prints nothing on a white label, and that is the point:
 * it reserves the clear paper, so pdfmake measures the canvas at its true
 * width and nothing — a longer description, a wider page margin — can be laid
 * against the start guard.
 */
function barsCanvas(bits: number[]): any {
  const rects: any[] = [{
    type: "rect", x: 0, y: 0, w: SYMBOL_W, h: BAR_H + GUARD_EXTRA, color: "#ffffff",
  }];
  let i = 0;
  while (i < bits.length) {
    if (!bits[i]) { i++; continue; }
    const start = i;
    const tall = isGuard(i);
    // A run only merges while the guard-ness matches, so a guard bar keeps its
    // longer tail even when a data bar sits against it.
    while (i < bits.length && bits[i] === 1 && isGuard(i) === tall) i++;
    rects.push({
      type: "rect",
      x: QUIET_LEFT_W + start * MODULE_W, y: 0,
      w: (i - start) * MODULE_W, h: BAR_H + (tall ? GUARD_EXTRA : 0),
      color: "#000000",
    });
  }
  return { canvas: rects, margin: [0, 2, 0, 0] };
}

/** The barcode block: the bars, then the digits split the way EAN prints them.
 *  The leading digit sits in the left quiet zone — that is where EAN prints it,
 *  and human-readable text is the one thing allowed in there. */
function barcodeBlock(ean: string): any[] {
  const bits = ean13Bars(ean);
  const text = ean13Text(ean);
  if (!bits || !text) return [];
  return [
    barsCanvas(bits),
    {
      text: `${text.lead}  ${text.left}  ${text.right}`,
      fontSize: 8, characterSpacing: 1,
      margin: [Math.max(0, QUIET_LEFT_W - 7), GUARD_EXTRA + 1, 0, 0],
    },
  ];
}

/**
 * WHY THE LABEL HAS THREE SENTENCES FOR ONE MISSING BARCODE, not one.
 *
 * crateLabels leaves `ean` null in three different situations, and they send
 * the packer to three different people. "No article on file" printed under an
 * item code and a description that came OFF an article — which is what the one
 * sentence used to do — is contradicted by the two lines above it, and sends
 * the desk to add a row that is already there while the real gap (the customer
 * has not sent the barcode) goes unnamed. The screen's panel splits the same
 * three ways (articles-rules.missingArticles / missingBarcodes).
 */
function barcodeGapLine(l: CrateLabel): string {
  if (!l.hasArticle) return "BARCODE: —  (no article on file for this design and size)";
  if (l.rejectedEan) return `BARCODE: —  (${l.rejectedEan} on file is not a readable EAN-13)`;
  return "BARCODE: —  (no barcode on file for this article yet)";
}

export interface CrateLabelsPdfInput {
  listNumber: string;
  labels: ReadonlyArray<CrateLabel>;
}

/**
 * One page per crate label. An empty run still produces a page saying so
 * rather than a zero-page PDF, which most viewers refuse to open at all.
 */
export async function generateCrateLabelsPdf(input: CrateLabelsPdfInput): Promise<Buffer> {
  const labels = input.labels ?? [];
  const content: any[] = [];

  if (!labels.length) {
    content.push({ text: `Nothing is packed on ${input.listNumber} yet — there is nothing to label.`, fontSize: 10 });
  }

  labels.forEach((l, i) => {
    const block: any[] = [
      { text: l.itemCodeLine, fontSize: 13, bold: true },
      ...(l.descriptionLine ? [{ text: l.descriptionLine, fontSize: 11, margin: [0, 2, 0, 0] }] : []),
      ...(l.ean
        ? [
            { text: `BARCODE: ${l.ean}`, fontSize: 9, margin: [0, 4, 0, 0] },
            ...barcodeBlock(l.ean),
          ]
        // No article, no barcode on the article, or a code that cannot be
        // drawn: the label says WHICH in words rather than leaving a blank the
        // packer reads as "no barcode needed" (answer 4).
        : [{ text: barcodeGapLine(l), fontSize: 8, italics: true, color: "#555555", margin: [0, 4, 0, 6] }]),
      { text: `QUANTITY: ${l.quantity}`, fontSize: 11, bold: true, margin: [0, 6, 0, 0] },
      { text: `SHIPPING DATE: ${l.shippingDate}`, fontSize: 10, margin: [0, 2, 0, 0] },
    ];
    content.push({
      stack: block,
      ...(i < labels.length - 1 ? { pageBreak: "after" } : {}),
    });
  });

  const docDef: any = {
    pageSize: { width: CRATE_PAGE[0], height: CRATE_PAGE[1] },
    pageMargins: [CRATE_MARGIN, CRATE_MARGIN, CRATE_MARGIN, 6 * MM],
    defaultStyle: { font: "Roboto", fontSize: 10 },
    footer: (page: number) => ({
      // Which list a loose label came off, small, at the foot — a label found
      // on the floor is otherwise unattributable.
      columns: [
        { text: input.listNumber, fontSize: 5.5, color: "#888888", margin: [CRATE_MARGIN, 0, 0, 0] },
        { text: `Crate ${labels[page - 1]?.crateNo || "—"}`, fontSize: 5.5, color: "#888888", alignment: "right", margin: [0, 0, CRATE_MARGIN, 0] },
      ],
    }),
    content,
  };
  return buildPdf(docDef);
}

export interface PieceLabelsPdfInput {
  listNumber: string;
  labels: ReadonlyArray<PieceLabel>;
  /** How many were asked for beyond PIECE_LABEL_MAX, so the sheet says it is
   *  short instead of the packer counting to 360 and coming up 40 light. */
  truncated?: number;
}

const PIECE_COLUMNS = 3;
const PIECE_ROWS = 8;

// THE PITCH IS WHAT THE GUILLOTINE CUTS TO, so the row height is fixed rather
// than grown from its content: a row that stretches moves every cut line below
// it, and the stack no longer cuts square. A4 is 841.89 pt tall; 24 pt off the
// head and 28 off the foot leave 789.89 pt, and pdfmake adds 2 pt of padding
// above and below each row — so eight rows of 90 pt come to 752 and the
// short-run note still fits under them rather than being pushed onto a
// sixteenth sheet (measured, not estimated: 360 labels render as 15 pages).
//
// This is also what makes PIECE_LABELS_PER_PAGE TRUE. It used to be a constant
// nobody enforced: PIECE_ROWS was multiplied out and then never applied, the
// table simply flowed until the page filled (about 15 rows), and a screen that
// trusted the export told the packer 15 sheets where the printer made 8.
const PIECE_ROW_H = 90;

/** Labels per sheet, exported so the screen can say how many sheets a run is —
 *  and ENFORCED below, which is the only thing that makes it worth exporting. */
export const PIECE_LABELS_PER_PAGE = PIECE_COLUMNS * PIECE_ROWS;

/** One box: the item code and the size, centred in its cell. */
const pieceCell = (text: string): any => ({
  text, fontSize: 12, bold: Boolean(text), alignment: "center",
  margin: [4, 34, 4, 4],
});

/**
 * The piece labels, 24 to an A4 sheet, each in its own box to be cut out.
 * `CQBE 103X11X2` and nothing else, which is exactly what his sheet prints —
 * these go on the piece, not on the crate, so there is no room for more and
 * nothing else is wanted.
 *
 * One table per sheet, broken at exactly PIECE_LABELS_PER_PAGE, so his
 * 360-piece run is 15 sheets cut to one pitch. The last sheet keeps only the
 * rows it needs — a short run prints short, not as twenty-two empty boxes —
 * but at the same row height, so the cut lines still land where they do on
 * every other sheet.
 */
export async function generatePieceLabelsPdf(input: PieceLabelsPdfInput): Promise<Buffer> {
  const labels = input.labels ?? [];
  const content: any[] = [];

  if (!labels.length) {
    content.push({ text: `Nothing is packed on ${input.listNumber} yet — there is nothing to label.`, fontSize: 10 });
  }

  for (let start = 0; start < labels.length; start += PIECE_LABELS_PER_PAGE) {
    const sheet = labels.slice(start, start + PIECE_LABELS_PER_PAGE);
    const rows: any[][] = [];
    for (let i = 0; i < sheet.length; i += PIECE_COLUMNS) {
      rows.push(Array.from({ length: PIECE_COLUMNS }, (_, c) => pieceCell(sheet[i + c]?.text ?? "")));
    }
    content.push({
      table: {
        widths: Array.from({ length: PIECE_COLUMNS }, () => "*"),
        heights: PIECE_ROW_H,
        body: rows,
        dontBreakRows: true,
      },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5,
        hLineColor: () => "#999999", vLineColor: () => "#999999",
      },
      ...(start + PIECE_LABELS_PER_PAGE < labels.length ? { pageBreak: "after" } : {}),
    });
  }
  if (input.truncated && input.truncated > 0) {
    content.push({
      text: `${input.truncated} more label(s) were asked for than this sheet prints — print the rest from the screen.`,
      fontSize: 8, italics: true, color: "#b45309", margin: [0, 8, 0, 0],
    });
  }

  const docDef: any = {
    pageSize: "A4",
    pageMargins: [24, 24, 24, 28],
    defaultStyle: { font: "Roboto", fontSize: 10 },
    footer: (page: number, count: number) => ({
      columns: [
        { text: `${input.listNumber} · piece labels`, fontSize: 6, color: "#888888", margin: [24, 0, 0, 0] },
        { text: `Page ${page} of ${count}`, fontSize: 6, color: "#888888", alignment: "right", margin: [0, 0, 24, 0] },
      ],
    }),
    content,
  };
  return buildPdf(docDef);
}
