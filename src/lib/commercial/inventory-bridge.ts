// The one place the Commercial module touches finished goods.
//
// Stock check, hold, pack and dispatch all go through changeSlabStatus in
// lib/inventory/finishedSlab.ts — the same function the Finished Goods page
// uses — so a hold placed here is a RESERVED slab there, with the reference
// in reservedForPi and the customer in customer, and the inventory sweep
// expires it exactly as it would any other hold.
//
// WHY THIS BYPASSES /api/inventory/status. That route refuses COMMERCIAL every
// action except cts/uncts, on the stated ground that `release` would let
// Commercial clear OTHER people's PI holds. This module can honour that
// concern properly: it knows which holds are its own (commercial_stock_hold),
// so releaseHeld() releases only slabs whose reservedForPi equals the hold's
// own reference. Every function here is called from a route that has already
// passed commercialGate("write").
//
// SALES-APPROVED STOCK ONLY ON EVERY ACQUIRING PATH, for the same reason the
// inventory routes apply it: a non-admin never sees or touches a slab in an
// unapproved (design, batch) pair. strict=true — failing to read the approval
// list fails closed. Search, hold, pack and dispatch all ACQUIRE, and all four
// filter.
//
// A RESTORE IS NOT AN ACQUISITION, and unpackSlabs is the one function here
// that only ever gives stock back. It reads unfiltered (see there): filtering a
// restore stranded PACKED, with no route back, any slab an admin had packed
// out of an unapproved pair the moment a non-admin was the one to reject or
// reopen the list.
//
// THE DECISIONS ARE IN holds-rules.ts, not here. Every rule in this file is a
// database call away from a test, and the adversarial review found four of them
// wrong without a query being at fault. Anything this module DECIDES —
// what counts as missing, whether a mark may be assumed whole, whose hold a
// slab is under, what a spent hold became — is a pure function there and is run
// by tests/commercialHolds.test.ts.
import { prisma } from "@/lib/prisma";
import { changeSlabStatus, sweepExpiredReservations } from "@/lib/inventory/finishedSlab";
import { buildInventoryWhere, getUnapprovedSlabNumbers } from "@/lib/inventory/searchWhere";
import { canonThickness } from "@/lib/thickness";
import { displayBatch } from "@/lib/batchDisplay";
import { sqftFromIn } from "./measure";
import { logOrderEvent } from "./events";
import {
  slabMarkOf, isFullSlab, notFullSlabReason, missingSlabNumbers, foreignHoldReason,
  holdStatusAfterReconcile, approvalFilterApplies, canonicalFromMap,
  type ReconcileCounts, type BridgeOp,
} from "./holds-rules";
// The swap's own decisions (answer 30) are pure and live with the rest of the
// packing rules, so tests/commercialPacking.test.ts runs them without Prisma.
import { swapReleaseOutcome, type SwapUndoLike } from "./packing-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface SlabRow {
  slabNumber: number;
  design: string | null;
  designCanonical: string | null;
  grade: string | null;
  thickness: string | null;        // as stored
  thicknessCanonical: string;      // '2 cm' / '3 cm' / ...
  batchKey: string | null;
  batchNumber: string | null;
  batchDisplay: string;
  bay: string | null;
  frame: string | null;
  lengthIn: number;
  widthIn: number;
  sqft: number;
  status: string;
  slabMark: string;
  reservedForPi: string | null;
  customer: string | null;
  reservationExpiresAt: string | null;
  polishType: string | null;
  rwStatus: string | null;
}

export interface BatchGroup {
  batchKey: string | null;
  batchDisplay: string;
  design: string | null;
  thickness: string;
  count: number;
  sqft: number;
  grades: Record<string, number>;
  slabs: SlabRow[];
}

const SELECT = {
  slabNumber: true, design: true, grade: true, slabThickness: true, batchKey: true, batchNumber: true,
  bayNumber: true, frameNumber: true, lengthIn: true, widthIn: true, status: true, slabMark: true,
  reservedForPi: true, customer: true, reservationExpiresAt: true, polishType: true, rwStatus: true,
} as const;

/**
 * variant → canonical, the whole fg_design_alias table in one read.
 *
 * WHY NOT canonicalDesign(). That helper is a `findUnique` keyed by the exact
 * variant, and toRow called it once PER ROW: one sequential round trip to Neon
 * for every slab in the answer. Measured on the live database 2026-09-06, 500
 * rows of Carrara Royale took 25.3 s that way — and Carrara Royale has 967
 * AVAILABLE slabs, so a plain stock check on it was a ~49 s function on a
 * platform that stops it long before. The same 500 rows through one findMany
 * and a Map: 0.097 s. The alias table is 287 rows.
 *
 * Read once per bridge CALL, not memoised across calls: designs get merged
 * while the app is running, and a stock check that answers from a cached alias
 * table is the class of bug the design-alias merge exists to fix.
 */
async function aliasMap(): Promise<Map<string, string>> {
  const rows: Array<{ variant: string; canonical: string }> =
    await db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []);
  const m = new Map<string, string>();
  for (const a of rows) m.set(a.variant, a.canonical);
  return m;
}

