// Stock hold rules, RUN against real values: the slab list a body names, hold
// length and expiry, which slabs the bridge actually held and the rows the
// hold records for them, the refusal message, release targets and the
// ACTIVE-only guard. Import-free module, so node --test loads it bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSlabNumbers, normaliseDays, holdExpiry, hoursLeft, heldSlabNumbers, buildHoldSlabRows, holdSqft,
  nothingHeldMessage, resolveHoldReference, stillHeldSlabs, releaseTargets, canActOnHold, parseHoldStatus, pageArgs, holdExpiryLine, holdTarget,
  toggleSlab, toggleBatch, batchTickState, selectionSummary, shortfallOffer,
  FALLBACK_HOLD_DAYS, MAX_HOLD_DAYS,
  // The bridge's own decisions, lifted out of inventory-bridge.ts by the
  // adversarial review so they can be RUN rather than reasoned about.
  slabMarkOf, isFullSlab, notFullSlabReason, UNREADABLE_SLAB_MARK,
  missingSlabNumbers, foreignHoldReason, holdStatusAfterReconcile,
  approvalFilterApplies, canonicalFromMap,
} from "../src/lib/commercial/holds-rules.ts";

test("parseSlabNumbers: numbers and numeric strings, de-duplicated, junk dropped", () => {
  assert.deepEqual(parseSlabNumbers([144338, "144339", 144338, " 144340 "]), [144338, 144339, 144340]);
  assert.deepEqual(parseSlabNumbers([0, -5, "abc", null, undefined, NaN, Infinity]), []);
  assert.deepEqual(parseSlabNumbers("144338"), [], "a bare string is not a list");
  assert.deepEqual(parseSlabNumbers(undefined), []);
  // an insert slab (144338.1) is a real slab number in fg_finished_slab
  assert.deepEqual(parseSlabNumbers([144338.1]), [144338.1]);
});

test("normaliseDays: body wins when sane, then settings, then the fallback", () => {
  assert.equal(normaliseDays(7, 5), 7);
  assert.equal(normaliseDays("7", 5), 7);
  assert.equal(normaliseDays(undefined, 5), 5);
  assert.equal(normaliseDays(null, "10"), 10);
  assert.equal(normaliseDays(0, 5), 5, "zero days is not a hold");
  assert.equal(normaliseDays(-3, 5), 5);
  assert.equal(normaliseDays(MAX_HOLD_DAYS + 1, 5), 5, "beyond the cap falls back to settings");
  assert.equal(normaliseDays("five", "many"), FALLBACK_HOLD_DAYS);
  assert.equal(normaliseDays(2.6, 5), 3, "whole days");
});

test("holdExpiry: now + days × 86 400 000 ms, fallback for nonsense", () => {
  const now = new Date("2026-09-06T10:00:00.000Z");
  assert.equal(holdExpiry(now, 5).toISOString(), "2026-09-11T10:00:00.000Z");
  assert.equal(holdExpiry(now, 1).getTime() - now.getTime(), 86_400_000);
  assert.equal(holdExpiry(now, NaN).toISOString(), "2026-09-11T10:00:00.000Z");
  assert.equal(holdExpiry(now, 0).toISOString(), "2026-09-11T10:00:00.000Z");
  assert.equal(holdExpiry(now, 0.5).getTime() - now.getTime(), 43_200_000, "half a day is allowed by the function; the route rounds days");
});

test("hoursLeft: positive before expiry, negative after", () => {
  const now = new Date("2026-09-06T10:00:00.000Z");
  assert.equal(hoursLeft("2026-09-06T22:00:00.000Z", now), 12);
  assert.equal(hoursLeft(new Date("2026-09-06T09:30:00.000Z"), now), -0.5);
});

