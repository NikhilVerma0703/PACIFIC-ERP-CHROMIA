// Packing-list and dispatch-check rules, RUN against real values: which
// statuses may be edited/submitted/verified, which inventory rows may go on a
// list, what a packed-slab row is built from an inventory row, how the Packing
// List groups crates into printed lines, how the Measurement List orders slabs
// and subtotals crates, what the dispatch check concludes, and what submit
// does with the bridge's answer. Import-free module, so node --test loads it
// bare (relative path, explicit .ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canEdit, canEditHeader, canSubmit, canReopen, canVerify, canFinalise, canDispatch,
  nextCrateNo, isSampleCrate, packagesSummary, nextPackagesSummary, marksAndNos, pad2,
  fitCounts, verifyOutcome, rejectionNote, verificationNote,
  slabEligibility, matchOrderItem, buildPackedSlab, partitionForPack, remeasure,
  parseSlabNumbers, slabNumberList, nextSortOrder, pageArgs, parsePackingStatus, fitPatch,
  submitOutcome, removalNote, dispatchNote,
  thicknessForDoc, slabDescription, crateGroups, samplesRow, printableSamplesRow, plTotals, measurementRows,
  quantityUnit, kgToMt, partyLines, fallbackParty, docDate, pdfFilename,
  dispatchPlan, bridgeSkips, restoredSlabs, strandedNote,
  parseCheckerStatus, checkerMaySee, checkerListView, checkerSlabView, CHECKER_STATUSES,
  measurementHeaderRef, vesselFromSnapshot,
  canRecheck, canCreatePackingList, canSetUnit, dispatchBlockers, swapEligibility, replacementEligibility, holdDaysLeft, swapNote,
  swapReleaseOutcome, swapRefusalNote, swapFailureNote, type SwapUndoLike,
  PACKING_STATUSES, PACKING_STATUS_LABEL, CRATE_KINDS, UNFIT_REASONS,
  type SlabLike, type CrateLike,
} from "../src/lib/commercial/packing-rules.ts";
import {
  parseMeasurementUnit, cmToIn, cmFromIn, sizeInUnit, sizeToCm, MEASUREMENT_UNITS, inToCm,
} from "../src/lib/commercial/measure.ts";

// ───────────────────────────── status rules ─────────────────────────────────

test("canEdit: crates and slabs move only while the list is with Commercial", () => {
  assert.equal(canEdit("DRAFT"), true);
  assert.equal(canEdit("REJECTED"), true, "a rejected list is being rebuilt");
  assert.equal(canEdit("SUBMITTED"), false, "the dispatch team is looking at it");
  assert.equal(canEdit("VERIFIED"), false);
  assert.equal(canEdit("FINAL"), false);
  assert.equal(canEdit("DISPATCHED"), false);
  assert.equal(canEdit("NONSENSE"), false, "an unknown status fails closed");
});

test("canEditHeader: container and weights stay open until the slabs have gone", () => {
  for (const s of ["DRAFT", "SUBMITTED", "VERIFIED", "REJECTED", "FINAL"]) {
    assert.equal(canEditHeader(s), true, `${s} should still take a container number`);
  }
  assert.equal(canEditHeader("DISPATCHED"), false);
});

test("canSubmit: an editable list with at least one slab, and it says why not", () => {
  assert.deepEqual(canSubmit("DRAFT", [{}]), { ok: true });
  assert.deepEqual(canSubmit("REJECTED", [{}, {}]), { ok: true });
  const empty = canSubmit("DRAFT", []);
  assert.equal(empty.ok, false);
  assert.match((empty as { reason: string }).reason, /at least one slab/i);
  const late = canSubmit("SUBMITTED", [{}]);
  assert.equal(late.ok, false);
  assert.match((late as { reason: string }).reason, /awaiting check/i);
});

test("the other gates line up with the pipeline", () => {
  assert.equal(canReopen("SUBMITTED"), true);
  assert.equal(canReopen("REJECTED"), true);
  assert.equal(canReopen("DRAFT"), false);
  assert.equal(canReopen("FINAL"), false, "a final list is not pulled back from here");
  assert.equal(canVerify("SUBMITTED"), true);
  assert.equal(canVerify("VERIFIED"), false, "verifying twice is not a thing");
  assert.equal(canFinalise("VERIFIED"), true);
  assert.equal(canFinalise("SUBMITTED"), false);
  assert.equal(canDispatch("FINAL"), true);
  assert.equal(canDispatch("VERIFIED"), false, "finalise first");
  assert.equal(canDispatch("DISPATCHED"), false);
});

test("every status has a label", () => {
  for (const s of PACKING_STATUSES) assert.equal(typeof PACKING_STATUS_LABEL[s], "string");
  assert.equal(PACKING_STATUS_LABEL.SUBMITTED, "Awaiting check");
});

// ───────────────────────────── crates ───────────────────────────────────────

test("nextCrateNo: one past the highest, 1 on an empty list", () => {
  assert.equal(nextCrateNo([]), 1);
  assert.equal(nextCrateNo([{ crateNo: 1 }, { crateNo: 2 }]), 3);
  assert.equal(nextCrateNo([{ crateNo: 7 }, { crateNo: 3 }]), 8, "gaps do not renumber");
});

test("packagesSummary: the reference invoice's own wording", () => {
  const crates = [
    ...Array.from({ length: 7 }, () => ({ kind: "Wooden Crate" })),
    ...Array.from({ length: 8 }, () => ({ kind: "Sample Box" })),
  ];
  assert.equal(packagesSummary(crates), "07 Wooden Crate(S) + 08 Sample Box");
  assert.equal(packagesSummary([{ kind: "Wooden Crate" }]), "01 Wooden Crate(S)");
  assert.equal(packagesSummary([]), null, "no crates, no summary");
  assert.equal(
    packagesSummary([{ kind: "Sample Box" }, { kind: "Wooden Crate" }]),
    "01 Wooden Crate(S) + 01 Sample Box",
    "wooden crates print first whatever order they were made in",
  );
});

test("nextPackagesSummary: kept true automatically, never over a typed wording", () => {
  const one = [{ kind: "Wooden Crate" }];
  const two = [{ kind: "Wooden Crate" }, { kind: "Wooden Crate" }];
  assert.deepEqual(nextPackagesSummary("", [], one), { change: true, value: "01 Wooden Crate(S)" });
  assert.deepEqual(nextPackagesSummary(null, [], []), { change: false, value: null });
  assert.deepEqual(nextPackagesSummary("01 Wooden Crate(S)", one, two), { change: true, value: "02 Wooden Crate(S)" },
    "it was ours, so it follows the crates");
  assert.deepEqual(nextPackagesSummary("2 x 20ft FCL", one, two), { change: false, value: "2 x 20ft FCL" },
    "somebody typed that; leave it alone");
  assert.deepEqual(nextPackagesSummary("01 Wooden Crate(S)", one, one), { change: false, value: "01 Wooden Crate(S)" },
    "no crate change, no write");
});

test("marks and pad2 and sample-crate detection", () => {
  assert.equal(marksAndNos([]), "");
  assert.equal(marksAndNos([{}]), "01");
  assert.equal(marksAndNos(Array.from({ length: 15 }, () => ({}))), "01 to 15");
  assert.equal(pad2(7), "07");
  assert.equal(pad2(70), "70");
  assert.equal(isSampleCrate("Sample Box"), true);
  assert.equal(isSampleCrate("sample box"), true);
  assert.equal(isSampleCrate("Wooden Crate"), false);
  assert.equal(isSampleCrate(null), false);
  assert.ok(CRATE_KINDS.includes("Wooden Crate"));
});

// ───────────────────────────── the dispatch check ───────────────────────────

const slabs = (fits: Array<[number, string, string?]>): Array<{ id: string; slabNumber: number; fit: string; unfitReason: string | null }> =>
  fits.map(([n, f, why], i) => ({ id: `s${i}`, slabNumber: n, fit: f, unfitReason: why ?? null }));

test("fitCounts and verifyOutcome", () => {
  assert.deepEqual(fitCounts([{ fit: "FIT" }, { fit: "UNFIT" }, { fit: "PENDING" }, { fit: "FIT" }]),
    { total: 4, fit: 2, unfit: 1, pending: 1 });

  const clean = verifyOutcome(slabs([[1, "FIT"], [2, "FIT"]]));
  assert.equal(clean.ok, true);
  assert.equal(clean.pending, 0);
  assert.deepEqual(clean.unfit, []);

  const half = verifyOutcome(slabs([[1, "FIT"], [2, "PENDING"]]));
  assert.equal(half.ok, false);
  assert.equal(half.pending, 1, "a list cannot be concluded while a slab is unlooked-at");

  const bad = verifyOutcome(slabs([[1, "FIT"], [2, "UNFIT", "Chipped edge"], [3, "UNFIT"]]));
  assert.equal(bad.ok, false);
  assert.equal(bad.pending, 0);
  assert.deepEqual(bad.unfit, [
    { id: "s1", slabNumber: 2, reason: "Chipped edge" },
    { id: "s2", slabNumber: 3, reason: "no reason given" },
  ]);
});

