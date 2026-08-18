// The real fabrication intake: the customer's Purchase Order PDF.
//
// Orders arrive as a two-page PO with a text layer — page 1 is the commercial
// header, page 2 is the piece table this module hands straight to
// parseFlatSheet(). The owner confirms the generator always emits the same
// template, so this parser is strict on purpose: when the document does not
// look like that template it says which part it could not find and imports
// NOTHING. A half-imported PO is worse than a refused one, because the half
// that made it in looks exactly like a whole one.
//
// THE ONE THING TO GET RIGHT. The line item reads
//
//     Description               Slabs  Quantity      Unit Price  Extended
//     Arva White Prefab (2cm)          2,233.99 EA   $7.81       $17,447.46
//
// and "2,233.99 EA" is the TOTAL SQUARE FOOTAGE, not a piece count. They are
// billed per square foot. The piece count is 780 and lives only in the page-2
// table. Reading that Quantity as pieces would create a project claiming 2,234
// tops instead of 780 and would still look plausible on screen, which is why
// the field below is called totalSqft and there is no field called quantity.
//
// PURITY. Everything here is a decision, so everything here is testable: the
// module reads a plain array of {text, x, y, width} runs and returns plain
// data. Getting those runs out of a PDF is the untestable half and lives next
// door in poPdf.ts — the same split as flatSheetParser / flatSheetWorkbook.
//
// The one import is flatSheetParser.ts, with the .ts extension, because the
// piece table is EXACTLY the table that parser already handles and reimplementing
// it here would give the two intakes two different definitions of a piece row.
// The extension is what lets `node --test` resolve it; src/lib/fab/postJson.ts
// imports ../httpJson.ts the same way and ships in the station screens, so the
// Next build handles it (tsconfig sets allowImportingTsExtensions).
//
// WHAT IS FATAL AND WHAT IS A WARNING. Anything carrying a number we act on is
// fatal when it is missing or unreadable: the PO number and date, the buyer,
// the supplier label, the two header tables, the description's thickness, the
// Quantity, the piece table, its totals row, and the three-way reconciliation.
// Prose that is missing (Notes, Special Instructions, Terms, and the shipping
// destination read out of them) is a warning and an empty string, because prose
// is the part of a template that legitimately varies and refusing a numerically
// perfect PO over a changed hyphen would teach people to route around this
// importer.

// RETIRED 2026-08 -- THE HEADER-PARSING HALF OF THIS MODULE, NOT THE MODULE.
//
// Read this before the paragraphs above, which still describe the document but no
// longer describe all of this file. Page 1 is now read by nobody.
//
// Commented out below (not deleted, per the owner): parsePurchaseOrder(),
// parseHeaderPage(), buildProjectRemarks(), splitMaterialAndThickness(),
// projectCodeForPo(), poAlreadyImportedMessage(), readProseBlocks(), nextNonEmpty(),
// and the constants and types that served only them (PO_MONEY_TOLERANCE_USD,
// BUYER_BLOCK_MAX_LINES, CM_TO_MM, TERMS_ROW_LABELS, LINE_ITEM_LABELS, PROSE_LABELS,
// ProseKey, HeaderParse, PurchaseOrderHeader, PurchaseOrderParseResult,
// MaterialAndThickness). Together they derived a whole FabProject from the document.
//
// WHAT REPLACED IT, mid-2026: the manager creates the project and its POs by hand at
// /fab/manager and uploads each PO against its own PO row, so none of page 1 is read.
// The PDF is asked for exactly one thing, the page-2 piece table.
//
// THE OTHER HALF IS LIVE AND IS WHAT THE INTAKE RUNS ON. parsePoPieceTable() at the
// bottom of this file, reached through lib/fab/poPdf.ts from
// /api/fab/manager/pos/parse and /import, plus everything it uses: readPieceTable(),
// toLines(), tokenise(), groupByY(), finishLine(), findTable(), matchColumns(),
// cellsFor(), norm(), toNumber(), round2(), group(), PIECE_TABLE_LABELS,
// PO_TOTAL_SQFT_TOLERANCE_SQFT, PO_REQUIREMENT_SLAB_CODE, PoPage, PoTextItem,
// PoLine, PoToken, PoColumn, PoStatedTotals, PoComputedTotals, PoPieceTableResult.
// Several of those (findTable, cellsFor, toNumber, round2, group) were shared with
// the header half and are deliberately untouched.
//
// LEFT IN PLACE, ORPHANED. isoDateFromUsDate(), readDestination() and
// isDuplicateProjectCodeError() are exported, self-contained and now have no caller,
// but nothing forces them out and each compiles alone, so they were not touched.

import {
  parseFlatSheet, SQ_IN_PER_SQ_FT,
  type FlatSheetRow, type SkippedRow,
} from "./flatSheetParser.ts";

/* -- Tolerances ------------------------------------------------------------- */

/**
 * How far a STATED total may sit from the total computed from the piece rows.
 *
 * 0.01 sqft, absolute. The PO prints its totals to two decimals, so the largest
 * gap an honest document can show is half a cent of a square foot (0.005); 0.01
 * is exactly twice that and nothing more. The real sample makes the point: the
 * unrounded rows come to 2233.9930555…, which prints as 2233.99, while summing
 * the twelve already-rounded row SFTs gives 2234.01. Reconciling against the
 * rounded sum would therefore fire on a perfect PO — so the check below uses
 * the unrounded value and this tolerance stays tight enough to catch a real
 * edit (changing one 60 to a 70 moves the total by 67 sqft).
 *
 * Deliberately a separate constant from flatSheetParser's per-row
 * SFT_TOLERANCE_SQFT even though both are currently 0.01: one bounds a single
 * row's printed rounding, the other bounds a whole order's, and tightening one
 * should never silently move the other.
 */
export const PO_TOTAL_SQFT_TOLERANCE_SQFT = 0.01;

// RETIRED 2026-08 (header half).
// The money cross-check it bounded lived in parseHeaderPage(). The sqft tolerance
// above is LIVE -- parsePoPieceTable() reconciles against it.
// /** Money tolerance for the Quantity x Unit Price = Extended cross-check, in dollars. */
// export const PO_MONEY_TOLERANCE_USD = 0.01;

/**
 * Runs whose baselines are within this many PDF points are one visual line.
 *
 * The PO is set in ~9pt type on ~12pt leading. In a generated (non-scanned) PDF
 * every run on a line shares a baseline exactly, so this only has to absorb a
 * run set at a different size sitting a point off. 3pt is a quarter of the
 * leading, which cannot merge two adjacent lines.
 */