test("heldSlabNumbers: requested minus skipped minus missing, in request order", () => {
  const held = heldSlabNumbers([1, 2, 3, 4, 5], { skipped: [{ slab: 2, reason: "RESERVED → RESERVED not allowed" }, { slab: 4, reason: "marked CTS — not a full slab" }], missing: [5] });
  assert.deepEqual(held, [1, 3]);
  assert.deepEqual(heldSlabNumbers([7], { skipped: [], missing: [] }), [7]);
  assert.deepEqual(heldSlabNumbers([7], { skipped: [{ slab: 7, reason: "x" }], missing: [] }), []);
});

const before = [
  { slabNumber: 144338, design: "Carrara Royale", designCanonical: "CARRARA ROYALE", grade: "A", thickness: "20mm", thicknessCanonical: "2 cm", batchKey: "B-0123", batchNumber: "PES.0123", lengthIn: 137, widthIn: 79, sqft: 75.15 },
  { slabNumber: 144339, design: "Carrara Royale", designCanonical: null, grade: null, thickness: null, thicknessCanonical: "", batchKey: null, batchNumber: null, lengthIn: 137, widthIn: 79, sqft: 75.1549 },
  { slabNumber: 144340, design: "Other", designCanonical: "OTHER", grade: "B", thickness: "3 cm", thicknessCanonical: "3 cm", batchKey: "B-9", batchNumber: "9", lengthIn: 137, widthIn: 79, sqft: 75.15 },
];

test("buildHoldSlabRows: rows from `before` for the held slabs only; canonical names preferred; sqft 3 dp", () => {
  const rows = buildHoldSlabRows(before, [144338, 144339, 999999]);
  assert.equal(rows.length, 2, "a held slab absent from `before` is dropped, not invented");
  assert.deepEqual(rows[0], { slabNumber: 144338, design: "CARRARA ROYALE", thickness: "2 cm", batchKey: "B-0123", batchNumber: "PES.0123", grade: "A", lengthIn: 137, widthIn: 79, sqft: 75.15 });
  assert.equal(rows[1].design, "Carrara Royale", "no canonical → raw design");
  assert.equal(rows[1].thickness, null, "blank canonical and null raw → null");
  assert.equal(rows[1].sqft, 75.155);
  assert.equal(holdSqft(rows), 150.305);
  assert.equal(holdSqft([{ sqft: null }, { sqft: 1.0004 }]), 1);
});

test("nothingHeldMessage names every reason", () => {
  const m = nothingHeldMessage({ skipped: [{ slab: 1, reason: "marked CTS — not a full slab" }, { slab: 2, reason: "RESERVED → RESERVED not allowed" }], missing: [3, 4] });
  assert.match(m, /^No slab could be held — /);
  assert.match(m, /1: marked CTS/);
  assert.match(m, /2: RESERVED/);
  assert.match(m, /not in finished goods: 3, 4/);
  assert.equal(nothingHeldMessage({ skipped: [], missing: [] }), "No slab could be held.");
});

