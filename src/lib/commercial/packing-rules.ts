// Packing lists and the dispatch check — the PURE rules. Everything a route,
// a PDF or a screen has to DECIDE about a packing list lives here, so that
// tests/commercialPacking.test.ts can run the decisions with plain values and
// the routes only move rows around:
//
//   which statuses may be edited / submitted / reopened / finalised / dispatched
//   which inventory rows may go on a list at all (slabEligibility)
//   what a packed-slab row is built from an inventory row (buildPackedSlab)
//   what the dispatch check concludes from the per-slab verdicts (verifyOutcome)
//   how the Packing List sheet groups crates into lines (crateGroups)
//   how the Measurement List orders slabs and subtotals crates (measurementRows)
//   "07 Wooden Crate(S) + 08 Sample Box" (packagesSummary), "01 to 15" (marksAndNos)
//   whether a dispatch may go at all (dispatchPlan) and what an unpack put back
//     (restoredSlabs) — the two places where believing the bridge without
//     reading its answer loses a slab
//   what a verify-only login may list, open and be told (CHECKER_STATUSES,
//     parseCheckerStatus, checkerMaySee, checkerListView)
//
// Imports only other pure modules (measure.ts, thickness.ts), by relative path
// with the extension, exactly as access-rules.ts imports roles.ts — node --test
// loads these without Next.
import { canonThickness } from "../thickness.ts";
import { sumTo, slabMeasure, sqmFromCm, sqftFromSqm, parseMeasurementUnit, type MeasurementUnit } from "./measure.ts";

export type PackingStatus = "DRAFT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "FINAL" | "DISPATCHED";
export type FitStatus = "PENDING" | "FIT" | "UNFIT";

export const PACKING_STATUSES: readonly PackingStatus[] = ["DRAFT", "SUBMITTED", "VERIFIED", "REJECTED", "FINAL", "DISPATCHED"];
export const PACKING_STATUS_LABEL: Record<PackingStatus, string> = {
  DRAFT: "Draft", SUBMITTED: "Awaiting check", VERIFIED: "Verified", REJECTED: "Rejected", FINAL: "Final", DISPATCHED: "Dispatched",
};

/** The three kinds the sheets print. Free text is still accepted on a crate. */
export const CRATE_KINDS: readonly string[] = ["Wooden Crate", "Sample Box", "Bundle"];

/** Quick reasons for the floor screen; free text is always allowed too. */
export const UNFIT_REASONS: readonly string[] = ["Chipped edge", "Crack", "Scratch", "Stain / mark", "Wrong design", "Wrong thickness", "Size short", "Not in crate"];

export interface CrateLike {
  id: string;
  crateNo: number;
  kind: string;
  grossKg?: number | null;
  netKg?: number | null;
  remarks?: string | null;
}

export interface SlabLike {
  id?: string;
  crateId: string | null;
  slabNumber: number;
  customerSlabNo?: string | null;
  customerBatchNo?: string | null;
  design: string | null;
  customerSku: string | null;
  thickness: string | null;
  batchKey?: string | null;
  batchNumber: string | null;
  grade?: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  sqm: number | null;
  sqft: number | null;
  fit: FitStatus | string;
  unfitReason?: string | null;
  sortOrder: number;
}

// ───────────────────────────── status rules ─────────────────────────────────

/** Crates and slabs may be changed only while the list is with Commercial. */
export function canEdit(status: string): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

/** Container, seal, vehicle and weights are known at stuffing time, which is
 *  after the check — so the header stays editable until the slabs have left. */
export function canEditHeader(status: string): boolean {
  return status !== "DISPATCHED";
}

/**
 * A list goes for the dispatch check once it has something on it.
 *
 * `pieces` is the SECOND kind of line (round three, answer 5): a cut-to-size
 * list packs pieces and may carry no slab at all, and an empty-list refusal that
 * only counts slabs would leave such a list unsendable for ever. Optional, so
 * every caller written before there were pieces still asks the old question.
 */
export function canSubmit(status: string, slabs: ReadonlyArray<unknown>, pieces: ReadonlyArray<unknown> = []): { ok: true } | { ok: false; reason: string } {
  if (!canEdit(status)) return { ok: false, reason: `A ${PACKING_STATUS_LABEL[status as PackingStatus]?.toLowerCase() ?? status} list cannot be submitted` };
  if (!slabs.length && !pieces.length) return { ok: false, reason: "Add at least one slab or cut-to-size line before submitting" };
  return { ok: true };
}

export function canReopen(status: string): boolean { return status === "SUBMITTED" || status === "REJECTED"; }
export function canVerify(status: string): boolean { return status === "SUBMITTED"; }
export function canFinalise(status: string): boolean { return status === "VERIFIED"; }
export function canDispatch(status: string): boolean { return status === "FINAL"; }

// ───────────────────────────── crates ───────────────────────────────────────

export function nextCrateNo(crates: ReadonlyArray<{ crateNo: number }>): number {
  return crates.reduce((m, c) => Math.max(m, Number(c.crateNo) || 0), 0) + 1;
}

export function isSampleCrate(kind: string | null | undefined): boolean {
  return /sample/i.test(kind ?? "");
}

export const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * "07 Wooden Crate(S) + 08 Sample Box" — the reference invoice's own wording.
 * Wooden crates first, then the other kinds in the order they first appear.
 * Null when there are no crates, so a blank column stays blank.
 */