const LINE_Y_TOLERANCE_PT = 3;

// RETIRED 2026-08 (header half).
// Only parseHeaderPage() used it.
// /** How many lines above "Supplier:" may belong to the buyer's address block. */
// const BUYER_BLOCK_MAX_LINES = 4;

// RETIRED 2026-08 (header half).
// Only splitMaterialAndThickness() used it.
// /** Centimetres to millimetres. The description says 2cm; FabSlab.thickness is mm. */
// const CM_TO_MM = 10;

/* -- Result shapes ---------------------------------------------------------- */

export interface PoTextItem {
  /** The run of characters the PDF text layer carries, verbatim. */
  text: string;
  /** Left edge, PDF points, origin at the page's bottom-left corner. */
  x: number;
  /** Baseline, PDF points, measured UP from the bottom of the page. */
  y: number;
  /** Advance width of `text` in points. 0 is tolerated (some producers omit it). */
  width: number;
}

export interface PoPage {
  /** 1-based, as printed. */
  pageNumber: number;
  items: PoTextItem[];
}

// RETIRED 2026-08 (header half).
// Everything page 1 carried. Nothing reads a PO header any more; PoStatedTotals and
// PoComputedTotals below are the page-2 shapes and are LIVE.
// export interface PurchaseOrderHeader {
//   /** "10026" — digits only, as printed. */
//   poNumber: string;
//   /** "6/17/2026", exactly as printed. */
//   poDate: string;
//   /** "2026-06-17". The printed date is US M/D/YYYY. */
//   poDateIso: string;
//   /** "Surfaces by Pacific" — this becomes FabProject.customerName. */
//   buyerName: string;
//   /** The rest of the buyer block, joined with ", ". */
//   buyerAddress: string;
//   /** "Pacific Engineered Surfaces Pvt Ltd." */
//   supplierName: string;
//   shipmentTerms: string;
//   paymentTerms: string;
//   requiredShipDate: string;
//   supplierSoNumber: string;
//   enteredBy: string;
//   etaDate: string;
//   /** "Arva White Prefab (2cm)", verbatim. */
//   description: string;
//   /** "Arva White Prefab" — the description with the thickness bracket removed. */
//   materialName: string;
//   /** MILLIMETRES. The description states centimetres (2cm); FabSlab.thickness is mm. */
//   thicknessMm: number;
//   /**
//    * TOTAL SQUARE FEET ORDERED — the "Quantity 2,233.99 EA" cell.
//    *
//    * NOT a piece count. See the note at the top of this file; the piece count is
//    * `totals.totalPieces`, which comes from the page-2 table.
//    */
//   totalSqft: number;
//   /** The unit printed after the quantity, normally "EA". */
//   quantityUnit: string;
//   /** Dollars per square foot. */
//   unitPriceUsd: number;
//   /** Dollars. Should be totalSqft x unitPriceUsd. */
//   extendedTotalUsd: number;
//   notes: string;
//   specialInstructions: string;
//   termsAndConditions: string;
//   /** "POD Chicago", read out of the Notes prose. Null when it could not be read. */
//   destination: string | null;
// }

/** The bottom line of the page-2 table: blank Length/Width, summed Qty and SFT. */
export interface PoStatedTotals {
  /** 780 in the sample. */
  totalPieces: number;
  /** 2233.99 in the sample. */
  totalSqft: number;
}

export interface PoComputedTotals {
  /** Live rows kept (Qty > 0). */
  rowCount: number;
  /** Sum of Qty over the live rows. */
  totalPieces: number;
  /**
   * Sum of L x W x Qty / 144 over the live rows, UNROUNDED.
   *
   * Deliberately not flatSheetParser's totals.totalSqft, which sums the
   * per-row 2dp values: on the real sample that gives 2234.01 against a stated
   * 2233.99, and reconciling against it would refuse a perfect PO.
   */
  totalSqft: number;
  /** `totalSqft` rounded to 2dp, i.e. the figure the PO ought to print. */
  totalSqftRounded: number;
}

// RETIRED 2026-08 (header half).
// parsePurchaseOrder()'s return shape.
// export interface PurchaseOrderParseResult {
//   /** True only when errors is empty. Nothing may be written unless this is true. */
//   ok: boolean;
//   header: PurchaseOrderHeader | null;
//   rows: FlatSheetRow[];
//   skippedZeroQtyRows: SkippedRow[];
//   /** What the piece rows actually add up to. */
//   totals: PoComputedTotals;
//   /** What the document claims, in both places it claims it. */
//   stated: { headerSqft: number | null; tableTotals: PoStatedTotals | null };
//   /** Non-empty means the import is refused. Every problem found, not just the first. */
//   errors: string[];
//   /** Non-empty means "look at this", not "stop". */
//   warnings: string[];
// }

/* -- Small pure helpers ----------------------------------------------------- */

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Lowercase and drop everything that is not a letter or a digit. Used for
 *  label matching, so "Sr.No", "Sr. No." and "SR NO" are one thing. */
function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** 2233.9931 -> "2,233.9931". Written out rather than toLocaleString so the
 *  error messages read the same on the Vercel box as on a laptop. */
function group(n: number, decimals: number): string {
  const fixed = Math.abs(n).toFixed(decimals);
  const dot = fixed.indexOf(".");
  const whole = dot === -1 ? fixed : fixed.slice(0, dot);
  const rest = dot === -1 ? "" : fixed.slice(dot);
  let out = "";
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += ",";
    out += whole[i];
  }
  return (n < 0 ? "-" : "") + out + rest;
}

/** A number from a cell that may carry thousands separators, a $ or a trailing
 *  unit. Null when there is no number in it at all. */