function toRow(r: Record<string, unknown>, aliases: Map<string, string>): SlabRow {
  const lengthIn = Number(r.lengthIn ?? 137) || 137;
  const widthIn = Number(r.widthIn ?? 79) || 79;
  const design = (r.design as string | null) ?? null;
  return {
    slabNumber: Number(r.slabNumber),
    design,
    designCanonical: canonicalFromMap(aliases, design),
    grade: (r.grade as string | null) ?? null,
    thickness: (r.slabThickness as string | null) ?? null,
    thicknessCanonical: canonThickness(r.slabThickness),
    batchKey: (r.batchKey as string | null) ?? null,
    batchNumber: (r.batchNumber as string | null) ?? null,
    batchDisplay: displayBatch((r.batchNumber as string | null) ?? (r.batchKey as string | null) ?? null),
    bay: (r.bayNumber as string | null) ?? null,
    frame: (r.frameNumber as string | null) ?? null,
    lengthIn, widthIn,
    sqft: sqftFromIn(lengthIn, widthIn),
    status: String(r.status),
    // FAIL CLOSED. This used to read `String(r.slabMark ?? "FULL_SLAB")` —
    // the only place in the codebase that ANSWERS "whole" when it cannot read
    // the mark. finishedSlab.ts refuses a dispatch it cannot verify the mark
    // of and searchWhere.ts refuses to build the filter at all; both say why at
    // length. "Whole" is the answer that puts the slab in a stock check, on a
    // hold and in a crate, so an unreadable mark is its own value now and every
    // FULL_SLAB test below refuses it (holds-rules.slabMarkOf).
    slabMark: slabMarkOf(r.slabMark),
    reservedForPi: (r.reservedForPi as string | null) ?? null,
    customer: (r.customer as string | null) ?? null,
    reservationExpiresAt: r.reservationExpiresAt ? new Date(r.reservationExpiresAt as Date).toISOString() : null,
    polishType: (r.polishType as string | null) ?? null,
    rwStatus: (r.rwStatus as string | null) ?? null,
  };
}

/** Rows per round trip while paging a stock check. */
const PAGE = 2000;
/** The point at which a stock check stops and says so rather than reading on.
 *  A design search that matches this many AVAILABLE slabs is not a stock check
 *  gone wrong on our side — but a silent truncation would be, so it throws. */
const MAX_SEARCH_ROWS = 50_000;

/**
 * EVERY row matching `where`, not the first five thousand.
 *
 * searchAvailable applied `take: 5000` and THEN narrowed in JS by thickness,
 * grade, mark and the approval list. Truncation therefore fell on the raw
 * design match, before any of that: with a term matching more than the cap, the
 * 3-cm slabs of a design could sit entirely past row 5000 and the screen would
 * report zero available — and then offer to raise a production request for
 * stock that is in the yard. Nothing on the screen would say a limit had been
 * hit.
 *
 * MEASURED, AND HONESTLY: on live Neon 2026-09-06 no term the picker can send
 * reaches the old cap. Every one of the 161 design names it offers was run
 * through buildInventoryWhere's clause; the widest match was 3,082 AVAILABLE
 * rows and the largest single design 1,506. So the 5,000 did not bite on
 * today's yard — this is a silent wrong answer waiting on stock growth, not
 * one the screens were giving. It was still worth removing: the failure mode
 * is a stock check that reads zero and then offers a production request for
 * slabs that are in the building, with nothing saying a limit was hit. Proved
 * by running this function and the old shape side by side with the cap lowered
 * to 100 on a design with 967 slabs: old 100, new 967; with a 3 cm filter, old
 * 64, new 615.
 *
 * Cursor paging on the unique slabNumber, so a row cannot be missed or read
 * twice. Ten round trips for 967 rows at PAGE 100; one for anything under 2,000.
 */
async function readAllPages(where: unknown): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let cursor: number | null = null;
  for (;;) {
    const page: Record<string, unknown>[] = await db.finishedSlab.findMany({
      where, select: SELECT, orderBy: { slabNumber: "asc" }, take: PAGE,
      ...(cursor == null ? {} : { skip: 1, cursor: { slabNumber: cursor } }),
    });
    out.push(...page);
    if (page.length < PAGE) return out;
    if (out.length >= MAX_SEARCH_ROWS) {
      throw new Error(`Stock check matched more than ${MAX_SEARCH_ROWS} slabs — narrow the design before reading further.`);
    }
    cursor = Number(page[page.length - 1].slabNumber);
  }
}

/** Slabs a non-admin may not see or touch, as a Set for filtering. */
async function unapprovedSet(isAdmin: boolean): Promise<Set<number>> {
  if (isAdmin) return new Set();
  return new Set(await getUnapprovedSlabNumbers(true));
}

/**
 * AVAILABLE full slabs of a design (canonical, alias-aware) and thickness,
 * grouped by batch. Lapsed holds are swept first so a slab whose 5 days ran
 * out yesterday shows as available today, as it should. Cut-marked slabs
 * (CTS / SAMPLE) are excluded: dispatch would refuse them, so a stock check
 * that counted them would over-promise.
 */
