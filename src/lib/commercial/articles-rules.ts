// The customer's ARTICLE — a design at one size, with the customer's own item
// code, description and EAN-13 — and the two labels that print off it
// (round three, answer 4). PURE: no Prisma, no Next, no React, so `node --test`
// loads it bare and the routes, the PDF and the screen all run the same rule.
//
// WHY THE ARTICLE IS ITS OWN THING. The owner's crate label reads
//
//     CQBE 101x19.5x2
//     WINDOW SILLS 101x19.5x2
//     BARCODE: 8720847172228
//     QUANTITY: 35
//     SHIPPING DATE: 07-09-2026
//
// and the barcode on it belongs to the CUSTOMER'S ARTICLE, not to our slab and
// not to our piece: twelve distinct articles for one design in the file he
// sent, one per size. So the code, the description and the EAN are held per
// (client, design, size) and every crate of that article prints the same
// barcode — which is also why two customers may sell one design at one size
// under different codes without either of them being wrong.
//
// TWO THINGS IN HIS FILE ARE FOR THE CUSTOMER, NOT FOR US TO COPY
// (DECISIONS-3.md 4): `220x19.5x2` and `220x15x2` carry the SAME EAN, and
// `126x25x2` reads `'8720847172297` with Excel's text prefix. The prefix is
// stripped (barcode.normaliseEan); the duplicate is NOT silently merged — the
// unique key is the size, so both rows exist and the desk can see them.
//
// ROUND FOUR, ANSWER 2 OVERTURNED THE SECOND HALF OF THAT. The EAN is now
// unique across the table, so the two rows can no longer both carry
// 8720847172266: the losing row keeps its size and its item code and loses the
// CODE, with `eanBlockedReason` saying which article took it. Everything that
// follows from that — what a save stores, what stops a client's labels, and
// where a new code comes from — is at the bottom of this file, over
// lib/commercial/barcode.ts's arithmetic.
import {
  describeEan, normaliseEan, isValidEan13,
  findEanCollisions, allocateEan13, edgeLabelLayout,
  ean13ModuleMm, ean13WidthMm, isEan13Magnification,
  EAN13_BAR_HEIGHT_MM, EAN13_MAGNIFICATION_MIN, EAN13_MAGNIFICATION_MAX,
  type EdgeLabel, type EdgeLabelResult,
} from "./barcode.ts";
import { DEFAULT_SETTINGS, type EdgeLabelSettings } from "./settings-defaults.ts";

// ───────────────────────────── the row ──────────────────────────────────────

export interface ArticleValues {
  /** null = ours, and it answers for any customer who has no row of their own. */
  clientId: string | null;
  design: string;
  lengthCm: number;
  widthCm: number;
  thicknessCm: number;
  itemCode: string | null;
  description: string | null;
  ean: string | null;
  notes: string | null;
}

export interface ArticleRow extends ArticleValues {
  id: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const trimOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

/** A size in centimetres, to the two decimals the column stores. */
function sizeNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

const SIZE_FIELDS: ReadonlyArray<[keyof ArticleValues, string]> = [
  ["lengthCm", "length"], ["widthCm", "width"], ["thicknessCm", "thickness"],
];

/**
 * Validate one row as typed. Every message names the field, because this form
 * is filled from a customer's spreadsheet with twelve rows on it and "invalid"
 * would mean re-reading all twelve.
 *
 * The EAN is judged by describeEan, so a mistyped digit is refused HERE with
 * the digit named rather than at the database's CHECK constraint (which can
 * only say the shape is wrong) or at the customer's gate.
 */
export function validateArticle(body: Record<string, unknown>): Parsed<ArticleValues> {
  const design = trimOrNull(body.design);
  if (!design) return { ok: false, reason: "Which design is this article? The design is half of its key." };

  const sizes: Record<string, number> = {};
  for (const [key, word] of SIZE_FIELDS) {
    const n = sizeNumber(body[key as string]);
    if (n === null) return { ok: false, reason: `Give the ${word} in centimetres — it is part of the article's key.` };
    if (n <= 0) return { ok: false, reason: `The ${word} has to be more than zero centimetres.` };
    sizes[key as string] = n;
  }

  const verdict = describeEan(body.ean);
  if (!verdict.ok) return { ok: false, reason: verdict.message ?? "That barcode is not an EAN-13." };

  return {
    ok: true,
    value: {
      clientId: trimOrNull(body.clientId),
      design,
      lengthCm: sizes.lengthCm,
      widthCm: sizes.widthCm,
      thicknessCm: sizes.thicknessCm,
      itemCode: trimOrNull(body.itemCode),
      description: trimOrNull(body.description),
      ean: verdict.value,
      notes: trimOrNull(body.notes),
    },
  };
}

export interface ArticleKey {
  clientId?: string | null;
  design: string;
  lengthCm: number | null;
  widthCm: number | null;
  thicknessCm: number | null;
}

const key2 = (n: number | null | undefined): number | null =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 100) / 100;

const sameDesign = (a: string | null | undefined, b: string | null | undefined): boolean =>
  String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

const sameSize = (a: ArticleKey, b: ArticleKey): boolean =>
  key2(a.lengthCm) !== null && key2(a.lengthCm) === key2(b.lengthCm)
  && key2(a.widthCm) === key2(b.widthCm)
  && key2(a.thicknessCm) === key2(b.thicknessCm);

/**
 * The unique key as the database spells it (scripts/0081's
 * `commercial_customer_article_key`, on COALESCE(client_id, '')). Used to find
 * a clash before the insert so the answer is a sentence and a 409 rather than
 * a constraint name.
 */