// ── [9] a body's `reference` was an authorisation grant ──────────────────────
// The old holdReference(typed, fallback) returned whatever the body said. The
// reference is what releaseHeld frees on and what packSlabs packs under, so
// "PSPL/PI/25-26/0042" in a body handed this order another team's reserved
// slabs. Every assertion below that expects a REFUSAL fails against that
// function, which returned the string.
test("resolveHoldReference: blank falls back, an allowed one is accepted, anything else is refused", () => {
  const order = "SAL-ORD/26-27/01642";
  const enq = "ENQ/26-27/0003";

  assert.deepEqual(resolveHoldReference("", [order, enq]), { ok: true, reference: order }, "blank → the record's own number");
  assert.deepEqual(resolveHoldReference(undefined, [order]), { ok: true, reference: order });
  assert.deepEqual(resolveHoldReference(42 as unknown as string, [order]), { ok: true, reference: order }, "a non-string is not a reference");
  assert.deepEqual(resolveHoldReference(`  ${order} `, [order, enq]), { ok: true, reference: order }, "its own number, trimmed");
  assert.deepEqual(resolveHoldReference(enq, [order, enq]), { ok: true, reference: enq }, "the enquiry it was converted from is allowed");
  assert.deepEqual(resolveHoldReference(order.toLowerCase(), [order]), { ok: true, reference: order },
    "matched case-insensitively but stamped in the ALLOWED spelling, so the hold and the slabs agree");

  // THE FINDING, run: another team's PI must not become this order's reference.
  const stolen = resolveHoldReference("PSPL/PI/25-26/0042", [order, enq]);
  assert.equal(stolen.ok, false, "a reference this record does not own is refused, not stamped");
  assert.match((stolen as { reason: string }).reason, /PSPL\/PI\/25-26\/0042/);
  assert.match((stolen as { reason: string }).reason, /SAL-ORD\/26-27\/01642 or ENQ\/26-27\/0003/);
  assert.equal(resolveHoldReference("SAL-ORD/26-27/01643", [order]).ok, false, "one digit out is still somebody else's order");
  assert.equal(resolveHoldReference("", []).ok, false, "nothing to hold against is a refusal, not a blank reference");
});

const holdSlabs = [
  { slabNumber: 1, releasedAt: null, packedAt: null },
  { slabNumber: 2, releasedAt: "2026-09-05T00:00:00.000Z", packedAt: null },
  { slabNumber: 3, releasedAt: null, packedAt: new Date("2026-09-05T00:00:00.000Z") },
  { slabNumber: 4, releasedAt: null, packedAt: null },
];

test("stillHeldSlabs / releaseTargets: released and packed slabs are off the hold", () => {
  assert.deepEqual(stillHeldSlabs(holdSlabs).map((s) => s.slabNumber), [1, 4]);
  assert.deepEqual(releaseTargets(holdSlabs, null), { targets: [1, 4], notOnHold: [] }, "no list → everything still held");
  assert.deepEqual(releaseTargets(holdSlabs, []), { targets: [1, 4], notOnHold: [] });
  assert.deepEqual(releaseTargets(holdSlabs, [4, 2, 99]), { targets: [4], notOnHold: [2, 99] }, "a released slab or a stranger is reported, not touched");
});

test("canActOnHold: ACTIVE only, with a reason that says which way it ended", () => {
  assert.deepEqual(canActOnHold("ACTIVE"), { ok: true });
  assert.deepEqual(canActOnHold("EXPIRED"), { ok: false, reason: "This hold has lapsed." });
  assert.deepEqual(canActOnHold("CONSUMED"), { ok: false, reason: "This hold has been packed." });
  assert.deepEqual(canActOnHold("RELEASED"), { ok: false, reason: "This hold has already been released." });
});

test("parseHoldStatus and pageArgs", () => {
  assert.equal(parseHoldStatus("active"), "ACTIVE");
  assert.equal(parseHoldStatus(" Expired "), "EXPIRED");
  assert.equal(parseHoldStatus("all"), null);
  assert.equal(parseHoldStatus(undefined), null);
  assert.deepEqual(pageArgs(undefined, undefined), { page: 1, limit: 50, skip: 0 });
  assert.deepEqual(pageArgs("3", "20"), { page: 3, limit: 20, skip: 40 });
  assert.deepEqual(pageArgs("-1", "9999"), { page: 1, limit: 200, skip: 0 });
  assert.deepEqual(pageArgs("x", "0"), { page: 1, limit: 50, skip: 0 });
});

// ─────────────────────────── the slab picker's arithmetic ────────────────────