function toNumber(text: string): number | null {
  const cleaned = String(text ?? "").replace(/[,$ ]/g, "").trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/* -- Lines and tokens ------------------------------------------------------- */

interface PoToken {
  text: string;
  x: number;
  width: number;
  /** Horizontal centre. Column assignment compares centres, not left edges,
   *  because headers are usually centred while their values are right-aligned. */
  centre: number;
}

interface PoLine {
  y: number;
  tokens: PoToken[];
  /** The line as one string, single-spaced, for label and prose matching. */
  text: string;
}

/**
 * Split one text run on its internal whitespace, estimating each piece's x by
 * character count.
 *
 * Producers differ: one emits a table row as five runs, one emits it as a
 * single run "3 28 22.5 60 262.50". Splitting normalises both, and the estimate
 * only has to be good enough to land a token nearer its own column's centre
 * than its neighbour's — the columns of this table are ~90pt apart and the
 * tokens are ~20pt wide.
 */
function tokenise(item: PoTextItem): PoToken[] {
  const raw = String(item.text ?? "");
  if (raw.trim() === "") return [];
  const perChar = raw.length > 0 && item.width > 0 ? item.width / raw.length : 0;
  const out: PoToken[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const x = item.x + m.index * perChar;
    const width = m[0].length * perChar;
    out.push({ text: m[0], x, width, centre: x + width / 2 });
  }
  return out;
}

/** Group a page's runs into visual lines, top of the page first, each line's
 *  tokens left to right. */
function toLines(page: PoPage): PoLine[] {
  const tokens = (page.items ?? []).flatMap(tokenise);
  // Descending y: pdf.js measures up from the bottom of the page, so the
  // largest y is the top line. Sorting by x inside the group is done after.
  tokens.sort((a, b) => b.centre - a.centre); // placeholder, replaced below
  const byY = [...tokens];
  byY.sort((a, b) => 0); // no-op; y lives on the item, not the token
  return groupByY(page, tokens);
}

/** Line grouping needs the y that tokenise() drops, so it is done over the
 *  items and their tokens together. */
function groupByY(page: PoPage, _unused: PoToken[]): PoLine[] {
  const withY: Array<{ y: number; token: PoToken }> = [];
  for (const item of page.items ?? []) {
    for (const token of tokenise(item)) withY.push({ y: Number(item.y) || 0, token });
  }
  withY.sort((a, b) => b.y - a.y);

  const lines: PoLine[] = [];
  let current: { y: number; tokens: PoToken[] } | null = null;
  for (const entry of withY) {
    if (current && Math.abs(current.y - entry.y) <= LINE_Y_TOLERANCE_PT) {
      current.tokens.push(entry.token);
    } else {
      if (current) lines.push(finishLine(current));
      current = { y: entry.y, tokens: [entry.token] };
    }
  }
  if (current) lines.push(finishLine(current));
  return lines;
}

function finishLine(line: { y: number; tokens: PoToken[] }): PoLine {
  const tokens = [...line.tokens].sort((a, b) => a.x - b.x);
  return { y: line.y, tokens, text: tokens.map(t => t.text).join(" ") };
}

/* -- Column-aware table reading --------------------------------------------- */

interface PoColumn {
  label: string;
  start: number;
  end: number;
  centre: number;
}

/**
 * Find a table's header line by matching an exact, ordered list of labels, and
 * return where each label sits horizontally.
 *
 * Matching is done over tokens and on normalised text, so "Sr.No" and "Sr. No."
 * are the same label whether the producer emitted them as one run or two.
 * Returns null when the labels are not all present in order, which is how a
 * caller tells "this is not that header line" from "this is".
 */
function matchColumns(line: PoLine, labels: string[]): PoColumn[] | null {
  const tokens = line.tokens.filter(t => norm(t.text) !== "");
  const columns: PoColumn[] = [];
  let i = 0;
  for (const label of labels) {
    const want = norm(label);
    let found: PoColumn | null = null;
    while (i < tokens.length) {
      let acc = "";
      let k = i;
      while (k < tokens.length && want.startsWith(acc + norm(tokens[k].text))) {
        acc += norm(tokens[k].text);
        k++;
        if (acc === want) break;
      }
      if (acc === want) {
        const start = tokens[i].x;
        const end = tokens[k - 1].x + tokens[k - 1].width;
        found = { label, start, end, centre: (start + end) / 2 };
        i = k;
        break;
      }
      i++;
    }
    if (!found) return null;
    columns.push(found);
  }
  return columns;
}

/** Drop every token into the column whose centre it is nearest, then rejoin
 *  each column's tokens left to right. A column nothing landed in comes back "". */
function cellsFor(line: PoLine, columns: PoColumn[]): string[] {
  const buckets: PoToken[][] = columns.map(() => []);
  for (const token of line.tokens) {
    let best = 0;
    let bestGap = Infinity;
    for (let c = 0; c < columns.length; c++) {
      const gap = Math.abs(token.centre - columns[c].centre);
      if (gap < bestGap) { bestGap = gap; best = c; }
    }
    buckets[best].push(token);
  }
  return buckets.map(bucket =>
    bucket.sort((a, b) => a.x - b.x).map(t => t.text).join(" ").trim(),
  );
}

// RETIRED 2026-08 (header half).
// "the next line with anything on it" -- only parseHeaderPage() used it. The piece
// table walks its lines itself.
// /** The first line of `lines` at or after `from` that has any text on it. */
// function nextNonEmpty(lines: PoLine[], from: number): number {
//   for (let i = from; i < lines.length; i++) if (lines[i].text.trim() !== "") return i;
//   return -1;
// }

/* -- Page 1: the header ----------------------------------------------------- */

// RETIRED 2026-08 (header half).
// Page-1 column and prose labels. Only parseHeaderPage() used them.
// const TERMS_ROW_LABELS = [
//   "Shipment Terms", "Payment Terms", "Required Ship Date",
//   "Supplier SO#", "Entered By", "ETA Date",
// ];
//
// const LINE_ITEM_LABELS = ["Description", "Slabs", "Quantity", "Unit Price", "Extended"];
//
// /** The prose blocks, in the order the template prints them. */
// const PROSE_LABELS = [
//   { key: "notes", label: "Notes:" },
//   { key: "specialInstructions", label: "Special Instructions:" },
//   { key: "termsAndConditions", label: "Terms and Conditions:" },
// ] as const;

/** M/D/YYYY as printed -> "YYYY-MM-DD", or null when it is not a real date. */
export function isoDateFromUsDate(printed: string): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(printed ?? "");
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject 2/30 and friends: build the date in UTC and check it did not roll over.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

// RETIRED 2026-08 (header half).
// "Arva White Prefab (2cm)" -> name + 20mm, off the page-1 line item. Only
// parseHeaderPage() called it; the manager picks material and thickness on screen.
// export interface MaterialAndThickness {
//   materialName: string;
//   /** MILLIMETRES. */
//   thicknessMm: number;
// }
//
// /**
//  * "Arva White Prefab (2cm)" -> { materialName: "Arva White Prefab", thicknessMm: 20 }.
//  *
//  * The bracket states CENTIMETRES because that is how the trade quotes slab
//  * thickness; everything downstream (FabSlab.thickness, the cut plan) is
//  * millimetres, so the conversion happens here, once, and the field says mm.
//  * Returns null rather than guessing when there is no thickness to read — a
//  * project whose thickness is wrong cuts the wrong slabs.
//  */
// export function splitMaterialAndThickness(description: string): MaterialAndThickness | null {
//   const text = String(description ?? "").trim();
//   const m = /^(.*?)\s*\(\s*(\d+(?:\.\d+)?)\s*(cm|mm)\s*\)\s*$/i.exec(text);
//   if (!m) return null;
//   const name = m[1].trim();
//   const value = Number(m[2]);
//   if (!name || !Number.isFinite(value) || value <= 0) return null;
//   const unit = m[3].toLowerCase();
//   const thicknessMm = unit === "cm" ? round2(value * CM_TO_MM) : round2(value);
//   return { materialName: name, thicknessMm };
// }

/**
 * The shipping destination, out of the Notes prose.
 *
 * "Final Destination - POD Chicago 20 Ft container - Max weight 21.5 MT" gives
 * "POD Chicago": everything after the dash, stopped at the first number or the
 * next dash, because what follows is container and weight, not a place.
 */
export function readDestination(notes: string, specialInstructions: string): string | null {
  for (const source of [notes, specialInstructions]) {
    const text = String(source ?? "");
    const m = /final\s+destination\s*[-–—:]\s*([^\n]+)/i.exec(text);
    if (!m) continue;
    const tail = m[1];
    // Stop at the first digit (a container size or a weight) or the next dash.
    const stop = /[\d]|\s[-–—]\s/.exec(tail);
    const value = (stop ? tail.slice(0, stop.index) : tail).trim().replace(/[\s,;.-]+$/, "");
    if (value) return value;
  }
  return null;
}

// RETIRED 2026-08 (header half).
// projectCodeForPo() minted "PO10026" from a PO number, back when uploading a PO
// created the project; poAlreadyImportedMessage() was the duplicate-upload sentence
// built on it. The manager types the project code in by hand now, so neither has a
// caller. They go together: the message calls projectCodeForPo(), so retiring the
// one named in the brief without the other would not compile.
// /** "10026" -> "PO10026". FabProject.projectCode is @unique, which is what makes
//  *  re-importing the same PO impossible rather than merely discouraged. */
// export function projectCodeForPo(poNumber: string): string {
//   return `PO${String(poNumber ?? "").trim()}`;
// }
//
// /** The message a duplicate upload must produce. Kept here, next to the code that
//  *  builds the project code, so the route cannot word it differently. */
// export function poAlreadyImportedMessage(poNumber: string, existingProjectCode?: string): string {
//   const code = existingProjectCode ?? projectCodeForPo(poNumber);
//   return (
//     `PO ${String(poNumber ?? "").trim()} has already been imported as project ${code}. ` +
//     `Nothing was created. Open that project, or delete it first if this PO really is a replacement.`
//   );
// }

/**
 * True for the Postgres/Prisma unique-constraint violation on
 * fab_project.project_code.
 *
 * The duplicate is normally caught by a read before the write, but two managers
 * uploading the same PO seconds apart both pass that read; this turns the write
 * that loses the race into the same sentence as the read that caught it,
 * instead of "Invalid `prisma.fabProject.create()` invocation".
 */
export function isDuplicateProjectCodeError(error: unknown): boolean {
  const e = error as { code?: unknown; meta?: { target?: unknown } } | null;
  if (!e || e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.some(f => f === "project_code" || f === "projectCode" || f.includes("project_code"));
}

// RETIRED 2026-08 (header half).
// FabProject.remarks, assembled from the page-1 header and prose. The manager types
// the project's details in now, so there is no document text to fold into remarks.
// /* -- Remarks ---------------------------------------------------------------- */
//
// /**
//  * Everything from the PO that is worth keeping but not worth a column, as one
//  * block for FabProject.remarks.
//  *
//  * The prose is the PO's own words and is read by a human deciding how to cut —
//  * "One undermount vanity bowl cutout per top" is an instruction, not a filter.
//  * Splitting it into columns would invent structure the document does not have.
//  */
// export function buildProjectRemarks(header: PurchaseOrderHeader): string {
//   const lines: string[] = [];
//   lines.push(`Purchase Order# ${header.poNumber} · Date ${header.poDate}`);
//   lines.push(`Buyer: ${header.buyerName}${header.buyerAddress ? `, ${header.buyerAddress}` : ""}`);
//   lines.push(`Supplier: ${header.supplierName}`);
//
//   const terms = [
//     header.shipmentTerms ? `Shipment Terms ${header.shipmentTerms}` : "",
//     header.paymentTerms ? `Payment Terms ${header.paymentTerms}` : "",
//     header.requiredShipDate ? `Required Ship Date ${header.requiredShipDate}` : "",
//     header.supplierSoNumber ? `Supplier SO# ${header.supplierSoNumber}` : "",
//     header.enteredBy ? `Entered By ${header.enteredBy}` : "",
//     header.etaDate ? `ETA Date ${header.etaDate}` : "",
//   ].filter(Boolean);
//   if (terms.length) lines.push(terms.join(" · "));
//
//   lines.push(
//     `Line item: ${header.description} — ${group(header.totalSqft, 2)} ${header.quantityUnit} ` +
//     `@ $${group(header.unitPriceUsd, 2)} = $${group(header.extendedTotalUsd, 2)}`,
//   );
//
//   if (header.notes) lines.push("", "Notes:", header.notes);
//   if (header.specialInstructions) lines.push("", "Special Instructions:", header.specialInstructions);
//   if (header.termsAndConditions) lines.push("", "Terms and Conditions:", header.termsAndConditions);
//
//   return lines.join("\n");
// }

/* -- The parser ------------------------------------------------------------- */

// RETIRED 2026-08 (header half).
// parseHeaderPage()'s return shape.
// interface HeaderParse {
//   header: PurchaseOrderHeader | null;
//   errors: string[];
//   warnings: string[];
// }

// RETIRED 2026-08 (header half).
// Page 1 in full: PO number and date, buyer block, supplier, the six-column terms
// row, the priced line item, the prose blocks. Only parsePurchaseOrder() called it.
//
// findTable() below is NOT retired -- readPieceTable() uses it too.
// function parseHeaderPage(page: PoPage): HeaderParse {
//   const errors: string[] = [];
//   const warnings: string[] = [];
//   const lines = toLines(page);
//   const pageText = lines.map(l => l.text).join("\n");
//
//   const fail = (message: string) => { errors.push(message); };
//
//   /* PO number and date. */
//   const poMatch = /purchase\s*order\s*#?\s*:?\s*(\d{1,12})/i.exec(pageText);
//   if (!poMatch) fail('Could not find "Purchase Order# <number>" on page 1. This does not look like the purchase-order template — nothing was imported.');
//   const dateMatch = /\bdate\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(pageText);
//   if (!dateMatch) fail('Could not find "Date: M/D/YYYY" on page 1 of the purchase order.');
//   const poDate = dateMatch ? dateMatch[1] : "";
//   const poDateIso = poDate ? isoDateFromUsDate(poDate) : null;
//   if (poDate && !poDateIso) fail(`The purchase order date "${poDate}" is not a real date. Expected M/D/YYYY, e.g. 6/17/2026.`);
//
//   /* Supplier, and the buyer block that sits above it. */
//   const supplierLine = lines.findIndex(l => /^supplier\s*:/i.test(l.text.trim()));
//   let supplierName = "";
//   if (supplierLine === -1) {
//     fail('Could not find the "Supplier:" line on page 1 of the purchase order.');
//   } else {
//     const inline = lines[supplierLine].text.replace(/^\s*supplier\s*:\s*/i, "").trim();
//     if (inline) supplierName = inline;
//     else {
//       const next = nextNonEmpty(lines, supplierLine + 1);
//       if (next !== -1) supplierName = lines[next].text.trim();
//     }
//     if (!supplierName) fail('The "Supplier:" line on page 1 has no supplier name after it.');
//   }
//
//   let buyerName = "";
//   let buyerAddress = "";
//   if (supplierLine !== -1) {
//     const block = lines
//       .slice(0, supplierLine)
//       .map(l => l.text.trim())
//       .filter(t => t !== "")
//       // The PO number, the date and any bare label ("Bill To:") are not the buyer.
//       .filter(t => !/purchase\s*order/i.test(t))
//       .filter(t => !/^\s*date\s*:/i.test(t))
//       .filter(t => !/^[A-Za-z][A-Za-z ]*:\s*$/.test(t))
//       .filter(t => /[A-Za-z]/.test(t));
//     const tail = block.slice(-BUYER_BLOCK_MAX_LINES);
//     if (!tail.length) {
//       fail('Could not read the buyer block above "Supplier:" on page 1. The project needs a customer name and there is nothing there to use.');
//     } else {
//       buyerName = tail[0];
//       buyerAddress = tail.slice(1).join(", ");
//     }
//   }
//
//   /* The six-column terms row, and the line item table below it. Both are read
//      by matching their header labels and then dropping the next line's tokens
//      into the columns those labels define, so a blank cell stays blank instead
//      of shifting every value one column to the left. */
//   const termsHeader = findTable(lines, TERMS_ROW_LABELS);
//   let shipmentTerms = "", paymentTerms = "", requiredShipDate = "";
//   let supplierSoNumber = "", enteredBy = "", etaDate = "";
//   if (!termsHeader) {
//     fail(
//       `Could not find the terms row on page 1 (expected the columns ${TERMS_ROW_LABELS.join(" | ")}). ` +
//       `This does not look like the purchase-order template — nothing was imported.`,
//     );
//   } else {
//     const valueIndex = nextNonEmpty(lines, termsHeader.lineIndex + 1);
//     if (valueIndex === -1) {
//       fail("The terms row on page 1 has a header but no values under it.");
//     } else {
//       const cells = cellsFor(lines[valueIndex], termsHeader.columns);
//       [shipmentTerms, paymentTerms, requiredShipDate, supplierSoNumber, enteredBy, etaDate] = cells;
//     }
//   }
//
//   const itemHeader = findTable(lines, LINE_ITEM_LABELS);
//   let description = "";
//   let totalSqft = 0;
//   let quantityUnit = "";
//   let unitPriceUsd = 0;
//   let extendedTotalUsd = 0;
//   if (!itemHeader) {
//     fail(
//       `Could not find the line item table on page 1 (expected the columns ${LINE_ITEM_LABELS.join(" | ")}). ` +
//       `Nothing was imported.`,
//     );
//   } else {
//     const valueIndex = nextNonEmpty(lines, itemHeader.lineIndex + 1);
//     if (valueIndex === -1) {
//       fail("The line item table on page 1 has a header but no line under it.");
//     } else {
//       const cells = cellsFor(lines[valueIndex], itemHeader.columns);
//       description = cells[0];
//       const quantityCell = cells[2];
//       const unitPriceCell = cells[3];
//       const extendedCell = cells[4];
//
//       if (!description) fail("The line item on page 1 has no Description, so there is no material to fabricate.");
//
//       // "2,233.99 EA" — the number is SQUARE FEET, the unit is what it is
//       // measured in. This is the single most consequential cell on the page.
//       const quantityMatch = /^([\d,]*\.?\d+)\s*([A-Za-z]*)$/.exec(quantityCell.trim());
//       const quantityValue = quantityMatch ? toNumber(quantityMatch[1]) : null;
//       if (quantityValue === null || quantityValue <= 0) {
//         fail(
//           `Could not read the ordered square footage from the line item's Quantity cell ` +
//           `(read "${quantityCell}"). Expected something like "2,233.99 EA".`,
//         );
//       } else {
//         totalSqft = quantityValue;
//         quantityUnit = quantityMatch ? quantityMatch[2].toUpperCase() : "";
//         if (quantityUnit && quantityUnit !== "EA") {
//           warnings.push(
//             `The line item's Quantity is measured in "${quantityUnit}", not "EA". This importer reads that ` +
//             `figure as TOTAL SQUARE FEET (the piece count comes from the page 2 table) — check that is right.`,
//           );
//         }
//       }
//
//       const unitPrice = toNumber(unitPriceCell);
//       if (unitPrice === null) fail(`Could not read the line item's Unit Price (read "${unitPriceCell}"). Expected something like "$7.81".`);
//       else unitPriceUsd = unitPrice;
//
//       const extended = toNumber(extendedCell);
//       if (extended === null) fail(`Could not read the line item's Extended total (read "${extendedCell}"). Expected something like "$17,447.46".`);
//       else extendedTotalUsd = extended;
//
//       // A second priced line would mean a second material, and this intake
//       // creates one project with one thickness. Refuse rather than drop it.
//       const secondIndex = nextNonEmpty(lines, valueIndex + 1);
//       if (secondIndex !== -1) {
//         const second = cellsFor(lines[secondIndex], itemHeader.columns);
//         const secondQty = /^([\d,]*\.?\d+)\s*([A-Za-z]*)$/.exec(second[2].trim());
//         if (second[0] && secondQty && toNumber(secondQty[1]) !== null && toNumber(second[3]) !== null) {
//           fail(
//             `This purchase order has more than one line item ("${description}" and "${second[0]}"). ` +
//             `The fabrication intake creates one project for one material, so nothing was imported — split the PO.`,
//           );
//         }
//       }
//     }
//   }
//
//   const split = description ? splitMaterialAndThickness(description) : null;
//   if (description && !split) {
//     fail(
//       `Could not read the thickness from the line item description "${description}". ` +
//       `Expected it to end with the thickness in brackets, e.g. "Arva White Prefab (2cm)".`,
//     );
//   }
//
//   /* Prose. Missing blocks are a warning, not a refusal — see the note at the
//      top of this file. */
//   const prose = readProseBlocks(lines);
//   for (const { key, label } of PROSE_LABELS) {
//     if (prose[key] === null) {
//       warnings.push(`Page 1 has no "${label}" block. That text is normally copied into the project remarks; it will be blank.`);
//     }
//   }
//   const notes = prose.notes ?? "";
//   const specialInstructions = prose.specialInstructions ?? "";
//   const termsAndConditions = prose.termsAndConditions ?? "";
//
//   const destination = readDestination(notes, specialInstructions);
//   if (!destination) {
//     warnings.push('Could not read a "Final Destination - ..." out of the Notes, so the project has no destination recorded.');
//   }
//
//   if (errors.length) return { header: null, errors, warnings };
//
//   const header: PurchaseOrderHeader = {
//     poNumber: poMatch ? poMatch[1] : "",
//     poDate,
//     poDateIso: poDateIso ?? "",
//     buyerName,
//     buyerAddress,
//     supplierName,
//     shipmentTerms, paymentTerms, requiredShipDate, supplierSoNumber, enteredBy, etaDate,
//     description,
//     materialName: split ? split.materialName : "",
//     thicknessMm: split ? split.thicknessMm : 0,
//     totalSqft,
//     quantityUnit,
//     unitPriceUsd,
//     extendedTotalUsd,
//     notes, specialInstructions, termsAndConditions,
//     destination,
//   };
//
//   // Money is a cross-check, never a gate: their rounding is their business and
//   // no piece is cut differently because of it.
//   const expectedExtended = round2(header.totalSqft * header.unitPriceUsd);
//   if (Math.abs(expectedExtended - header.extendedTotalUsd) > PO_MONEY_TOLERANCE_USD) {
//     warnings.push(
//       `The line item does not multiply out: ${group(header.totalSqft, 2)} × $${group(header.unitPriceUsd, 2)} ` +
//       `= $${group(expectedExtended, 2)}, but the Extended column says $${group(header.extendedTotalUsd, 2)}.`,
//     );
//   }
//
//   return { header, errors, warnings };
// }

/** Find the line that carries a table's header labels, and where its columns sit. */
function findTable(lines: PoLine[], labels: string[]): { lineIndex: number; columns: PoColumn[] } | null {
  for (let i = 0; i < lines.length; i++) {
    const columns = matchColumns(lines[i], labels);
    if (columns) return { lineIndex: i, columns };
  }
  return null;
}

// RETIRED 2026-08 (header half).
// Notes / Special Instructions / Terms blocks, for the project remarks.
// Only parseHeaderPage() called this.
// type ProseKey = (typeof PROSE_LABELS)[number]["key"];
//
// /** Pull the three prose blocks out by their labels. A block runs from its own
//  *  label to whichever other label comes next in the document, or to the end. */
// function readProseBlocks(lines: PoLine[]): Record<ProseKey, string | null> {
//   const found: Array<{ key: ProseKey; lineIndex: number; inline: string }> = [];
//   for (const { key, label } of PROSE_LABELS) {
//     const pattern = new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}`, "i");
//     const lineIndex = lines.findIndex(l => pattern.test(l.text));
//     if (lineIndex === -1) continue;
//     found.push({ key, lineIndex, inline: lines[lineIndex].text.replace(pattern, "").trim() });
//   }
//   found.sort((a, b) => a.lineIndex - b.lineIndex);
//
//   const out: Record<ProseKey, string | null> = {
//     notes: null, specialInstructions: null, termsAndConditions: null,
//   };
//   for (let i = 0; i < found.length; i++) {
//     const start = found[i].lineIndex + 1;
//     const end = i + 1 < found.length ? found[i + 1].lineIndex : lines.length;
//     const body = lines.slice(start, end).map(l => l.text.trim()).filter(t => t !== "");
//     out[found[i].key] = [found[i].inline, ...body].filter(t => t !== "").join("\n");
//   }
//   return out;
// }

/* -- Page 2: the piece table ------------------------------------------------ */

const PIECE_TABLE_LABELS = ["Sr.No", "Length", "Width", "Qty", "SFT"];

/** A line the piece table is allowed to contain and this parser ignores. */
const TABLE_NOISE = /^\s*page\s*\d+\s*(?:of|\/)\s*\d+\s*$/i;

/** A totals row may or may not be labelled; strip the label if it is. */
const TOTAL_LABEL = /^(?:grand\s*)?(?:sub\s*)?totals?$/i;

interface PieceTableRead {
  /** The matrix handed to parseFlatSheet: header row first, then every data row. */
  matrix: string[][];
  stated: PoStatedTotals | null;
  errors: string[];
  warnings: string[];
}

function readPieceTable(pages: PoPage[]): PieceTableRead {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const page of pages) {
    const lines = toLines(page);
    const header = findTable(lines, PIECE_TABLE_LABELS);
    if (!header) continue;

    const matrix: string[][] = [PIECE_TABLE_LABELS.slice()];
    let stated: PoStatedTotals | null = null;

    for (let i = header.lineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.text.trim() === "" || TABLE_NOISE.test(line.text)) continue;

      // A leading "Total" label belongs to no column; drop it and read the
      // numbers that follow by their position.
      const tokens = line.tokens.filter(t => !TOTAL_LABEL.test(t.text));
      if (!tokens.length) continue;
      const stripped: PoLine = { ...line, tokens, text: tokens.map(t => t.text).join(" ") };

      const numeric = tokens.filter(t => toNumber(t.text) !== null);
      if (!numeric.length) continue;                       // a caption or a footer
      if (numeric.length !== tokens.length) {
        // Something inside the table is not a number. Say so and move on: the
        // three-way reconciliation below is what decides whether the loss
        // matters, and it will, because a dropped row cannot add up.
        warnings.push(`Page ${page.pageNumber} line "${stripped.text}" is inside the piece table but is not a piece row; it was ignored.`);
        continue;
      }

      const cells = cellsFor(stripped, header.columns);
      const [, lengthCell, widthCell, qtyCell, sftCell] = cells;

      // Blank Length AND Width with a Qty and an SFT is the totals line.
      if (lengthCell === "" && widthCell === "" && qtyCell !== "" && sftCell !== "") {
        const qty = toNumber(qtyCell);
        const sft = toNumber(sftCell);
        if (qty !== null && sft !== null) {
          stated = { totalPieces: qty, totalSqft: sft };
          continue;
        }
      }
      matrix.push(cells);
    }

    if (matrix.length === 1) {
      errors.push("The piece table has a header row and no piece rows under it. Nothing was imported.");
    }
    if (!stated) {
      errors.push(
        "The piece table has no totals row. The last line of the table must carry the total Qty and total SFT " +
        "with Length and Width blank — that row is one of the three figures this import reconciles against.",
      );
    }
    return { matrix, stated, errors, warnings };
  }

  return {
    matrix: [],
    stated: null,
    warnings,
    errors: [
      `Could not find the piece table (a row of columns ${PIECE_TABLE_LABELS.join(" | ")}) on any page of this PDF. ` +
      `This does not look like the purchase-order template — nothing was imported.`,
    ],
  };
}