export function articleKeyOf(a: ArticleKey): string {
  return [
    (a.clientId ?? "").trim(),
    String(a.design ?? "").trim().toLowerCase(),
    key2(a.lengthCm), key2(a.widthCm), key2(a.thicknessCm),
  ].join("|");
}

/**
 * The article to print for one design at one size.
 *
 * THE CLIENT'S OWN ROW FIRST, THE CLIENT-LESS ROW SECOND (answer 4). The EAN
 * is the CUSTOMER'S, so a row keyed to this customer always wins; a row with no
 * client is ours and stands in for a customer who has not sent their own codes
 * yet. A row belonging to a DIFFERENT customer is never used — printing one
 * customer's barcode on another's crate is exactly the error this table exists
 * to prevent.
 */
export function articleFor<T extends ArticleKey>(articles: ReadonlyArray<T>, want: ArticleKey): T | null {
  const rows = (articles ?? []).filter((a) => a && sameDesign(a.design, want.design) && sameSize(a, want));
  if (!rows.length) return null;
  const clientId = (want.clientId ?? "").trim();
  if (clientId) {
    const own = rows.find((a) => (a.clientId ?? "").trim() === clientId);
    if (own) return own;
  }
  return rows.find((a) => !(a.clientId ?? "").trim()) ?? null;
}

// ───────────────────────────── the labels ────────────────────────────────────

/** 101, 19.5, 2 → "101x19.5x2", the way his file writes a size. Trailing
 *  zeros go: the sheet reads 19.5 and 2, never 19.50 and 2.00. */
export function sizeLabel(lengthCm: number | null, widthCm: number | null, thicknessCm: number | null, sep = "x"): string {
  const one = (n: number | null): string => {
    const v = key2(n);
    if (v === null) return "?";
    return String(v);
  };
  return [one(lengthCm), one(widthCm), one(thicknessCm)].join(sep);
}

const squash = (s: string): string => s.toLowerCase().replace(/[\s×*]/g, "");

/**
 * "CQBE" + "101x19.5x2" → "CQBE 101x19.5x2", but "CQBE 101x19.5x2" is left
 * alone.
 *
 * WHY BOTH. DECISIONS-3 annotates the first line as "item code + size in CM"
 * while scripts/0081 stores the item code AS `CQBE 101x19.5x2` — size
 * included. Both readings print the same line and neither prints the size
 * twice, so the label does not depend on which way a row was typed.
 */
export function withSize(text: string | null, size: string): string {
  const t = (text ?? "").trim();
  if (!t) return size;
  return squash(t).includes(squash(size)) ? t : `${t} ${size}`;
}

