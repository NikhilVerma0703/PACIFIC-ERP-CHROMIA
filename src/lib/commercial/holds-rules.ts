// Stock holds — the PURE half. Everything a hold route decides that is not a
// database read lives here so tests/commercialHolds.test.ts can run it under
// node --test without Prisma, Next or the inventory bridge: which slab numbers
// a body names, when a hold lapses, which of the slabs the bridge touched are
// the hold's own, what a refused hold says, and which of a hold's slabs are
// still on it when some are released.
//
// IMPORT-FREE, deliberately. The routes in app/api/office/commercial/holds
// and .../orders/[id]/holds import this; nothing here imports them back.
//
// AND SINCE THE ADVERSARIAL REVIEW, the bridge's own decisions too (the block
// at the foot of this file). inventory-bridge.ts is the module's single door
// into fg_finished_slab, so every one of its rules is a database call away from
// a test — and the four the review found wrong (a restore filtered like an
// acquisition, a `missing` that was always empty, a foreign hold packed out
// from under its owner, a part-packed hold recorded as RELEASED) were all
// wrong in the DECISION, not in the SQL. They live here now, pure, and
// tests/commercialHolds.test.ts runs them.
//
// THERE IS NO EXTENSION (answer 11). A hold that lapses sends the order back
// to the stock check — reconcileHold does that through holdStatusAfterReconcile
// — and the only way to keep slabs is a fresh hold with fresh days.

/** A hold lasts this many days when neither the body nor settings says. */
export const FALLBACK_HOLD_DAYS = 5;
/** A hold may not be asked for longer than this. Anything longer is a
 *  reservation, not a stock check, and belongs to the PI. */
export const MAX_HOLD_DAYS = 60;

/** Slab numbers from a request body: numbers or numeric strings, finite,
 *  positive, de-duplicated, in the order first seen. Anything else is dropped
 *  rather than refused — one bad entry must not lose the other forty. */
export function parseSlabNumbers(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of input) {
    const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** The hold length actually used: the body's days when it is a whole positive
 *  number within MAX_HOLD_DAYS, else the settings' holdDays, else 5. */
export function normaliseDays(requested: unknown, settingsDays: unknown): number {
  const pick = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
    if (!Number.isFinite(n)) return null;
    const r = Math.round(n);
    if (r < 1 || r > MAX_HOLD_DAYS) return null;
    return r;
  };
  return pick(requested) ?? pick(settingsDays) ?? FALLBACK_HOLD_DAYS;
}

/** When a hold placed at `now` for `days` lapses: now + days × 86 400 000 ms.
 *  Whole milliseconds; the inventory sweep compares against the clock. */
export function holdExpiry(now: Date, days: number): Date {
  const d = Number.isFinite(days) && days > 0 ? days : FALLBACK_HOLD_DAYS;
  return new Date(now.getTime() + Math.round(d * 86_400_000));
}

/** Hours left on a hold, negative once lapsed. For the screens. */
export function hoursLeft(expiresAt: Date | string, now: Date): number {
  const t = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : expiresAt.getTime();
  return Math.round(((t - now.getTime()) / 3_600_000) * 10) / 10;
}

export interface BridgeSlabLike {
  slabNumber: number;
  design?: string | null;
  designCanonical?: string | null;
  thickness?: string | null;
  thicknessCanonical?: string | null;
  batchKey?: string | null;
  batchNumber?: string | null;
  grade?: string | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  sqft?: number | null;
}

export interface BridgeOutcomeLike {
  skipped: { slab: number; reason: string }[];
  missing: number[];
}

/** The slab numbers the bridge actually changed: everything asked for that it
 *  neither skipped nor failed to find. The bridge reports a count, not a list,
 *  so the list is derived here — and this is what the hold's own slab rows are
 *  built from, never the request body. */
export function heldSlabNumbers(requested: number[], outcome: BridgeOutcomeLike): number[] {
  const out = new Set<number>();
  for (const s of outcome.skipped) out.add(s.slab);
  for (const m of outcome.missing) out.add(m);
  return requested.filter((n) => !out.has(n));
}