export async function searchAvailable(opts: { design: string; thickness?: string | null; grade?: string | null; isAdmin: boolean }): Promise<{ groups: BatchGroup[]; total: number; totalSqft: number }> {
  await sweepExpiredReservations();
  // The design goes into the QUERY (buildInventoryWhere resolves it through
  // fg_design_alias, so a merged-away variant is matched by the name it is
  // shown under). What follows in JS is the narrowing the query cannot do:
  // thickness canonicalised across '20mm' / '2cm' / '2 cm', grade, the mark,
  // and the sales-approval list.
  const params = new URLSearchParams({ design: opts.design, status: "AVAILABLE" });
  const where = await buildInventoryWhere(params);
  const [aliases, hidden] = await Promise.all([aliasMap(), unapprovedSet(opts.isAdmin)]);
  const rows = await readAllPages(where);
  const wantDesign = (canonicalFromMap(aliases, opts.design) ?? opts.design).toLowerCase();
  const wantThk = opts.thickness ? canonThickness(opts.thickness) : null;
  const wantGrade = opts.grade ? opts.grade.trim().toUpperCase() : null;
  const groups = new Map<string, BatchGroup>();
  let total = 0, totalSqft = 0;
  for (const r of rows) {
    const row = toRow(r, aliases);
    if (hidden.has(row.slabNumber)) continue;
    if ((row.designCanonical ?? row.design ?? "").toLowerCase() !== wantDesign) continue;
    if (wantThk && row.thicknessCanonical !== wantThk) continue;
    if (wantGrade && (row.grade ?? "").toUpperCase() !== wantGrade) continue;
    if (!isFullSlab(row.slabMark)) continue;
    const key = `${row.batchDisplay}|${row.thicknessCanonical}`;
    let g = groups.get(key);
    if (!g) {
      g = { batchKey: row.batchKey, batchDisplay: row.batchDisplay, design: row.designCanonical ?? row.design, thickness: row.thicknessCanonical, count: 0, sqft: 0, grades: {}, slabs: [] };
      groups.set(key, g);
    }
    g.count++; g.sqft = Math.round((g.sqft + row.sqft) * 100) / 100;
    const gk = row.grade ?? "ungraded";
    g.grades[gk] = (g.grades[gk] ?? 0) + 1;
    g.slabs.push(row);
    total++; totalSqft += row.sqft;
  }
  const list = Array.from(groups.values()).sort((a, b) => b.count - a.count || a.batchDisplay.localeCompare(b.batchDisplay));
  return { groups: list, total, totalSqft: Math.round(totalSqft * 100) / 100 };
}

/** Read the current inventory rows for a set of slab numbers. */
export async function readSlabs(slabNumbers: number[], isAdmin: boolean): Promise<SlabRow[]> {
  if (!slabNumbers.length) return [];
  const [hidden, aliases] = await Promise.all([unapprovedSet(isAdmin), aliasMap()]);
  const rows: Record<string, unknown>[] = await db.finishedSlab.findMany({ where: { slabNumber: { in: slabNumbers } }, select: SELECT });
  const out: SlabRow[] = [];
  for (const r of rows) { const row = toRow(r, aliases); if (!hidden.has(row.slabNumber)) out.push(row); }
  return out;
}

/** The same read WITHOUT the sales-approval filter. Not exported: an
 *  unfiltered read is a restore's privilege, not a general one. */
async function readSlabsUnfiltered(slabNumbers: number[]): Promise<SlabRow[]> {
  if (!slabNumbers.length) return [];
  const aliases = await aliasMap();
  const rows: Record<string, unknown>[] = await db.finishedSlab.findMany({ where: { slabNumber: { in: slabNumbers } }, select: SELECT });
  return rows.map((r) => toRow(r, aliases));
}

/** The read each bridge operation gets, decided by the one table that says
 *  which of them apply the sales-approval filter (holds-rules
 *  .approvalFilterApplies, and the reasoning for `unpack` is written there).
 *  Every write below reads through this, so the table is the behaviour and not
 *  a description of it. */
async function readForOp(op: BridgeOp, slabNumbers: number[], isAdmin: boolean): Promise<SlabRow[]> {
  return approvalFilterApplies(op) ? readSlabs(slabNumbers, isAdmin) : readSlabsUnfiltered(slabNumbers);
}

export interface BridgeResult {
  updated: number;
  missing: number[];
  skipped: { slab: number; reason: string }[];
  /** The rows as they were BEFORE the change, for the module's snapshot tables. */
  before: SlabRow[];
}