test("the notes a conclusion writes", () => {
  assert.equal(
    rejectionNote([{ slabNumber: 150903, reason: "Crack" }, { slabNumber: 150904, reason: "Chipped edge" }]),
    "Rejected — 2 unfit: #150903 (Crack); #150904 (Chipped edge)",
  );
  assert.match(rejectionNote([{ slabNumber: 1, reason: "Crack" }], "reload tomorrow"), /reload tomorrow$/);
  assert.equal(verificationNote(47), "All 47 slab(s) checked fit");
  assert.equal(verificationNote(47, "loaded 18:40"), "All 47 slab(s) checked fit. loaded 18:40");
});

test("fitPatch: UNFIT must say why; PENDING is not a verdict", () => {
  assert.deepEqual(fitPatch("FIT", null), { ok: true, fit: "FIT", unfitReason: null });
  assert.deepEqual(fitPatch("fit", "Crack"), { ok: true, fit: "FIT", unfitReason: null },
    "a reason on a fit slab is dropped, not stored");
  assert.deepEqual(fitPatch("UNFIT", " Crack "), { ok: true, fit: "UNFIT", unfitReason: "Crack" });
  const noWhy = fitPatch("UNFIT", "   ");
  assert.equal(noWhy.ok, false);
  assert.match((noWhy as { reason: string }).reason, /what is wrong/i);
  assert.equal(fitPatch("PENDING", null).ok, false);
  assert.equal(fitPatch(undefined, null).ok, false);
  assert.ok(UNFIT_REASONS.length >= 4);
});

// ───────────────────────────── eligibility and rows ─────────────────────────

test("slabEligibility: our own holds may be packed, other people's may not", () => {
  const ours = ["SAL-ORD/26-27/01642", "ENQ/26-27/0007"];
  assert.deepEqual(slabEligibility({ slabNumber: 1, status: "AVAILABLE" }, ours), { ok: true });
  // A RETURNED slab is refused AT INTAKE, where the clerk can do something
  // about it. It used to be accepted here and then deleted from the list at
  // submit, because the bridge's packSlabs only packs AVAILABLE and RESERVED —
  // so the mistake surfaced an hour later as a list one slab shorter.
  const returned = slabEligibility({ slabNumber: 1, status: "RETURNED" }, ours);
  assert.equal(returned.ok, false, "the inventory will not pack a RETURNED slab, so the list must not take one");
  assert.match((returned as { reason: string }).reason, /RETURNED — release it back to available/);
  assert.deepEqual(slabEligibility({ slabNumber: 1, status: "RESERVED", reservedForPi: "SAL-ORD/26-27/01642" }, ours), { ok: true });
  assert.deepEqual(slabEligibility({ slabNumber: 1, status: "RESERVED", reservedForPi: "SAL-ORD/26-27/01111" }, ours),
    { ok: false, reason: "held under SAL-ORD/26-27/01111" });
  assert.deepEqual(slabEligibility({ slabNumber: 1, status: "RESERVED", reservedForPi: null }, ours),
    { ok: false, reason: "held under another reference" });
  assert.deepEqual(slabEligibility({ slabNumber: 1, status: "PACKED" }, ours), { ok: false, reason: "already PACKED" });
  assert.deepEqual(slabEligibility({ slabNumber: 1, status: "DISPATCHED" }, ours), { ok: false, reason: "DISPATCHED — cannot be packed" });
  assert.deepEqual(slabEligibility({ slabNumber: 1, status: "AVAILABLE", slabMark: "CTS" }, ours),
    { ok: false, reason: "marked CTS — not a full slab" });
});

const orderItems = [
  { design: "Carrara Royale", customerSku: "VGWT10301A", thickness: "2 cm", isSample: false },
  { design: "Carrara Royale", customerSku: "VGWT10303A", thickness: "3 cm", isSample: false },
  { design: "Onyx Storm", customerSku: "OSWT10305A", thickness: null, isSample: false },
  { design: "Carrara Royale", customerSku: "SAMPLE-CR", thickness: "2 cm", isSample: true },
];

test("matchOrderItem: same design AND thickness, then the line with no thickness", () => {
  assert.equal(matchOrderItem(orderItems, "Carrara Royale", "20mm")?.customerSku, "VGWT10301A", "20mm is 2 cm");
  assert.equal(matchOrderItem(orderItems, "CARRARA ROYALE", "3 cm")?.customerSku, "VGWT10303A");
  assert.equal(matchOrderItem(orderItems, "Onyx Storm", "3 cm")?.customerSku, "OSWT10305A", "a line with no thickness catches any");
  assert.equal(matchOrderItem(orderItems, "Carrara Royale", "7 mm"), null, "no 7mm line, and no untyped line for that design");
  assert.equal(matchOrderItem(orderItems, null, "2 cm"), null);
  assert.equal(matchOrderItem([], "Carrara Royale", "2 cm"), null);
});

test("buildPackedSlab: canonical design and thickness, the customer's SKU, cm from inches", () => {
  const row = {
    slabNumber: 150903, design: "carrara royale", designCanonical: "CARRARA ROYALE",
    thickness: "20mm", thicknessCanonical: "2 cm", batchKey: "B-0123", batchNumber: "PES.0123",
    grade: "A", lengthIn: 137, widthIn: 79,
  };
  const built = buildPackedSlab(row, orderItems, 4);
  assert.equal(built.slabNumber, 150903);
  assert.equal(built.design, "CARRARA ROYALE");
  assert.equal(built.thickness, "2 cm");
  assert.equal(built.customerSku, "VGWT10301A");
  assert.equal(built.batchNumber, "PES.0123");
  assert.equal(built.grade, "A");
  assert.equal(built.lengthCm, 348, "137 in → 348 cm");
  assert.equal(built.widthCm, 201, "79 in → 201 cm");
  assert.equal(built.sqm, 6.9948);
  assert.equal(built.sqft, 75.292, "6.9948 sqm x 10.764");
  assert.equal(built.fit, "PENDING");
  assert.equal(built.sortOrder, 4);

  // no matching line, no measurements stored: the nominal slab is used
  const bare = buildPackedSlab({ slabNumber: 2, design: null, batchKey: null, batchNumber: null, grade: null, lengthIn: null, widthIn: null }, [], 1);
  assert.equal(bare.design, null);
  assert.equal(bare.customerSku, null);
  assert.equal(bare.lengthCm, 348);
  assert.equal(bare.widthCm, 201);
});

test("partitionForPack: OUR already-PACKED slabs are left alone at submit", () => {
  const p = partitionForPack([
    { slabNumber: 1, status: "PACKED" },
    { slabNumber: 2, status: "RESERVED" },
    { slabNumber: 3, status: "AVAILABLE" },
  ], [1]);
  assert.deepEqual(p.alreadyPacked, [1], "this list packed #1 before it was rejected");
  assert.deepEqual(p.toPack, [2, 3]);
  assert.deepEqual(p.refused, []);
});

test("partitionForPack: a slab ANOTHER list packed is refused, not adopted", () => {
  // Two DRAFT lists may both hold a slab while it is AVAILABLE. The first
  // submits and packs it. At the second submit the slab reads PACKED — and
  // treating that as "already done" is how two packing lists come to claim one
  // slab and one container leaves a slab short.
  const p = partitionForPack([
    { slabNumber: 150903, status: "PACKED" },     // packed by the other list
    { slabNumber: 150904, status: "AVAILABLE" },
  ]);   // no ownPacked: this list has never been submitted
  assert.deepEqual(p.alreadyPacked, [], "nothing on this list packed 150903");
  assert.deepEqual(p.toPack, [150904]);
  assert.deepEqual(p.refused, [{ slab: 150903, reason: "already PACKED — not by this list" }]);

  // and the refusal is per slab, not per list: the rest still submits
  const mixed = partitionForPack(
    [{ slabNumber: 1, status: "PACKED" }, { slabNumber: 2, status: "PACKED" }, { slabNumber: 3, status: "AVAILABLE" }],
    [2],
  );
  assert.deepEqual(mixed.alreadyPacked, [2]);
  assert.deepEqual(mixed.refused.map((r) => r.slab), [1]);
  assert.deepEqual(mixed.toPack, [3]);
});