/** 2026-09-07 → "07-09-2026", the way the crate label prints it. */
export function ddmmyyyy(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/**
 * The shipping date the crate label prints, off the packing list.
 *
 * The list has no "shipping date" column: what it has is the day it left
 * (dispatchedAt), failing that the day it was finalised for stuffing, failing
 * that the invoice it travels with, failing that the day it was raised. Labels
 * are stuck on before the container goes, so in practice this is the finalised
 * date — and it is never blank, which matters on a label a person reads.
 */
export function shippingDateOf(list: {
  dispatchedAt?: string | Date | null;
  finalisedAt?: string | Date | null;
  invoiceDate?: string | Date | null;
  createdAt?: string | Date | null;
}): string {
  return ddmmyyyy(list.dispatchedAt ?? list.finalisedAt ?? list.invoiceDate ?? list.createdAt ?? null);
}

/** Centimetres from a thickness as the slab rows spell it: "2 cm", "20mm",
 *  "2", "30". Bare numbers of ten and over are millimetres, the same reading
 *  lib/thickness.ts takes. */
export function thicknessCmOf(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim().toLowerCase().replace(/\s+/g, "");
  const cm = s.match(/^(\d+(?:\.\d+)?)cm$/);
  if (cm) return key2(Number(cm[1]));
  const mm = s.match(/^(\d+(?:\.\d+)?)mm$/);
  if (mm) return key2(Number(mm[1]) / 10);
  const plain = s.match(/^(\d+(?:\.\d+)?)$/);
  if (plain) { const n = Number(plain[1]); return key2(n >= 10 ? n / 10 : n); }
  return null;
}

/** A cut-to-size line as commercial_packed_piece stores it — MILLIMETRES
 *  (answer 5), converted here because the article is in centimetres. */
export interface LabelPiece {
  crateId?: string | null;
  crateNo?: string | number | null;
  design: string;
  lengthMm?: number | null;
  widthMm?: number | null;
  thicknessMm?: number | null;
  quantity?: number | null;
}

/** A packed slab, for a list that packs slabs rather than pieces. */
export interface LabelSlab {
  crateId?: string | null;
  design?: string | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  thickness?: string | null;
}

export interface LabelCrate {
  id: string;
  crateNo: number;
}

export interface LabelsInput {
  clientId?: string | null;
  crates: ReadonlyArray<LabelCrate>;
  pieces?: ReadonlyArray<LabelPiece>;
  slabs?: ReadonlyArray<LabelSlab>;
  articles: ReadonlyArray<ArticleRow | (ArticleKey & Partial<ArticleValues>)>;
  list: { dispatchedAt?: string | Date | null; finalisedAt?: string | Date | null; invoiceDate?: string | Date | null; createdAt?: string | Date | null };
}

/** One (design, size) group inside one crate — what a single label describes. */
interface Group {
  crateKey: string;
  crateNo: string;
  design: string;
  lengthCm: number | null;
  widthCm: number | null;
  thicknessCm: number | null;
  quantity: number;
}

const groupKey = (g: { crateKey: string; design: string; lengthCm: number | null; widthCm: number | null; thicknessCm: number | null }): string =>
  [g.crateKey, g.design.trim().toLowerCase(), g.lengthCm, g.widthCm, g.thicknessCm].join("|");

/**
 * Everything on the list, gathered per crate and per article.
 *
 * ONE LABEL PER CRATE is what the owner's file shows, and a crate of one
 * design at one size gets exactly one here. A crate holding two sizes gets two
 * — one barcode cannot describe both, and printing the first size's code over
 * the whole crate is how the wrong article reaches the customer's scanner.
 */
function groupsOf(input: LabelsInput): Group[] {
  const crateNoById = new Map<string, string>();
  for (const c of input.crates ?? []) crateNoById.set(c.id, String(c.crateNo));

  const out: Group[] = [];
  const index = new Map<string, Group>();
  const add = (g: Omit<Group, "quantity">, qty: number): void => {
    const k = groupKey(g);
    const seen = index.get(k);
    if (seen) { seen.quantity += qty; return; }
    const row: Group = { ...g, quantity: qty };
    index.set(k, row);
    out.push(row);
  };

  for (const p of input.pieces ?? []) {
    const crateKey = p.crateId ?? (p.crateNo != null ? `no:${p.crateNo}` : "");
    add({
      crateKey,
      crateNo: (p.crateId ? crateNoById.get(p.crateId) : null) ?? (p.crateNo != null ? String(p.crateNo) : ""),
      design: String(p.design ?? "").trim(),
      lengthCm: key2(p.lengthMm == null ? null : Number(p.lengthMm) / 10),
      widthCm: key2(p.widthMm == null ? null : Number(p.widthMm) / 10),
      thicknessCm: key2(p.thicknessMm == null ? null : Number(p.thicknessMm) / 10),
    }, Math.max(1, Math.round(Number(p.quantity ?? 1)) || 1));
  }

  for (const s of input.slabs ?? []) {
    const crateKey = s.crateId ?? "";
    add({
      crateKey,
      crateNo: (s.crateId ? crateNoById.get(s.crateId) : null) ?? "",
      design: String(s.design ?? "").trim(),
      lengthCm: key2(s.lengthCm ?? null),
      widthCm: key2(s.widthCm ?? null),
      thicknessCm: thicknessCmOf(s.thickness),
    }, 1);
  }

  // Crate order, as the crates are numbered; an unassigned line sorts last
  // rather than disappearing — it still has to be labelled and packed.
  return out.sort((a, b) => {
    const na = Number(a.crateNo), nb = Number(b.crateNo);
    const ka = Number.isFinite(na) && a.crateNo !== "" ? na : Number.MAX_SAFE_INTEGER;
    const kb = Number.isFinite(nb) && b.crateNo !== "" ? nb : Number.MAX_SAFE_INTEGER;
    return ka - kb;
  });
}

/** The article the list's own row keys resolve to — one lookup, used by the
 *  crate labels, the piece labels and both "what is missing" lists, so the
 *  three can never disagree about which article a line belongs to. */
type FoundArticle = (ArticleKey & Partial<ArticleValues>) | null;

function groupsWithArticles(input: LabelsInput): Array<{ g: Group; art: FoundArticle }> {
  const articles = input.articles as ReadonlyArray<ArticleKey & Partial<ArticleValues>>;
  return groupsOf(input).map((g) => ({
    g,
    art: articleFor(articles, {
      clientId: input.clientId ?? null,
      design: g.design, lengthCm: g.lengthCm, widthCm: g.widthCm, thicknessCm: g.thicknessCm,
    }),
  }));
}

export interface CrateLabel {
  crateNo: string;
  design: string;
  size: string;
  /** The five lines, in the owner's order, with the barcode line dropped when
   *  there is no code to print. */
  lines: string[];
  itemCodeLine: string;
  descriptionLine: string | null;
  ean: string | null;
  quantity: number;
  shippingDate: string;
  /** False when no article is on file: the label prints the design and the
   *  size and NO barcode, and the screen says which lines are missing one. */
  hasArticle: boolean;
  /** The code held on the article that could NOT be drawn — thirteen digits
   *  whose check digit is wrong, or a code of the wrong shape. Null when the
   *  article simply carries no barcode, and null when `ean` is set.
   *
   *  WHY IT IS A SEPARATE FIELD. `ean === null` covers three situations that
   *  send the packer to three different people — no article at all, an article
   *  the customer has not sent a barcode for, and a barcode that was mistyped
   *  — and the label and the screen have to say which. */
  rejectedEan: string | null;
}

/** The crate labels for a packing list, in crate order. */
export function crateLabels(input: LabelsInput): CrateLabel[] {
  const shippingDate = shippingDateOf(input.list ?? {});
  return groupsWithArticles(input).map(({ g, art }) => {
    const size = sizeLabel(g.lengthCm, g.widthCm, g.thicknessCm);
    const onFile = art ? normaliseEan(art.ean) : "";
    const ean = onFile && isValidEan13(onFile) ? onFile : null;
    const rejectedEan = onFile && !ean ? onFile : null;
    const itemCodeLine = art?.itemCode ? withSize(art.itemCode, size) : `${g.design} ${size}`.trim();
    const descriptionLine = art?.description ? withSize(art.description, size) : null;
    const lines = [
      itemCodeLine,
      ...(descriptionLine ? [descriptionLine] : []),
      ...(ean ? [`BARCODE: ${ean}`] : []),
      `QUANTITY: ${g.quantity}`,
      `SHIPPING DATE: ${shippingDate}`,
    ];
    return {
      crateNo: g.crateNo, design: g.design, size, lines,
      itemCodeLine, descriptionLine, ean, quantity: g.quantity, shippingDate,
      hasArticle: Boolean(art), rejectedEan,
    };
  });
}

export interface PieceLabel {
  text: string;
  design: string;
  size: string;
  crateNo: string;
  hasArticle: boolean;
}

/** A run of piece labels is one per PIECE — his DS-Thresholds file is 360 of
 *  them off one line — so a mistyped quantity could ask for a PDF of a hundred
 *  thousand. The run stops here and the caller says so. */
export const PIECE_LABEL_MAX = 2000;

/**
 * The piece labels: the item code and the size alone, repeated once per piece,
 * exactly as `DS - Thresholds (103 x 11) -360 PCS.docx` prints them.
 */
export function pieceLabels(input: LabelsInput): { labels: PieceLabel[]; truncated: number } {
  const out: PieceLabel[] = [];
  let wanted = 0;
  for (const { g, art } of groupsWithArticles(input)) {
    const size = sizeLabel(g.lengthCm, g.widthCm, g.thicknessCm);
    const text = art?.itemCode ? withSize(art.itemCode, size) : `${g.design} ${size}`.trim();
    wanted += g.quantity;
    for (let i = 0; i < g.quantity && out.length < PIECE_LABEL_MAX; i++) {
      out.push({ text, design: g.design, size, crateNo: g.crateNo, hasArticle: Boolean(art) });
    }
  }
  return { labels: out, truncated: Math.max(0, wanted - out.length) };
}

export interface MissingArticle {
  design: string;
  size: string;
  crateNos: string[];
  quantity: number;
}

/** A line whose article IS on file but whose barcode is not usable. */
export interface MissingBarcode extends MissingArticle {
  /** The customer's item code for the row that needs the barcode, so the desk
   *  can find it in the list without matching the size by eye. */
  itemCode: string | null;
  /** The unusable code as it stands on the article, or null when the article
   *  carries no barcode at all — the difference between "chase the customer"
   *  and "somebody mistyped a digit". */
  rejectedEan: string | null;
}

/** Roll a group into a (design, size) bucket, merging the crate numbers and
 *  the quantity when the same pair turns up in a second crate. */
function bucket<T extends MissingArticle>(byKey: Map<string, T>, g: Group, size: string, make: () => T): void {
  const k = `${g.design.trim().toLowerCase()}|${size}`;
  const seen = byKey.get(k);
  if (seen) {
    seen.quantity += g.quantity;
    if (g.crateNo && !seen.crateNos.includes(g.crateNo)) seen.crateNos.push(g.crateNo);
    return;
  }
  byKey.set(k, make());
}

/**
 * The (design, size) pairs on this list with no article on file — what the
 * screen shows INSTEAD of quietly printing a blank label. A crate label with
 * no barcode is a label somebody has to chase; it is better named on the screen
 * than discovered on the pallet.
 */
export function missingArticles(input: LabelsInput): MissingArticle[] {
  const byKey = new Map<string, MissingArticle>();
  for (const { g, art } of groupsWithArticles(input)) {
    if (art) continue;
    const size = sizeLabel(g.lengthCm, g.widthCm, g.thicknessCm);
    bucket(byKey, g, size, () => ({
      design: g.design, size, crateNos: g.crateNo ? [g.crateNo] : [], quantity: g.quantity,
    }));
  }
  return Array.from(byKey.values());
}

/**
 * The pairs whose article EXISTS but whose crates still print without bars.
 *
 * WHY THIS IS A SECOND LIST AND NOT PART OF THE FIRST. missingArticles asks
 * "is there a row?"; an article entered with the item code and the description
 * while the customer's barcode is still to come answers yes, so the panel used
 * to say nothing at all about it — and the label said "no article on file",
 * contradicting the item code printed two lines above. These are the rows to
 * chase the CUSTOMER for (or, when rejectedEan is set, the digit somebody
 * mistyped), not rows to add.
 */
export function missingBarcodes(input: LabelsInput): MissingBarcode[] {
  const byKey = new Map<string, MissingBarcode>();
  for (const { g, art } of groupsWithArticles(input)) {
    if (!art) continue;
    const onFile = normaliseEan(art.ean);
    if (onFile && isValidEan13(onFile)) continue;
    const size = sizeLabel(g.lengthCm, g.widthCm, g.thicknessCm);
    bucket(byKey, g, size, () => ({
      design: g.design, size, crateNos: g.crateNo ? [g.crateNo] : [], quantity: g.quantity,
      itemCode: art.itemCode ?? null,
      rejectedEan: onFile ? onFile : null,
    }));
  }
  return Array.from(byKey.values());
}

/** The three kinds the label route serves. `edge` is round four, answer 3:
 *  the barcode pasted on the 2 cm edge of the piece itself. */
export const LABEL_KINDS = ["crate", "piece", "edge"] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

export function parseLabelKind(v: unknown): LabelKind | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (LABEL_KINDS as readonly string[]).includes(s) ? (s as LabelKind) : null;
}