/** Put AVAILABLE slabs on hold for `days` against `reference`. */
export async function holdSlabs(opts: { slabNumbers: number[]; reference: string; customer: string | null; days: number; by: string | null; isAdmin: boolean }): Promise<BridgeResult> {
  const before = await readForOp("hold", opts.slabNumbers, opts.isAdmin);
  const allowed = before.filter((r) => isFullSlab(r.slabMark)).map((r) => r.slabNumber);
  const cut = before.filter((r) => !isFullSlab(r.slabMark)).map((r) => ({ slab: r.slabNumber, reason: notFullSlabReason(r.slabMark) }));
  const missing = missingSlabNumbers(opts.slabNumbers, before);
  const res = allowed.length
    ? await changeSlabStatus(allowed, "reserve", { pi: opts.reference, customer: opts.customer, expiryDays: opts.days, by: opts.by, source: "Commercial hold", onlyFrom: ["AVAILABLE"] })
    : { updated: 0, missing: [], skipped: [] };
  return { updated: res.updated, missing: [...missing, ...res.missing], skipped: [...cut, ...res.skipped], before };
}

/** Release slabs held under `reference` — and ONLY those, so a hold placed by
 *  somebody else under another reference is never cleared from here. */
export async function releaseHeld(opts: { slabNumbers: number[]; reference: string; by: string | null; isAdmin: boolean }): Promise<BridgeResult> {
  const before = await readForOp("release", opts.slabNumbers, opts.isAdmin);
  const ours = before.filter((r) => r.status === "RESERVED" && (r.reservedForPi ?? "") === opts.reference).map((r) => r.slabNumber);
  const notOurs = before.filter((r) => !ours.includes(r.slabNumber)).map((r) => ({ slab: r.slabNumber, reason: r.status === "RESERVED" ? `held under ${r.reservedForPi ?? "another reference"}` : `${r.status}, not on hold` }));
  const missing = missingSlabNumbers(opts.slabNumbers, before);
  const res = ours.length
    ? await changeSlabStatus(ours, "release", { by: opts.by, source: "Commercial hold", onlyFrom: ["RESERVED"] })
    : { updated: 0, missing: [], skipped: [] };
  return { updated: res.updated, missing: [...missing, ...res.missing], skipped: [...notOurs, ...res.skipped], before };
}

/**
 * Mark slabs PACKED (from AVAILABLE or RESERVED). Cut-marked slabs refused —
 * and, since the review, SOMEBODY ELSE'S HELD SLABS refused too.
 *
 * `references` is what this caller may pack under: for a packing list, its
 * order's number, its enquiry's number and its own holds' references —
 * `ownReferences(list.order)` in packing-lists/_lib.ts, the same list the
 * intake check (`slabEligibility`) already uses when a slab is ADDED to a list.
 * Submit did not re-ask, and a hold can arrive between the add and the submit:
 * two orders may both have a slab on a DRAFT list, order B holds it, order A
 * submits, and the bridge converted B's RESERVED straight to PACKED. B's hold
 * then reconciled to "packed" and B's screen claimed the slab was on ITS list.
 *
 * REQUIRED, not optional, and an empty array refuses every held slab: a caller
 * that cannot say what it owns owns nothing. See holds-rules.foreignHoldReason.
 */
export async function packSlabs(opts: { slabNumbers: number[]; references: readonly string[]; by: string | null; isAdmin: boolean }): Promise<BridgeResult> {
  const before = await readForOp("pack", opts.slabNumbers, opts.isAdmin);
  const refused: { slab: number; reason: string }[] = [];
  const allowed: number[] = [];
  for (const r of before) {
    if (!isFullSlab(r.slabMark)) { refused.push({ slab: r.slabNumber, reason: notFullSlabReason(r.slabMark) }); continue; }
    const foreign = foreignHoldReason(r, opts.references ?? []);
    if (foreign) { refused.push({ slab: r.slabNumber, reason: foreign }); continue; }
    allowed.push(r.slabNumber);
  }
  const missing = missingSlabNumbers(opts.slabNumbers, before);
  const res = allowed.length
    ? await changeSlabStatus(allowed, "pack", { by: opts.by, source: "Commercial packing", onlyFrom: ["AVAILABLE", "RESERVED"] })
    : { updated: 0, missing: [], skipped: [] };
  return { updated: res.updated, missing: [...missing, ...res.missing], skipped: [...refused, ...res.skipped], before };
}

/**
 * Undo a pack (PACKED → AVAILABLE) when a packing list is rejected or a slab is
 * pulled from it. Uses `release`, which is the only transition out of PACKED;
 * the slab loses any hold stamp with it, so re-hold if needed.
 *
 * THE ONE READ HERE THAT DOES NOT APPLY THE SALES-APPROVAL FILTER, and that is
 * the point. The filter exists to stop a non-admin SEEING or COMMITTING stock
 * in an unapproved (design, batch) pair. Putting a slab back is neither: it
 * ends a commitment. Filtering it meant a slab an admin had legitimately packed
 * out of an unapproved pair was invisible to a non-admin checker, so the
 * rejection that should have returned it to stock quietly returned nothing and
 * the slab stayed PACKED with no route out — not on the list any more, not
 * available to anybody, and nothing on any screen saying so. `isAdmin` stays in
 * the signature (every other bridge function takes it and the callers pass it
 * uniformly) and deliberately does not gate the read.
 */