test("remeasure: whichever side is typed replaces the stored one, areas follow", () => {
  assert.deepEqual(remeasure({ lengthCm: 348, widthCm: 201 }, { lengthCm: 347 }),
    { lengthCm: 347, widthCm: 201, sqm: 6.9747, sqft: 75.076 }, "the CIOT sheet's own row");
  assert.deepEqual(remeasure({ lengthCm: 348, widthCm: 201 }, { widthCm: 200 }),
    { lengthCm: 348, widthCm: 200, sqm: 6.96, sqft: 74.917 });
  assert.deepEqual(remeasure({ lengthCm: null, widthCm: null }, {}),
    { lengthCm: 348, widthCm: 201, sqm: 6.9948, sqft: 75.292 }, "the nominal slab when nothing is known");
});

// ───────────────────────────── parsing at the edges ─────────────────────────

test("parseSlabNumbers: what a clerk actually types", () => {
  assert.deepEqual(parseSlabNumbers("150903, 150904 150905"), [150903, 150904, 150905]);
  assert.deepEqual(parseSlabNumbers("150905-150908"), [150905, 150906, 150907, 150908]);
  assert.deepEqual(parseSlabNumbers("150903;150903"), [150903], "duplicates collapse");
  assert.deepEqual(parseSlabNumbers("abc, -5, 0"), []);
  assert.deepEqual(parseSlabNumbers(""), []);
  assert.deepEqual(parseSlabNumbers("1-9999"), [], "a runaway range is refused, not expanded");
  assert.deepEqual(parseSlabNumbers("144338.1"), [144338.1], "an insert slab is a real slab number");
});

test("slabNumberList: an array or a typed string, same contract", () => {
  assert.deepEqual(slabNumberList([3, "1", 2, 2]), [1, 2, 3]);
  assert.deepEqual(slabNumberList("3 1 2"), [1, 2, 3]);
  assert.deepEqual(slabNumberList([0, -1, "x", null, undefined, ""]), []);
  assert.deepEqual(slabNumberList(null), []);
  assert.deepEqual(slabNumberList({ a: 1 }), []);
});

test("nextSortOrder, pageArgs, parsePackingStatus", () => {
  assert.equal(nextSortOrder([]), 1);
  assert.equal(nextSortOrder([{ sortOrder: 3 }, { sortOrder: 9 }]), 10);
  assert.deepEqual(pageArgs(null, null), { page: 1, limit: 50, skip: 0, take: 50 });
  assert.deepEqual(pageArgs("3", "20"), { page: 3, limit: 20, skip: 40, take: 20 });
  assert.deepEqual(pageArgs("0", "9999"), { page: 1, limit: 500, skip: 0, take: 500 });
  assert.equal(parsePackingStatus("submitted"), "SUBMITTED");
  assert.equal(parsePackingStatus("nonsense"), null, "a typo widens the list rather than emptying it");
  assert.equal(parsePackingStatus(null), null);
});

// ───────────────────────────── submit's arithmetic ──────────────────────────

test("submitOutcome: what the bridge refused comes off the list", () => {
  const onList = [
    { id: "a", slabNumber: 1 }, { id: "b", slabNumber: 2 }, { id: "c", slabNumber: 3 }, { id: "d", slabNumber: 4 },
  ];
  const out = submitOutcome(onList, {
    skipped: [{ slab: 2, reason: "marked CTS — not a full slab" }],
    missing: [4],
  });
  assert.deepEqual(out.kept.map((k) => k.slabNumber), [1, 3]);
  assert.deepEqual(out.removed, [
    { id: "b", slab: 2, reason: "marked CTS — not a full slab" },
    { id: "d", slab: 4, reason: "not found in finished goods" },
  ]);

  const clean = submitOutcome(onList, { skipped: [], missing: [] });
  assert.equal(clean.kept.length, 4);
  assert.equal(clean.removed.length, 0);

  const nothing = submitOutcome([{ id: "a", slabNumber: 1 }], { skipped: [{ slab: 1, reason: "already PACKED" }], missing: [] });
  assert.equal(nothing.kept.length, 0, "the route turns an empty kept into a 409 and changes nothing");
});

test("removalNote and dispatchNote read as sentences", () => {
  assert.equal(removalNote([]), "");
  assert.equal(removalNote([{ slab: 2, reason: "already PACKED" }]), "1 slab(s) dropped: #2 (already PACKED)");
  assert.equal(dispatchNote("PL/26-27/0004", 47, []), "Packing list PL/26-27/0004 dispatched — 47 slab(s)");
  assert.match(dispatchNote("PL/26-27/0004", 46, [{ slab: 9, reason: "DISPATCHED, not on hold" }]), /Not dispatched: #9 \(DISPATCHED, not on hold\)$/);
});

// ───────────────────────────── the printed sheets ───────────────────────────

const crates: CrateLike[] = [
  { id: "c1", crateNo: 1, kind: "Wooden Crate", netKg: 1000, remarks: null },
  { id: "c2", crateNo: 2, kind: "Wooden Crate", netKg: 1200, remarks: null },
  { id: "c3", crateNo: 3, kind: "Sample Box", netKg: 40, remarks: "6 pcs 30x30" },
];

const slab = (over: Partial<SlabLike> & { slabNumber: number; sortOrder: number }): SlabLike => ({
  crateId: null, customerSlabNo: null, customerBatchNo: null, design: "ONYX STORM", customerSku: "OSWT10305A",
  thickness: "3 cm", batchKey: "B-1", batchNumber: "PES.0301", grade: "A",
  lengthCm: 347, widthCm: 201, sqm: 6.9747, sqft: 75.076, fit: "PENDING",
  ...over,
});

const sheetSlabs: SlabLike[] = [
  slab({ slabNumber: 101, sortOrder: 1, crateId: "c1" }),
  slab({ slabNumber: 102, sortOrder: 2, crateId: "c1" }),
  slab({ slabNumber: 103, sortOrder: 3, crateId: "c2" }),
  slab({ slabNumber: 104, sortOrder: 4, crateId: "c2", design: "CARRARA ROYALE", customerSku: "VGWT10301A", thickness: "2 cm", lengthCm: 348, widthCm: 201, sqm: 6.9948, sqft: 75.292 }),
  slab({ slabNumber: 105, sortOrder: 5, crateId: null }),
];

test("thicknessForDoc and slabDescription: how the sheets spell things", () => {
  assert.equal(thicknessForDoc("3 cm"), "3CM");
  assert.equal(thicknessForDoc("20mm"), "2CM");
  assert.equal(thicknessForDoc("7 mm"), "7MM");
  assert.equal(thicknessForDoc(null), "");
  assert.equal(slabDescription({ customerSku: "OSWT10305A", design: "ONYX STORM" }), "OSWT10305A", "the customer's code when there is one");
  assert.equal(slabDescription({ customerSku: null, design: "ONYX STORM" }), "ONYX STORM");
  assert.equal(slabDescription({ customerSku: "  ", design: null }), "—");
});

test("crateGroups: one printed line per design and thickness across the crates", () => {
  const g = crateGroups(sheetSlabs, crates);
  assert.equal(g.length, 2, "four Onyx 3CM slabs in two crates are ONE line, not two");

  const onyx = g[0];
  assert.equal(onyx.description, "OSWT10305A");
  assert.equal(onyx.thickness, "3CM");
  assert.equal(onyx.slabs, 4);
  assert.equal(onyx.sqm, 27.8988, "4 × 6.9747");
  assert.deepEqual(onyx.crateNos, [1, 2], "the unassigned slab adds no crate");
  assert.deepEqual(onyx.batches, ["PES.0301"]);
  // crate 1 (1000 kg over 2 slabs) + crate 2 (1200 kg over 2 slabs, one of them Onyx)
  assert.equal(onyx.netKg, 1600, "1000 + 600: a shared crate's weight splits by slab count");

  const carrara = g[1];
  assert.equal(carrara.description, "VGWT10301A");
  assert.equal(carrara.thickness, "2CM");
  assert.equal(carrara.slabs, 1);
  assert.equal(carrara.sqm, 6.9948);
  assert.equal(carrara.netKg, 600);

  assert.deepEqual(crateGroups([], crates), []);
});

test("samplesRow and plTotals", () => {
  const s = samplesRow(crates, [{ qtySlabs: 6 }]);
  assert.ok(s);
  assert.equal(s!.description, "Free Trade Samples");
  assert.equal(s!.boxes, 1);
  assert.equal(s!.pcs, 6);
  assert.equal(s!.netKg, 40);
  assert.equal(s!.remarks, "6 pcs 30x30");
  assert.equal(samplesRow([{ id: "c1", crateNo: 1, kind: "Wooden Crate" }]), null, "no sample box, no line");

  const groups = crateGroups(sheetSlabs, crates);
  const t = plTotals(groups, s, crates);
  assert.equal(t.slabs, 5 + 6, "five slabs plus six sample pieces");
  assert.equal(t.sqm, 34.8936);
  assert.equal(t.packages, 3);
  assert.equal(t.netKg, 2240, "1600 + 600 + 40");

  const noSamples = plTotals(groups, null, crates);
  assert.equal(noSamples.slabs, 5);
  assert.equal(noSamples.netKg, 2200);
});

test("measurementRows: crate order, a subtotal after each crate, a grand total", () => {
  const sheet = measurementRows(sheetSlabs, crates);
  const kinds = sheet.rows.map((r) => r.kind);
  assert.deepEqual(kinds, ["slab", "slab", "subtotal", "slab", "slab", "subtotal", "slab", "subtotal"]);

  const first = sheet.rows[0];
  assert.equal(first.kind, "slab");
  if (first.kind === "slab") {
    assert.equal(first.sl, 1);
    assert.equal(first.description, "OSWT10305A");
    assert.equal(first.batch, "PES.0301");
    assert.equal(first.slabNumber, 101);
    assert.equal(first.thickness, "3CM");
    assert.equal(first.crateNo, 1);
    assert.equal(first.customerSlabNo, "");
  }

  const sub1 = sheet.rows[2];
  if (sub1.kind === "subtotal") {
    assert.equal(sub1.crateNo, 1);
    assert.equal(sub1.slabs, 2);
    assert.equal(sub1.sqm, 13.9494);
  }
  const last = sheet.rows[7];
  if (last.kind === "subtotal") assert.equal(last.crateNo, null, "the unassigned block subtotals under no crate");

  assert.equal(sheet.totals.slabs, 5);
  assert.equal(sheet.totals.sqm, 34.8936);
  assert.equal(sheet.totals.sqft, 375.596);
  assert.equal(sheet.hasCustomerNos, false);

  const withCustomer = measurementRows(
    [slab({ slabNumber: 101, sortOrder: 1, crateId: "c1", customerSlabNo: "CIOT-01", customerBatchNo: "LOT-9" })],
    crates,
  );
  assert.equal(withCustomer.hasCustomerNos, true, "the sheet prints both columns once any slab carries theirs");
  assert.equal(withCustomer.hasCustomerBatches, true);
  const row = withCustomer.rows[0];
  if (row.kind === "slab") {
    assert.equal(row.customerSlabNo, "CIOT-01");
    // OURS ALWAYS PRINTS (OPEN-QUESTIONS §16). Theirs used to REPLACE ours,
    // which left the sheet with no way back to the batch we made the slab in.
    assert.equal(row.batch, "PES.0301", "our batch is still there");
    assert.equal(row.customerBatch, "LOT-9", "and theirs is beside it");
  }

  const empty = measurementRows([], crates);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.totals.slabs, 0);
});