// ─────────── one barcode, one article (round four, answer 2) ─────────────────
// "Do not let duplicate barcodes be entered. If something is already there in
// the data flag it and don't generate barcodes till it's fixed."
//
// Three rules come out of that sentence and they are all here, because the
// entry form, the allocator and the label printer have to say the same thing
// in the same words — the moment the condition is written twice, one of the
// copies is the one somebody forgets to change.
//
//   claimEan          what a save stores when the code is already somebody's:
//                     the row, without the code, with the sentence.
//   barcodeBlockFor   whether this client's barcodes may be made or printed
//                     at all. One helper, read by the allocate route AND by
//                     the labels route.
//   planEanAllocation which blank articles get which code, in order, from the
//                     client's own GS1 series.

/** Where a code came from. CUSTOMER is off their own file and is never
 *  overwritten; GENERATED came out of our allocator under their prefix. */
export const EAN_SOURCES = ["CUSTOMER", "GENERATED"] as const;
export type EanSource = (typeof EAN_SOURCES)[number];

export function parseEanSource(v: unknown): EanSource | null {
  const s = String(v ?? "").trim().toUpperCase();
  return (EAN_SOURCES as readonly string[]).includes(s) ? (s as EanSource) : null;
}

/**
 * The source that belongs to a code, given what the row already held.
 *
 * ONE CONDITION, TWO CALLERS: claimEan below, which decides what the save
 * routes store, and the entry form, which has to decide what to claim in the
 * body it sends. Asked twice it would one day be answered twice differently,
 * and the answer decides both the badge the row wears and the sentence the
 * allocator prints about whose code it is refusing to touch.
 *
 * A code is the customer's because somebody typed it off their sheet. It is not
 * the customer's merely because it was in the form when the form was submitted:
 * an edit re-sends whatever the row already carried, codes our own allocator
 * minted included. So a code that is the one already stored keeps the source
 * already stored with it, and only a code that is NEW to the row is the saver's
 * to speak for.
 */