test("toggleSlab / toggleBatch: picking is additive and order-preserving", () => {
  assert.deepEqual(toggleSlab([], 144338, true), [144338]);
  assert.deepEqual(toggleSlab([144338, 144339], 144340, true), [144338, 144339, 144340]);
  assert.deepEqual(toggleSlab([144338, 144339], 144338, true), [144338, 144339], "ticking a ticked slab changes nothing");
  assert.deepEqual(toggleSlab([144338, 144339], 144338, false), [144339]);
  assert.deepEqual(toggleSlab([144339], 144338, false), [144339], "unticking one that is not picked changes nothing");

  // select-all on a batch keeps picks made in OTHER batches
  assert.deepEqual(toggleBatch([1, 2], [3, 4, 2], true), [1, 2, 3, 4]);
  assert.deepEqual(toggleBatch([1, 2, 3, 4], [3, 4], false), [1, 2]);
  assert.deepEqual(toggleBatch([1, 2], [], true), [1, 2]);
});

test("batchTickState: off / half-on / on", () => {
  assert.equal(batchTickState([], [1, 2, 3]), "none");
  assert.equal(batchTickState([2], [1, 2, 3]), "some");
  assert.equal(batchTickState([3, 1, 2], [1, 2, 3]), "all", "order does not matter");
  assert.equal(batchTickState([9], [1, 2, 3]), "none", "a pick from another batch does not half-tick this one");
  assert.equal(batchTickState([1, 2], []), "none");
});

test("selectionSummary: picked / required with the sqft of what is picked", () => {
  const sqft = (n: number) => ({ 1: 75.2, 2: 75.2, 3: 74.9 } as Record<number, number>)[n] ?? null;
  assert.deepEqual(selectionSummary([1, 2], 5, sqft), { picked: 2, required: 5, short: 3, enough: false, sqft: 150.4 });
  assert.deepEqual(selectionSummary([1, 2, 3], 3, sqft), { picked: 3, required: 3, short: 0, enough: true, sqft: 225.3 });
  assert.deepEqual(selectionSummary([1, 2, 3, 4], 3, sqft), { picked: 4, required: 3, short: 0, enough: true, sqft: 225.3 }, "an unknown slab's sqft is skipped, not NaN");
  // a line priced by area states no slab count: nothing to be short of
  assert.deepEqual(selectionSummary([1], null), { picked: 1, required: null, short: 0, enough: true, sqft: 0 });
  assert.deepEqual(selectionSummary([], undefined), { picked: 0, required: null, short: 0, enough: true, sqft: 0 });
});

test("shortfallOffer: the production-request button appears only on a real shortfall", () => {
  assert.deepEqual(shortfallOffer(40, 12), { offer: true, short: 28 });
  assert.deepEqual(shortfallOffer(40, 40), { offer: false, short: 0 });
  assert.deepEqual(shortfallOffer(40, 55), { offer: false, short: 0 });
  assert.deepEqual(shortfallOffer(null, 0), { offer: false, short: 0 }, "no stated quantity, no shortfall");
  assert.deepEqual(shortfallOffer(0, 0), { offer: false, short: 0 });
  assert.deepEqual(shortfallOffer(40, NaN), { offer: true, short: 40 }, "a failed search is zero available, not zero short");
});

// ═══════════ the bridge's decisions, from the adversarial review ═════════════
//
// Each block names the finding it pins and asserts the OLD behaviour is gone,
// so a revert fails here rather than on a lorry.

// ── [46] an unreadable slab mark used to read FULL_SLAB ──────────────────────
test("slabMarkOf: the mark fails CLOSED — unreadable is not whole", () => {
  assert.equal(slabMarkOf("FULL_SLAB"), "FULL_SLAB");
  assert.equal(slabMarkOf("CTS"), "CTS");
  assert.equal(slabMarkOf("  SAMPLE  "), "SAMPLE", "trimmed");

  // toRow used to do `String(r.slabMark ?? "FULL_SLAB")`: every one of these
  // came back "FULL_SLAB", which is the answer that puts a slab in a stock
  // check, on a hold and in a crate.
  for (const unreadable of [null, undefined, "", "   ", 0, {}, NaN]) {
    assert.equal(slabMarkOf(unreadable), UNREADABLE_SLAB_MARK, `${String(unreadable)} is not a mark`);
    assert.equal(isFullSlab(unreadable), false, `${String(unreadable)} must not read as a full slab`);
  }
  assert.equal(isFullSlab("FULL_SLAB"), true);
  assert.equal(isFullSlab("CTS"), false);

  assert.equal(notFullSlabReason("CTS"), "marked CTS — not a full slab");
  assert.match(notFullSlabReason(null), /could not be read/, "the reason says WHY, so it goes to the right person");
  assert.doesNotMatch(notFullSlabReason(null), /FULL_SLAB/);
});