export interface HoldSlabRowInput {
  slabNumber: number;
  design: string | null;
  thickness: string | null;
  batchKey: string | null;
  batchNumber: string | null;
  grade: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  sqft: number | null;
}

/** commercial_stock_hold_slab rows from the bridge's `before` snapshot, for the
 *  slabs that were actually held. Canonical design and thickness are preferred
 *  over the raw column so the hold reads the way the order item does; sqft is
 *  the bridge's own figure (10.764 sqft/sqm off the stored inches). A slab held
 *  but absent from `before` cannot happen (the bridge reads before it writes),
 *  so it is dropped rather than invented. */
export function buildHoldSlabRows(before: BridgeSlabLike[], held: number[]): HoldSlabRowInput[] {
  const byNo = new Map<number, BridgeSlabLike>();
  for (const r of before) byNo.set(r.slabNumber, r);
  const rows: HoldSlabRowInput[] = [];
  for (const n of held) {
    const r = byNo.get(n);
    if (!r) continue;
    rows.push({
      slabNumber: n,
      design: r.designCanonical ?? r.design ?? null,
      thickness: (r.thicknessCanonical && r.thicknessCanonical !== "" ? r.thicknessCanonical : r.thickness) ?? null,
      batchKey: r.batchKey ?? null,
      batchNumber: r.batchNumber ?? null,
      grade: r.grade ?? null,
      lengthIn: r.lengthIn ?? null,
      widthIn: r.widthIn ?? null,
      sqft: r.sqft == null ? null : Math.round(r.sqft * 1000) / 1000,
    });
  }
  return rows;
}

/** Total sqft of a set of hold rows, 3 dp. */
export function holdSqft(rows: { sqft: number | null }[]): number {
  return Math.round(rows.reduce((s, r) => s + (r.sqft ?? 0), 0) * 1000) / 1000;
}

/** What a hold that held nothing says: every reason the bridge gave, one
 *  per slab, so the person can see WHY (cut-marked, already held under
 *  another reference, not in stock) and not merely that it failed. */
export function nothingHeldMessage(outcome: BridgeOutcomeLike): string {
  const parts: string[] = [];
  for (const s of outcome.skipped) parts.push(`${s.slab}: ${s.reason}`);
  if (outcome.missing.length) parts.push(`not in finished goods: ${outcome.missing.join(", ")}`);
  return parts.length ? `No slab could be held — ${parts.join("; ")}` : "No slab could be held.";
}

/**
 * THE REFERENCE STAMPED ON THE SLABS, AND WHY IT IS NO LONGER TAKEN ON TRUST.
 *
 * This used to be `holdReference(typed, fallback)`: whatever the body said,
 * else the order number. The reference is not a label — it is the module's
 * whole notion of ownership. `releaseHeld` frees exactly the slabs whose
 * `reservedForPi` equals a hold's reference, `packSlabs` (after the review)
 * packs only slabs held under a reference the caller owns, and the intake
 * check `slabEligibility` admits a RESERVED slab on the same test. So a body
 * that said `reference: "PSPL/PI/25-26/0042"` — another team's PI — created a
 * commercial_stock_hold whose reference was that PI, and from that moment this
 * module treated that team's reserved slabs as its own to release and to pack.
 * A caller-supplied string was an authorisation grant.
 *
 * It is now checked against the references the RECORD allows: an order's own
 * number and, when it was converted from one, its enquiry's number (holds
 * placed before the conversion carry that). Anything else is refused rather
 * than stamped, and the refusal names what is allowed so a genuine typo is
 * fixable. Blank still means "the first allowed reference", which is what the
 * screen sends when nobody typed anything.
 *
 * Comparison is trimmed and case-insensitive, and the ALLOWED spelling is what
 * gets returned — never the caller's — so "sal-ord/26-27/01642" cannot create a
 * second hold whose reference no longer matches the one stamped on the slabs.
 */