test("quantityUnit and kgToMt: exports quote sqm, domestic sqft", () => {
  assert.deepEqual(quantityUnit("EXPORT"), { unit: "SQMT", field: "sqm", dp: 4 });
  assert.deepEqual(quantityUnit("DOMESTIC"), { unit: "SQFT", field: "sqft", dp: 3 });
  assert.equal(kgToMt(24000), "24.00 MT");
  assert.equal(kgToMt(null), "");
  assert.equal(kgToMt(Number.NaN), "");
});

test("parties, dates and filenames", () => {
  assert.deepEqual(
    partyLines({ name: "CIOT LLC", lines: ["1 Wall St", ""], country: "USA", tel: "555", gstin: null }),
    ["CIOT LLC", "1 Wall St", "USA", "Tel: 555"],
  );
  assert.deepEqual(partyLines(null), []);

  const client = { name: "CIOT LLC", address: "1 Wall St", city: "New York", country: "USA" };
  assert.deepEqual(fallbackParty(client, null), { name: "CIOT LLC", lines: ["1 Wall St", "New York"], country: "USA" });
  assert.equal(fallbackParty(client, { shippingAddress: { name: "", lines: ["Pier 9"] } })?.name, "CIOT LLC",
    "a shipping block with no name still uses the client's");
  assert.equal(fallbackParty(null, null), null);

  assert.equal(docDate("2026-09-06T00:00:00.000Z"), "06/09/2026");
  assert.equal(docDate(null), "");
  assert.equal(docDate("not a date"), "");

  assert.equal(pdfFilename("PL/26-27/0004"), "PL-26-27-0004.pdf");
  assert.equal(pdfFilename("PL/26-27/0004", "measurement-list"), "PL-26-27-0004-measurement-list.pdf");
  assert.equal(pdfFilename(""), "packing-list.pdf");
});

// ───────────────────── dispatch: all of it, or none of it ───────────────────

test("dispatchPlan: one slab that cannot leave stops the whole dispatch", () => {
  // The reproduction: 150903 is PACKED on a FINAL list, fabrication marks it
  // CTS, Commercial presses Dispatch. The inventory refuses that slab quietly —
  // and a route that shipped the rest anyway left it PACKED with no route back
  // and a packing list that said it went.
  const numbers = [150901, 150902, 150903];
  const plan = dispatchPlan(numbers, [
    { slabNumber: 150901, status: "PACKED", slabMark: "FULL_SLAB" },
    { slabNumber: 150902, status: "PACKED", slabMark: "FULL_SLAB" },
    { slabNumber: 150903, status: "PACKED", slabMark: "CTS" },
  ]);
  assert.equal(plan.ok, false, "the list does not go while one slab cannot");
  assert.deepEqual(plan.blocked, [{ slab: 150903, reason: "marked CTS — cut to size, not dispatchable as a full slab" }]);
  assert.deepEqual(plan.dispatchable, [150901, 150902], "and the route dispatches none of them");

  const sampled = dispatchPlan([1], [{ slabNumber: 1, status: "PACKED", slabMark: "SAMPLE" }]);
  assert.match(sampled.blocked[0].reason, /cut down for samples/);
});

test("dispatchPlan: every slab is named, with what is wrong with it", () => {
  const plan = dispatchPlan([1, 2, 3, 4], [
    { slabNumber: 1, status: "PACKED" },
    { slabNumber: 2, status: "RESERVED" },          // still held: the bridge takes it
    { slabNumber: 3, status: "AVAILABLE" },         // released behind our back
    // 4 is not readable at all — deleted, or outside this login's approved stock
  ]);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.dispatchable, [1, 2]);
  assert.deepEqual(plan.blocked.map((b) => b.slab), [3, 4]);
  assert.match(plan.blocked[0].reason, /AVAILABLE — not packed for dispatch/);
  assert.match(plan.blocked[1].reason, /not found in finished goods/);

  const clean = dispatchPlan([1, 2], [{ slabNumber: 1, status: "PACKED" }, { slabNumber: 2, status: "PACKED" }]);
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.blocked, []);
});

test("bridgeSkips: what the bridge refused and what it never found, as one list", () => {
  assert.deepEqual(bridgeSkips({ skipped: [{ slab: 9, reason: "PACKED → DISPATCHED not allowed" }], missing: [4, 9] }), [
    { slab: 4, reason: "not found in finished goods" },
    { slab: 9, reason: "PACKED → DISPATCHED not allowed" },
  ]);
  assert.deepEqual(bridgeSkips({ skipped: [], missing: [] }), []);
});

// ───────────────────── a row is only deleted for a slab that came back ──────

test("restoredSlabs: a restore that put nothing back deletes nothing", () => {
  // The reproduction: an admin packs 158138 (unapproved for non-admins), the
  // STORE checker marks it UNFIT and verifies, and the restore cannot even read
  // the row. The row was deleted anyway and the slab was left PACKED with
  // nothing pointing at it.
  const nothing = restoredSlabs([158138], { updated: 0, missing: [], skipped: [], before: [] });
  assert.deepEqual(nothing.restored, [], "nothing may be deleted");
  assert.deepEqual(nothing.failed, [{ slab: 158138, reason: "could not be read in finished goods" }]);

  // the bridge saying so explicitly is the same answer
  const missing = restoredSlabs([158138], { updated: 0, missing: [158138], skipped: [] });
  assert.deepEqual(missing.restored, []);
  assert.equal(missing.failed[0].reason, "not found in finished goods");

  const refused = restoredSlabs([1], { updated: 0, missing: [], skipped: [{ slab: 1, reason: "CTS → AVAILABLE not allowed" }], before: [{ slabNumber: 1, status: "CTS" }] });
  assert.deepEqual(refused.restored, []);
  assert.equal(refused.failed[0].reason, "CTS → AVAILABLE not allowed");
});

