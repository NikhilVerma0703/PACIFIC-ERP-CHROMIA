// Packing lists and the dispatch check — the PURE rules. Everything a route,
// a PDF or a screen has to DECIDE about a packing list lives here, so that
// tests/commercialPacking.test.ts can run the decisions with plain values and
// the routes only move rows around:
//
//   which statuses may be edited / submitted / reopened / finalised / dispatched
//   which inventory rows may go on a list at all (slabEligibility)
//   what a packed-slab row is built from an inventory row (buildPackedSlab)
//   what the dispatch check concludes from the verdicts on BOTH kinds of line
//     (fitCounts, verifyOutcome) and what one "mark crate correct" touches
//     (checkerGroups, bulkFitPlan)
//   how the Packing List sheet groups crates into lines (crateGroups)
//   how the Measurement List orders slabs and subtotals crates (measurementRows)
//   "07 Wooden Crate(S) + 08 Sample Box" (packagesSummary), "01 to 15" (marksAndNos)
//   whether a dispatch may go at all (dispatchPlan) and what an unpack put back
//     (restoredSlabs) — the two places where believing the bridge without
//     reading its answer loses a slab
//   what a verify-only login may list, open and be told (CHECKER_STATUSES,
//     parseCheckerStatus, checkerMaySee, checkerListView, checkerPieceView)
//
// Imports only other pure modules (measure.ts, thickness.ts, pieces-rules.ts),
// by relative path with the extension, exactly as access-rules.ts imports
// roles.ts — node --test loads these without Next.
import { canonThickness } from "../thickness.ts";
import { sumTo, slabMeasure, sqmFromCm, sqftFromSqm, parseMeasurementUnit, type MeasurementUnit } from "./measure.ts";
import { compareCrateNo, pieceLabel } from "./pieces-rules.ts";

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
// TWO KINDS OF LINE, ONE CHECK (round four, answer 1: "a cut to size also gets
// a physical check piece by piece"). A packed PIECE carries the same fit,
// unfitReason, checkedById and checkedAt a packed slab has carried since 0076,
// on the same enum, so everything below counts and concludes over both. The
// verdict is per ROW, which on the piece side is per LINE: a line of 360
// thresholds of one size in one crate is one thing the checker looks at, and it
// is the row the database gives a verdict column to.

export interface FitCount { total: number; fit: number; unfit: number; pending: number }

/** The verdicts on a list, slabs and cut-to-size lines together. `pieces` is
 *  optional so a caller that only ever has slabs in its hand — the packing-list
 *  register's own row count — asks the question it used to ask. */
export function fitCounts(slabs: ReadonlyArray<{ fit: string }>, pieces: ReadonlyArray<{ fit: string }> = []): FitCount {
  let fit = 0, unfit = 0, pending = 0;
  for (const s of [...slabs, ...pieces]) {
    if (s.fit === "FIT") fit++;
    else if (s.fit === "UNFIT") unfit++;
    else pending++;
  }
  return { total: slabs.length + pieces.length, fit, unfit, pending };
}

/** A cut-to-size line the check refused. It has no slab number, because it is
 *  not a slab — see verifyOutcome on why that distinction is load-bearing. */
export interface UnfitPiece { id: string; label: string; reason: string }

export interface PieceFitLike {
  id?: string;
  crateNo?: string | null;
  pieceNo?: string | null;
  design?: string | null;
  fit: string;
  unfitReason?: string | null;
}

export interface VerifyOutcome {
  /** True when every line of both kinds is FIT — the list may be VERIFIED. */
  ok: boolean;
  /** Unlooked-at lines of both kinds; the list cannot be concluded above nought. */
  pending: number;
  /** The two kinds separately, so a refusal can say which of them is outstanding. */
  slabs: FitCount;
  pieces: FitCount;
  /**
   * THE UNFIT SLABS, AND ONLY THE SLABS. This is the list the verify route
   * hands unpackSlabs, so nothing that is not a row in finished goods may ever
   * reach it — see unfitPieces.
   */
  unfit: Array<{ id: string; slabNumber: number; reason: string }>;
  /**
   * THE UNFIT CUT-TO-SIZE LINES, WHICH DO NOT GO BACK TO STOCK (answer 1: "an
   * unfit piece does not go back to stock"). An unfit slab is returned through
   * the inventory bridge because a slab is a row in finished goods; a piece was
   * cut to a customer's size and there is nothing to return it to. They are a
   * separate field rather than the same one with a null slab number precisely
   * so that the bridge call cannot be handed one by accident — that would be a
   * release against a slab number that does not exist.
   */
  unfitPieces: UnfitPiece[];
  /**
   * THERE WAS NOTHING FOR THE FLOOR TO TICK — no slab and no piece. canSubmit
   * refuses to send such a list for a check at all, so this is the list that
   * lost its last line after it was sent; it is a fact the note records rather
   * than a refusal, because there is nothing for the checker to do about it.
   */
  nothingToVerify: boolean;
}