export function resolveHoldReference(
  typed: unknown,
  allowed: ReadonlyArray<string | null | undefined>,
): { ok: true; reference: string } | { ok: false; reason: string } {
  const refs: string[] = [];
  for (const a of allowed) {
    const s = typeof a === "string" ? a.trim() : "";
    if (s && !refs.some((r) => r.toLowerCase() === s.toLowerCase())) refs.push(s);
  }
  if (!refs.length) return { ok: false, reason: "This record has no number to hold stock against." };
  const s = typeof typed === "string" ? typed.trim() : "";
  if (!s) return { ok: true, reference: refs[0] };
  const hit = refs.find((r) => r.toLowerCase() === s.toLowerCase());
  if (hit) return { ok: true, reference: hit };
  return {
    ok: false,
    reason: `A hold placed here can only be referenced as ${refs.join(" or ")} — "${s}" belongs to something else.`,
  };
}

/**
 * Answer 12: a hold is placed against an ORDER, never against an enquiry. The
 * enquiry-referenced hold used to be the way stock was kept while a quote was
 * out; the owner closed it, so a body that names an enquiry and no order is
 * refused with the reason — not silently turned into an order hold, because
 * the caller plainly meant the enquiry. Whatever else the body says, the
 * order id is the only target the routes accept.
 */
export function holdTarget(body: { orderId?: unknown; enquiryId?: unknown }): { ok: true; orderId: string } | { ok: false; reason: string } {
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const enquiryId = typeof body.enquiryId === "string" ? body.enquiryId.trim() : "";
  if (orderId) return { ok: true, orderId };
  if (enquiryId) return { ok: false, reason: "Stock is not held against an enquiry (answer 12) — convert it to an order and hold from there." };
  return { ok: false, reason: "A hold needs the order it is for (orderId)." };
}

export interface HoldSlabStateLike {
  slabNumber: number;
  releasedAt: string | Date | null;
  packedAt: string | Date | null;
}

/** Slabs still on the hold: neither released (by hand or by the sweep) nor
 *  consumed by a packing list. These are what release-all acts on. */
export function stillHeldSlabs<T extends HoldSlabStateLike>(slabs: T[]): T[] {
  return slabs.filter((s) => s.releasedAt == null && s.packedAt == null);
}

/**
 * Answer 11, in the words the hold card shows. An ACTIVE hold says when it
 * lapses and what that costs — the order goes back to the stock check — so
 * nobody looks for an Extend button that no longer exists. An EXPIRED hold
 * says that it happened. `expiresAtText` is already formatted: the screen
 * owns the locale, the rule owns the sentence.
 */
export function holdExpiryLine(status: string, expiresAtText: string): string {
  switch (status) {
    case "ACTIVE": return `expires ${expiresAtText} — on expiry the order returns to the stock check`;
    case "EXPIRED": return `lapsed ${expiresAtText} — the order went back to the stock check`;
    case "CONSUMED": return "packed";
    default: return "released";
  }
}

/** Which of a hold's slabs a release request names. No list → every slab
 *  still held; a list → only those of them that are still held (a number
 *  that is not on the hold is reported back, never touched). */
export function releaseTargets(slabs: HoldSlabStateLike[], requested: number[] | null): { targets: number[]; notOnHold: number[] } {
  const held = stillHeldSlabs(slabs).map((s) => s.slabNumber);
  if (!requested || requested.length === 0) return { targets: held, notOnHold: [] };
  const heldSet = new Set(held);
  const targets = requested.filter((n) => heldSet.has(n));
  const notOnHold = requested.filter((n) => !heldSet.has(n));
  return { targets, notOnHold };
}

/** A hold may be released only while ACTIVE; an EXPIRED, RELEASED or
 *  CONSUMED hold is history. */
export function canActOnHold(status: string): { ok: true } | { ok: false; reason: string } {
  if (status === "ACTIVE") return { ok: true };
  const word = status === "EXPIRED" ? "lapsed" : status === "CONSUMED" ? "been packed" : "already been released";
  return { ok: false, reason: `This hold has ${word}.` };
}

/** The list filter: a status string from the query, validated against the
 *  enum; anything else means "all". */