test("restoredSlabs: what did come back, and a short count fails closed", () => {
  const ok = restoredSlabs([1, 2], {
    updated: 2, missing: [], skipped: [],
    before: [{ slabNumber: 1, status: "PACKED" }, { slabNumber: 2, status: "PACKED" }],
  });
  assert.deepEqual(ok.restored, [1, 2]);
  assert.deepEqual(ok.failed, []);

  // A slab that was never PACKED needs no release, and its row may go.
  const already = restoredSlabs([1, 2], {
    updated: 1, missing: [], skipped: [],
    before: [{ slabNumber: 1, status: "PACKED" }, { slabNumber: 2, status: "AVAILABLE" }],
  });
  assert.deepEqual(already.restored, [1, 2]);
  assert.deepEqual(already.failed, []);

  // Two needed releasing, one landed, and the bridge cannot say which: keep both.
  const short = restoredSlabs([1, 2], {
    updated: 1, missing: [], skipped: [],
    before: [{ slabNumber: 1, status: "PACKED" }, { slabNumber: 2, status: "PACKED" }],
  });
  assert.deepEqual(short.restored, []);
  assert.deepEqual(short.failed.map((f) => f.reason), [
    "the inventory did not confirm the release", "the inventory did not confirm the release",
  ]);

  const mixed = restoredSlabs([1, 2, 3], {
    updated: 2, missing: [3], skipped: [],
    before: [{ slabNumber: 1, status: "PACKED" }, { slabNumber: 2, status: "PACKED" }],
  });
  assert.deepEqual(mixed.restored, [1, 2]);
  assert.deepEqual(mixed.failed.map((f) => f.slab), [3]);
});

test("strandedNote says which slabs stayed on the list", () => {
  assert.equal(strandedNote([]), "");
  assert.equal(
    strandedNote([{ slab: 158138, reason: "could not be read in finished goods" }]),
    "1 slab(s) stayed on the list, still packed: #158138 (could not be read in finished goods)",
  );
});

// ───────────────────── what a verify-only login may see ─────────────────────

test("parseCheckerStatus and checkerMaySee: four statuses, and nothing else", () => {
  // FINAL joined the three on 2026-09-07 (answer 30): the loading bay is where
  // a passed slab is found cracked, and the checker marks it there.
  assert.deepEqual([...CHECKER_STATUSES], ["SUBMITTED", "VERIFIED", "REJECTED", "FINAL"]);
  assert.equal(parseCheckerStatus("VERIFIED"), "VERIFIED");
  assert.equal(parseCheckerStatus("rejected"), "REJECTED");
  assert.equal(parseCheckerStatus("final"), "FINAL");
  assert.equal(parseCheckerStatus(null), "SUBMITTED");
  // ?status=DRAFT was listing every list Commercial had open, through the one
  // door the dispatch team has.
  assert.equal(parseCheckerStatus("DRAFT"), "SUBMITTED", "a draft list is not the dispatch team's business");
  assert.equal(parseCheckerStatus("DISPATCHED"), "SUBMITTED", "a dispatched list has gone");
  assert.equal(parseCheckerStatus("nonsense"), "SUBMITTED");

  assert.equal(checkerMaySee("SUBMITTED"), true);
  assert.equal(checkerMaySee("VERIFIED"), true);
  assert.equal(checkerMaySee("REJECTED"), true);
  assert.equal(checkerMaySee("FINAL"), true);
  assert.equal(checkerMaySee("DRAFT"), false, "the detail route 404s a list it may not open");
  assert.equal(checkerMaySee("DISPATCHED"), false);
});

test("canRecheck: a late verdict lands on a verified or final list only", () => {
  assert.equal(canRecheck("VERIFIED"), true);
  assert.equal(canRecheck("FINAL"), true);
  assert.equal(canRecheck("SUBMITTED"), false, "that is the ordinary check, canVerify's business");
  assert.equal(canRecheck("REJECTED"), false);
  assert.equal(canRecheck("DRAFT"), false);
  assert.equal(canRecheck("DISPATCHED"), false);
});

test("checkerListView: the floor screen's shape, not the order book", () => {
  // The loader the verify endpoint used to answer with, in full.
  const loaded = {
    id: "pl1", number: "PL/26-27/0004", status: "SUBMITTED", orderId: "o1",
    containerNo: "TGHU1234567", sealNo: "E-88", linerOtlNo: "OTL-1", vehicleNo: "TN 21 X 1234",
    packagesSummary: "07 Wooden Crate(S)", grossWeightKg: 24000, netWeightKg: 22000, notes: "stuffed 18:40",
    submittedAt: new Date("2026-09-05T10:00:00Z"), verifiedAt: null, verifiedByName: null, verificationNote: null,
    crates: [{ id: "c1", crateNo: 1, kind: "Wooden Crate", grossKg: 1100, netKg: 1000, lengthCm: 350, widthCm: 210, heightCm: 60, remarks: null }],
    slabs: [{ id: "s1", crateId: "c1", slabNumber: 150903, customerSlabNo: "CIOT-01", customerBatchNo: "LOT-9", design: "ONYX STORM", customerSku: "OSWT10305A", thickness: "3 cm", batchKey: "B-1", batchNumber: "PES.0301", grade: "A", lengthCm: 347, widthCm: 201, sqm: 6.9747, sqft: 75.076, fit: "PENDING", unfitReason: null, checkedAt: null, sortOrder: 1, checkedById: "u9" }],
    order: {
      id: "o1", number: "SAL-ORD/26-27/01642", kind: "EXPORT", status: "PACKING",
      customerPoNumber: "PO-4068622", paymentTerms: "30% advance, balance against CAD",
      holdHistory: [{ note: "credit hold 2026-08-01" }],
      items: [{ lineNo: 1, design: "ONYX STORM", customerSku: "OSWT10305A", rate: 1250.5, amount: 58773.5 }],
      holds: [{ id: "h1", reference: "SAL-ORD/26-27/01642", slabs: [{ slabNumber: 150903 }] }],
      client: { id: "c9", name: "CIOT LLC", country: "USA", commercialExt: { gstin: "33AALCP2750N1Z3", pan: "AALCP2750N", billingAddress: { lines: ["1 Wall St"] } } },
    },
  };
  const view = checkerListView(loaded);
  const body = JSON.stringify(view);

  // what the floor needs
  assert.equal(view.number, "PL/26-27/0004");
  assert.equal(view.orderNumber, "SAL-ORD/26-27/01642");
  assert.equal(view.clientName, "CIOT LLC");
  assert.equal(view.clientCountry, "USA");
  assert.equal(view.customerPoNumber, "PO-4068622");
  assert.equal(view.containerNo, "TGHU1234567");
  assert.equal(view.crates.length, 1);
  assert.equal(view.slabs.length, 1);
  assert.equal(view.slabs[0].slabNumber, 150903);
  assert.equal(view.slabs[0].customerSlabNo, "CIOT-01");
  assert.deepEqual(view.fit, { total: 1, fit: 0, unfit: 0, pending: 1 });
  assert.equal(view.submittedAt, "2026-09-05T10:00:00.000Z");
  assert.equal(view.measurementUnit, "cm", "a list with no unit stored reads in centimetres");
  assert.equal(checkerListView({ ...loaded, measurementUnit: "in" }).measurementUnit, "in");
  assert.equal(checkerListView({ ...loaded, measurementUnit: "furlongs" }).measurementUnit, "cm");

  // and what a store incharge is not being handed with it
  for (const secret of ["1250.5", "58773.5", "33AALCP2750N1Z3", "AALCP2750N", "1 Wall St", "30% advance", "credit hold"]) {
    assert.equal(body.includes(secret), false, `the verify answer must not carry ${secret}`);
  }
  for (const key of ["rate", "amount", "gstin", "pan", "billingAddress", "paymentTerms", "holds", "items", "commercialExt", "orderId"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(view, key), false, `${key} has no business on a floor screen`);
  }
  // a whitelist, so a field added to the loader tomorrow does not appear here
  assert.equal(body.includes("holdHistory"), false);

  // an empty list still answers a shape the screen can render
  const bare = checkerListView({ id: "x", number: "PL/1", status: "SUBMITTED" });
  assert.deepEqual(bare.crates, []);
  assert.deepEqual(bare.slabs, []);
  assert.deepEqual(bare.fit, { total: 0, fit: 0, unfit: 0, pending: 0 });
  assert.equal(bare.clientName, "");
});