export async function unpackSlabs(opts: { slabNumbers: number[]; by: string | null; isAdmin: boolean }): Promise<BridgeResult> {
  const before = await readForOp("unpack", opts.slabNumbers, opts.isAdmin);
  const packed = before.filter((r) => r.status === "PACKED").map((r) => r.slabNumber);
  const missing = missingSlabNumbers(opts.slabNumbers, before);
  const res = packed.length
    ? await changeSlabStatus(packed, "release", { by: opts.by, source: "Commercial packing", onlyFrom: ["PACKED"] })
    : { updated: 0, missing: [], skipped: [] };
  return { updated: res.updated, missing: [...missing, ...res.missing], skipped: res.skipped, before };
}

/** Dispatch packed (or held) slabs under the order's reference and customer. */
export async function dispatchSlabs(opts: { slabNumbers: number[]; reference: string; customer: string; by: string | null; isAdmin: boolean }): Promise<BridgeResult> {
  const before = await readForOp("dispatch", opts.slabNumbers, opts.isAdmin);
  const res = before.length
    ? await changeSlabStatus(before.map((r) => r.slabNumber), "dispatch", { pi: opts.reference, customer: opts.customer, by: opts.by, source: "Commercial dispatch", onlyFrom: ["PACKED", "RESERVED"] })
    : { updated: 0, missing: [], skipped: [] };
  const missing = missingSlabNumbers(opts.slabNumbers, before);
  return { updated: res.updated, missing: [...missing, ...res.missing], skipped: res.skipped, before };
}

/**
 * Bring a hold's own record in line with the inventory: slabs no longer
 * RESERVED under the hold's reference are marked released on the hold (the
 * inventory sweep may have expired them, or a packing list consumed them).
 *
 * WHAT THE COUNTS MEAN, and it is now four of them rather than three:
 *   stillHeld  — RESERVED, under this hold's own reference. The hold is live.
 *   packed     — PACKED or DISPATCHED: the hold ended in a packing list.
 *   released   — READ, and no longer this hold's: swept, or handed back.
 *   unreadable — asked for and no fg_finished_slab row came back at all. That
 *                is not a release: nobody released it and we do not know that
 *                anybody did. It used to be counted as one, which meant a
 *                vanished row could turn a hold RELEASED (see below) purely
 *                because we could not read it.
 *
 * The status a spent hold takes is holds-rules.holdStatusAfterReconcile, which
 * is where the "any packed and nothing outstanding is CONSUMED" rule and its
 * reasoning live.
 */
export async function reconcileHold(holdId: string): Promise<ReconcileCounts> {
  const empty: ReconcileCounts = { stillHeld: 0, packed: 0, released: 0, unreadable: 0 };
  const hold = await db.commercialStockHold.findUnique({ where: { id: holdId }, include: { slabs: true } });
  if (!hold) return empty;
  const live: Record<string, unknown>[] = await db.finishedSlab.findMany({
    where: { slabNumber: { in: hold.slabs.map((s: { slabNumber: number }) => s.slabNumber) } },
    select: { slabNumber: true, status: true, reservedForPi: true },
  });
  const byNo = new Map(live.map((r) => [Number(r.slabNumber), r]));
  const now = new Date();
  const counts: ReconcileCounts = { stillHeld: 0, packed: 0, released: 0, unreadable: 0 };
  for (const s of hold.slabs as Array<{ id: string; slabNumber: number; releasedAt: Date | null; packedAt: Date | null }>) {
    const r = byNo.get(s.slabNumber);
    if (!r) {
      // No row. The slab is certainly not held any more, so it comes off the
      // hold — but it is counted apart from a real release, because "we could
      // not read it" and "somebody gave it back" are different facts and the
      // hold's closing status used to be decided by conflating them.
      counts.unreadable++;
      if (!s.releasedAt) await db.commercialStockHoldSlab.update({ where: { id: s.id }, data: { releasedAt: now } });
      continue;
    }
    if (String(r.status) === "RESERVED" && (r.reservedForPi ?? "") === hold.reference) { counts.stillHeld++; continue; }
    if (String(r.status) === "PACKED" || String(r.status) === "DISPATCHED") {
      counts.packed++;
      if (!s.packedAt) await db.commercialStockHoldSlab.update({ where: { id: s.id }, data: { packedAt: now } });
      continue;
    }
    counts.released++;
    if (!s.releasedAt) await db.commercialStockHoldSlab.update({ where: { id: s.id }, data: { releasedAt: now } });
  }
  if (hold.status === "ACTIVE" && counts.stillHeld === 0) {
    const status = holdStatusAfterReconcile(counts, hold.expiresAt as Date, now);
    await db.commercialStockHold.update({ where: { id: holdId }, data: { status, releasedAt: hold.releasedAt ?? now } });
    if (status === "EXPIRED" && hold.orderId) await regressExpiredOrder(hold.orderId, hold.reference, now);
  }
  return counts;
}