export const HOLD_STATUSES = ["ACTIVE", "RELEASED", "EXPIRED", "CONSUMED"] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];
export function parseHoldStatus(v: unknown): HoldStatus | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return (HOLD_STATUSES as readonly string[]).includes(s) ? (s as HoldStatus) : null;
}

/** Page/limit from a query string: page ≥ 1, limit 1..200, defaults 1 / 50. */
export function pageArgs(pageRaw: unknown, limitRaw: unknown): { page: number; limit: number; skip: number } {
  const p = Math.max(1, Math.round(Number(pageRaw)) || 1);
  const l = Math.min(200, Math.max(1, Math.round(Number(limitRaw)) || 50));
  return { page: p, limit: l, skip: (p - 1) * l };
}

// ───────────────────────── the slab picker's own arithmetic ──────────────────
// The stock tab shows batch groups with a checkbox per slab, a select-all per
// batch and a running "selected / required" counter. That is decision logic —
// how many are still to pick, whether the tick-all box is on, half-on or off —
// so it lives here and is run by the tests rather than inlined in JSX.

/** Add or remove one slab from the picked set, order preserved. */
export function toggleSlab(selected: readonly number[], slabNumber: number, on: boolean): number[] {
  const has = selected.includes(slabNumber);
  if (on) return has ? [...selected] : [...selected, slabNumber];
  return has ? selected.filter((n) => n !== slabNumber) : [...selected];
}

/** Tick or clear a whole batch at once, leaving other batches' picks alone. */
export function toggleBatch(selected: readonly number[], batchSlabs: readonly number[], on: boolean): number[] {
  if (!on) { const drop = new Set(batchSlabs); return selected.filter((n) => !drop.has(n)); }
  const out = [...selected];
  for (const n of batchSlabs) if (!out.includes(n)) out.push(n);
  return out;
}

/** The select-all box: off, half-on (some picked) or on. An empty batch is off. */
export function batchTickState(selected: readonly number[], batchSlabs: readonly number[]): "none" | "some" | "all" {
  if (!batchSlabs.length) return "none";
  const set = new Set(selected);
  let n = 0;
  for (const s of batchSlabs) if (set.has(s)) n++;
  if (n === 0) return "none";
  return n === batchSlabs.length ? "all" : "some";
}

/**
 * The counter under the picker. `required` is the order line's qtySlabs, which
 * may be null (a line priced by area with no slab count) — then there is
 * nothing to be short of and `enough` is true, so the screen does not nag about
 * a quantity nobody stated.
 */
export function selectionSummary(selected: readonly number[], required: number | null | undefined, sqftOf?: (slab: number) => number | null | undefined): {
  picked: number; required: number | null; short: number; enough: boolean; sqft: number;
} {
  const picked = selected.length;
  const req = required == null || !Number.isFinite(Number(required)) ? null : Math.max(0, Math.round(Number(required)));
  const short = req == null ? 0 : Math.max(0, req - picked);
  let sqft = 0;
  if (sqftOf) for (const n of selected) { const v = Number(sqftOf(n)); if (Number.isFinite(v)) sqft += v; }
  return { picked, required: req, short, enough: req == null || picked >= req, sqft: Math.round(sqft * 100) / 100 };
}

/**
 * Whether the stock tab offers "raise a production request for the shortfall":
 * only when the line says how many slabs it needs and the search found fewer.
 * `available` is what the search returned, not what has been ticked — the
 * shortfall is a fact about stock, not about the picking.
 */
export function shortfallOffer(required: number | null | undefined, available: number): { offer: boolean; short: number } {
  const req = required == null || !Number.isFinite(Number(required)) ? null : Math.round(Number(required));
  if (req == null || req <= 0) return { offer: false, short: 0 };
  const av = Number.isFinite(available) ? Math.max(0, Math.round(available)) : 0;
  const short = Math.max(0, req - av);
  return { offer: short > 0, short };
}