test("checkerSlabView: one verdict's answer carries the slab, not the row", () => {
  const v = checkerSlabView({
    id: "s1", packingListId: "pl1", crateId: "c1", slabNumber: 150903, design: "ONYX STORM",
    customerSku: "OSWT10305A", thickness: "3 cm", batchNumber: "PES.0301", batchKey: "B-1",
    customerSlabNo: null, customerBatchNo: null, grade: "A",
    lengthCm: 347, widthCm: 201, sqm: 6.9747, sqft: 75.076,
    fit: "UNFIT", unfitReason: "Chipped edge", checkedAt: new Date("2026-09-05T12:00:00Z"),
    checkedById: "u9", sortOrder: 3, createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal(v.fit, "UNFIT");
  assert.equal(v.unfitReason, "Chipped edge");
  assert.equal(v.checkedAt, "2026-09-05T12:00:00.000Z");
  assert.equal(Object.prototype.hasOwnProperty.call(v, "checkedById"), false, "who checked it is not the floor's business");
  assert.equal(Object.prototype.hasOwnProperty.call(v, "packingListId"), false);
});

// ───────────────────── weights, batches and the two sheets agreeing ─────────

test("crateGroups: a crate with no net weight leaves the line's weight blank", () => {
  // Four slabs on one printed line across two crates, one of which nobody has
  // weighed yet. Counting that crate as zero kilograms printed 1000 kg on a
  // customs document for a line that really weighs 1000 plus a whole crate.
  const half: CrateLike[] = [
    { id: "w1", crateNo: 1, kind: "Wooden Crate", netKg: 1000 },
    { id: "w2", crateNo: 2, kind: "Wooden Crate", netKg: null },
  ];
  const four = [
    slab({ slabNumber: 1, sortOrder: 1, crateId: "w1" }), slab({ slabNumber: 2, sortOrder: 2, crateId: "w1" }),
    slab({ slabNumber: 3, sortOrder: 3, crateId: "w2" }), slab({ slabNumber: 4, sortOrder: 4, crateId: "w2" }),
  ];
  const g = crateGroups(four, half);
  assert.equal(g[0].netKg, null, "unknown, and printed blank — not 1000");
  assert.equal(g[0].netKgRaw, null);
  assert.equal(plTotals(g, null, half).netKg, null, "and the total cannot be known either");

  // weigh the second crate and the line comes back
  const both: CrateLike[] = [half[0], { id: "w2", crateNo: 2, kind: "Wooden Crate", netKg: 1200 }];
  assert.equal(crateGroups(four, both)[0].netKg, 2200);

  // a crate whose weight is 0 is a typed zero, not a missing one
  assert.equal(crateGroups([slab({ slabNumber: 1, sortOrder: 1, crateId: "z1" })], [{ id: "z1", crateNo: 1, kind: "Wooden Crate", netKg: 0 }])[0].netKg, 0);
});

test("plTotals: the total is added from the lines' own numbers and rounded once", () => {
  // Per-line rounding, then a sum of the rounded lines, put a kilogram on the
  // sheet that no crate weighs: 10 kg over four slabs is 7.5 + 2.5, which
  // rounds to 8 + 3.
  const oneCrate: CrateLike[] = [{ id: "k1", crateNo: 1, kind: "Wooden Crate", netKg: 10 }];
  const four = [
    slab({ slabNumber: 1, sortOrder: 1, crateId: "k1" }),
    slab({ slabNumber: 2, sortOrder: 2, crateId: "k1" }),
    slab({ slabNumber: 3, sortOrder: 3, crateId: "k1" }),
    slab({ slabNumber: 4, sortOrder: 4, crateId: "k1", design: "CARRARA ROYALE", customerSku: "VGWT10301A", thickness: "2 cm" }),
  ];
  const g = crateGroups(four, oneCrate);
  assert.deepEqual(g.map((x) => x.netKg), [8, 3], "each printed line still rounds to whole kilograms");
  assert.equal(plTotals(g, null, oneCrate).netKg, 10, "and the total is the crate's own 10 kg, not 11");

  // areas: the packing list's total and the measurement list's total are the
  // same number because both add the same unrounded figures and round once.
  const odd = [
    slab({ slabNumber: 1, sortOrder: 1, crateId: "k1", design: "A", customerSku: null, sqm: 6.97475, sqft: 75.0755 }),
    slab({ slabNumber: 2, sortOrder: 2, crateId: "k1", design: "B", customerSku: null, sqm: 6.97475, sqft: 75.0755 }),
  ];
  const pl = plTotals(crateGroups(odd, oneCrate), null, oneCrate);
  const ml = measurementRows(odd, oneCrate).totals;
  assert.equal(pl.sqft, ml.sqft, "two sheets issued together may not disagree");
  assert.equal(pl.sqm, ml.sqm);
  assert.equal(pl.sqft, 150.151);
});

test("crateGroups: our batch prints, and the customer's prints beside it", () => {
  const c: CrateLike[] = [{ id: "c1", crateNo: 1, kind: "Wooden Crate", netKg: 1000 }];
  const g = crateGroups([
    slab({ slabNumber: 1, sortOrder: 1, crateId: "c1", customerBatchNo: "LOT-9" }),
    slab({ slabNumber: 2, sortOrder: 2, crateId: "c1" }),
  ], c);
  assert.deepEqual(g[0].batches, ["PES.0301"], "ours always (OPEN-QUESTIONS §16)");
  assert.deepEqual(g[0].customerBatches, ["LOT-9"], "theirs as well, not instead");

  const noneOfTheirs = crateGroups([slab({ slabNumber: 1, sortOrder: 1, crateId: "c1" })], c);
  assert.deepEqual(noneOfTheirs[0].customerBatches, [], "no empty column when they gave none");
  assert.deepEqual(noneOfTheirs[0].batches, ["PES.0301"]);
});

test("measurementRows: a slab pointing at a crate that is not on the list", () => {
  // TODAY'S DOCUMENTED BEHAVIOUR, PINNED. A stale crateId — the crate was
  // deleted, or the slab was moved to a list that does not have that crate —
  // sorts the slab LAST, prints an em dash for its crate and subtotals it under
  // "Not in a crate". It must not vanish from the sheet, and it must not
  // silently join crate 1.
  const c: CrateLike[] = [{ id: "c1", crateNo: 1, kind: "Wooden Crate", netKg: 1000 }];
  const sheet = measurementRows([
    slab({ slabNumber: 2, sortOrder: 2, crateId: "GONE" }),
    slab({ slabNumber: 1, sortOrder: 1, crateId: "c1" }),
  ], c);
  assert.deepEqual(sheet.rows.map((r) => r.kind), ["slab", "subtotal", "slab", "subtotal"]);
  const first = sheet.rows[0], orphan = sheet.rows[2], orphanSub = sheet.rows[3];
  if (first.kind === "slab") {
    assert.equal(first.slabNumber, 1, "the crated slab comes first");
    assert.equal(first.crateNo, 1);
  }
  if (orphan.kind === "slab") {
    assert.equal(orphan.slabNumber, 2, "the orphan sorts last, with the unassigned slabs");
    assert.equal(orphan.crateNo, null, "and prints no crate number rather than a wrong one");
    assert.equal(orphan.sl, 2, "it is still numbered and still on the sheet");
  }
  if (orphanSub.kind === "subtotal") {
    assert.equal(orphanSub.crateNo, null);
    assert.equal(orphanSub.slabs, 1);
  }
  assert.equal(sheet.totals.slabs, 2, "the grand total counts it either way");

  // an orphan and a genuinely unassigned slab share the one trailing block
  const mixed = measurementRows([
    slab({ slabNumber: 3, sortOrder: 3, crateId: null }),
    slab({ slabNumber: 2, sortOrder: 2, crateId: "GONE" }),
    slab({ slabNumber: 1, sortOrder: 1, crateId: "c1" }),
  ], c);
  assert.deepEqual(mixed.rows.map((r) => r.kind), ["slab", "subtotal", "slab", "slab", "subtotal"]);
  const lastSub = mixed.rows[4];
  if (lastSub.kind === "subtotal") assert.equal(lastSub.slabs, 2);
});

// ───────────────────── what the sheets print and what they call it ──────────

test("printableSamplesRow: free trade samples are an export line", () => {
  const boxes: CrateLike[] = [
    { id: "c1", crateNo: 1, kind: "Wooden Crate", netKg: 1000 },
    { id: "c2", crateNo: 2, kind: "Sample Box", netKg: 40, remarks: "6 pcs 30x30" },
  ];
  const items = [{ qtySlabs: 6 }];
  assert.ok(printableSamplesRow("EXPORT", boxes, items), "an export order that sells samples prints the line");
  // A domestic list with a sample box was printing an export-only row with no
  // pieces and no quantity against it.
  assert.equal(printableSamplesRow("DOMESTIC", boxes, items), null);
  assert.equal(printableSamplesRow("EXPORT", boxes, []), null, "no sample line on the order, no sample row");
  assert.equal(printableSamplesRow("EXPORT", [boxes[0]], items), null, "no sample box, no row");
  assert.equal(printableSamplesRow(null, boxes, items), null);
  // the underlying row is unchanged for anyone who wants it regardless
  assert.equal(samplesRow(boxes, items)?.boxes, 1);
});

test("samplesRow: an unweighed sample box leaves the weight blank", () => {
  const two: CrateLike[] = [
    { id: "s1", crateNo: 1, kind: "Sample Box", netKg: 40 },
    { id: "s2", crateNo: 2, kind: "Sample Box", netKg: null },
  ];
  const row = samplesRow(two, [{ qtySlabs: 6 }]);
  assert.equal(row?.boxes, 2);
  assert.equal(row?.netKg, null, "one box unweighed and the line's weight is not known");
  assert.equal(samplesRow([two[0]], [])?.netKg, 40);
});

test("measurementHeaderRef: an uninvoiced list is not an invoice", () => {
  const list = { number: "PL/26-27/0004", createdAt: "2026-09-05T00:00:00.000Z" };
  const withInv = measurementHeaderRef({ number: "PESPL/2780", invoiceDate: "2026-09-06T00:00:00.000Z" }, list);
  assert.deepEqual(withInv, { label: "Invoice No.", value: "PESPL/2780", dateLabel: "Invoice date", dateValue: "06/09/2026" });

  // It used to print "Invoice No.: PL/26-27/0004" — the packing list's own
  // number, under the one label that must never carry it.
  const none = measurementHeaderRef(null, list);
  assert.equal(none.value, "Not yet invoiced");
  assert.equal(none.value.includes(list.number), false);
  assert.equal(none.dateLabel, "Packing list date");
  assert.equal(none.dateValue, "05/09/2026");
});

test("vesselFromSnapshot: the only place the module knows a vessel", () => {
  assert.equal(vesselFromSnapshot({ vessel: "MSC ANNA / 452W" }), "MSC ANNA / 452W");
  assert.equal(vesselFromSnapshot({ vessel: "   " }), null, "a blank box is not a vessel");
  assert.equal(vesselFromSnapshot({ vessel: null }), null);
  assert.equal(vesselFromSnapshot({}), null);
  assert.equal(vesselFromSnapshot(null), null, "no invoice yet, no vessel — the box prints empty");
  assert.equal(vesselFromSnapshot("not a snapshot"), null);
});

// ───────────────────── the owner's answers of 2026-09-07 ────────────────────

test("canCreatePackingList: one PI has one packing list (answer 18)", () => {
  assert.deepEqual(canCreatePackingList([]), { ok: true });
  // A rejected list is reopened, not replaced — and it does not block a fresh start.
  assert.deepEqual(canCreatePackingList([{ number: "PL/26-27/N1", status: "REJECTED" }]), { ok: true });
  for (const status of ["DRAFT", "SUBMITTED", "VERIFIED", "FINAL", "DISPATCHED"]) {
    const r = canCreatePackingList([{ number: "PL/26-27/N1", status }]);
    assert.equal(r.ok, false, `${status} already IS this order's list`);
    if (!r.ok) {
      assert.match(r.reason, /PL\/26-27\/N1/, "the refusal names the list that exists");
      assert.match(r.reason, /one PI has one packing list/);
    }
  }
  // A rejected one beside an open one: the open one blocks.
  const two = canCreatePackingList([{ number: "PL/26-27/N2", status: "DRAFT" }, { number: "PL/26-27/N1", status: "REJECTED" }]);
  assert.equal(two.ok, false);
  if (!two.ok) assert.match(two.reason, /N2 \(draft\)/);
  // A dispatched list is not offered "reopen it".
  const gone = canCreatePackingList([{ number: "PL/26-27/N1", status: "DISPATCHED" }]);
  if (!gone.ok) assert.equal(gone.reason.includes("reopen"), false);
});

test("canSetUnit follows canEdit: the sheet does not change unit under the checker (answer 17)", () => {
  assert.equal(canSetUnit("DRAFT"), true);
  assert.equal(canSetUnit("REJECTED"), true);
  for (const s of ["SUBMITTED", "VERIFIED", "FINAL", "DISPATCHED"]) assert.equal(canSetUnit(s), false, s);
});

test("dispatchBlockers: an unfit or unchecked slab stops the whole list (answers 2, 31)", () => {
  const clean = dispatchBlockers([{ slabNumber: 1, fit: "FIT" }, { slabNumber: 2, fit: "FIT" }]);
  assert.deepEqual(clean, { ok: true, unfit: [], unchecked: [], reason: "" });

  const mixed = dispatchBlockers([
    { slabNumber: 150905, fit: "FIT" },
    { slabNumber: 150903, fit: "UNFIT", unfitReason: "Crack" },
    { slabNumber: 150910, fit: "PENDING" },
    { slabNumber: 150901, fit: "UNFIT", unfitReason: "" },
  ]);
  assert.equal(mixed.ok, false);
  assert.deepEqual(mixed.unfit, [150901, 150903], "ascending, so the message reads the way the crate does");
  assert.deepEqual(mixed.unchecked, [150910]);
  assert.match(mixed.reason, /^Nothing ships until the list is corrected\./);
  assert.match(mixed.reason, /#150903 \(Crack\)/, "the reason the checker gave travels with the number");
  assert.match(mixed.reason, /#150901[^(]/, "no empty parentheses for a missing reason");
  assert.match(mixed.reason, /not yet checked: #150910/);
  assert.match(mixed.reason, /same design and thickness/);

  // A verdict the schema does not know is not a pass.
  const odd = dispatchBlockers([{ slabNumber: 7, fit: "MAYBE" }]);
  assert.deepEqual(odd.unchecked, [7]);
  assert.equal(dispatchBlockers([]).ok, true, "an empty list has nothing to block — the route refuses it for having no slabs");
});

test("swapEligibility: only a refused slab, only on a concluded list (answer 30)", () => {
  assert.deepEqual(swapEligibility("FINAL", { slabNumber: 1, fit: "UNFIT" }), { ok: true });
  assert.deepEqual(swapEligibility("VERIFIED", { slabNumber: 1, fit: "UNFIT" }), { ok: true });
  const fit = swapEligibility("FINAL", { slabNumber: 150903, fit: "FIT" });
  assert.equal(fit.ok, false);
  if (!fit.ok) assert.match(fit.reason, /#150903 has not been marked unfit/);
  const pending = swapEligibility("FINAL", { slabNumber: 1, fit: "PENDING" });
  assert.equal(pending.ok, false, "a slab nobody has looked at is checked, not swapped");
  for (const status of ["DRAFT", "REJECTED", "SUBMITTED", "DISPATCHED"]) {
    const r = swapEligibility(status, { slabNumber: 1, fit: "UNFIT" });
    assert.equal(r.ok, false, `${status}: edit it the ordinary way, or it has gone`);
    if (!r.ok) assert.match(r.reason, /verified or final list/);
  }
});

test("replacementEligibility: like for like — same design, same thickness, and packable by us", () => {
  const refused = { slabNumber: 150903, design: "ONYX STORM", thickness: "3 cm" };
  const refs = ["SAL-ORD/26-27/N1"];
  const good = { slabNumber: 150950, status: "AVAILABLE", slabMark: "FULL_SLAB", design: "Onyx Storm", thickness: "30mm" };
  assert.deepEqual(replacementEligibility(refused, good, refs), { ok: true }, "case and '30mm' vs '3 cm' are spellings, not differences");

  const ours = { ...good, status: "RESERVED", reservedForPi: "SAL-ORD/26-27/N1" };
  assert.deepEqual(replacementEligibility(refused, ours, refs), { ok: true }, "held under this order's own reference");
  const theirs = { ...good, status: "RESERVED", reservedForPi: "SAL-ORD/26-27/N7" };
  const t = replacementEligibility(refused, theirs, refs);
  assert.equal(t.ok, false);
  if (!t.ok) assert.match(t.reason, /held under SAL-ORD\/26-27\/N7/);

  const itself = replacementEligibility(refused, { ...good, slabNumber: 150903 }, refs);
  assert.equal(itself.ok, false);
  if (!itself.ok) assert.match(itself.reason, /refused slab itself/);

  const colour = replacementEligibility(refused, { ...good, design: "CARRARA ROYALE" }, refs);
  assert.equal(colour.ok, false, "a different colour is a new order line, not a swap");
  if (!colour.ok) assert.equal(colour.reason, "CARRARA ROYALE, not ONYX STORM");

  // The canonical design wins over the raw one when the row carries both.
  const aliased = replacementEligibility(refused, { ...good, design: "Onyx Storm Dark", designCanonical: "ONYX STORM" }, refs);
  assert.equal(aliased.ok, true);

  const thin = replacementEligibility(refused, { ...good, thickness: "2 cm", thicknessCanonical: "2 cm" }, refs);
  assert.equal(thin.ok, false, "a 2 cm for a 3 cm is a new order line");
  if (!thin.ok) assert.equal(thin.reason, "2 cm, not 3 cm");

  const cut = replacementEligibility(refused, { ...good, slabMark: "CTS" }, refs);
  assert.equal(cut.ok, false);
  if (!cut.ok) assert.match(cut.reason, /not a full slab/);
  const packed = replacementEligibility(refused, { ...good, status: "PACKED" }, refs);
  assert.equal(packed.ok, false);

  // A refused slab with no design or thickness recorded cannot demand a match on it.
  assert.deepEqual(replacementEligibility({ slabNumber: 1, design: null, thickness: null }, good, refs), { ok: true });
});

test("holdDaysLeft: a re-held slab lapses when the hold does, not five days from the swap", () => {
  const now = new Date("2026-09-08T10:00:00Z");
  const left = holdDaysLeft("2026-09-10T10:00:00Z", now);
  assert.equal(left, 2);
  const half = holdDaysLeft(new Date("2026-09-08T22:00:00Z"), now);
  assert.equal(half, 0.5, "fractional days, which changeSlabStatus multiplies straight into milliseconds");
  assert.equal(holdDaysLeft("2026-09-07T10:00:00Z", now), null, "a lapsed hold is not re-held — the slab goes back to open stock");
  assert.equal(holdDaysLeft(null, now), null);
  assert.equal(holdDaysLeft("not a date", now), null);
});

test("swapNote reads as one sentence with both numbers", () => {
  const back = swapNote("PL/26-27/N4", 150903, 150950, "Crack", "SAL-ORD/26-27/N1");
  assert.equal(back, "Packing list PL/26-27/N4: slab #150903 swapped for #150950 (Crack) — #150903 back on hold SAL-ORD/26-27/N1; #150950 awaits the dispatch check");
  const stock = swapNote("PL/26-27/N4", 150903, 150950, null, null);
  assert.equal(stock, "Packing list PL/26-27/N4: slab #150903 swapped for #150950 — #150903 back in stock; #150950 awaits the dispatch check");
});

test("swapReleaseOutcome: the refused slab's release is the swap's precondition", () => {
  const packed = [{ slabNumber: 150903, status: "PACKED" }];
  assert.deepEqual(swapReleaseOutcome(150903, packed, 1), { ok: true });

  // The double-swap this exists to stop: two clerks swap the same UNFIT slab,
  // the second call finds it AVAILABLE already. Reading that as "already
  // released, nothing to do" let both POSTs succeed and stranded the first
  // replacement PACKED against nothing, on no list.
  const gone = swapReleaseOutcome(150903, [{ slabNumber: 150903, status: "AVAILABLE" }], 0);
  assert.equal(gone.ok, false);
  assert.equal(gone.ok === false && gone.wasPacked, false, "not packed any more — the caller must unpack the replacement");
  assert.equal(gone.ok === false && gone.reason, "#150903 is no longer packed — it was already swapped or released");

  // Packed, but the inventory would not confirm the release: still a refusal,
  // and still an unpack of the replacement — two slabs must never be PACKED
  // for one crate slot.
  const stuck = swapReleaseOutcome(150903, packed, 0);
  assert.equal(stuck.ok, false);
  assert.equal(stuck.ok === false && stuck.wasPacked, true);
  assert.equal(stuck.ok === false && stuck.reason, "the inventory did not confirm the release");

  // A row the restore could not read at all is not a release either.
  const missing = swapReleaseOutcome(150903, [{ slabNumber: 150950, status: "PACKED" }], 0);
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.wasPacked, false);
});

test("swapRefusalNote: a reason that names its own slab is not numbered twice", () => {
  assert.equal(
    swapRefusalNote([{ slab: 150903, reason: "#150903 is no longer packed — it was already swapped or released" }]),
    "#150903 is no longer packed — it was already swapped or released",
  );
  assert.equal(swapRefusalNote([{ slab: 150950, reason: "marked for cutting" }]), "#150950 (marked for cutting)");
  assert.equal(
    swapRefusalNote([{ slab: 150950, reason: "held for someone else" }, { slab: 150903, reason: "#150903 is no longer packed" }]),
    "#150950 (held for someone else); #150903 is no longer packed",
  );
  assert.equal(swapRefusalNote([]), "the inventory did not confirm the move", "a refusal with no reason still says something");
});

test("swapFailureNote: the inventory moved, the list did not — both slabs are named", () => {
  const clean: SwapUndoLike = { replacementUnpacked: true, replacementHold: null, refusedState: "packed", refusedHold: null };
  assert.equal(
    swapFailureNote("PL/26-27/N4", 150903, 150950, "write conflict", clean),
    "Packing list PL/26-27/N4: swap of #150903 for #150950 did NOT happen — the inventory moved but the list could not be updated (write conflict); #150950 back in stock; #150903 packed again, as the list still says",
  );

  // The replacement came off one of the order's holds and went back onto it: a
  // swap that did not happen must not end a customer's five-day hold either.
  const held: SwapUndoLike = { replacementUnpacked: true, replacementHold: "SAL-ORD/26-27/N1", refusedState: "packed", refusedHold: null };
  assert.match(swapFailureNote("PL/26-27/N4", 150903, 150950, "boom", held), /#150950 back on hold SAL-ORD\/26-27\/N1/);

  // Compensation that itself failed is the case the log exists for: the note
  // has to send somebody to finished goods, because no screen shows this.
  const bad: SwapUndoLike = { replacementUnpacked: false, replacementHold: null, refusedState: "stock", refusedHold: null };
  const note = swapFailureNote("PL/26-27/N4", 150903, 150950, "", bad);
  assert.match(note, /\(unknown error\)/, "a thrown error with no message still reads as a sentence");
  assert.match(note, /#150950 is still PACKED and on no list/);
  assert.match(note, /#150903 is in open stock but the list still shows it PACKED/);

  const reheld: SwapUndoLike = { replacementUnpacked: true, replacementHold: null, refusedState: "held", refusedHold: "SAL-ORD/26-27/N1" };
  assert.match(swapFailureNote("PL/26-27/N4", 150903, 150950, "boom", reheld), /#150903 is on hold SAL-ORD\/26-27\/N1 but the list still shows it PACKED/);
});

// ───────────────────── the list's own unit (answer 17) ──────────────────────

test("parseMeasurementUnit: cm or in, and nothing else becomes a third unit", () => {
  assert.deepEqual([...MEASUREMENT_UNITS], ["cm", "in"]);
  assert.equal(parseMeasurementUnit("cm"), "cm");
  assert.equal(parseMeasurementUnit(" IN "), "in");
  assert.equal(parseMeasurementUnit("inches"), null);
  assert.equal(parseMeasurementUnit(""), null);
  assert.equal(parseMeasurementUnit(null), null);
  assert.equal(parseMeasurementUnit(undefined), null);
});

test("cmToIn / cmFromIn: the owner's two readings of one slab", () => {
  // Stored 348 × 201 (from the nominal 137 × 79 in) reads 137.0 × 79.1 in.
  assert.equal(cmToIn(348), 137);
  assert.equal(cmToIn(201), 79.1);
  // The CIOT sheet's 347 × 201 measured slab in inches.
  assert.equal(cmToIn(347), 136.6);
  // Typed inches come back as centimetres to a tenth, not a whole centimetre:
  // 136.6 in is 346.96 cm and prints as 347.0, which reads back as 136.6.
  assert.equal(cmFromIn(136.6), 347);
  assert.equal(cmToIn(cmFromIn(136.6)), 136.6, "a typed inch figure survives the round trip");
  assert.equal(cmFromIn(137), 348, "a whole nominal slab converts to what inToCm already stores");
  assert.equal(inToCm(137), 348);
});

test("sizeInUnit / sizeToCm: the lens the editor and the sheets look through", () => {
  assert.equal(sizeInUnit(347, "cm"), 347);
  assert.equal(sizeInUnit(347, "in"), 136.6);
  assert.equal(sizeInUnit(null, "in"), null, "a blank stays blank in either unit");
  assert.equal(sizeInUnit(undefined, "cm"), null);
  assert.equal(sizeInUnit(Number.NaN, "cm"), null);
  assert.equal(sizeInUnit(346.96, "cm"), 347, "a centimetre figure shows to a tenth at most");

  assert.equal(sizeToCm(136.6, "in"), 347);
  assert.equal(sizeToCm(347, "cm"), 347);
  assert.equal(sizeToCm(347.25, "cm"), 347.3);
  assert.equal(sizeToCm(null, "in"), null);
  assert.equal(sizeToCm("79" as unknown as number, "in"), 200.7, "a string from a form field is a number to this function");
  assert.equal(sizeToCm("" as unknown as number, "in"), null, "an emptied cell is no measurement");
});
