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
import { describeEan, normaliseEan, isValidEan13 } from "./barcode.ts";

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

/** The two kinds the label route serves. */
export const LABEL_KINDS = ["crate", "piece"] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

export function parseLabelKind(v: unknown): LabelKind | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (LABEL_KINDS as readonly string[]).includes(s) ? (s as LabelKind) : null;
}