// ═════════════ what the bridge decides, lifted out of the bridge ═════════════
//
// inventory-bridge.ts holds the module's only writes to fg_finished_slab, so
// each of these ran a database call away from any test. The adversarial review
// found four of them wrong and none of the four was a query bug. They are pure
// functions here, and tests/commercialHolds.test.ts runs them.

/** The mark a slab that could not be read as one is given.
 *
 *  toRow used to write `String(r.slabMark ?? "FULL_SLAB")` — the ONE fail-open
 *  reading of the mark in this codebase, next to finishedSlab.ts, which refuses
 *  a dispatch it cannot verify the mark of, and searchWhere.ts, which refuses to
 *  build a filter at all. Whole is the answer that loads a lorry: it puts the
 *  slab in a stock check, on a hold, on a packing list. Unreadable is now its
 *  own value, it equals nothing, and every FULL_SLAB test in the bridge refuses
 *  it. */
export const UNREADABLE_SLAB_MARK = "UNREADABLE";

/** FULL_SLAB / CTS / SAMPLE as stored, or UNREADABLE when the column gave back
 *  anything that is not a non-empty string. */
export function slabMarkOf(raw: unknown): string {
  return typeof raw === "string" && raw.trim() ? raw.trim() : UNREADABLE_SLAB_MARK;
}

export function isFullSlab(mark: unknown): boolean {
  return slabMarkOf(mark) === "FULL_SLAB";
}

/** Why a slab was refused for a hold or a pack, in the words the person needs:
 *  "cut to size" sends them to fabrication, "could not be read" sends them to
 *  whoever owns the column. */
export function notFullSlabReason(mark: unknown): string {
  const m = slabMarkOf(mark);
  return m === UNREADABLE_SLAB_MARK
    ? "slab mark could not be read — refused rather than assumed whole"
    : `marked ${m} — not a full slab`;
}

/**
 * THE SLAB NUMBERS A BRIDGE CALL ASKED FOR AND COULD NOT READ.
 *
 * holdSlabs and dispatchSlabs computed this inline; packSlabs, unpackSlabs and
 * releaseHeld returned `res.missing` from changeSlabStatus, which only ever
 * names a slab that VANISHED between the bridge's own read and the write —
 * i.e. never. So `missing` came back empty on every one of those three however
 * many numbers went in, and a caller could not tell a silent no-op ("none of
 * those slabs exist") from a success ("all of them were already unpacked").
 * Now all five derive it the same way.
 */
export function missingSlabNumbers(requested: readonly number[], read: ReadonlyArray<{ slabNumber: number }>): number[] {
  const found = new Set(read.map((r) => r.slabNumber));
  return requested.filter((n) => !found.has(n));
}

export interface HeldSlabLike {
  slabNumber: number;
  status: string;
  reservedForPi?: string | null;
}

/**
 * MAY THIS CALLER PACK THIS SLAB?
 *
 * packSlabs used to move any RESERVED slab straight to PACKED, whoever held it.
 * Two orders can both have a slab on a DRAFT packing list — nothing stops that,
 * the list is a document, not a lock — so order B holds it (reservedForPi =
 * ORD-B) and order A submits, and the bridge packs it out from under B's hold.
 * B's hold then reconciles to "packed" and B's screen says the slab is on ITS
 * packing list. The intake check (packing-rules.slabEligibility, via
 * ownReferences) already refused exactly this when the slab was ADDED; submit
 * did not re-ask, and the hold can arrive after the add.
 *
 * `own` is the references the caller may pack under — for a packing list, its
 * order's number, its enquiry's number and its own holds' references
 * (packing-lists/_lib.ts `ownReferences`). An EMPTY list is not "anything
 * goes": it means the caller named nothing it owns, so every held slab is
 * somebody's but not theirs, and all of them are refused. A RESERVED slab with
 * no reference at all is nobody's and passes — the hold is what this guards,
 * not the status.
 */
export function foreignHoldReason(row: HeldSlabLike, own: readonly string[]): string | null {
  if (String(row.status) !== "RESERVED") return null;
  const ref = (row.reservedForPi ?? "").trim();
  if (!ref) return null;
  const mine = own.some((r) => typeof r === "string" && r.trim().toLowerCase() === ref.toLowerCase());
  return mine ? null : `held under ${ref} — not this list's own hold`;
}