export function eanSourceForSave(input: {
  /** The code being stored. */
  ean: unknown;
  /** What the row held before this save — its code and the source recorded
   *  against it. Absent on a create, which has no earlier code to have come
   *  from anywhere. */
  prior?: { ean?: unknown; source?: unknown } | null;
  /** What the saver says about a code that is new to the row. */
  claimed?: unknown;
}): EanSource | null {
  const code = normaliseEan(input.ean);
  if (!code) return null;
  const recorded = normaliseEan(input.prior?.ean) === code ? parseEanSource(input.prior?.source) : null;
  return recorded ?? parseEanSource(input.claimed) ?? "CUSTOMER";
}

/** What a row is CALLED in the sentences below. */
export interface ArticleNameable {
  design?: string | null;
  itemCode?: string | null;
  lengthCm?: number | null;
  widthCm?: number | null;
  thicknessCm?: number | null;
}

/**
 * The name a refusal uses for an article.
 *
 * The customer's item code first, because it is what the desk searches by and
 * it already carries the size (`CQBE 220x19.5x2`). Failing that, the design and
 * the size — his collision is between two SIZES of one design, so a name
 * without the size would print "Desert Silk is on both Desert Silk and Desert
 * Silk" and tell nobody which row to open.
 */
export function articleName(a: ArticleNameable): string {
  const known = [a.lengthCm, a.widthCm, a.thicknessCm].some((n) => n !== null && n !== undefined && Number.isFinite(Number(n)));
  // A row whose size is not to hand — a lookup that selected the code alone —
  // is named by what it has. `CQBE ?x?x?` reads as a corrupt row rather than
  // as a missing column, and this name is shown to somebody being told their
  // save was refused, which is the wrong moment to introduce a mystery.
  const size = known ? sizeLabel(a.lengthCm ?? null, a.widthCm ?? null, a.thicknessCm ?? null) : "";
  const code = (a.itemCode ?? "").trim();
  if (code) return size ? withSize(code, size) : code;
  const design = (a.design ?? "").trim();
  if (!design) return size || "an article with no code or design on it";
  return size ? `${design} ${size}` : design;
}

/** The article that already holds a code, as the database found it. */
export interface EanOwner {
  id: string;
  /** articleName of that row — what the sentence calls it. */
  label: string;
}

export interface EanClaim {
  /** What to write to `ean`: the tidied code, or null when it could not be
   *  taken. */
  ean: string | null;
  eanSource: EanSource | null;
  /** What to write to `eanBlockedReason`. */
  eanBlockedReason: string | null;
  /** True when a code was offered and REFUSED because another article owns it
   *  — the difference between "this row has no barcode" and "this row lost
   *  one", which is the difference between an ordinary article and a client
   *  whose labels are stopped. */
  refused: boolean;
  /** The sentence to show whoever typed it; null when there is nothing to
   *  say. */
  message: string | null;
}

export interface EanClaimInput {
  /** The code as typed, already through validateArticle (so it is either a
   *  good EAN-13 or blank). */
  ean: string | null;
  /** CUSTOMER unless our own allocator is writing. */
  source?: EanSource;
  /** The row being saved, for the sentence. `id` is absent on a new row. */
  self: ArticleNameable & { id?: string | null };
  /** The row that already holds this code, or null when nobody does. */
  owner?: EanOwner | null;
  /** What this row already stores — the code it holds and the source recorded
   *  against it — so a save that leaves the code alone cannot relabel where it
   *  came from. Absent on a create, which has no earlier code to have a
   *  provenance. */
  prior?: { ean?: unknown; source?: unknown } | null;
  /** The reason already stored on this row, so an ordinary edit does not
   *  quietly clear a block nobody has settled. */
  blockedReason?: string | null;
  /** "This is settled" — the one deliberate way a block goes away without a
   *  code being taken. */
  clearBlock?: boolean;
}

/**
 * What a save stores for the code, once it is known who else holds it.
 *
 * THE ROW IS STORED EITHER WAY. Answer 2 refuses the DUPLICATE, not the
 * article: "the losing row must still be storable, without a code and saying
 * why it has none". So a refusal here is a complete set of column values —
 * no code, no source, the sentence in eanBlockedReason — and the caller
 * chooses whether to hand it to the person first (the entry form does, with a
 * 409, because somebody is sitting there who can correct the digit) or to
 * store it straight away (an import has nobody to ask).
 *
 * THE SENTENCE COMES OFF findEanCollisions and not out of this function, so
 * the form, the allocator and the label screen say the same words about the
 * same pair. It names both articles because either one of them may be the
 * mistake — his 220x19.5x2 and 220x15x2 have one code between them and
 * nothing in the data says which of the two is right.
 *
 * A code that IS taken clears the block: the row now has a barcode, and there
 * is nothing left for the labels to wait for. A blank save leaves the block
 * where it was, because "I edited the notes" is not "we settled it with the
 * customer"; clearBlock is how somebody says the second thing.
 *
 * THE SOURCE BELONGS TO THE CODE AND NOT TO THE SAVE. Answer 2 gives eanSource
 * one job, "whether a code came off their file or out of our allocator", and a
 * save that leaves the code untouched has learned nothing new about where it
 * came from. So when the code claimed is the one the row already holds, the
 * source stored against it wins and `source` is ignored; `source` decides only
 * for a code that is new to this row, which is a code somebody has just typed
 * or the allocator has just minted. Without that, editing the description of an
 * article we allocated relabels it CUSTOMER — every entry form sends CUSTOMER,
 * because that is what a code typed into a form is — and the allocator's skip
 * line then says the customer's own file sent us a code we minted ourselves.
 */