/**
 * Answer 11 (owner, 2026-09-07): "no extension. On expiry they go back to the
 * hold step again." An order whose LAST live hold has lapsed is no longer
 * stock-checked, so it returns to CONFIRMED and the stock check is done over
 * — a fresh hold, a fresh five days. Only the two stages the hold carried it
 * through come back: STOCK_CHECKED and PI_ISSUED. An order that is already
 * packing has PACKED slabs, and a hold with packed slabs is CONSUMED, never
 * EXPIRED, so this is unreachable there by construction; the status test is
 * belt and braces for a hold released by hand after packing began. The
 * stamps stay (stockCheckedAt is history); only the status moves, which is
 * why this writes the row directly rather than through moveOrder, whose
 * stagePatch would re-stamp confirmedAt as if the order were confirmed today.
 */
async function regressExpiredOrder(orderId: string, reference: string, now: Date): Promise<void> {
  const order = await db.commercialOrder.findUnique({ where: { id: orderId }, select: { status: true, number: true } });
  if (!order || (order.status !== "STOCK_CHECKED" && order.status !== "PI_ISSUED")) return;
  const others = await db.commercialStockHold.count({ where: { orderId, status: "ACTIVE" } });
  if (others > 0) return;
  await db.commercialOrder.update({ where: { id: orderId }, data: { status: "CONFIRMED" } });
  await logOrderEvent(orderId, "hold_expired", {
    note: `Hold ${reference} expired with nothing packed — back to the stock check (${stageLabel(order.status)} → Confirmed)`,
    payload: { from: order.status, to: "CONFIRMED", reference, at: now.toISOString() },
  });
}

function stageLabel(status: string): string {
  return status === "STOCK_CHECKED" ? "Stock checked" : status === "PI_ISSUED" ? "PI issued" : status;
}

/**
 * SWAP ONE PACKED SLAB FOR ANOTHER (answer 30): the dispatch check refused a
 * slab on a FINAL list, and the recovery is by hand — take the refused slab out
 * of the crate and put a like-for-like in. In finished goods that is two moves
 * with nothing between them that the yard would recognise as a state:
 *
 *   1. the replacement goes PACKED — the ACQUIRING path, so it reads through
 *      the sales-approval filter (holds-rules.approvalFilterApplies "pack"),
 *      refuses a cut slab and somebody else's hold exactly as packSlabs does,
 *      and is done FIRST: if the yard will not give up the replacement, the
 *      refused slab stays in the crate and the caller is told, and nothing has
 *      moved;
 *   2. the refused slab is released (PACKED → AVAILABLE) — a restore, read
 *      unfiltered for the reason unpackSlabs gives — and, when it came off one
 *      of this order's holds and that hold still has days to run, put back on
 *      it (AVAILABLE → RESERVED under the hold's reference, lapsing when the
 *      hold does) so a five-day hold is not silently ended by a swap.
 *
 * STEP 2 IS A PRECONDITION, NOT A COURTESY (swapReleaseOutcome). The swap only
 * holds if THIS call took the refused slab out of PACKED. A refused slab that
 * is no longer PACKED was already swapped or released by somebody else, and
 * reading that as "already done" let two clerks swap the same UNFIT slab at
 * once: both POSTs succeeded, the row ended up naming the second replacement,
 * and the FIRST replacement stayed PACKED against nothing, on no list, with no
 * screen saying so. Either refusal — not packed any more, or the inventory not
 * confirming the release — unpacks the replacement again so that two slabs are
 * never PACKED against one crate slot; the caller sees `packed: false`,
 * `released: false` and the reason, and the list is left as it was. A failure
 * to re-hold is reported but is not a failure of the swap — the slab is back
 * in stock either way, which is where the owner said a refused slab goes.
 */
export async function swapPackedSlab(opts: {
  refusedSlabNumber: number;
  replacementSlabNumber: number;
  /** What this order may pack under: ownReferences(order). */
  references: readonly string[];
  /** The hold the refused slab came off, if it is still running. */
  rehold: { reference: string; customer: string | null; days: number } | null;
  by: string | null;
  isAdmin: boolean;
}): Promise<{
  packed: boolean;
  released: boolean;
  reheld: boolean;
  /** Every reason anything was refused, by slab. */
  skipped: { slab: number; reason: string }[];
  before: SlabRow[];
}> {
  const skipped: { slab: number; reason: string }[] = [];

  const pack = await packSlabs({ slabNumbers: [opts.replacementSlabNumber], references: opts.references, by: opts.by, isAdmin: opts.isAdmin });
  skipped.push(...bridgeRefusals(pack));
  if (pack.updated !== 1) return { packed: false, released: false, reheld: false, skipped, before: pack.before };

  const back = await unpackSlabs({ slabNumbers: [opts.refusedSlabNumber], by: opts.by, isAdmin: opts.isAdmin });
  skipped.push(...bridgeRefusals(back));
  const release = swapReleaseOutcome(opts.refusedSlabNumber, back.before, back.updated);
  if (!release.ok) {
    // Two slabs PACKED for one slot is the state this undo exists to prevent —
    // and so is the losing half of a double swap (release.wasPacked false).
    const undo = await unpackSlabs({ slabNumbers: [opts.replacementSlabNumber], by: opts.by, isAdmin: opts.isAdmin });
    if (undo.updated !== 1) skipped.push({ slab: opts.replacementSlabNumber, reason: "packed for the swap and could NOT be put back — check it in finished goods" });
    if (!skipped.some((s) => s.slab === opts.refusedSlabNumber)) skipped.push({ slab: opts.refusedSlabNumber, reason: release.reason });
    return { packed: false, released: false, reheld: false, skipped, before: [...pack.before, ...back.before] };
  }

  let reheld = false;
  if (opts.rehold) {
    const held = await changeSlabStatus([opts.refusedSlabNumber], "reserve", {
      pi: opts.rehold.reference, customer: opts.rehold.customer, expiryDays: opts.rehold.days,
      by: opts.by, source: "Commercial hold", onlyFrom: ["AVAILABLE"],
    });
    reheld = held.updated === 1;
    for (const s of held.skipped) skipped.push({ slab: s.slab, reason: `not put back on hold: ${s.reason}` });
    for (const n of held.missing) skipped.push({ slab: n, reason: "not put back on hold: not found in finished goods" });
  }
  return { packed: true, released: true, reheld, skipped, before: [...pack.before, ...back.before] };
}