export interface ReconcileCounts {
  /** Still RESERVED under the hold's own reference. */
  stillHeld: number;
  /** PACKED or DISPATCHED — the hold was consumed by a packing list. */
  packed: number;
  /** Read, and no longer the hold's: the sweep expired it, or it was released. */
  released: number;
  /** Asked for and NOT READ AT ALL — no fg_finished_slab row came back. */
  unreadable: number;
}

/**
 * WHAT A HOLD WITH NOTHING LEFT ON IT BECAME.
 *
 * The old line was `packed > 0 && released === 0 ? "CONSUMED" : expired ?
 * "EXPIRED" : "RELEASED"`, and it made a part-packed hold lie twice over. Hold
 * forty slabs, pack thirty-two, hand eight back: packed = 32, released = 8, so
 * the hold reads RELEASED — or EXPIRED if the five days had run — and the
 * order's history says the stock check came to nothing when in fact thirty-two
 * of those slabs are in a container. CONSUMED means "this hold ended in a
 * packing list", and one packed slab makes that true; releasing the remainder
 * is the ordinary way a hold ends, not evidence against it.
 *
 * A slab whose fg row could not be read is NOT released — nobody released it
 * and we do not know that anybody did — so it is counted apart (see
 * ReconcileCounts.unreadable) and cannot by itself turn a hold RELEASED. With
 * nothing packed and nothing outstanding, the hold ended by lapsing or by hand,
 * and the expiry says which.
 */
export function holdStatusAfterReconcile(counts: ReconcileCounts, expiresAt: Date | string, now: Date): "CONSUMED" | "EXPIRED" | "RELEASED" {
  if (counts.packed > 0) return "CONSUMED";
  const t = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : expiresAt.getTime();
  return Number.isFinite(t) && t < now.getTime() ? "EXPIRED" : "RELEASED";
}

/**
 * WHICH BRIDGE OPERATIONS APPLY THE SALES-APPROVAL FILTER — the table, in one
 * place, because the review found it applied by habit rather than by rule.
 *
 * The filter hides slabs in an unapproved (design, batch) pair from a
 * non-admin. It exists so that audience cannot SEE stock that has not been
 * passed for sale, and cannot COMMIT it. Every operation that ACQUIRES a slab
 * — the stock search, a plain read, a hold, a pack, a dispatch — therefore
 * asks it.
 *
 * `unpack` does not, and that is the whole distinction. Unpacking only ever
 * gives stock back: it ends a commitment rather than making one, and there is
 * nothing to hide from somebody who is holding the slab in their hands. With
 * the filter on, a slab an ADMIN had legitimately packed out of an unapproved
 * pair could not be read by a non-admin checker, so the rejection that should
 * have returned it to stock silently returned nothing and left it PACKED
 * forever — off the list, unavailable to anyone, with no screen saying why.
 *
 * A restore is not an acquisition. If this ever needs a second exception,
 * ask that question of it rather than of the caller's role.
 */
export type BridgeOp = "search" | "read" | "hold" | "release" | "pack" | "unpack" | "dispatch";
export function approvalFilterApplies(op: BridgeOp): boolean {
  return op !== "unpack";
}

/**
 * The canonical spelling of a design from an ALREADY-LOADED alias table.
 *
 * The bridge used to call finishedSlab.canonicalDesign() once per row — a
 * findUnique on fg_design_alias per slab, sequentially. Measured on live Neon
 * 2026-09-06: 500 rows took 25.3 s that way, and one findMany plus this lookup
 * took 0.097 s for the same 500. Same answer, and that is what the test pins:
 * a variant maps to its canonical, a design with no alias is its own
 * canonical, and nothing at all is null.
 */
export function canonicalFromMap(aliases: ReadonlyMap<string, string>, raw: string | null | undefined): string | null {
  if (!raw) return null;
  return aliases.get(raw) ?? raw;
}