export function claimEan(input: EanClaimInput): EanClaim {
  const code = normaliseEan(input.ean);
  const selfId = String(input.self?.id ?? "").trim();
  const owner = input.owner && String(input.owner.id ?? "").trim() !== selfId ? input.owner : null;

  if (code && owner) {
    const [collision] = findEanCollisions([
      { id: owner.id, ean: code, label: owner.label },
      { id: selfId || "new", ean: code, label: articleName(input.self ?? {}) },
    ]);
    const message = collision?.message
      ?? `${code} is already on ${owner.label}. One of them has to give it up before any barcode for this client is generated or printed.`;
    return { ean: null, eanSource: null, eanBlockedReason: message, refused: true, message };
  }

  if (code) {
    return {
      ean: code,
      eanSource: eanSourceForSave({ ean: code, prior: input.prior, claimed: input.source }),
      eanBlockedReason: null,
      refused: false,
      message: null,
    };
  }

  const kept = input.clearBlock ? null : (input.blockedReason ?? null);
  return { ean: null, eanSource: null, eanBlockedReason: kept, refused: false, message: null };
}

/** An article as the block question sees it: does it hold a code, and did it
 *  lose one? */
export interface BlockableArticle {
  id: string;
  label?: string | null;
  ean?: unknown;
  eanBlockedReason?: string | null;
}

export interface BarcodeBlock {
  blocked: boolean;
  /** One line per stopped article, for a screen that lists them. */
  articles: Array<{ id: string; label: string; reason: string }>;
  /** Every sentence, joined — what the allocate route and the labels route
   *  both refuse with. Null when nothing is blocked. */
  message: string | null;
}

/**
 * May this client's barcodes be generated and printed?
 *
 * THE OWNER'S WHOLE SENTENCE WAS "if something is already there in the data
 * flag it and don't generate barcodes till its fixed", and this is the second
 * half of it. While any article of a client carries a blocked reason, NOTHING
 * of that client's is allocated and no crate of theirs is labelled — because a
 * duplicate means two articles are wearing one identity, and every barcode
 * printed in the meantime is a guess about which of them the scanner will be
 * read against. Half a right answer at the customer's gate is a container
 * turned away.
 *
 * IT ALSO LOOKS FOR A LIVE COLLISION and not only for the stored sentence.
 * scripts/0082's unique index means two rows cannot hold one code today, so
 * that arm finds nothing — but the index is the only thing standing between us
 * and the state this rule exists for, and the day a bulk load goes in with the
 * index dropped for speed, printing has to stop rather than print two crates
 * the same. It costs one pass over rows the caller has already fetched.
 */
export function barcodeBlockFor(rows: Iterable<BlockableArticle>): BarcodeBlock {
  const all = Array.from(rows ?? []);
  const out: Array<{ id: string; label: string; reason: string }> = [];
  const seen = new Set<string>();

  const add = (id: string, label: string, reason: string): void => {
    const k = `${id}|${reason}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ id, label, reason });
  };

  for (const r of all) {
    const reason = (r?.eanBlockedReason ?? "").trim();
    if (reason) add(String(r.id), (r.label ?? "").trim() || String(r.id), reason);
  }

  for (const c of findEanCollisions(all.map((r) => ({ id: String(r.id), ean: r.ean, label: r.label ?? null })))) {
    for (const row of c.rows) add(String(row.id), (row.label ?? "").trim() || String(row.id), c.message);
  }

  if (!out.length) return { blocked: false, articles: [], message: null };

  const sentences: string[] = [];
  for (const a of out) if (!sentences.includes(a.reason)) sentences.push(a.reason);
  return {
    blocked: true,
    articles: out,
    message: `This customer's barcodes are stopped until a duplicate is settled. ${sentences.join(" ")}`,
  };
}

/** An article the allocator may or may not fill. */
export interface AllocatableArticle extends BlockableArticle, ArticleNameable {
  id: string;
  eanSource?: string | null;
}

export interface PlannedAllocation {
  id: string;
  label: string;
  ean: string;
  ref: number;
}

export interface SkippedAllocation {
  id: string;
  label: string;
  reason: string;
}

export interface AllocationPlan {
  ok: boolean;
  allocations: PlannedAllocation[];
  skipped: SkippedAllocation[];
  /** What to store back in commercial_client_barcode.nextRef. Null when
   *  nothing was allocated, so the floor is left exactly where it was. */
  nextFloor: number | null;
  /** Why nothing (or nothing more) could be allocated. */
  message: string | null;
}

export interface AllocationPlanInput {
  /** commercial_client_barcode.gs1Prefix — the CUSTOMER'S own. */
  prefix: unknown;
  /** commercial_client_barcode.nextRef, a floor. */
  floor?: number | bigint | string | null;
  /** EVERY article of this client: the block is asked of all of them, not
   *  only of the ones being filled. */
  rows: ReadonlyArray<AllocatableArticle>;
  /** The articles to fill; every blank one when absent. */
  ids?: ReadonlyArray<string> | null;
  /** Codes held anywhere else in the table — every row whose EAN starts with
   *  this prefix, whoever it belongs to. The unique index is global, so a code
   *  spent under this prefix by another client's row would collide just as
   *  hard as one of this client's. */
  otherEans?: Iterable<unknown> | null;
}