/**
 * PUT A SWAP BACK when the inventory moved but the list did not. The route
 * writes the packed-slab row, the hold-slab stamps, the verification note and
 * the slab_swapped event in ONE db.$transaction; if that transaction fails,
 * finished goods has already been changed and nothing else has, so the two
 * slabs are the wrong way round against a list that still names the refused
 * one. This walks them back, in the order that never leaves both PACKED:
 *
 *   1. the replacement is unpacked (and put back on the hold it came off, when
 *      it came off one — a swap that did not happen must not end a customer's
 *      five-day hold either);
 *   2. the refused slab is packed again, because the list row still names it:
 *      PACKED is the state that matches the document.
 *
 * It never throws — it is the compensation for something that already went
 * wrong — and it REPORTS what it managed (SwapUndoLike) so the caller can log
 * a note naming both slabs. A repack that fails leaves the refused slab held
 * or in open stock while the list shows it packed; that is a real divergence
 * and the log is the only thing that will tell anybody, which is why the state
 * is read back rather than guessed.
 */
export async function undoSwapPackedSlab(opts: {
  refusedSlabNumber: number;
  replacementSlabNumber: number;
  /** What this order may pack under: ownReferences(order). */
  references: readonly string[];
  /** The hold the REPLACEMENT came off, if it was on one. */
  replacementRehold: { reference: string; customer: string | null; days: number } | null;
  by: string | null;
  isAdmin: boolean;
}): Promise<SwapUndoLike> {
  let replacementUnpacked = false;
  let replacementHold: string | null = null;
  try {
    const undo = await unpackSlabs({ slabNumbers: [opts.replacementSlabNumber], by: opts.by, isAdmin: opts.isAdmin });
    replacementUnpacked = undo.updated === 1;
    if (replacementUnpacked && opts.replacementRehold) {
      const held = await changeSlabStatus([opts.replacementSlabNumber], "reserve", {
        pi: opts.replacementRehold.reference, customer: opts.replacementRehold.customer,
        expiryDays: opts.replacementRehold.days, by: opts.by, source: "Commercial hold", onlyFrom: ["AVAILABLE"],
      });
      if (held.updated === 1) replacementHold = opts.replacementRehold.reference;
    }
  } catch (e) {
    console.error("[commercial] swap undo: replacement not put back:", (e as Error).message);
  }

  try {
    const repack = await packSlabs({ slabNumbers: [opts.refusedSlabNumber], references: opts.references, by: opts.by, isAdmin: opts.isAdmin });
    if (repack.updated === 1) return { replacementUnpacked, replacementHold, refusedState: "packed", refusedHold: null };
  } catch (e) {
    console.error("[commercial] swap undo: refused slab not re-packed:", (e as Error).message);
  }
  // Unfiltered, like every restore read here: what the row says now decides
  // what the note tells the clerk to go and look at.
  const [now] = await readForOp("unpack", [opts.refusedSlabNumber], opts.isAdmin).catch(() => [] as SlabRow[]);
  const refusedState = now?.status === "PACKED" ? "packed" : now?.status === "RESERVED" ? "held" : "stock";
  return { replacementUnpacked, replacementHold, refusedState, refusedHold: now?.reservedForPi ?? null };
}

/** A bridge answer's refusals and misses as one list, for the swap's report. */
function bridgeRefusals(res: BridgeResult): { slab: number; reason: string }[] {
  const out = res.skipped.map((s) => ({ slab: Number(s.slab), reason: s.reason }));
  for (const n of res.missing) if (!out.some((s) => s.slab === Number(n))) out.push({ slab: Number(n), reason: "not found in finished goods" });
  return out;
}

// ─────────── automatic dispatch when an order closes (round three, answer 6) ──
//
// The import sits HERE rather than in the block at the top of the file because
// this section was appended while other builders held the same file open; an ES
// import is hoisted wherever it is written, so the placement costs nothing at
// run time and costs nobody a conflict in the header.
import { autoDispatchPlan, type AutoDispatchPlan } from "./tasks-rules";