/** What the verdicts add up to. `ok` is only true with nothing PENDING and
 *  nothing UNFIT of either kind; a caller refuses to conclude while pending > 0. */
export function verifyOutcome(
  slabs: ReadonlyArray<{ id?: string; slabNumber: number; fit: string; unfitReason?: string | null }>,
  pieces: ReadonlyArray<PieceFitLike> = [],
): VerifyOutcome {
  const why = (v: string | null | undefined): string => (v ?? "").trim() || "no reason given";
  const slabCounts = fitCounts(slabs);
  const pieceCounts = fitCounts(pieces);
  const unfit = slabs.filter((s) => s.fit === "UNFIT").map((s) => ({ id: s.id ?? "", slabNumber: s.slabNumber, reason: why(s.unfitReason) }));
  const unfitPieces = pieces.filter((p) => p.fit === "UNFIT").map((p) => ({ id: p.id ?? "", label: pieceLabel(p), reason: why(p.unfitReason) }));
  const pending = slabCounts.pending + pieceCounts.pending;
  return {
    ok: pending === 0 && unfit.length === 0 && unfitPieces.length === 0,
    pending,
    slabs: slabCounts,
    pieces: pieceCounts,
    unfit,
    unfitPieces,
    nothingToVerify: slabCounts.total + pieceCounts.total === 0,
  };
}

/**
 * The verification note written on a rejected list.
 *
 * The unfit cut-to-size lines are named and said to be STAYING, because that is
 * the one thing Commercial cannot work out from the list itself: the unfit
 * slabs have gone off it and back into finished goods, and a line that is still
 * sitting there with a red flag on it would otherwise read as one the rejection
 * missed rather than one there is nowhere to send.
 */