/* -- Everything together ---------------------------------------------------- */

const EMPTY_TOTALS: PoComputedTotals = { rowCount: 0, totalPieces: 0, totalSqft: 0, totalSqftRounded: 0 };

// RETIRED 2026-08 (header half).
// The whole-document read: page 1 header + page 2 table + the three-way
// reconciliation between the header Quantity, the table totals row and the rows.
// Nothing calls it. parsePoPieceTable() at the bottom of this file is the live
// entry point and keeps the table half of that reconciliation.
// /**
//  * Read a purchase order out of its extracted pages.
//  *
//  * Returns ok:false with every problem named rather than throwing, and never
//  * returns a partial order: if the reconciliation fails, `rows` still carries
//  * what was read so the screen can show the manager what disagreed, but `ok` is
//  * false and the caller must write nothing.
//  */
// export function parsePurchaseOrder(pages: PoPage[]): PurchaseOrderParseResult {
//   const errors: string[] = [];
//   const warnings: string[] = [];
//
//   const list = Array.isArray(pages) ? pages.filter(p => p && Array.isArray(p.items)) : [];
//   if (!list.length) {
//     return {
//       ok: false, header: null, rows: [], skippedZeroQtyRows: [],
//       totals: EMPTY_TOTALS, stated: { headerSqft: null, tableTotals: null },
//       errors: ["That PDF has no readable text on any page. This importer needs the original purchase-order PDF, not a scan or a photograph of one."],
//       warnings: [],
//     };
//   }
//
//   const headerParse = parseHeaderPage(list[0]);
//   errors.push(...headerParse.errors);
//   warnings.push(...headerParse.warnings);
//
//   const table = readPieceTable(list);
//   errors.push(...table.errors);
//   warnings.push(...table.warnings);
//
//   let rows: FlatSheetRow[] = [];
//   let skippedZeroQtyRows: SkippedRow[] = [];
//   let totals = EMPTY_TOTALS;
//
//   if (table.matrix.length > 1) {
//     const sheet = parseFlatSheet(table.matrix);
//     rows = sheet.rows;
//     skippedZeroQtyRows = sheet.skippedZeroQtyRows;
//     warnings.push(...sheet.warnings);
//     for (const e of sheet.errors) errors.push(`Piece table — ${e}`);
//
//     if (rows.length) {
//       // UNROUNDED. Summing the per-row 2dp values gives 2234.01 on the real
//       // sample against a stated 2233.99, so that sum can never be the one the
//       // reconciliation trusts.
//       const exact = rows.reduce((s, r) => s + (r.lengthIn * r.widthIn * r.quantity) / SQ_IN_PER_SQ_FT, 0);
//       totals = {
//         rowCount: rows.length,
//         totalPieces: rows.reduce((s, r) => s + r.quantity, 0),
//         totalSqft: exact,
//         totalSqftRounded: round2(exact),
//       };
//     }
//   }
//
//   const headerSqft = headerParse.header ? headerParse.header.totalSqft : null;
//   const stated = { headerSqft, tableTotals: table.stated };
//
//   /* The three-way reconciliation. This is the check that catches a hand-edited
//      PO, so it names the figure and the size of the gap rather than saying the
//      totals do not match. */
//   if (rows.length) {
//     const shown = (n: number) => group(n, 4);
//
//     if (headerSqft !== null) {
//       const gap = headerSqft - totals.totalSqft;
//       if (Math.abs(gap) > PO_TOTAL_SQFT_TOLERANCE_SQFT) {
//         errors.push(
//           `Header total disagrees with the piece rows: the line item's Quantity says ${group(headerSqft, 2)} sqft, ` +
//           `but the ${totals.rowCount} live piece row${totals.rowCount === 1 ? "" : "s"} come to ${shown(totals.totalSqft)} sqft — ` +
//           `a difference of ${shown(Math.abs(gap))} sqft (tolerance ${PO_TOTAL_SQFT_TOLERANCE_SQFT}). Nothing was imported.`,
//         );
//       }
//     }
//
//     if (table.stated) {
//       const sqftGap = table.stated.totalSqft - totals.totalSqft;
//       if (Math.abs(sqftGap) > PO_TOTAL_SQFT_TOLERANCE_SQFT) {
//         errors.push(
//           `Table totals row disagrees with the piece rows: it says ${group(table.stated.totalSqft, 2)} sqft, ` +
//           `but the ${totals.rowCount} live piece row${totals.rowCount === 1 ? "" : "s"} come to ${shown(totals.totalSqft)} sqft — ` +
//           `a difference of ${shown(Math.abs(sqftGap))} sqft (tolerance ${PO_TOTAL_SQFT_TOLERANCE_SQFT}). Nothing was imported.`,
//         );
//       }
//       const pieceGap = table.stated.totalPieces - totals.totalPieces;
//       if (pieceGap !== 0) {
//         errors.push(
//           `Table totals row disagrees with the piece rows: it says ${group(table.stated.totalPieces, 0)} pieces, ` +
//           `but the rows add up to ${group(totals.totalPieces, 0)} — ` +
//           `${group(Math.abs(pieceGap), 0)} piece${Math.abs(pieceGap) === 1 ? "" : "s"} ` +
//           `${pieceGap > 0 ? "missing" : "too many"}. Nothing was imported.`,
//         );
//       }
//     }
//   }
//
//   return {
//     ok: errors.length === 0,
//     header: errors.length === 0 ? headerParse.header : headerParse.header,
//     rows, skippedZeroQtyRows, totals, stated, errors, warnings,
//   };
// }