/**
 * Mark everything still RESERVED against an order DISPATCHED.
 *
 * Round three, answer 6: "whatever is reserved should be marked dispatched
 * after deliver / last step." No clerk marks slabs one at a time any more; the
 * close does it, and this is the one function that moves them.
 *
 * HOW THE CANDIDATES ARE FOUND, and why it is not the order's own hold rows. A
 * hold's slab list is this module's bookkeeping of what it ASKED for; the
 * question here is what the INVENTORY still says is reserved against this
 * order right now. So the search is fg_finished_slab itself — status RESERVED,
 * reservedForPi in the order's references — which also catches a slab reserved
 * against the order outside a commercial hold, and does not chase one whose
 * hold row was never reconciled after the sweep let it go.
 *
 * Those rows are then RE-READ through readForOp (the sales-approval filter,
 * like every other acquiring path here) and put through the pure decision, so a
 * status that changed between the two reads is caught before anything moves.
 * `onlyFrom: ["RESERVED"]` is the last guard: closing an order can never sweep
 * a PACKED slab out of a crate nobody has loaded.
 *
 * `unreadable` is reported rather than swallowed: a slab in an unapproved
 * (design, batch) pair is invisible to a non-admin, so it stays RESERVED — and
 * an order that closes leaving stock reserved with nothing on any screen
 * saying so is exactly the bug this count exists to prevent.
 *
 * `slabNumbers` IS WHAT MOVED, NOT WHAT WAS PLANNED. It used to be the plan,
 * and the plan is only a proposal: changeSlabStatus refuses a CTS/SAMPLE-marked
 * slab, a slab whose mark cannot be read, and one that lost the concurrency
 * guard between the two reads, and it reports a row that vanished as `missing`.
 * The order log and the close's on-screen report both print this list, so a
 * plan-shaped answer named slabs the sweep had just declined to touch — the
 * one number a person reading the order months later has no way to check
 * against the floor. Every refusal now leaves the list and enters `skipped`
 * with its reason, `missing` included, the way holdSlabs and packSlabs already
 * merge theirs.
 */
export async function dispatchReservedForOrder(opts: {
  /** Every reference this order's slabs may legitimately be held under —
   *  ownReferences(order): its number, its holds', its enquiry's. AN EMPTY
   *  LIST OWNS NOTHING, the same rule packSlabs applies. */
  references: readonly string[];
  /** What the dispatch stamps on the slab — the order number. */
  reference: string;
  customer: string;
  by: string | null;
  isAdmin: boolean;
  /** Told what the sweep is ABOUT to move, before a single slab moves — the
   *  caller logs it, so a request killed part-way through a long sweep still
   *  leaves a record of what was in flight (order-stage.dispatchOnClose). It
   *  is never allowed to stop the sweep: a failure here is the caller's log,
   *  not the stock. */
  onPlanned?: (plan: AutoDispatchPlan) => Promise<void> | void;
}): Promise<{ updated: number; slabNumbers: number[]; skipped: { slab: number; reason: string }[]; unreadable: number }> {
  const refs = (opts.references ?? []).filter((r) => typeof r === "string" && r.trim() !== "");
  const none = { updated: 0, slabNumbers: [] as number[], skipped: [] as { slab: number; reason: string }[], unreadable: 0 };
  if (!refs.length) return none;

  const candidates: Array<{ slabNumber: number }> = await db.finishedSlab.findMany({
    where: { status: "RESERVED", reservedForPi: { in: refs } },
    select: { slabNumber: true },
  });
  const numbers = candidates.map((c) => Number(c.slabNumber)).filter((n) => Number.isFinite(n));
  if (!numbers.length) return none;

  const live = await readForOp("dispatch", numbers, opts.isAdmin);
  const unreadable = numbers.length - live.length;
  const plan = autoDispatchPlan(live, refs);
  if (!plan.slabNumbers.length) return { ...none, skipped: plan.skipped, unreadable };

  // Announce the intent, then move. A throw here would leave the stock alone
  // for a logging failure, which is the wrong way round.
  try { await opts.onPlanned?.(plan); } catch (e) {
    console.error("[commercial] auto-dispatch: intent not logged:", (e as Error).message);
  }

  const res = await changeSlabStatus(plan.slabNumbers, "dispatch", {
    pi: opts.reference,
    customer: opts.customer,
    by: opts.by,
    source: "Commercial auto-dispatch",
    onlyFrom: ["RESERVED"],
  });
  // What the bridge REFUSED (a cut mark, a status that changed under the
  // guard) and what it could not find, each with its reason and each dropped
  // from the moved list — bridgeRefusals is the same merge holdSlabs and
  // packSlabs do, so all three answers read alike.
  const refusals = bridgeRefusals({ updated: res.updated, missing: res.missing, skipped: res.skipped, before: [] });
  const refused = new Set(refusals.map((r) => r.slab));
  const moved = plan.slabNumbers.filter((n) => !refused.has(n));
  const skipped = [...plan.skipped, ...refusals];
  return { updated: res.updated, slabNumbers: moved, skipped, unreadable };
}