/**
 * Which blank articles get which code.
 *
 * IT NEVER OVERWRITES A CODE, and it says which kind it is refusing to touch.
 * A CUSTOMER code is theirs — regenerating it would print a barcode their own
 * system has never heard of on a crate going to their gate — and a GENERATED
 * one is already on a label somewhere. Only a blank article is filled, which is
 * the whole of `eanSource`'s reason for existing.
 *
 * IT STOPS AT THE FIRST REFUSAL rather than carrying on down the list. The two
 * things that make allocateEan13 refuse — no usable prefix, and a series that
 * has run out of references — are properties of the CLIENT and not of the
 * article, so every call after the first would fail in the same words; a bulk
 * run over forty blank articles would otherwise answer with forty copies of one
 * sentence. What was allocated before the refusal still stands and is returned,
 * because a run that filled thirty and then hit the end of the series has done
 * thirty articles' worth of real work.
 *
 * The floor walks forward through the run (allocateEan13's nextFloor), so a
 * bulk allocation does not have to re-read the table between articles and two
 * articles in one run cannot be handed the same reference.
 */
export function planEanAllocation(input: AllocationPlanInput): AllocationPlan {
  const rows = input.rows ?? [];
  const block = barcodeBlockFor(rows);
  if (block.blocked) {
    return { ok: false, allocations: [], skipped: [], nextFloor: null, message: block.message };
  }

  const wanted = input.ids && input.ids.length
    ? new Set(input.ids.map((id) => String(id)))
    : null;
  const candidates = wanted ? rows.filter((r) => wanted.has(String(r.id))) : rows.slice();

  const inUse: unknown[] = [
    ...rows.map((r) => r.ean),
    ...Array.from(input.otherEans ?? []),
  ];

  const allocations: PlannedAllocation[] = [];
  const skipped: SkippedAllocation[] = [];
  let floor: number | bigint | string | null | undefined = input.floor;
  let nextFloor: number | null = null;
  let message: string | null = null;

  for (const row of candidates) {
    const label = (row.label ?? "").trim() || articleName(row);
    const held = normaliseEan(row.ean);
    if (held) {
      const source = parseEanSource(row.eanSource);
      skipped.push({
        id: String(row.id),
        label,
        reason: source === "CUSTOMER"
          ? `${label} already carries ${held}, which came off the customer's own file — their codes are never overwritten.`
          : `${label} already carries ${held}.`,
      });
      continue;
    }

    const got = allocateEan13({ prefix: input.prefix, inUse, floor });
    if (!got.ok || got.ean === null || got.ref === null) {
      message = got.message;
      break;
    }
    allocations.push({ id: String(row.id), label, ean: got.ean, ref: got.ref });
    inUse.push(got.ean);
    floor = got.nextFloor;
    nextFloor = got.nextFloor;
  }

  if (!allocations.length && !message) {
    message = candidates.length
      ? "Every article picked already has a barcode, so there is nothing to generate."
      // Two empty runs that look the same and are not: a customer whose
      // articles all have codes, and an article named by an id that is not
      // this customer's — a row deleted while the screen was open, or a screen
      // showing one customer and a button pressed against another's row.
      : wanted
        ? "None of the articles asked for belong to this customer's series."
        : "There is no article without a barcode to generate one for.";
  }

  return { ok: allocations.length > 0, allocations, skipped, nextFloor, message };
}

// ────────── the label on the edge of the piece (round four, answer 3) ────────
// "We have to paste it on a 2cm slab so lower than 2cm width. Length can be
// anything proportional." The geometry of that label — how much bar height a
// given thickness leaves once the clearance, the margins and the digits are
// taken off — is barcode.edgeLabelLayout, which is pure and pinned by its own
// tests. What is here is the part that belongs to the MODULE rather than to the
// symbol: the owner's four tunables, and one edge label per piece off a packing
// list.

/** The tunables as they ship — DEFAULT_SETTINGS.labels.edge, which is itself
 *  built from barcode.ts's own constants so the two cannot drift apart. */
export const EDGE_LABEL_DEFAULTS: EdgeLabelSettings = DEFAULT_SETTINGS.labels.edge;

const sameGeometry = (e: EdgeLabelSettings): boolean =>
  e.clearanceMm === EDGE_LABEL_DEFAULTS.clearanceMm
  && e.marginMm === EDGE_LABEL_DEFAULTS.marginMm
  && e.digitsMm === EDGE_LABEL_DEFAULTS.digitsMm
  && e.minBarMm === EDGE_LABEL_DEFAULTS.minBarMm;

/** Millimetres to the thousandth, as barcode.ts rounds them: these sums run
 *  through floating point and 18 mm arrives as 17.999999999999996. */
const mm3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * The edge label for a piece of a given thickness, under the owner's settings.
 *
 * WHY THIS IS NOT SIMPLY edgeLabelLayout. That function takes the magnification
 * and holds the other three measurements as constants, which is right for a
 * pure module pinned by tests and wrong for a shop floor: the clearance a label
 * needs off the arris depends on who is pasting it and on the stock, and
 * nobody should need a deploy to move it by half a millimetre. So the four
 * numbers live in settings (labels.edge) and this is the one place that reads
 * them.
 *
 * AS LONG AS THEY STAND AT THEIR DEFAULTS — which is every install until
 * somebody changes one — the answer IS edgeLabelLayout's, returned from it
 * verbatim rather than recomputed to match. The arithmetic below runs only for
 * an install that has moved a knob edgeLabelLayout does not take, and it is the
 * same four-term sum: thickness, less the clearance, less both margins, less
 * the digit band, is what is left for the bars.
 */
