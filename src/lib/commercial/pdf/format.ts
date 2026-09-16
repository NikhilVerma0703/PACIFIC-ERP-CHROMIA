/* eslint-disable @typescript-eslint/no-explicit-any */
// THE ACCEPTED DOCUMENT FORMAT — the type scale, the hairline grid, and the
// rules about what is allowed to print as an empty box.
//
// Lifted out of pdf/proforma.ts unchanged on 2026-09-15, the day the owner
// signed off a rendered Monolith proforma as "the format" and then asked for
// the same treatment on invoices. It lives here so there is exactly ONE
// answer to "how does one of our documents look", rather than a second copy
// that drifts. The proforma imports it and renders identically — proved by
// re-rendering both signed-off PIs and comparing every word and every rule
// coordinate, not by reading the diff.
//
// WHAT THIS FILE IS NOT. It holds no decisions about WHAT to print: every
// string still comes from the pure rules modules, which node --test can load
// and assert on. This file only knows how a box looks. Nothing here may
// import Prisma, Next, or anything with a `@/` alias — see below.
//
// AND NO TEST MAY IMPORT IT, or any sibling under pdf/. `npm test` runs
// `node --experimental-strip-types --test` with no loader and no imports map,
// so the `@/` alias every PDF module uses is invisible to Node and the import
// throws. That is why the format guards in tests/commercialProforma.test.ts
// read these files as TEXT with readFileSync instead of importing them.
import { printable } from "@/lib/commercial/proforma-rules";

export const FS = { body: 9, label: 8.5, value: 10, head: 9.5, title: 16, big: 11 } as const;
export const GREY = "#f2f2f2";

/** A hairline box round every cell — the reference is a grid of boxes. */
export const gridLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => "#000000",
  vLineColor: () => "#000000",
  // WIDE SIDES, TIGHT TOP AND BOTTOM, and that split was measured rather than
  // guessed. Vertical padding is the expensive dimension: it is paid on every
  // one of the fifteen-odd rows, so raising it from 2 to 4 costs more height
  // than growing every font on the page. Rendering a Pacific proforma at four
  // scales showed the largest type at padding 2 fits more item lines on one
  // sheet than a middling type at padding 4 — the same page for smaller words.
  // So the height went into the type and the breathing room went sideways,
  // where it costs nothing. (The absolute count that comparison quoted was
  // wrong by one; the ordering it established was not. See FS above for the
  // measured figure.)
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 2,
  paddingBottom: () => 2,
};

/**
 * THE TWO HEADER COLUMNS ARE ONE BOX, NOT TWO (the owner, 2026-09-15, of a
 * screenshot with the space under Consignee highlighted: "just fix this on
 * both — the alignment").
 *
 * The header used to be a borderless two-cell table holding one bordered table
 * per side, and that costs alignment twice over. Measured off the delivered
 * PDFs: each side drew its own box inside a padded cell, so the left box ran
 * 34.0 → 291.1 and the right 303.6 → 560.8 while every table below them — the
 * carriage grid, the bank block, the items — ran 28.0 → 566.8. The header was
 * inset six points at both edges and left twelve and a half points of daylight
 * down the middle where the two boxes never met. And because a nested table is
 * only as tall as what is in it, the shorter side simply stopped: on the
 * Monolith proforma the left column ended 55.5pt above the right, which is the
 * open corner under Consignee that he circled.
 *
 * So the OUTER table is the bordered one now, at zero padding, and its two
 * cells run edge to edge and meet in the middle — the same x as everything
 * below. Its row is as tall as the taller side, and its border is drawn round
 * the whole row, so both columns close on one line whichever side is longer.
 * The inner tables keep their padding and draw only the lines BETWEEN their own
 * rows: their outer edges would land on top of the outer border, a second
 * hairline half a point off the first.
 *
 * The leftover space is then inside the left box rather than outside it — a
 * tall Seller/Consignee cell with room under it, which is how the reference
 * proforma reads too.
 */
export const outerGrid = {
  ...gridLayout,
  paddingLeft: () => 0,
  paddingRight: () => 0,
  paddingTop: () => 0,
  paddingBottom: () => 0,
};

/** Internal dividers only — the enclosing cell of `outerGrid` draws the box.
 *  i counts the LINES, so 0 is the top edge and body.length the bottom; the
 *  same for vertical lines against the column count. */
export const innerGrid = {
  ...gridLayout,
  hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
  vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 0 : 0.5),
};

/** "Label" over its value — the shape every box on this document has. */
export function field(label: string, value: string, opts: { bold?: boolean; upper?: boolean } = {}): any {
  return {
    stack: [
      { text: label, fontSize: FS.label, color: "#444" },
      { text: value || " ", fontSize: FS.value, bold: Boolean(opts.bold), characterSpacing: 0 },
    ],
  };
}

/**
 * A box, or NOTHING, and this is the rule the whole document now follows: a
 * label with nothing after it is not information, it is a gap that reads to a
 * customer as a figure somebody forgot (the owner, 2026-09-15, for the third
 * time — after the Buyer-if-Not-Consignee cell and the discount line:
 * "remove empty boxes like port of loading etc").
 *
 * So `field()` answers null for a blank value and the row builders below drop
 * what is null. The document keeps only the boxes that say something.
 */
export function fieldOrNull(label: string, value: string, opts: { bold?: boolean } = {}): any | null {
  return printable(value) ? field(label, value, opts) : null;
}

/**
 * Two fields side by side. Both blank and the ROW goes; one blank and its half
 * becomes an unlabelled empty cell, because the table is two columns wide and
 * handing a row one cell would break every border below it.
 */
export function fullRow(cell: any | null): any[] | null {
  if (!cell) return null;
  return [{ colSpan: 2, ...cell }, {}];
}

export function pairRow(a: any | null, b: any | null): any[] | null {
  if (!a && !b) return null;
  // ONE OF THE TWO MISSING MEANS THE OTHER TAKES THE ROW, not that the row
  // keeps an unlabelled half-box beside it. Returning [a, {}] drew exactly the
  // hole the owner circled on 2026-09-15: "Pre-Carriage By / By Road" filling
  // the left half of a row whose right half was an empty bordered rectangle,
  // and the same again beside a lone Port of Loading. An empty cell is the
  // empty box this document has spent the day removing — it was simply the one
  // shape of it that had no label to give it away.
  if (!a || !b) return fullRow(a ?? b);
  return [a, b];
}

/** One cell across both columns of a two-column table: the colSpan and the
 *  filler cell pdfmake needs behind it, built together so neither can be left
 *  behind when a row is added or dropped. */


/** A named party: bold name, then its printed lines. */
export function partyCell(label: string, p: { name: string; lines: string[] }): any {
  return {
    stack: [
      { text: label, fontSize: FS.label, color: "#444" },
      { text: p.name || " ", fontSize: FS.value, bold: true },
      ...p.lines.map((l) => ({ text: l, fontSize: FS.body })),
    ],
  };
}

/** One bold "Label : value" line in the terms / bank block. */
export function termLine(label: string, value: string): any {
  return {
    text: [
      { text: `${label} : `, fontSize: FS.body, bold: true },
      { text: value, fontSize: FS.body },
    ],
    margin: [0, 0, 0, 1],
  };
}