/* -- What a requirement row is made of -------------------------------------- */

/**
 * What goes in fab_requirement.slab_code for a PO-sourced requirement.
 *
 * The column is String NOT NULL and a purchase order has no slab code at all —
 * the slab is chosen later by the supervisor on the allocation board. Nothing
 * in the app reads fab_requirement.slab_code (only fab_slab.slab_code is ever
 * displayed or joined on), so this is a placeholder to satisfy the constraint,
 * and it is spelled out rather than left as the legacy path's "UNKNOWN": a row
 * that says UNASSIGNED is telling the truth about a decision that has not been
 * made, while UNKNOWN reads like data we lost.
 */
export const PO_REQUIREMENT_SLAB_CODE = "UNASSIGNED";

/* -- The manager's narrow path: the piece table and nothing else ------------ */

/**
 * WHAT THE MANAGER DASHBOARD ACTUALLY USES.
 *
 * parsePurchaseOrder() above reads the whole document, header included, and
 * derives a project from it. The manager surface does not work that way: he
 * creates the project by hand, creates a PO under it by hand, and the PDF is
 * asked for exactly one thing — the page-2 piece table. Page 1 is ignored
 * entirely, which also means a PO whose commercial header changed (a new terms
 * row, a renamed buyer) still imports, because none of that is read.
 *
 * So this is deliberately NOT parsePurchaseOrder minus some fields. It shares
 * readPieceTable() and the reconciliation with it — one definition of what a
 * piece row is and what makes the totals agree — and skips everything else.
 */