// ── [30] `missing` was always empty on pack / unpack / release ───────────────
test("missingSlabNumbers: the numbers asked for that no inventory row answered", () => {
  const read = [{ slabNumber: 144338 }, { slabNumber: 144340 }];
  assert.deepEqual(missingSlabNumbers([144338, 144339, 144340, 144341], read), [144339, 144341]);
  assert.deepEqual(missingSlabNumbers([144338, 144340], read), [], "nothing missing when everything was read");
  // The failure the finding names: ask for slabs that do not exist and the
  // caller must be able to tell that from a successful no-op. packSlabs,
  // unpackSlabs and releaseHeld each returned [] here however many went in.
  assert.deepEqual(missingSlabNumbers([1, 2, 3], []), [1, 2, 3], "nothing read → everything missing");
  assert.deepEqual(missingSlabNumbers([], read), []);
  assert.deepEqual(missingSlabNumbers([5, 5, 6], [{ slabNumber: 6 }]), [5, 5], "order preserved, request taken as given");
});

// ── [24] a RESTORE is not an acquisition ─────────────────────────────────────
test("approvalFilterApplies: every acquiring path filters; the restore does not", () => {
  for (const op of ["search", "read", "hold", "release", "pack", "dispatch"] as const) {
    assert.equal(approvalFilterApplies(op), true, `${op} acquires or shows stock — it must filter`);
  }
  // THE FINDING: with the filter on, a slab an ADMIN legitimately packed out of
  // an unapproved (design, batch) pair could not be READ by a non-admin
  // checker, so rejecting or reopening the list returned nothing and the slab
  // stayed PACKED with no route back to stock.
  assert.equal(approvalFilterApplies("unpack"), false, "putting a slab back is neither seeing nor committing unapproved stock");
});

// ── [11] packing another party's held slab out from under its hold ───────────
const heldByAnotherOrder = { slabNumber: 150903, status: "RESERVED", reservedForPi: "SAL-ORD/26-27/01700" };

test("foreignHoldReason: a slab reserved under a reference the caller does not own is refused", () => {
  const mine = ["SAL-ORD/26-27/01642", "ENQ/26-27/0003"];

  // THE FINDING: two orders both have the slab on a DRAFT list, B holds it, A
  // submits. packSlabs used to convert B's RESERVED straight to PACKED.
  const refused = foreignHoldReason(heldByAnotherOrder, mine);
  assert.equal(typeof refused, "string", "somebody else's hold must refuse the pack");
  assert.match(String(refused), /SAL-ORD\/26-27\/01700/, "the reason names whose hold it is");

  assert.equal(foreignHoldReason({ ...heldByAnotherOrder, reservedForPi: mine[0] }, mine), null, "our own order's hold packs");
  assert.equal(foreignHoldReason({ ...heldByAnotherOrder, reservedForPi: mine[1] }, mine), null, "a hold placed against the enquiry packs");
  assert.equal(foreignHoldReason({ ...heldByAnotherOrder, reservedForPi: "  sal-ord/26-27/01642 " }, mine), null,
    "matched trimmed and case-insensitively — a stamp that differs only in case is still ours");

  assert.equal(foreignHoldReason({ slabNumber: 1, status: "AVAILABLE", reservedForPi: null }, mine), null, "plain stock is nobody's");
  assert.equal(foreignHoldReason({ slabNumber: 1, status: "AVAILABLE", reservedForPi: "SAL-ORD/26-27/01700" }, mine), null,
    "a stale stamp on an AVAILABLE slab is not a hold — the sweep already freed it");
  assert.equal(foreignHoldReason({ slabNumber: 1, status: "RESERVED", reservedForPi: null }, mine), null,
    "RESERVED with no reference at all is nobody's hold");
  assert.equal(foreignHoldReason({ slabNumber: 1, status: "RESERVED", reservedForPi: "   " }, []), null);

  // An empty list is not "anything goes": a caller that cannot say what it owns
  // owns nothing, so every held slab is refused.
  assert.equal(typeof foreignHoldReason(heldByAnotherOrder, []), "string", "no references named → no held slab may be packed");
});