export function edgeLabelFor(
  thicknessMm: unknown,
  edge: EdgeLabelSettings = EDGE_LABEL_DEFAULTS,
): EdgeLabelResult {
  const e = edge ?? EDGE_LABEL_DEFAULTS;
  if (sameGeometry(e)) return edgeLabelLayout(thicknessMm, e.magnification);

  const t = Number(thicknessMm);
  if (!Number.isFinite(t) || t <= 0) {
    return {
      ok: false, label: null,
      reason: "Give the thickness of the piece in millimetres — the label is pasted on its edge, so the edge is what decides the label.",
    };
  }
  if (!isEan13Magnification(e.magnification)) {
    return {
      ok: false, label: null,
      reason: `An EAN-13 is only specified between magnification ${EAN13_MAGNIFICATION_MIN} and ${EAN13_MAGNIFICATION_MAX}, and ${e.magnification} is outside that — a scanner may refuse to acquire it at all.`,
    };
  }

  const m = Number(e.magnification);
  const fullBar = EAN13_BAR_HEIGHT_MM * m;
  const room = t - e.clearanceMm - 2 * e.marginMm - e.digitsMm;
  const bar = Math.min(room, fullBar);

  if (bar < e.minBarMm) {
    const left = room > 0 ? `${mm3(room)} mm` : "nothing at all";
    return {
      ok: false, label: null,
      reason: `A ${mm3(t)} mm edge leaves ${left} for the bars once the label's clearance, margins and digits are taken off, and under ${e.minBarMm} mm of bars an EAN-13 scans as nothing — print this one's barcode on the crate label instead of the edge.`,
    };
  }

  return {
    ok: true,
    reason: null,
    label: {
      thicknessMm: mm3(t),
      magnification: m,
      moduleMm: mm3(ean13ModuleMm(m)),
      heightMm: mm3(bar + e.digitsMm + 2 * e.marginMm),
      lengthMm: mm3(ean13WidthMm(m) + 2 * e.marginMm),
      marginMm: e.marginMm,
      barHeightMm: mm3(bar),
      digitsHeightMm: e.digitsMm,
      symbolWidthMm: mm3(ean13WidthMm(m)),
      fullBarHeightMm: mm3(fullBar),
      truncated: bar < fullBar - 1e-9,
      truncatedByMm: mm3(Math.max(0, fullBar - bar)),
      percentOfNominalHeight: Math.round((bar / EAN13_BAR_HEIGHT_MM) * 100),
    },
  };
}

export interface EdgeLabelRow {
  crateNo: string;
  design: string;
  size: string;
  /** The item code and the size, the same line the piece label carries — the
   *  one thing a person can read when the bars will not scan. */
  text: string;
  ean: string;
  layout: EdgeLabel;
}

/** A (design, size) whose pieces get NO edge label, and why. */
export interface EdgeLabelSkip extends MissingArticle {
  reason: string;
}

/**
 * One edge label per PIECE, like the piece labels — the label goes on the
 * stone, not on the crate, so a crate of thirty-five needs thirty-five.
 *
 * A LINE WITH NO READABLE CODE IS SKIPPED, NOT PRINTED BLANK. The crate label
 * without a barcode is still a useful label: it carries the item code, the
 * quantity and the shipping date, and a person reads it. An edge label is
 * nothing BUT the barcode and a line of digits, so one printed without bars is
 * a sticker that says nothing, pasted on a finished piece somebody then has to
 * scrape off. The reasons come back beside the labels so the screen can name
 * every piece that needs its code chased before the run is printed.
 */
export function edgeLabels(
  input: LabelsInput,
  edge: EdgeLabelSettings = EDGE_LABEL_DEFAULTS,
): { labels: EdgeLabelRow[]; truncated: number; skipped: EdgeLabelSkip[] } {
  const out: EdgeLabelRow[] = [];
  const skipped = new Map<string, EdgeLabelSkip>();
  let wanted = 0;

  for (const { g, art } of groupsWithArticles(input)) {
    const size = sizeLabel(g.lengthCm, g.widthCm, g.thicknessCm);
    const text = art?.itemCode ? withSize(art.itemCode, size) : `${g.design} ${size}`.trim();
    const onFile = art ? normaliseEan(art.ean) : "";
    const ean = onFile && isValidEan13(onFile) ? onFile : null;

    const refuse = (reason: string): void => {
      bucket(skipped, g, size, () => ({
        design: g.design, size, crateNos: g.crateNo ? [g.crateNo] : [], quantity: g.quantity, reason,
      }));
    };

    if (!art) { refuse("No article on file for this design and size, so there is no barcode to print."); continue; }
    if (!ean) {
      refuse(onFile
        ? `${onFile} on file is not a readable EAN-13, so the bars cannot be drawn.`
        : "This article has no barcode yet.");
      continue;
    }

    // The piece's own thickness, in millimetres: the article is stored in
    // centimetres and the edge label is laid out against the edge it is
    // pasted on.
    const laid = edgeLabelFor(g.thicknessCm === null ? null : g.thicknessCm * 10, edge);
    if (!laid.ok) { refuse(laid.reason); continue; }

    wanted += g.quantity;
    for (let i = 0; i < g.quantity && out.length < PIECE_LABEL_MAX; i++) {
      out.push({ crateNo: g.crateNo, design: g.design, size, text, ean, layout: laid.label });
    }
  }

  return { labels: out, truncated: Math.max(0, wanted - out.length), skipped: Array.from(skipped.values()) };
}