export function packagesSummary(crates: ReadonlyArray<{ kind: string }>): string | null {
  if (!crates.length) return null;
  const counts = new Map<string, number>();
  for (const c of crates) {
    const k = (c.kind || "Wooden Crate").trim();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const kinds = Array.from(counts.keys()).sort((a, b) => (a === "Wooden Crate" ? -1 : b === "Wooden Crate" ? 1 : 0));
  return kinds.map((k) => `${pad2(counts.get(k)!)} ${k === "Wooden Crate" ? "Wooden Crate(S)" : k}`).join(" + ");
}

/**
 * Keeping the packages summary true as crates come and go, without ever
 * overwriting a wording someone chose. Blank → fill it. Still exactly what we
 * would have written for the OLD crate set → it was ours, so rewrite it for
 * the new one. Anything else was typed by hand and is left alone.
 */
export function nextPackagesSummary(
  current: string | null | undefined,
  before: ReadonlyArray<{ kind: string }>,
  after: ReadonlyArray<{ kind: string }>,
): { change: boolean; value: string | null } {
  const cur = (current ?? "").trim();
  const want = packagesSummary(after);
  if (!cur) return want ? { change: true, value: want } : { change: false, value: null };
  if (cur === packagesSummary(before)) return cur === want ? { change: false, value: cur } : { change: true, value: want };
  return { change: false, value: cur };
}

/** "01 to 15" for fifteen packages, "01" for one, "" for none. */
export function marksAndNos(crates: ReadonlyArray<unknown>): string {
  const n = crates.length;
  if (!n) return "";
  return n === 1 ? "01" : `01 to ${pad2(n)}`;
}

// ───────────────────────────── the dispatch check ───────────────────────────

export function fitCounts(slabs: ReadonlyArray<{ fit: string }>): { total: number; fit: number; unfit: number; pending: number } {
  let fit = 0, unfit = 0, pending = 0;
  for (const s of slabs) {
    if (s.fit === "FIT") fit++;
    else if (s.fit === "UNFIT") unfit++;
    else pending++;
  }
  return { total: slabs.length, fit, unfit, pending };
}

export interface VerifyOutcome {
  /** True when every slab is FIT — the list may be VERIFIED. */
  ok: boolean;
  pending: number;
  unfit: Array<{ id: string; slabNumber: number; reason: string }>;
  /**
   * THERE WAS NOTHING FOR THE FLOOR TO TICK. A cut-to-size list may carry no
   * slab at all (round three, answer 5), and a piece line has no fit column to
   * carry a verdict — so such a list passes the check the moment it is opened.
   *
   * It is a FACT here, not a refusal: refusing would leave a cut-to-size list
   * unshippable, which is the dead end answer 5 exists to remove. What it needs
   * to stop being a rubber stamp is a fit + unfit_reason on commercial_packed_
   * piece and the piece verdicts folded in here — a schema change, so it is an
   * owner question, not a fixer's. Until then the check says what it did:
   * verificationNote() below writes no "all N slabs checked fit" for N = 0.
   */
  nothingToVerify: boolean;
}

/** What the verdicts add up to. `ok` is only true with nothing PENDING and
 *  nothing UNFIT; a caller refuses to conclude while pending > 0. */
export function verifyOutcome(slabs: ReadonlyArray<{ id?: string; slabNumber: number; fit: string; unfitReason?: string | null }>): VerifyOutcome {
  const c = fitCounts(slabs);
  const unfit = slabs.filter((s) => s.fit === "UNFIT").map((s) => ({ id: s.id ?? "", slabNumber: s.slabNumber, reason: (s.unfitReason ?? "").trim() || "no reason given" }));
  return { ok: c.pending === 0 && unfit.length === 0, pending: c.pending, unfit, nothingToVerify: c.total === 0 };
}

/** The verification note written on a rejected list. */
export function rejectionNote(unfit: ReadonlyArray<{ slabNumber: number; reason: string }>, note?: string | null): string {
  const head = `Rejected — ${unfit.length} unfit: ${unfit.map((u) => `#${fmtSlabNo(u.slabNumber)} (${u.reason})`).join("; ")}`;
  const extra = (note ?? "").trim();
  return extra ? `${head}. ${extra}` : head;
}

// ───────────────────────────── eligibility & building rows ──────────────────

export interface InventoryRowLike {
  slabNumber: number;
  status: string;
  slabMark?: string | null;
  reservedForPi?: string | null;
}

/**
 * May this inventory row be put on a packing list of an order whose own
 * references are `ownRefs` (the order number, its holds' references, its
 * enquiry number)? AVAILABLE slabs may; a RESERVED slab only when
 * it is held under one of OUR references — packing somebody else's hold from
 * here is exactly what the inventory route refused Commercial for. Anything
 * cut, packed elsewhere or dispatched is refused with the reason printed.
 */
export function slabEligibility(row: InventoryRowLike, ownRefs: ReadonlyArray<string>): { ok: true } | { ok: false; reason: string } {
  const mark = row.slabMark ?? "FULL_SLAB";
  if (mark !== "FULL_SLAB") return { ok: false, reason: `marked ${mark} — not a full slab` };
  const status = String(row.status);
  if (status === "AVAILABLE") return { ok: true };
  // A RETURNED slab came back off a lorry and has NOT been put back in stock.
  // The inventory will not pack one (inventory-bridge's packSlabs narrows the
  // pack transition to AVAILABLE and RESERVED), so accepting it here only means
  // deleting it again at submit — the clerk learns about the mistake an hour
  // later, from a list that is quietly one slab shorter. Refuse it now and say
  // what to do about it.
  if (status === "RETURNED") return { ok: false, reason: "RETURNED — release it back to available in finished goods first" };
  if (status === "RESERVED") {
    const ref = row.reservedForPi ?? "";
    if (ref && ownRefs.includes(ref)) return { ok: true };
    return { ok: false, reason: `held under ${ref || "another reference"}` };
  }
  if (status === "PACKED") return { ok: false, reason: "already PACKED" };
  return { ok: false, reason: `${status} — cannot be packed` };
}

export interface OrderItemLike {
  design?: string | null;
  customerSku?: string | null;
  thickness?: string | null;
  isSample?: boolean | null;
}

/** The order line a slab belongs to: same design (case-insensitive) and same
 *  canonical thickness; failing that, same design with no thickness on the
 *  line. Null when the order has no such line. */
export function matchOrderItem<T extends OrderItemLike>(items: ReadonlyArray<T>, design: string | null, thickness: string | null): T | null {
  const d = (design ?? "").trim().toLowerCase();
  if (!d) return null;
  const t = canonThickness(thickness);
  const goods = items.filter((i) => !i.isSample && (i.design ?? "").trim().toLowerCase() === d);
  return goods.find((i) => canonThickness(i.thickness) === t) ?? goods.find((i) => !canonThickness(i.thickness)) ?? null;
}

export interface BridgeRowLike {
  slabNumber: number;
  design: string | null;
  designCanonical?: string | null;
  thickness?: string | null;
  thicknessCanonical?: string | null;
  batchKey: string | null;
  batchNumber: string | null;
  grade: string | null;
  lengthIn: number | null;
  widthIn: number | null;
}

export interface PackedSlabInput {
  slabNumber: number;
  design: string | null;
  customerSku: string | null;
  thickness: string | null;
  batchKey: string | null;
  batchNumber: string | null;
  grade: string | null;
  lengthCm: number;
  widthCm: number;
  sqm: number;
  sqft: number;
  fit: "PENDING";
  sortOrder: number;
}

/** One commercial_packed_slab row from an inventory row: canonical design and
 *  thickness, the customer's SKU from the matching order line, centimetres and
 *  areas from the stored inches (slabMeasure). */
export function buildPackedSlab(row: BridgeRowLike, items: ReadonlyArray<OrderItemLike>, sortOrder: number): PackedSlabInput {
  const design = (row.designCanonical ?? row.design ?? null) || null;
  const thickness = (row.thicknessCanonical || canonThickness(row.thickness)) || null;
  const item = matchOrderItem(items, design, thickness);
  const m = slabMeasure(row.lengthIn, row.widthIn);
  return {
    slabNumber: row.slabNumber,
    design,
    customerSku: item?.customerSku ?? null,
    thickness,
    batchKey: row.batchKey ?? null,
    batchNumber: row.batchNumber ?? null,
    grade: row.grade ?? null,
    lengthCm: m.lengthCm, widthCm: m.widthCm, sqm: m.sqm, sqft: m.sqft,
    fit: "PENDING",
    sortOrder,
  };
}

/**
 * Slabs on a list at submit time.
 *
 * A slab that is already PACKED is left alone ONLY when this very list is what
 * packed it — a re-submit after a rejection keeps its FIT slabs packed. A PACKED
 * slab this list did not pack belongs to somebody else's crate: two lists can
 * both hold a slab while it is AVAILABLE, and if the second submit treated the
 * first one's PACKED slab as "already done", two packing lists would claim one
 * slab and one of the two containers would be a slab short at the port.
 *
 * `ownPacked` is the set of slab numbers this list itself packed (the route
 * works it out from the list's own submit history and the other lists holding
 * the same number). Everything PACKED outside it is refused, and the caller
 * takes it off the list with the reason.
 */
export function partitionForPack(
  rows: ReadonlyArray<{ slabNumber: number; status: string }>,
  ownPacked: ReadonlyArray<number> = [],
): { alreadyPacked: number[]; toPack: number[]; refused: Removal[] } {
  const ours = new Set(ownPacked.map((n) => Number(n)));
  const alreadyPacked: number[] = [], toPack: number[] = [], refused: Removal[] = [];
  for (const r of rows) {
    if (String(r.status) !== "PACKED") { toPack.push(r.slabNumber); continue; }
    if (ours.has(Number(r.slabNumber))) alreadyPacked.push(r.slabNumber);
    else refused.push({ slab: r.slabNumber, reason: "already PACKED — not by this list" });
  }
  return { alreadyPacked, toPack, refused };
}

/** Statuses the inventory will dispatch a slab from: inventory-bridge's
 *  dispatchSlabs narrows the transition to these two. */
export const DISPATCHABLE_STATUSES: readonly string[] = ["PACKED", "RESERVED"];

export interface DispatchRowLike { slabNumber: number; status: string; slabMark?: string | null }

/**
 * The pre-flight before a dispatch: every slab on the list read back from
 * finished goods, checked for the things the inventory would refuse.
 *
 * WHY IT EXISTS. The bridge refuses a cut slab quietly — it comes back in
 * `skipped` — and a route that marks the list and the order DISPATCHED anyway
 * leaves the slab PACKED with no route back and a packing list that says it
 * shipped. Dispatch is all-or-nothing here: a packing list IS the shipping
 * document, there is no way to split one, and a FINAL list cannot be edited to
 * drop a slab. So the honest answer to "one of these cannot leave" is to move
 * nothing, name every slab and why, and let Commercial fix the slab (or the
 * list) and press the button again.
 */
export function dispatchPlan(
  numbers: ReadonlyArray<number>,
  live: ReadonlyArray<DispatchRowLike>,
): { ok: boolean; dispatchable: number[]; blocked: Removal[] } {
  const byNo = new Map(live.map((r) => [Number(r.slabNumber), r]));
  const dispatchable: number[] = [], blocked: Removal[] = [];
  for (const raw of numbers) {
    const n = Number(raw);
    const row = byNo.get(n);
    if (!row) { blocked.push({ slab: n, reason: "not found in finished goods (or not visible to this login)" }); continue; }
    const mark = row.slabMark ?? "FULL_SLAB";
    if (mark !== "FULL_SLAB") {
      blocked.push({ slab: n, reason: mark === "SAMPLE" ? "cut down for samples — not dispatchable as a full slab" : `marked ${mark} — cut to size, not dispatchable as a full slab` });
      continue;
    }
    const status = String(row.status);
    if (!DISPATCHABLE_STATUSES.includes(status)) { blocked.push({ slab: n, reason: `${status} — not packed for dispatch` }); continue; }
    dispatchable.push(n);
  }
  return { ok: blocked.length === 0, dispatchable, blocked };
}

/** Everything a bridge call could not do, as one list for the answer and the
 *  log: what it skipped, plus what it could not find at all. */
export function bridgeSkips(res: { missing: ReadonlyArray<number>; skipped: ReadonlyArray<{ slab: number; reason: string }> }): Removal[] {
  const out: Removal[] = res.skipped.map((s) => ({ slab: Number(s.slab), reason: s.reason }));
  const seen = new Set(out.map((s) => s.slab));
  for (const n of res.missing) if (!seen.has(Number(n))) { seen.add(Number(n)); out.push({ slab: Number(n), reason: "not found in finished goods" }); }
  return out.sort((a, b) => a.slab - b.slab);
}

export interface RestoreResultLike {
  updated: number;
  missing: ReadonlyArray<number>;
  skipped: ReadonlyArray<{ slab: number; reason: string }>;
  /** The rows the bridge could read before it acted. Absent = it did not say. */
  before?: ReadonlyArray<{ slabNumber: number; status: string }>;
}

/**
 * Which slabs an unpack actually put back, and which are still PACKED.
 *
 * The reject/reopen/remove paths delete the packed-slab row once a slab has
 * gone back to stock. The row is the only thing that points at the slab, so
 * deleting it for a slab the bridge did NOT restore strands that slab PACKED
 * with nothing to find it by. Everything the bridge skipped, could not find, or
 * never even read counts as NOT restored — and if it changed fewer rows than
 * the slabs it read as PACKED, none of those is proven back either: it cannot
 * say which one failed, so the caller keeps them all.
 */
export function restoredSlabs(numbers: ReadonlyArray<number>, res: RestoreResultLike): { restored: number[]; failed: Removal[] } {
  const why = new Map<number, string>();
  for (const s of res.skipped) why.set(Number(s.slab), s.reason);
  for (const n of res.missing) if (!why.has(Number(n))) why.set(Number(n), "not found in finished goods");
  const read = res.before ? new Set(res.before.map((b) => Number(b.slabNumber))) : null;
  const wasPacked = new Map<number, boolean>();
  for (const b of res.before ?? []) wasPacked.set(Number(b.slabNumber), String(b.status) === "PACKED");

  const restored: number[] = [], failed: Removal[] = [];
  for (const raw of numbers) {
    const n = Number(raw);
    const reason = why.get(n);
    if (reason) { failed.push({ slab: n, reason }); continue; }
    if (read && !read.has(n)) { failed.push({ slab: n, reason: "could not be read in finished goods" }); continue; }
    restored.push(n);
  }
  // Fail closed on a short count: the slabs that needed a release outnumber the
  // rows the bridge changed, and it has not said which one it left behind.
  const needed = restored.filter((n) => (read ? wasPacked.get(n) === true : true));
  if (needed.length > res.updated) {
    for (const n of needed) failed.push({ slab: n, reason: "the inventory did not confirm the release" });
    return {
      restored: restored.filter((n) => !needed.includes(n)),
      failed: failed.sort((a, b) => a.slab - b.slab),
    };
  }
  return { restored, failed: failed.sort((a, b) => a.slab - b.slab) };
}

/** "1 slab(s) stayed on the list: #158138 (could not be read…)" or "". */
export function strandedNote(failed: ReadonlyArray<Removal>): string {
  if (!failed.length) return "";
  return `${failed.length} slab(s) stayed on the list, still packed: ${failed.map((f) => `#${fmtSlabNo(f.slab)} (${f.reason})`).join("; ")}`;
}

/** New measurements for a slab: whichever side was typed replaces the stored
 *  one, and the areas follow. */
export function remeasure(current: { lengthCm: number | null; widthCm: number | null }, patch: { lengthCm?: number | null; widthCm?: number | null }): { lengthCm: number; widthCm: number; sqm: number; sqft: number } {
  const lengthCm = patch.lengthCm ?? current.lengthCm ?? 348;
  const widthCm = patch.widthCm ?? current.widthCm ?? 201;
  const sqm = sqmFromCm(lengthCm, widthCm);
  return { lengthCm, widthCm, sqm, sqft: sqftFromSqm(sqm) };
}

/**
 * Slab numbers typed into a box: "150903, 150904 150905-150910". Ranges of up
 * to 500 are expanded; anything that is not a positive number is dropped;
 * duplicates collapse; the result is ascending.
 */
export function parseSlabNumbers(text: string): number[] {
  const out = new Set<number>();
  for (const tok of (text ?? "").split(/[\s,;]+/)) {
    if (!tok) continue;
    const range = tok.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a <= 500) for (let n = a; n <= b; n++) out.add(n);
      continue;
    }
    const n = Number(tok);
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

// ───────────────────────────── the printed sheets ───────────────────────────

/** "3 cm" → "3CM", "7 mm" → "7MM" — the measurement list's own spelling. */
export function thicknessForDoc(thk: string | null | undefined): string {
  const c = canonThickness(thk);
  return c ? c.replace(/\s+/g, "").toUpperCase() : "";
}

/** What the sheet calls the slab: the customer's SKU when the order has one, else our design. */
export function slabDescription(s: { customerSku: string | null; design: string | null }): string {
  return (s.customerSku ?? "").trim() || (s.design ?? "").trim() || "—";
}

/** Slab numbers are floats in the schema (to match fg_finished_slab); print
 *  whole ones without a decimal. */
export function fmtSlabNo(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

export interface PlGroupRow {
  description: string;
  thickness: string;        // as printed, e.g. 3CM
  slabs: number;
  sqm: number;
  sqft: number;
  /** The line's unrounded areas. The printed line rounds; the TOTAL adds these
   *  up and rounds once, so it is the same number the measurement list's total
   *  is — two sheets issued together may not disagree in the third decimal. */
  sqmRaw: number;
  sqftRaw: number;
  /** Apportioned from the crates' net weights: a crate holding two designs
   *  gives each its share by slab count. Null when no crate has a weight — and
   *  null when one of the crates on the line has none, because a weight that
   *  silently counts an unweighed crate as zero kilograms is a customs
   *  declaration that understates the shipment. */
  netKg: number | null;
  /** The same figure unrounded, for the total (rounded once, at the end). */
  netKgRaw: number | null;
  crateNos: number[];
  /** OUR batch numbers on the line, for the invoice's "Batch No's" column. */
  batches: string[];
  /** The customer's own batch numbers, when they gave any. Printed BESIDE ours,
   *  never instead of them (OPEN-QUESTIONS §16). */
  customerBatches: string[];
}

/**
 * The Packing List table: one line per (description, thickness) across all
 * non-sample crates — the sheet has one line for OSWT10305A 3CM covering all
 * seven crates, not one line per crate. Order of first appearance.
 */
export function crateGroups(slabs: ReadonlyArray<SlabLike>, crates: ReadonlyArray<CrateLike>): PlGroupRow[] {
  const crateById = new Map(crates.map((c) => [c.id, c]));
  const slabsInCrate = new Map<string, number>();
  for (const s of slabs) if (s.crateId) slabsInCrate.set(s.crateId, (slabsInCrate.get(s.crateId) ?? 0) + 1);

  const groups = new Map<string, PlGroupRow & { _sqm: number[]; _sqft: number[]; _kg: number; _hasKg: boolean; _missingKg: boolean; _crates: Set<number>; _batches: Set<string>; _custBatches: Set<string> }>();
  const ordered = [...slabs].sort((a, b) => a.sortOrder - b.sortOrder || a.slabNumber - b.slabNumber);
  for (const s of ordered) {
    const description = slabDescription(s);
    const thickness = thicknessForDoc(s.thickness);
    const key = `${description}|${thickness}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        description, thickness, slabs: 0, sqm: 0, sqft: 0, sqmRaw: 0, sqftRaw: 0, netKg: null, netKgRaw: null,
        crateNos: [], batches: [], customerBatches: [],
        _sqm: [], _sqft: [], _kg: 0, _hasKg: false, _missingKg: false, _crates: new Set(), _batches: new Set(), _custBatches: new Set(),
      };
      groups.set(key, g);
    }
    g.slabs++;
    g._sqm.push(s.sqm ?? 0);
    g._sqft.push(s.sqft ?? 0);
    const batch = (s.batchNumber ?? s.batchKey ?? "").trim();
    if (batch) g._batches.add(batch);
    const custBatch = (s.customerBatchNo ?? "").trim();
    if (custBatch) g._custBatches.add(custBatch);
    const crate = s.crateId ? crateById.get(s.crateId) : undefined;
    if (crate) {
      g._crates.add(crate.crateNo);
      if (crate.netKg != null && Number.isFinite(Number(crate.netKg))) {
        g._kg += Number(crate.netKg) / (slabsInCrate.get(crate.id) ?? 1);
        g._hasKg = true;
      } else {
        // A crate on this line whose weight nobody has typed yet. Counting it as
        // zero would print a net weight that is short by a whole crate.
        g._missingKg = true;
      }
    }
  }
  return Array.from(groups.values()).map((g) => {
    const kg = g._hasKg && !g._missingKg ? g._kg : null;
    return {
      description: g.description,
      thickness: g.thickness,
      slabs: g.slabs,
      sqm: sumTo(g._sqm, 4),
      sqft: sumTo(g._sqft, 3),
      sqmRaw: g._sqm.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0),
      sqftRaw: g._sqft.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0),
      netKg: kg == null ? null : Math.round(kg),
      netKgRaw: kg,
      crateNos: Array.from(g._crates).sort((a, b) => a - b),
      batches: Array.from(g._batches),
      customerBatches: Array.from(g._custBatches),
    };
  });
}

export interface SamplesRow {
  description: string;
  boxes: number;
  /** From the order's sample lines when it has any; else null (the sheet
   *  prints the boxes and leaves pieces to the remark). */
  pcs: number | null;
  netKg: number | null;
  /** The same weight unrounded, so the total rounds once. Null on the same
   *  terms as netKg: a sample box with no weight typed makes it unknowable. */
  netKgRaw: number | null;
  remarks: string;
}

/** The "Free Trade Samples" line, present only when there are sample boxes. */
export function samplesRow(crates: ReadonlyArray<CrateLike>, sampleItems: ReadonlyArray<{ qtySlabs?: number | null; qty?: number | null; description?: string | null }> = []): SamplesRow | null {
  const boxes = crates.filter((c) => isSampleCrate(c.kind));
  if (!boxes.length) return null;
  const weighed = boxes.filter((c) => c.netKg != null && Number.isFinite(Number(c.netKg)));
  const kg = weighed.length === boxes.length ? weighed.reduce((a, c) => a + Number(c.netKg), 0) : null;
  const pcs = sampleItems.reduce((a, i) => a + (Number(i.qtySlabs ?? i.qty ?? 0) || 0), 0);
  const remarks = boxes.map((c) => (c.remarks ?? "").trim()).filter(Boolean).join("; ");
  return { description: "Free Trade Samples", boxes: boxes.length, pcs: pcs > 0 ? pcs : null, netKg: kg == null ? null : Math.round(kg), netKgRaw: kg, remarks };
}

/**
 * The "Free Trade Samples" line as the SHEET prints it: an export-only concept,
 * and only when the order actually sells samples. A domestic list that happens
 * to carry a sample box was printing an export line with no pieces and no
 * quantity against it — a row that says nothing and has to be explained.
 */
export function printableSamplesRow(
  kind: string | null | undefined,
  crates: ReadonlyArray<CrateLike>,
  sampleItems: ReadonlyArray<{ qtySlabs?: number | null; qty?: number | null; description?: string | null }> = [],
): SamplesRow | null {
  if (String(kind ?? "").toUpperCase() !== "EXPORT") return null;
  if (!sampleItems.length) return null;
  return samplesRow(crates, sampleItems);
}

export interface PlTotals { slabs: number; sqm: number; sqft: number; netKg: number | null; packages: number }

/**
 * The TOTAL line. Every figure is added from the same numbers the measurement
 * list adds — the lines' unrounded areas and unrounded kilograms — and rounded
 * once here, so the two sheets that go in the same envelope agree. Summing the
 * printed (already rounded) line figures is what made them disagree.
 */
export function plTotals(groups: ReadonlyArray<PlGroupRow>, samples: SamplesRow | null, crates: ReadonlyArray<unknown>): PlTotals {
  const kgs = groups.map((g) => g.netKgRaw).concat(samples ? [samples.netKgRaw] : []);
  return {
    slabs: groups.reduce((a, g) => a + g.slabs, 0) + (samples?.pcs ?? 0),
    sqm: sumTo(groups.map((g) => g.sqmRaw), 4),
    sqft: sumTo(groups.map((g) => g.sqftRaw), 3),
    // One unknown weight anywhere and the total is unknown: a customs total that
    // silently leaves out a crate is worse than a blank one.
    netKg: kgs.length && kgs.every((k): k is number => k != null) ? sumTo(kgs as number[], 0) : null,
    packages: crates.length,
  };
}

export type MeasurementRow =
  | { kind: "slab"; sl: number; description: string; batch: string; customerBatch: string; customerSlabNo: string; slabNumber: number; thickness: string; lengthCm: number | null; widthCm: number | null; sqm: number | null; sqft: number | null; crateNo: number | null }
  | { kind: "subtotal"; crateNo: number | null; slabs: number; sqm: number; sqft: number };

export interface MeasurementSheet {
  rows: MeasurementRow[];
  totals: { slabs: number; sqm: number; sqft: number };
  /** True when any slab carries the customer's number — the sheet then prints
   *  both columns (theirs first, ours beside it). */
  hasCustomerNos: boolean;
  /** True when any slab carries the customer's batch. OURS ALWAYS PRINTS
   *  (OPEN-QUESTIONS §16); theirs is printed beside it when they gave one. It
   *  used to REPLACE ours, which lost the only number that ties a slab on a
   *  customer's floor back to the batch we made it in. */
  hasCustomerBatches: boolean;
}

/**
 * The Measurement List: slabs in crate order (unassigned last), a subtotal line
 * after each crate (the sheet sums every crate's sqm), and a grand total.
 */
export function measurementRows(slabs: ReadonlyArray<SlabLike>, crates: ReadonlyArray<CrateLike>): MeasurementSheet {
  const crateNo = new Map(crates.map((c) => [c.id, c.crateNo]));
  const keyOf = (s: SlabLike): number => (s.crateId && crateNo.has(s.crateId) ? crateNo.get(s.crateId)! : Number.MAX_SAFE_INTEGER);
  const ordered = [...slabs].sort((a, b) => keyOf(a) - keyOf(b) || a.sortOrder - b.sortOrder || a.slabNumber - b.slabNumber);
  const rows: MeasurementRow[] = [];
  let sl = 0;
  let block: SlabLike[] = [];
  let blockKey: number | null = null;
  const flush = () => {
    if (!block.length) return;
    rows.push({ kind: "subtotal", crateNo: blockKey === Number.MAX_SAFE_INTEGER ? null : blockKey, slabs: block.length, sqm: sumTo(block.map((s) => s.sqm ?? 0), 4), sqft: sumTo(block.map((s) => s.sqft ?? 0), 3) });
    block = [];
  };
  for (const s of ordered) {
    const k = keyOf(s);
    if (blockKey !== null && k !== blockKey) flush();
    blockKey = k;
    block.push(s);
    sl++;
    rows.push({
      kind: "slab", sl,
      description: slabDescription(s),
      batch: (s.batchNumber ?? s.batchKey ?? "").trim(),
      customerBatch: (s.customerBatchNo ?? "").trim(),
      customerSlabNo: (s.customerSlabNo ?? "").trim(),
      slabNumber: s.slabNumber,
      thickness: thicknessForDoc(s.thickness),
      lengthCm: s.lengthCm, widthCm: s.widthCm, sqm: s.sqm, sqft: s.sqft,
      crateNo: k === Number.MAX_SAFE_INTEGER ? null : k,
    });
  }
  flush();
  return {
    rows,
    totals: { slabs: slabs.length, sqm: sumTo(slabs.map((s) => s.sqm ?? 0), 4), sqft: sumTo(slabs.map((s) => s.sqft ?? 0), 3) },
    hasCustomerNos: slabs.some((s) => (s.customerSlabNo ?? "").trim() !== ""),
    hasCustomerBatches: slabs.some((s) => (s.customerBatchNo ?? "").trim() !== ""),
  };
}

/**
 * What the measurement list's reference box says at the top. An unissued list
 * has no invoice, and calling its own packing-list number "Invoice No." is how
 * a document that has not been invoiced ends up quoted as one in an email.
 */
export function measurementHeaderRef(
  invoice: { number: string; invoiceDate?: string | Date | null } | null | undefined,
  list: { number: string; createdAt?: string | Date | null },
): { label: string; value: string; dateLabel: string; dateValue: string } {
  if (invoice?.number) {
    return { label: "Invoice No.", value: invoice.number, dateLabel: "Invoice date", dateValue: docDate(invoice.invoiceDate ?? null) };
  }
  return { label: "Invoice No.", value: "Not yet invoiced", dateLabel: "Packing list date", dateValue: docDate(list.createdAt ?? null) };
}

/** Export documents quote square metres; domestic ones square feet. */
export function quantityUnit(kind: string | null | undefined): { unit: string; field: "sqm" | "sqft"; dp: number } {
  return kind === "DOMESTIC" ? { unit: "SQFT", field: "sqft", dp: 3 } : { unit: "SQMT", field: "sqm", dp: 4 };
}

/** 24000 kg → "24.00 MT"; nothing → "". */
export function kgToMt(kg: number | null | undefined): string {
  if (kg == null || !Number.isFinite(Number(kg))) return "";
  return `${(Number(kg) / 1000).toFixed(2)} MT`;
}

export interface PartyLike { name?: string | null; lines?: string[] | null; country?: string | null; tel?: string | null; email?: string | null; gstin?: string | null; code?: string | null }

/** A party as printed: name, address lines, country, phone. */
export function partyLines(p: PartyLike | null | undefined): string[] {
  if (!p) return [];
  const out = [p.name ?? "", ...(p.lines ?? [])].map((l) => (l ?? "").trim()).filter(Boolean);
  if (p.country) out.push(p.country.trim());
  if (p.tel) out.push(`Tel: ${p.tel.trim()}`);
  if (p.gstin) out.push(`GSTIN: ${p.gstin.trim()}`);
  return out;
}

/** The consignee when the order has none typed: the client's shipping block,
 *  else the client master's address. */
export function fallbackParty(client: { name: string; address?: string | null; city?: string | null; country?: string | null } | null | undefined, ext?: { shippingAddress?: PartyLike | null; billingAddress?: PartyLike | null } | null): PartyLike | null {
  if (!client) return null;
  const shipping = ext?.shippingAddress;
  if (shipping && (shipping.name || (shipping.lines ?? []).length)) return { ...shipping, name: shipping.name || client.name };
  const billing = ext?.billingAddress;
  if (billing && (billing.name || (billing.lines ?? []).length)) return { ...billing, name: billing.name || client.name };
  return { name: client.name, lines: [client.address ?? "", client.city ?? ""].filter(Boolean), country: client.country ?? null };
}

/**
 * The vessel or flight the container went on. The packing list has a box for it
 * and no column behind it: the only place the module records a vessel is the
 * invoice's frozen snapshot (InvoiceSnapshot.vessel), so the box can only be
 * filled once the list has an invoice. Blank, whitespace or a missing snapshot
 * all mean "not known" — the box then prints empty, to be written in by hand,
 * which is what the reference sheets do.
 */
export function vesselFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const v = (snapshot as { vessel?: unknown }).vessel;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

/** DD/MM/YYYY from an ISO string or Date; "" when absent. */
export function docDate(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** "PL/26-27/0004" → "PL-26-27-0004-measurement-list.pdf". */
export function pdfFilename(number: string, suffix = ""): string {
  const base = (number || "packing-list").replace(/[\\/]+/g, "-").replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${base}${suffix ? `-${suffix}` : ""}.pdf`;
}

// ───────────────────────────── what the routes decide ───────────────────────
// Everything below is a decision a handler would otherwise make inline, kept
// here so tests/commercialPacking.test.ts can run it with plain values.

/** ?page=&limit= — 1/50 by default, 500 the ceiling (orders-rules pageArgs). */
export function pageArgs(page: unknown, limit: unknown): { page: number; limit: number; skip: number; take: number } {
  const asNum = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  };
  const p = Math.max(1, Math.trunc(asNum(page) ?? 1));
  const l = Math.min(500, Math.max(1, Math.trunc(asNum(limit) ?? 50)));
  return { page: p, limit: l, skip: (p - 1) * l, take: l };
}

/** A ?status= filter, or null for "every status". Unknown values are null too:
 *  a typo must widen the list, never silently empty it. */
export function parsePackingStatus(v: unknown): PackingStatus | null {
  const s = String(v ?? "").trim().toUpperCase();
  return (PACKING_STATUSES as readonly string[]).includes(s) ? (s as PackingStatus) : null;
}

// ───────────────────────────── what the checker may see ─────────────────────
// The dispatch team's login reaches this module through /dispatch-check/**
// alone (access-rules isDispatchCheckPath) and is refused `view`. So the queue
// and the detail screen are not a window on the packing-list register: a list
// Commercial is still building, or one that has already shipped, is none of
// the checker's business. Four statuses, and a list in any other one does not
// exist as far as that segment is concerned.
//
// FINAL is the fourth since answer 30. A FINAL list is the one the container is
// being stuffed from, and the loading bay is where a slab passed a week ago is
// found cracked; the owner's answer to that is "dispatch refuses, the refused
// slab is swapped", which needs the dispatch team to be able to mark it unfit
// on the FINAL list (canRecheck). DISPATCHED stays out: it has gone.

/** The only statuses the dispatch check may list or open. */
export const CHECKER_STATUSES: readonly PackingStatus[] = ["SUBMITTED", "VERIFIED", "REJECTED", "FINAL"];

/**
 * May the dispatch check change a verdict on a list it has ALREADY concluded?
 * VERIFIED and FINAL: a slab found unfit at loading is marked so where the
 * checker stands, the list keeps its status (nothing is unpacked, the order
 * does not move), and the dispatch route refuses until Commercial swaps it
 * (answers 30, 31). Never on SUBMITTED — that is the ordinary check, which
 * canVerify covers — and never on anything else.
 */
export function canRecheck(status: string): boolean {
  return status === "VERIFIED" || status === "FINAL";
}

/** The queue's ?status=, clamped. Anything else — DRAFT, FINAL, DISPATCHED, a
 *  typo — falls back to the queue itself rather than widening it. */
export function parseCheckerStatus(v: unknown): PackingStatus {
  const s = parsePackingStatus(v);
  return s && (CHECKER_STATUSES as readonly string[]).includes(s) ? s : "SUBMITTED";
}

/** May the dispatch check open a list in this status at all? */
export function checkerMaySee(status: string): boolean {
  return (CHECKER_STATUSES as readonly string[]).includes(String(status));
}

export interface CheckerSlabView {
  id: string; crateId: string | null; slabNumber: number;
  customerSlabNo: string | null; customerBatchNo: string | null;
  design: string | null; customerSku: string | null; thickness: string | null;
  batchKey: string | null; batchNumber: string | null; grade: string | null;
  lengthCm: number | null; widthCm: number | null; sqm: number | null; sqft: number | null;
  fit: string; unfitReason: string | null; checkedAt: string | null; sortOrder: number;
}

export interface CheckerCrateView {
  id: string; crateNo: number; kind: string;
  grossKg: number | null; netKg: number | null;
  lengthCm: number | null; widthCm: number | null; heightCm: number | null;
  remarks: string | null;
}

export interface CheckerListView {
  id: string; number: string; status: string;
  submittedAt: string | null; verifiedAt: string | null; verifiedByName: string | null; verificationNote: string | null;
  containerNo: string | null; sealNo: string | null; linerOtlNo: string | null; vehicleNo: string | null;
  packagesSummary: string | null; grossWeightKg: number | null; netWeightKg: number | null; notes: string | null;
  orderNumber: string; kind: string; customerPoNumber: string | null;
  clientName: string; clientCountry: string | null;
  /** cm | in — the floor reads sizes in the unit the sheet prints (answer 17). */
  measurementUnit: MeasurementUnit;
  crates: CheckerCrateView[]; slabs: CheckerSlabView[];
  fit: { total: number; fit: number; unfit: number; pending: number };
}

const vStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const vNum = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const vDate = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

/** One packed slab as the floor screen reads it. */
export function checkerSlabView(s: Record<string, unknown>): CheckerSlabView {
  return {
    id: String(s.id ?? ""),
    crateId: vStr(s.crateId),
    slabNumber: Number(s.slabNumber),
    customerSlabNo: vStr(s.customerSlabNo),
    customerBatchNo: vStr(s.customerBatchNo),
    design: vStr(s.design),
    customerSku: vStr(s.customerSku),
    thickness: vStr(s.thickness),
    batchKey: vStr(s.batchKey),
    batchNumber: vStr(s.batchNumber),
    grade: vStr(s.grade),
    lengthCm: vNum(s.lengthCm), widthCm: vNum(s.widthCm), sqm: vNum(s.sqm), sqft: vNum(s.sqft),
    fit: String(s.fit ?? "PENDING"),
    unfitReason: vStr(s.unfitReason),
    checkedAt: vDate(s.checkedAt),
    sortOrder: Number(s.sortOrder ?? 0),
  };
}

/**
 * A packing list as the DISPATCH CHECK is allowed to see it — a WHITELIST, not
 * a deletion of the sensitive fields, because the loader keeps growing and the
 * next field somebody adds to it must not appear on a store login's screen by
 * default.
 *
 * What is deliberately NOT here: the order's items with the customer's rates
 * and amounts, the client's GSTIN / PAN / billing address, the order's payment
 * terms, its holds and its whole event history. A store incharge checks slabs
 * against a crate; the order book is not part of that job, and the verify
 * endpoint was handing all of it back in the answer to "these 47 are fit".
 */
export function checkerListView(list: Record<string, unknown>): CheckerListView {
  const order = (list.order as Record<string, unknown> | null) ?? {};
  const client = (order.client as Record<string, unknown> | null) ?? null;
  const crates = (list.crates as Array<Record<string, unknown>> | undefined) ?? [];
  const slabs = (list.slabs as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    id: String(list.id ?? ""),
    number: String(list.number ?? ""),
    status: String(list.status ?? ""),
    submittedAt: vDate(list.submittedAt),
    verifiedAt: vDate(list.verifiedAt),
    verifiedByName: vStr(list.verifiedByName),
    verificationNote: vStr(list.verificationNote),
    containerNo: vStr(list.containerNo),
    sealNo: vStr(list.sealNo),
    linerOtlNo: vStr(list.linerOtlNo),
    vehicleNo: vStr(list.vehicleNo),
    packagesSummary: vStr(list.packagesSummary),
    grossWeightKg: vNum(list.grossWeightKg),
    netWeightKg: vNum(list.netWeightKg),
    notes: vStr(list.notes),
    orderNumber: String(order.number ?? ""),
    kind: String(order.kind ?? ""),
    customerPoNumber: vStr(order.customerPoNumber),
    clientName: String(client?.name ?? ""),
    clientCountry: vStr(client?.country),
    measurementUnit: parseMeasurementUnit(list.measurementUnit) ?? "cm",
    crates: crates.map((c) => ({
      id: String(c.id ?? ""),
      crateNo: Number(c.crateNo ?? 0),
      kind: String(c.kind ?? ""),
      grossKg: vNum(c.grossKg), netKg: vNum(c.netKg),
      lengthCm: vNum(c.lengthCm), widthCm: vNum(c.widthCm), heightCm: vNum(c.heightCm),
      remarks: vStr(c.remarks),
    })),
    slabs: slabs.map(checkerSlabView),
    fit: fitCounts(slabs.map((s) => ({ fit: String(s.fit ?? "PENDING") }))),
  };
}

/**
 * The dispatch check's verdict body: `fit` must be FIT or UNFIT (PENDING is
 * where a slab starts, not something the floor sets), and UNFIT must say why —
 * a rejected list sends slabs back to stock and moves the order backwards, so
 * "no reason given" is not good enough to do that on.
 */
export function fitPatch(fit: unknown, unfitReason: unknown): { ok: true; fit: "FIT" | "UNFIT"; unfitReason: string | null } | { ok: false; reason: string } {
  const f = String(fit ?? "").trim().toUpperCase();
  if (f !== "FIT" && f !== "UNFIT") return { ok: false, reason: "fit must be FIT or UNFIT" };
  const why = String(unfitReason ?? "").trim();
  if (f === "UNFIT" && !why) return { ok: false, reason: "Say what is wrong with the slab" };
  return { ok: true, fit: f, unfitReason: f === "UNFIT" ? why : null };
}

/**
 * Slab numbers from a request body or a typed box: an array of numbers or
 * numeric strings, or one string of numbers and ranges. Ascending, unique,
 * junk dropped — the same contract either way, so the screen may send whichever
 * it has.
 */
export function slabNumberList(v: unknown): number[] {
  if (typeof v === "string") return parseSlabNumbers(v);
  if (!Array.isArray(v)) return [];
  const out = new Set<number>();
  for (const raw of v) {
    if (raw === null || raw === undefined || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (Number.isFinite(n) && n > 0) out.add(n);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/** The next sortOrder when slabs are added to a list that already has some. */
export function nextSortOrder(slabs: ReadonlyArray<{ sortOrder: number }>): number {
  return slabs.reduce((m, s) => Math.max(m, Number(s.sortOrder) || 0), 0) + 1;
}

export interface Removal { slab: number; reason: string }

/**
 * What submit does with the bridge's answer. Slabs the inventory would not
 * pack (cut-marked, dispatched, already packed elsewhere) and slabs that are
 * not in finished goods at all come OFF the list — the packing list has to
 * describe what is actually in the crates. `kept` is what is left.
 */
export function submitOutcome(
  onList: ReadonlyArray<{ id: string; slabNumber: number }>,
  bridge: { skipped: ReadonlyArray<{ slab: number; reason: string }>; missing: ReadonlyArray<number> },
): { kept: Array<{ id: string; slabNumber: number }>; removed: Array<{ id: string; slab: number; reason: string }> } {
  const why = new Map<number, string>();
  for (const s of bridge.skipped) why.set(Number(s.slab), s.reason);
  for (const n of bridge.missing) if (!why.has(Number(n))) why.set(Number(n), "not found in finished goods");
  const kept: Array<{ id: string; slabNumber: number }> = [];
  const removed: Array<{ id: string; slab: number; reason: string }> = [];
  for (const s of onList) {
    const reason = why.get(Number(s.slabNumber));
    if (reason) removed.push({ id: s.id, slab: s.slabNumber, reason });
    else kept.push({ id: s.id, slabNumber: s.slabNumber });
  }
  return { kept, removed };
}

/** "3 slab(s) dropped: #1441 (marked CTS — not a full slab); …" or "". */
export function removalNote(removed: ReadonlyArray<Removal>): string {
  if (!removed.length) return "";
  return `${removed.length} slab(s) dropped: ${removed.map((r) => `#${fmtSlabNo(r.slab)} (${r.reason})`).join("; ")}`;
}

/** The note on the dispatched event. */
export function dispatchNote(number: string, dispatched: number, skipped: ReadonlyArray<Removal>): string {
  const head = `Packing list ${number} dispatched — ${dispatched} slab(s)`;
  return skipped.length ? `${head}. Not dispatched: ${skipped.map((s) => `#${fmtSlabNo(s.slab)} (${s.reason})`).join("; ")}` : head;
}

/** The note a verified list carries.
 *
 *  A LIST WITH NO SLAB ON IT SAYS SO. A cut-to-size list carries pieces alone
 *  (round three, answer 5) and a piece has no fit column, so the checker ticked
 *  nothing; "All 0 slab(s) checked fit" would put a check in the record that
 *  nobody performed. The note names what was actually in front of them, and the
 *  checker's own words follow it. */
export function verificationNote(slabs: number, note?: string | null): string {
  const head = slabs === 0
    ? "No slab line to check — the cut-to-size lines were passed on the sheet"
    : `All ${slabs} slab(s) checked fit`;
  const extra = (note ?? "").trim();
  return extra ? `${head}. ${extra}` : head;
}

// ───────────────────── the owner's answers of 2026-09-07 ────────────────────
// Answers 2, 17, 18, 30 and 31 as decisions. Each is one function so the
// route that applies it is a database read on either side of a call the test
// file runs with plain values.

/**
 * ONE PACKING LIST PER ORDER (answer 18: "one PI has one packing list, which
 * may hold several colours, batches, crates and containers"). A second list is
 * refused while the order has any that is not REJECTED. A REJECTED list does
 * not block — it is reopened rather than replaced, and the reason says so —
 * but nor does it stop somebody who wants to start over. Everything else,
 * DRAFT through DISPATCHED, does: two lists on one order is two shipments on
 * one PI, which is exactly what the answer rules out.
 */
export function canCreatePackingList(
  existing: ReadonlyArray<{ number: string; status: string }>,
): { ok: true } | { ok: false; reason: string } {
  const open = existing.find((l) => String(l.status) !== "REJECTED");
  if (open) {
    const label = PACKING_STATUS_LABEL[open.status as PackingStatus]?.toLowerCase() ?? open.status;
    return { ok: false, reason: `This order already has packing list ${open.number} (${label}) — one PI has one packing list. Add crates and slabs to it${open.status === "DISPATCHED" ? "" : ", or reopen it if it was sent too early"}.` };
  }
  return { ok: true };
}

/** The unit may change only while the list is with Commercial (answer 17):
 *  once the dispatch team has it, the sheet they are reading must not turn
 *  into inches underneath them. */
export function canSetUnit(status: string): boolean {
  return canEdit(status);
}

export interface DispatchBlockers {
  ok: boolean;
  unfit: number[];
  unchecked: number[];
  /** Names every slab, ready for the 409. "" when ok. */
  reason: string;
}

/**
 * NOTHING SHIPS UNTIL THE LIST IS CORRECTED (answers 2 and 31). Every packed
 * slab must carry a FIT verdict at the moment of dispatch: an UNFIT one is a
 * slab the dispatch team refused, and a PENDING one is a slab nobody has looked
 * at — a replacement swapped in after the check, say. Both stop the whole
 * list, because a packing list cannot be split and a FINAL list's slabs cannot
 * be edited: the honest answer is "not this list, not yet", with the slabs
 * named so Commercial knows which to swap or which to send the checker back to.
 */
export function dispatchBlockers(slabs: ReadonlyArray<{ slabNumber: number; fit: string; unfitReason?: string | null }>): DispatchBlockers {
  const unfit = slabs.filter((s) => s.fit === "UNFIT").map((s) => Number(s.slabNumber)).sort((a, b) => a - b);
  const unchecked = slabs.filter((s) => s.fit !== "UNFIT" && s.fit !== "FIT").map((s) => Number(s.slabNumber)).sort((a, b) => a - b);
  if (!unfit.length && !unchecked.length) return { ok: true, unfit, unchecked, reason: "" };
  const parts: string[] = [];
  if (unfit.length) {
    const why = new Map(slabs.filter((s) => s.fit === "UNFIT").map((s) => [Number(s.slabNumber), (s.unfitReason ?? "").trim()]));
    parts.push(`${unfit.length} slab(s) marked unfit by the dispatch check: ${unfit.map((n) => `#${fmtSlabNo(n)}${why.get(n) ? ` (${why.get(n)})` : ""}`).join("; ")} — swap each one for a slab of the same design and thickness`);
  }
  if (unchecked.length) {
    parts.push(`${unchecked.length} slab(s) not yet checked: ${unchecked.map((n) => `#${fmtSlabNo(n)}`).join(", ")} — the dispatch team has to pass them first`);
  }
  return { ok: false, unfit, unchecked, reason: `Nothing ships until the list is corrected. ${parts.join(". ")}.` };
}

/**
 * MAY THIS SLAB BE SWAPPED (answer 30)? Only on a list the dispatch team has
 * concluded — VERIFIED, or FINAL — and only a slab they marked UNFIT. A DRAFT
 * or REJECTED list is edited the ordinary way (remove, add); a SUBMITTED one
 * is under the checker's hands; a DISPATCHED one has gone. And a FIT slab is
 * not swapped from here: "it looks nicer" is not a refusal.
 */
export function swapEligibility(listStatus: string, slab: { slabNumber: number; fit: string }): { ok: true } | { ok: false; reason: string } {
  if (!canRecheck(listStatus)) {
    const label = PACKING_STATUS_LABEL[listStatus as PackingStatus]?.toLowerCase() ?? listStatus;
    return { ok: false, reason: `A ${label} list has no slab to swap — swapping is for a verified or final list whose slab the dispatch check refused` };
  }
  if (slab.fit !== "UNFIT") return { ok: false, reason: `Slab #${fmtSlabNo(slab.slabNumber)} has not been marked unfit — only a refused slab is swapped` };
  return { ok: true };
}

export interface ReplacementLike {
  slabNumber: number;
  status: string;
  slabMark?: string | null;
  reservedForPi?: string | null;
  design?: string | null;
  designCanonical?: string | null;
  thickness?: string | null;
  thicknessCanonical?: string | null;
}

const designKey = (r: { design?: string | null; designCanonical?: string | null }): string =>
  ((r.designCanonical ?? r.design ?? "") || "").trim().toLowerCase();

/**
 * MAY THIS INVENTORY ROW STAND IN FOR THE REFUSED SLAB (answer 30)? Same
 * design and the same canonical thickness — a swap is a like-for-like the
 * customer never sees on the invoice, so a different colour or a 2 cm for a 3
 * cm is a new order line, not a swap — and, as for any slab going into a
 * crate, AVAILABLE or held under one of this order's own references, whole,
 * and not the refused slab itself. The refusal names the mismatch: "3 cm, not
 * 2 cm" is what the picker needs to say beside a slab it will not take.
 */
export function replacementEligibility(
  refused: { slabNumber: number; design: string | null; thickness: string | null },
  candidate: ReplacementLike,
  ownRefs: ReadonlyArray<string>,
): { ok: true } | { ok: false; reason: string } {
  if (Number(candidate.slabNumber) === Number(refused.slabNumber)) return { ok: false, reason: "that is the refused slab itself" };
  const wantDesign = designKey({ design: refused.design });
  const haveDesign = designKey(candidate);
  if (wantDesign && haveDesign !== wantDesign) return { ok: false, reason: `${candidate.designCanonical ?? candidate.design ?? "no design"}, not ${refused.design}` };
  const wantThk = canonThickness(refused.thickness);
  const haveThk = (candidate.thicknessCanonical || canonThickness(candidate.thickness)) || "";
  if (wantThk && haveThk !== wantThk) return { ok: false, reason: `${haveThk || "no thickness"}, not ${wantThk}` };
  return slabEligibility(candidate, ownRefs);
}

/** How many days a hold has left, as the fraction changeSlabStatus takes for
 *  `expiryDays` — so a slab put back on its hold lapses when the hold does,
 *  not five days from the swap. Null when the hold has already lapsed. */
export function holdDaysLeft(expiresAt: string | Date | null | undefined, now: Date): number | null {
  if (!expiresAt) return null;
  const t = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : expiresAt.getTime();
  if (!Number.isFinite(t)) return null;
  const days = (t - now.getTime()) / 86400000;
  return days > 0 ? days : null;
}

/** The note the slab_swapped event and the verification note carry. */
export function swapNote(number: string, refused: number, replacement: number, reason: string | null, reheld: string | null): string {
  const head = `Packing list ${number}: slab #${fmtSlabNo(refused)} swapped for #${fmtSlabNo(replacement)}`;
  const why = (reason ?? "").trim();
  const back = reheld ? `#${fmtSlabNo(refused)} back on hold ${reheld}` : `#${fmtSlabNo(refused)} back in stock`;
  return `${head}${why ? ` (${why})` : ""} — ${back}; #${fmtSlabNo(replacement)} awaits the dispatch check`;
}

/**
 * DID THE REFUSED SLAB JUST COME OUT OF THE CRATE (answer 30)? The swap packs
 * the replacement first and releases the refused slab second, and the release
 * is a PRECONDITION of the swap, not a courtesy: the swap only holds if the
 * refused slab went PACKED → AVAILABLE by this call's own hand. The first cut
 * read "not PACKED any more" as "already released, nothing left to do" — so
 * two clerks swapping the same UNFIT slab at once BOTH succeeded, the row
 * ended up naming the second replacement, and the first replacement stayed
 * PACKED against nothing with no screen saying so. Either refusal here means
 * the caller must unpack the replacement it has just packed.
 */
export function swapReleaseOutcome(
  refused: number,
  before: ReadonlyArray<{ slabNumber: number; status: string }>,
  released: number,
): { ok: true } | { ok: false; wasPacked: boolean; reason: string } {
  const wasPacked = before.some((r) => Number(r.slabNumber) === Number(refused) && r.status === "PACKED");
  if (!wasPacked) return { ok: false, wasPacked: false, reason: `#${fmtSlabNo(refused)} is no longer packed — it was already swapped or released` };
  if (released !== 1) return { ok: false, wasPacked: true, reason: "the inventory did not confirm the release" };
  return { ok: true };
}

/**
 * Why a swap did not happen, as one sentence for the 409 and the log. A reason
 * that already names its own slab (swapReleaseOutcome's does, because it has
 * to read as a sentence wherever it is shown) is NOT prefixed with the number
 * again — "#150903 (#150903 is no longer packed…)" is how the first cut read.
 */
export function swapRefusalNote(skipped: ReadonlyArray<Removal>): string {
  if (!skipped.length) return "the inventory did not confirm the move";
  return skipped
    .map((s) => (s.reason.trim().startsWith("#") ? s.reason.trim() : `#${fmtSlabNo(s.slab)} (${s.reason})`))
    .join("; ");
}

/** Where each slab stands after a failed swap was put back (undoSwapPackedSlab). */
export interface SwapUndoLike {
  /** The replacement's pack was undone (PACKED → AVAILABLE, or back on its hold). */
  replacementUnpacked: boolean;
  /** The hold the replacement went back onto, when it had come off one. */
  replacementHold?: string | null;
  /** PACKED again (the row still names it, so this is the consistent state),
   *  RESERVED under the order's hold, or in open stock — the last two are
   *  inconsistent with the row and are said so. */
  refusedState: "packed" | "held" | "stock";
  refusedHold?: string | null;
}

/**
 * The note logged when the inventory moved for a swap but the list did not
 * (the row / hold / event transaction failed and the bridge put the slabs
 * back). It names BOTH slabs and where each one is now, so the state is never
 * silent: the log is the only thing that will tell a clerk why a slab the
 * screen shows as PACKED is AVAILABLE in finished goods.
 */
export function swapFailureNote(number: string, refused: number, replacement: number, cause: string, undo: SwapUndoLike): string {
  const a = `#${fmtSlabNo(refused)}`;
  const b = `#${fmtSlabNo(replacement)}`;
  const repl = undo.replacementUnpacked
    ? (undo.replacementHold ? `${b} back on hold ${undo.replacementHold}` : `${b} back in stock`)
    : `${b} is still PACKED and on no list — check it in finished goods`;
  const ref = undo.refusedState === "packed"
    ? `${a} packed again, as the list still says`
    : undo.refusedState === "held"
      ? `${a} is on hold ${undo.refusedHold ?? ""}`.trim() + ` but the list still shows it PACKED — check it in finished goods`
      : `${a} is in open stock but the list still shows it PACKED — check it in finished goods`;
  return `Packing list ${number}: swap of ${a} for ${b} did NOT happen — the inventory moved but the list could not be updated (${cause.trim() || "unknown error"}); ${repl}; ${ref}`;
}