// ── [29] a part-packed hold read RELEASED, and a vanished row read released ──
const EXPIRED_AT = new Date("2026-09-01T00:00:00.000Z");
const EXPIRES_LATER = new Date("2026-09-20T00:00:00.000Z");
const RECONCILED_AT = new Date("2026-09-06T10:00:00.000Z");

test("holdStatusAfterReconcile: anything packed is CONSUMED; the rest is EXPIRED or RELEASED", () => {
  // THE FINDING: hold 40, pack 32, hand 8 back. `packed > 0 && released === 0`
  // made this RELEASED — or EXPIRED once the five days ran — and the order's
  // history then said the stock check came to nothing, with 32 slabs in a
  // container.
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 32, released: 8, unreadable: 0 }, EXPIRES_LATER, RECONCILED_AT), "CONSUMED");
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 32, released: 8, unreadable: 0 }, EXPIRED_AT, RECONCILED_AT), "CONSUMED",
    "a lapsed expiry does not undo the fact that the hold ended in a packing list");
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 1, released: 39, unreadable: 0 }, EXPIRES_LATER, RECONCILED_AT), "CONSUMED",
    "one packed slab is enough — releasing the remainder is how a hold ordinarily ends");
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 40, released: 0, unreadable: 0 }, EXPIRES_LATER, RECONCILED_AT), "CONSUMED");

  // Nothing packed: the expiry says which way it ended.
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 0, released: 40, unreadable: 0 }, EXPIRES_LATER, RECONCILED_AT), "RELEASED");
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 0, released: 40, unreadable: 0 }, EXPIRED_AT, RECONCILED_AT), "EXPIRED");
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 0, released: 0, unreadable: 3 }, EXPIRES_LATER, RECONCILED_AT), "RELEASED",
    "slabs we could not read do not by themselves make a hold CONSUMED");
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 2, released: 0, unreadable: 3 }, EXPIRES_LATER, RECONCILED_AT), "CONSUMED");
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 0, released: 1, unreadable: 0 }, "2026-09-01T00:00:00.000Z", RECONCILED_AT), "EXPIRED",
    "an ISO expiry reads the same as a Date");
});

// ── [14] canonicalDesign() per row: 500 rows = 25.3 s on live Neon ───────────
test("canonicalFromMap: the same answer canonicalDesign gives, from one loaded table", () => {
  const aliases = new Map<string, string>([["Arva White Trial", "Trial"], ["CARRARA ROYALE", "Carrara Royale"]]);
  assert.equal(canonicalFromMap(aliases, "Arva White Trial"), "Trial", "a merged variant reads as the name it is shown under");
  assert.equal(canonicalFromMap(aliases, "CARRARA ROYALE"), "Carrara Royale");
  assert.equal(canonicalFromMap(aliases, "Cappuccino"), "Cappuccino", "a design with no alias is its own canonical");
  assert.equal(canonicalFromMap(aliases, null), null);
  assert.equal(canonicalFromMap(aliases, undefined), null);
  assert.equal(canonicalFromMap(aliases, ""), null, "no design, no canonical — never the empty string");
  assert.equal(canonicalFromMap(new Map(), "Cappuccino"), "Cappuccino", "an unreadable alias table still answers the raw name");
});