export interface PoPieceTableResult {
  /** True only when errors is empty. Nothing may be written unless this is true. */
  ok: boolean;
  /** One entry per LIVE row (Qty > 0), in document order. */
  rows: FlatSheetRow[];
  /** The Qty-0 rows, kept so the preview can say how many were skipped and which. */
  skippedZeroQtyRows: SkippedRow[];
  /** What the piece rows actually add up to, from unrounded values. */
  totals: PoComputedTotals;
  /** What the table's own totals row claims. Null when there is not one. */
  stated: PoStatedTotals | null;
  /** Non-empty means the import is refused. Every problem found, not just the first. */
  errors: string[];
  /** Non-empty means "look at this", not "stop". */
  warnings: string[];
}

const EMPTY_PIECE_TABLE: PoPieceTableResult = {
  ok: false, rows: [], skippedZeroQtyRows: [],
  totals: EMPTY_TOTALS, stated: null, errors: [], warnings: [],
};

/**
 * Read ONLY the piece table (Sr.No | Length | Width | Qty | SFT) out of a PO's
 * extracted pages, and reconcile it against the table's own totals row.
 *
 * Refuses, naming the figure and the size of the gap, when:
 *   - no page carries that header line (this is not the template),
 *   - the table has no rows under the header,
 *   - the table has no totals row,
 *   - a row is unreadable (flatSheetParser's own rules), or
 *   - the totals row disagrees with the rows by more than
 *     PO_TOTAL_SQFT_TOLERANCE_SQFT square feet, or by a single piece.
 *
 * THE COMPARISON IS AGAINST THE UNROUNDED SUM. The real sample's rows come to
 * 2233.9930555..., which the PO prints as 2233.99, while summing the per-row 2dp
 * SFTs gives 2234.01 — reconciling against that sum would refuse a perfect PO.
 *
 * `rows` is still populated when ok is false, so the preview can show the
 * manager what disagreed. The caller must key off `ok`, never off rows.length.
 */