export function rejectionNote(
  unfit: ReadonlyArray<{ slabNumber: number; reason: string }>,
  note?: string | null,
  pieces: ReadonlyArray<UnfitPiece> = [],
): string {
  const parts: string[] = [];
  if (unfit.length) parts.push(`${unfit.length} unfit: ${unfit.map((u) => `#${fmtSlabNo(u.slabNumber)} (${u.reason})`).join("; ")}`);
  if (pieces.length) parts.push(`${pieces.length} unfit cut-to-size line(s), still on the list: ${pieces.map((p) => `${p.label} (${p.reason})`).join("; ")}`);
  const head = parts.length ? `Rejected — ${parts.join(". ")}` : "Rejected";
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

export interface CheckerPieceView {
  id: string; crateId: string | null; crateNo: string | null;
  drawingNo: string | null; pieceNo: string | null; design: string;
  lengthMm: number | null; widthMm: number | null; thicknessMm: number | null;
  sqft: number | null; quantity: number; room: string | null; weightKg: number | null;
  notes: string | null;
  fit: string; unfitReason: string | null; checkedAt: string | null;
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
  /** cm | in — the floor reads sizes in the unit the sheet prints (answer 17).
   *  The piece lines are the exception the module already lives with: they are
   *  stored in millimetres whatever this says (round three, answer 5), and the
   *  screen converts them the same way the two sheets do. */
  measurementUnit: MeasurementUnit;
  crates: CheckerCrateView[]; slabs: CheckerSlabView[]; pieces: CheckerPieceView[];
  /** Both kinds of line together — what the progress bar and the Verify button
   *  read, and a list is only verified when this has nothing pending. */
  fit: FitCount;
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
 * One packed PIECE as the floor screen reads it — a WHITELIST, for the same
 * reason checkerSlabView is one and not a spread of the row: commercial_packed_
 * piece is a young table and the next column somebody puts on it (a rate per
 * square foot on the cut-to-size line is the obvious one) must not appear on a
 * store login's screen merely because it was added.
 *
 * Sizes stay in the MILLIMETRES the row stores; the screen converts them to the
 * list's unit with pieces-rules' own sizeFromMm, so the floor and the two
 * printed sheets can never show one piece at two sizes.
 */
export function checkerPieceView(p: Record<string, unknown>): CheckerPieceView {
  return {
    id: String(p.id ?? ""),
    crateId: vStr(p.crateId),
    crateNo: vStr(p.crateNo),
    drawingNo: vStr(p.drawingNo),
    pieceNo: vStr(p.pieceNo),
    design: String(p.design ?? ""),
    lengthMm: vNum(p.lengthMm), widthMm: vNum(p.widthMm), thicknessMm: vNum(p.thicknessMm),
    sqft: vNum(p.sqft),
    quantity: Number(p.quantity ?? 1),
    room: vStr(p.room),
    weightKg: vNum(p.weightKg),
    notes: vStr(p.notes),
    fit: String(p.fit ?? "PENDING"),
    unfitReason: vStr(p.unfitReason),
    checkedAt: vDate(p.checkedAt),
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
  const pieces = (list.pieces as Array<Record<string, unknown>> | undefined) ?? [];
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
    pieces: pieces.map(checkerPieceView),
    fit: fitCounts(
      slabs.map((s) => ({ fit: String(s.fit ?? "PENDING") })),
      pieces.map((p) => ({ fit: String(p.fit ?? "PENDING") })),
    ),
  };
}

/**
 * The dispatch check's verdict body, for a slab and for a cut-to-size line
 * alike: `fit` must be FIT or UNFIT (PENDING is where a line starts, not
 * something the floor sets), and UNFIT must say why — a rejected list sends
 * slabs back to stock and moves the order backwards, so "no reason given" is
 * not good enough to do that on. One function for both kinds because it is one
 * verdict on one enum; a second copy for pieces would be the place the two
 * rules quietly stopped agreeing.
 */
export function fitPatch(fit: unknown, unfitReason: unknown): { ok: true; fit: "FIT" | "UNFIT"; unfitReason: string | null } | { ok: false; reason: string } {
  const f = String(fit ?? "").trim().toUpperCase();
  if (f !== "FIT" && f !== "UNFIT") return { ok: false, reason: "fit must be FIT or UNFIT" };
  const why = String(unfitReason ?? "").trim();
  if (f === "UNFIT" && !why) return { ok: false, reason: "Say what is wrong with it" };
  return { ok: true, fit: f, unfitReason: f === "UNFIT" ? why : null };
}

// ────────────────── the crate a line is checked under, and the bulk marks ────
// Answer 1 gives the checker three ways to say "correct": one line, one crate,
// the whole list. The crate is therefore not just a heading on the screen any
// more — it is the thing an action is aimed at, so what belongs to it has to be
// decided once, here, and the screen and the route both read that same answer.
// A "mark crate as correct" that marked a line the checker could not see under
// that heading would be the worst kind of wrong: silent and plausible.

/**
 * WHICH CRATE IS THIS LINE IN? A slab is in a crate row of this list or in none.
 * A piece carries the crate number AS PRINTED on the customer's sheet as well,
 * and that number need not be a crate of ours — "1A", or crate 7 of a sheet
 * whose crates nobody has entered (pieces-rules matchCrate drops the link when
 * it does not match). Such lines are still a crate the man on the floor is
 * standing in front of, so they group under their own heading rather than being
 * tipped in with the lines that are in no crate at all.
 *
 *   "crate:<id>"  a crate row of this list
 *   "no:<number>" a crate number printed on a piece line, with no row of ours
 *   ""            in no crate
 */
export function checkerCrateKey(line: { crateId?: string | null; crateNo?: string | null }): string {
  const id = (line.crateId ?? "").trim();
  if (id) return `crate:${id}`;
  const no = (line.crateNo ?? "").trim();
  return no ? `no:${no}` : "";
}

export interface CheckerGroup<S, P> {
  /** What a "mark this crate correct" names — checkerCrateKey. */
  key: string;
  crateId: string | null;
  /** As printed: the crate row's number, or the number the piece lines type. */
  crateNo: string | null;
  /** False for a crate number that is not a crate row of this list. */
  onList: boolean;
  slabs: S[];
  pieces: P[];
  fit: FitCount;
}

/**
 * The screen's crates, in the order it shows them: the list's own crates by
 * crate number, then the crate numbers only the piece lines know about, then
 * whatever is in no crate. Empty crates are left out — a crate row with nothing
 * in it is a heading with no work under it, and the bulk mark on it would be a
 * button that does nothing.
 */
export function checkerGroups<
  S extends { crateId?: string | null; fit: string },
  P extends { crateId?: string | null; crateNo?: string | null; fit: string },
>(
  crates: ReadonlyArray<{ id: string; crateNo: number | string }>,
  slabs: ReadonlyArray<S>,
  pieces: ReadonlyArray<P>,
): Array<CheckerGroup<S, P>> {
  const order = new Map<string, number>();
  const numberOf = new Map<string, string>();
  crates.forEach((c, i) => { order.set(`crate:${c.id}`, i); numberOf.set(`crate:${c.id}`, String(c.crateNo)); });

  const groups = new Map<string, CheckerGroup<S, P>>();
  const group = (key: string): CheckerGroup<S, P> => {
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        crateId: key.startsWith("crate:") ? key.slice(6) : null,
        crateNo: key.startsWith("crate:") ? (numberOf.get(key) ?? null) : key.startsWith("no:") ? key.slice(3) : null,
        onList: order.has(key),
        slabs: [], pieces: [],
        fit: { total: 0, fit: 0, unfit: 0, pending: 0 },
      };
      groups.set(key, g);
    }
    return g;
  };
  for (const s of slabs) group(checkerCrateKey(s)).slabs.push(s);
  for (const p of pieces) group(checkerCrateKey(p)).pieces.push(p);

  const rank = (g: CheckerGroup<S, P>): number => (g.key.startsWith("crate:") ? 0 : g.key ? 1 : 2);
  return Array.from(groups.values())
    .map((g) => ({ ...g, fit: fitCounts(g.slabs, g.pieces) }))
    .sort((a, b) =>
      rank(a) - rank(b)
      || (rank(a) === 0 ? (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER) : 0)
      || compareCrateNo(a.crateNo ?? "", b.crateNo ?? ""));
}

export type BulkFitScope = { kind: "all" } | { kind: "crate"; key: string };

export interface BulkFitPlan {
  /** Exactly the rows to set FIT — nothing else is touched. */
  slabIds: string[];
  pieceIds: string[];
  marked: number;
  /** Lines left alone because the checker had already found something wrong. */
  skippedUnfit: number;
  /** Lines already passed. Counted apart from `marked` so the answer does not
   *  claim work the action did not do. */
  alreadyFit: number;
}

/**
 * WHAT A BULK "MARK CORRECT" TOUCHES: the PENDING lines of the scope, of both
 * kinds, and nothing else (answer 1).
 *
 * IT NEVER OVERWRITES AN UNFIT. A line already marked unfit is a deliberate
 * finding with a reason attached — it is the one thing the whole check exists
 * to produce — and a "mark all as correct" that quietly erased it would send a
 * cracked slab to a customer with the record saying it was looked at and
 * passed. So an UNFIT line is skipped and COUNTED, because a bulk action that
 * says "38 marked correct" while silently walking past two findings is telling
 * the checker the crate is clear when it is not. Clearing an unfit line is a
 * deliberate single tap on that line, which is honest about what it is doing.
 */
export function bulkFitPlan<
  S extends { id?: string; crateId?: string | null; fit: string },
  P extends { id?: string; crateId?: string | null; crateNo?: string | null; fit: string },
>(
  slabs: ReadonlyArray<S>,
  pieces: ReadonlyArray<P>,
  scope: BulkFitScope = { kind: "all" },
): BulkFitPlan {
  const inScope = (line: { crateId?: string | null; crateNo?: string | null }): boolean =>
    scope.kind === "all" || checkerCrateKey(line) === scope.key;

  const plan: BulkFitPlan = { slabIds: [], pieceIds: [], marked: 0, skippedUnfit: 0, alreadyFit: 0 };
  const take = (line: { id?: string; fit: string }, into: string[]): void => {
    if (line.fit === "UNFIT") { plan.skippedUnfit++; return; }
    if (line.fit === "FIT") { plan.alreadyFit++; return; }
    if (line.id) into.push(line.id);
    plan.marked++;
  };
  for (const s of slabs) if (inScope(s)) take(s, plan.slabIds);
  for (const p of pieces) if (inScope(p)) take(p, plan.pieceIds);
  return plan;
}

/** "38 marked correct, 2 left unfit" — what the bulk action reports. Both
 *  halves always, because the skipped half is the half that matters. */
export function bulkFitNote(plan: BulkFitPlan): string {
  if (!plan.marked && !plan.skippedUnfit && !plan.alreadyFit) return "Nothing here to mark";
  const bits = [`${plan.marked} marked correct`];
  if (plan.skippedUnfit) bits.push(`${plan.skippedUnfit} left unfit`);
  if (plan.alreadyFit) bits.push(`${plan.alreadyFit} already correct`);
  return bits.join(", ");
}

/** The bulk action's body: `scope` is "crate" or "all", and a crate scope names
 *  the group (checkerCrateKey) — including "" for the lines in no crate, which
 *  is a real heading on the screen and not a missing field. */
export function parseBulkFitScope(body: { scope?: unknown; crate?: unknown }): { ok: true; scope: BulkFitScope } | { ok: false; reason: string } {
  const s = String(body.scope ?? "").trim().toLowerCase();
  if (s === "all") return { ok: true, scope: { kind: "all" } };
  if (s === "crate") {
    if (body.crate === undefined || body.crate === null) return { ok: false, reason: "Say which crate to mark" };
    return { ok: true, scope: { kind: "crate", key: String(body.crate) } };
  }
  return { ok: false, reason: "scope must be crate or all" };
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
 *  IT NAMES WHAT WAS ACTUALLY IN FRONT OF THE CHECKER, both kinds of line. A
 *  cut-to-size list carries pieces alone and used to be passed with "no slab
 *  line to check", which recorded a check nobody performed; since answer 1 of
 *  round four the pieces were ticked one by one and the note has to say so, or
 *  the record of a piece-only shipment reads as a rubber stamp for ever. A list
 *  with neither kind on it still says there was nothing — which after canSubmit
 *  means a list that lost its last line while the checker had it. */
export function verificationNote(slabs: number, note?: string | null, pieces = 0): string {
  const bits: string[] = [];
  if (slabs > 0) bits.push(`${slabs} slab(s)`);
  if (pieces > 0) bits.push(`${pieces} cut-to-size line(s)`);
  const head = bits.length ? `All ${bits.join(" and ")} checked fit` : "Nothing on this list to check";
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
  /** Cut-to-size lines the check refused, named rather than numbered — they
   *  have no slab number, and there is no swap for them either. */
  unfitPieces: string[];
  /** Cut-to-size lines nobody has looked at yet. */
  uncheckedPieces: number;
  /** Names every line, ready for the 409. "" when ok. */
  reason: string;
}

/**
 * NOTHING SHIPS UNTIL THE LIST IS CORRECTED (answers 2 and 31, and answer 1 of
 * round four for the second kind of line). Every packed line must carry a FIT
 * verdict at the moment of dispatch: an UNFIT one is a line the dispatch team
 * refused, and a PENDING one is a line nobody has looked at — a replacement
 * swapped in after the check, say. Both stop the whole list, because a packing
 * list cannot be split and a FINAL list's lines cannot be edited: the honest
 * answer is "not this list, not yet", with the lines named so Commercial knows
 * which to swap or which to send the checker back to.
 *
 * A REFUSED CUT-TO-SIZE LINE IS NOT SWAPPED, IT IS RECUT. The swap that clears
 * an unfit slab takes another slab of the same design and thickness out of
 * finished goods; there is no such shelf for a piece cut to a customer's size,
 * so the sentence for a piece does not offer one.
 */
export function dispatchBlockers(
  slabs: ReadonlyArray<{ slabNumber: number; fit: string; unfitReason?: string | null }>,
  pieces: ReadonlyArray<PieceFitLike> = [],
): DispatchBlockers {
  const unfit = slabs.filter((s) => s.fit === "UNFIT").map((s) => Number(s.slabNumber)).sort((a, b) => a - b);
  const unchecked = slabs.filter((s) => s.fit !== "UNFIT" && s.fit !== "FIT").map((s) => Number(s.slabNumber)).sort((a, b) => a - b);
  const unfitPieces = pieces.filter((p) => p.fit === "UNFIT").map((p) => pieceLabel(p));
  const uncheckedPieces = pieces.filter((p) => p.fit !== "UNFIT" && p.fit !== "FIT").length;
  const clear = { unfit, unchecked, unfitPieces, uncheckedPieces };
  if (!unfit.length && !unchecked.length && !unfitPieces.length && !uncheckedPieces) return { ok: true, ...clear, reason: "" };
  const parts: string[] = [];
  if (unfit.length) {
    const why = new Map(slabs.filter((s) => s.fit === "UNFIT").map((s) => [Number(s.slabNumber), (s.unfitReason ?? "").trim()]));
    parts.push(`${unfit.length} slab(s) marked unfit by the dispatch check: ${unfit.map((n) => `#${fmtSlabNo(n)}${why.get(n) ? ` (${why.get(n)})` : ""}`).join("; ")} — swap each one for a slab of the same design and thickness`);
  }
  if (unchecked.length) {
    parts.push(`${unchecked.length} slab(s) not yet checked: ${unchecked.map((n) => `#${fmtSlabNo(n)}`).join(", ")} — the dispatch team has to pass them first`);
  }
  if (unfitPieces.length) {
    const why = new Map(pieces.filter((p) => p.fit === "UNFIT").map((p) => [pieceLabel(p), (p.unfitReason ?? "").trim()]));
    parts.push(`${unfitPieces.length} cut-to-size line(s) marked unfit: ${unfitPieces.map((l) => `${l}${why.get(l) ? ` (${why.get(l)})` : ""}`).join("; ")} — each one has to be recut and repacked`);
  }
  if (uncheckedPieces) {
    parts.push(`${uncheckedPieces} cut-to-size line(s) not yet checked — the dispatch team has to pass them first`);
  }
  return { ok: false, ...clear, reason: `Nothing ships until the list is corrected. ${parts.join(". ")}.` };
}

/**
 * WHAT THE PACKING LIST'S OWN SCREEN SAYS AFTER A LATE VERDICT (answers 30 and
 * 31, and answer 1 of round four for the second kind of line). The dispatch
 * check may refuse a line on a list it has already concluded — canRecheck is
 * true on a VERIFIED or a FINAL list, and the check screen writes the verdict
 * without moving the list's status or its verification note. Commercial does
 * not sit on the check screen, so the packing list is where that news has to
 * land, and it has to land for BOTH kinds of line: the count behind this
 * banner was taken over the slabs alone, so a list whose twelve slabs all
 * passed and whose one cut-to-size line was refused at loading read "12/12,
 * all fit" with nothing amber on it, and the recut nobody was told about never
 * started.
 *
 * A REFUSED PIECE IS RECUT, NOT SWAPPED, so it gets a sentence of its own: it
 * has no Swap beside it and no shelf to take a replacement from (answer 1 —
 * "it was cut to a customer's size and there is nothing to return it to"). Its
 * lines are named rather than counted, because a cut-to-size line has no slab
 * number to look up and the table under the banner may hold forty of them.
 *
 * Nothing outstanding, or a list no longer open to a late verdict, answers
 * null — the caller draws no banner at all.
 */
export function recheckBanner(
  listStatus: string,
  slabs: ReadonlyArray<{ fit: string }>,
  pieces: ReadonlyArray<PieceFitLike> = [],
): string | null {
  if (!canRecheck(listStatus)) return null;
  const s = fitCounts(slabs);
  const p = fitCounts(pieces);
  if (!s.unfit && !p.unfit && !s.pending && !p.pending) return null;

  const parts: string[] = [];
  if (s.unfit) {
    parts.push(`${s.unfit} slab(s) refused by the dispatch check — nothing ships until each is swapped for a slab of the same design and thickness (Swap beside the slab)`);
  }
  if (p.unfit) {
    const named = pieces.filter((x) => x.fit === "UNFIT").map((x) => {
      const why = (x.unfitReason ?? "").trim();
      return `${pieceLabel(x)}${why ? ` (${why})` : ""}`;
    });
    parts.push(`${p.unfit} cut-to-size line(s) refused by the dispatch check: ${named.join("; ")} — nothing ships until each is recut and repacked`);
  }
  // A pending line is the swap that has come in and not been looked at yet, so
  // it is only news while nothing worse is outstanding: on a list that still
  // carries a refusal, the refusal is what has to be cleared first and saying
  // both at once buries it.
  if (!parts.length) {
    if (s.pending) parts.push(`${s.pending} swapped-in slab(s) await the dispatch check — nothing ships until they are marked fit`);
    if (p.pending) parts.push(`${p.pending} cut-to-size line(s) await the dispatch check — nothing ships until they are marked fit`);
  }
  return `${parts.join(". ")}.`;
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