// ═══════════════ answer 11: there is no extension ════════════════════════════
//
// The extend route, its rule and its button are gone. What replaces them is
// nothing: a hold lapses, reconcileHold marks it EXPIRED through
// holdStatusAfterReconcile, and regressExpiredOrder sends the order back to
// the stock check. These pin the pure half of that path and the sentence the
// card shows instead of a button.

test("no extension: the rules module exports nothing that extends a hold", async () => {
  const mod = await import("../src/lib/commercial/holds-rules.ts");
  assert.deepEqual(Object.keys(mod).filter((k) => /extend/i.test(k)), [], "an extend helper coming back here means the route is coming back too");
});

test("expiry sends the order back: a lapsed hold with nothing packed is EXPIRED, whatever else happened to it", () => {
  const lapsed = new Date("2026-09-01T00:00:00.000Z");
  const checkedAt = new Date("2026-09-06T10:00:00.000Z");
  // the sweep freed every slab overnight: released = all, expiry in the past
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 0, released: 40, unreadable: 0 }, lapsed, checkedAt), "EXPIRED");
  // some were released by hand before the five days ran; the rest lapsed
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 0, released: 12, unreadable: 0 }, lapsed, checkedAt), "EXPIRED");
  // one slab we could not read does not stop the hold being recorded as lapsed
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 0, released: 39, unreadable: 1 }, lapsed, checkedAt), "EXPIRED");
  // exactly at the expiry instant it has not lapsed yet — the sweep runs after
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 0, released: 40, unreadable: 0 }, checkedAt, checkedAt), "RELEASED");
  // and a hold with slabs in a container never lapses into a stock re-check
  assert.equal(holdStatusAfterReconcile({ stillHeld: 0, packed: 3, released: 37, unreadable: 0 }, lapsed, checkedAt), "CONSUMED");
  assert.equal(canActOnHold("EXPIRED").ok, false, "nothing can be done to a lapsed hold — a new hold is the only way on");
});

test("holdExpiryLine: the card says what expiry costs instead of offering a button", () => {
  assert.equal(holdExpiryLine("ACTIVE", "11/09/2026, 10:00 am"), "expires 11/09/2026, 10:00 am — on expiry the order returns to the stock check");
  assert.equal(holdExpiryLine("EXPIRED", "01/09/2026, 10:00 am"), "lapsed 01/09/2026, 10:00 am — the order went back to the stock check");
  assert.equal(holdExpiryLine("CONSUMED", "x"), "packed");
  assert.equal(holdExpiryLine("RELEASED", "x"), "released");
});

// ═══════════════ answer 12: no holds against an enquiry ══════════════════════

test("holdTarget: an order id is the only target; an enquiry is refused with the reason, not converted", () => {
  assert.deepEqual(holdTarget({ orderId: " ord_1 " }), { ok: true, orderId: "ord_1" });
  assert.deepEqual(holdTarget({ orderId: "ord_1", enquiryId: "enq_1" }), { ok: true, orderId: "ord_1" }, "an order in the body wins; the enquiry is history");
  const enq = holdTarget({ enquiryId: "enq_1" });
  assert.equal(enq.ok, false);
  assert.match((enq as { reason: string }).reason, /not held against an enquiry/);
  assert.match((enq as { reason: string }).reason, /answer 12/);
  const none = holdTarget({});
  assert.equal(none.ok, false);
  assert.match((none as { reason: string }).reason, /orderId/);
  assert.equal(holdTarget({ orderId: "   ", enquiryId: "" }).ok, false, "blanks are not ids");
  assert.equal(holdTarget({ orderId: 42 }).ok, false, "an id is a string");
});