export function parsePoPieceTable(pages: PoPage[]): PoPieceTableResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const list = Array.isArray(pages) ? pages.filter(p => p && Array.isArray(p.items)) : [];
  if (!list.length) {
    return {
      ...EMPTY_PIECE_TABLE,
      errors: [
        "That PDF has no readable text on any page. This importer needs the original purchase-order PDF, " +
        "not a scan or a photograph of one.",
      ],
    };
  }

  const table = readPieceTable(list);
  errors.push(...table.errors);
  warnings.push(...table.warnings);

  let rows: FlatSheetRow[] = [];
  let skippedZeroQtyRows: SkippedRow[] = [];
  let totals = EMPTY_TOTALS;

  if (table.matrix.length > 1) {
    const sheet = parseFlatSheet(table.matrix);
    rows = sheet.rows;
    skippedZeroQtyRows = sheet.skippedZeroQtyRows;
    warnings.push(...sheet.warnings);
    for (const e of sheet.errors) errors.push(`Piece table — ${e}`);

    if (rows.length) {
      const exact = rows.reduce((s, r) => s + (r.lengthIn * r.widthIn * r.quantity) / SQ_IN_PER_SQ_FT, 0);
      totals = {
        rowCount: rows.length,
        totalPieces: rows.reduce((s, r) => s + r.quantity, 0),
        totalSqft: exact,
        totalSqftRounded: round2(exact),
      };
    }
  }

  if (rows.length && table.stated) {
    const shown = (n: number) => group(n, 4);

    const sqftGap = table.stated.totalSqft - totals.totalSqft;
    if (Math.abs(sqftGap) > PO_TOTAL_SQFT_TOLERANCE_SQFT) {
      errors.push(
        `Table totals row disagrees with the piece rows: it says ${group(table.stated.totalSqft, 2)} sqft, ` +
        `but the ${totals.rowCount} live piece row${totals.rowCount === 1 ? "" : "s"} come to ${shown(totals.totalSqft)} sqft — ` +
        `a difference of ${shown(Math.abs(sqftGap))} sqft (tolerance ${PO_TOTAL_SQFT_TOLERANCE_SQFT}). Nothing was imported.`,
      );
    }

    const pieceGap = table.stated.totalPieces - totals.totalPieces;
    if (pieceGap !== 0) {
      errors.push(
        `Table totals row disagrees with the piece rows: it says ${group(table.stated.totalPieces, 0)} pieces, ` +
        `but the rows add up to ${group(totals.totalPieces, 0)} — ` +
        `${group(Math.abs(pieceGap), 0)} piece${Math.abs(pieceGap) === 1 ? "" : "s"} ` +
        `${pieceGap > 0 ? "missing" : "too many"}. Nothing was imported.`,
      );
    }
  }

  return { ok: errors.length === 0, rows, skippedZeroQtyRows, totals, stated: table.stated, errors, warnings };
}
