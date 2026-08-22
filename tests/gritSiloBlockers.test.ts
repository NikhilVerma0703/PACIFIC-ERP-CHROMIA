import { test } from "node:test";
import assert from "node:assert/strict";
import { gritSiloBlockers } from "../src/lib/costing/completeness.ts";
import { priceGritSilo } from "../src/lib/costing/gritAssign.ts";

// Two gates, one rule. priceGritSilo decides whether the SHEET computes;
// gritSiloBlockers decides whether a SIGN-OFF is accepted. When they disagree a
// batch carries a signature saying its prices were checked while every price is
// NULL — which is exactly what was happening, because this gate resolved grit
// per BAND against the plant card and could not see a silo at all.

const sup = (supplier: string, kg: number, ratePerT: number | null) => ({ supplier, kg, ratePerT });

test("an unpriced line blocks the sign-off, exactly as it withholds the sheet", () => {
  const silos = [{ silo: "204", size: "1.2-2.5", kg: 12998.6, suppliers: [sup("Premium Vinayaka", 12998.6, null)] }];
  const blockers = gritSiloBlockers(silos, [{ silo: "204", kg: 12998.6 }]);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /no price per tonne/);
  // ...and the sheet agrees. If these two ever diverge, one of them is lying.
  assert.equal(priceGritSilo(silos[0]).withhold, true);
});

test("a fully priced, fully covered silo blocks nothing", () => {
  const silos = [{ silo: "201", size: "0.1-0.4", kg: 19103.5, suppliers: [sup("Supreme Vinayaka", 19103.5, 4200)] }];
  assert.deepEqual(gritSiloBlockers(silos, [{ silo: "201", kg: 19103.5 }]), []);
  assert.equal(priceGritSilo(silos[0]).withhold, false);
});

test("A SILO THE MIXER DREW FROM THAT NOBODY ASSIGNED IS CAUGHT", () => {
  // The worst of the defects. The screen saves ONE silo per request, so this is
  // the normal state halfway through the job — not an edge case. Iterating the
  // assignment table alone made those silos invisible: no price, no blocker,
  // nothing withheld, and a sheet that printed as complete while missing most
  // of the batch's grit. It did not look broken; it looked like a cheap batch.
  const silos = [{ silo: "201", size: "0.1-0.4", kg: 19103.5, suppliers: [sup("Supreme Vinayaka", 19103.5, 4200)] }];
  const mixer = [
    { silo: "201", kg: 19103.5 },
    { silo: "102", kg: 17180 },
    { silo: "204", kg: 12998.6 },
  ];
  const blockers = gritSiloBlockers(silos, mixer);
  assert.equal(blockers.length, 2, "both unassigned silos must be named");
  assert.ok(blockers.some((b) => /Silo 102 drew 17180 kg and has not been assigned/.test(b)));
  assert.ok(blockers.some((b) => /Silo 204 drew 12999 kg and has not been assigned/.test(b)));
});

test("over-assignment blocks, and says which way it is wrong", () => {
  // A fat-fingered 41,814 against a silo that drew 17,180 prices 24 t of grit
  // that was never weighed. Under-assignment reads as "somebody still has work
  // to do"; over-assignment reads as "these numbers are wrong" — so the two
  // cannot share a sentence.
  const silos = [{ silo: "102", size: "0.6-1.2", kg: 17180, suppliers: [sup("A", 12998.6, 5000), sup("B", 41814, 5000)] }];
  const blockers = gritSiloBlockers(silos, [{ silo: "102", kg: 17180 }]);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /over-assigned/);
  assert.equal(priceGritSilo(silos[0]).withhold, true, "the sheet must refuse it too");
});

test("under-assignment blocks only once every line that exists is priced", () => {
  // Otherwise one silo reports the same missing kilograms twice, under two
  // different sentences, and reads as two separate problems.
  const bothWrong = [{ silo: "102", size: "0.6-1.2", kg: 17180, suppliers: [sup("A", 12998.6, null)] }];
  assert.equal(gritSiloBlockers(bothWrong, [{ silo: "102", kg: 17180 }]).length, 1);

  const onlyShort = [{ silo: "102", size: "0.6-1.2", kg: 17180, suppliers: [sup("A", 12998.6, 5000)] }];
  const b = gritSiloBlockers(onlyShort, [{ silo: "102", kg: 17180 }]);
  assert.equal(b.length, 1);
  assert.match(b[0], /4181.4 kg assigned to nobody/);
});

test("a silo with no size, and one with no supplier at all, each say so", () => {
  const silos = [
    { silo: "206", size: "", kg: 1921.5, suppliers: [sup("Shaswat Mirror", 1921.5, 9000)] },
    { silo: "207", size: "# 8-16", kg: 1364.8, suppliers: [] },
  ];
  const b = gritSiloBlockers(silos, [{ silo: "206", kg: 1921.5 }, { silo: "207", kg: 1364.8 }]);
  assert.ok(b.some((x) => /Silo 206 has no size/.test(x)));
  assert.ok(b.some((x) => /Silo 207 has no supplier or price/.test(x)));
});

test("an UNASSIGNED batch is judged by the bands, exactly as it always was", () => {
  // Every historical batch is still costed per band. This gate must stay silent
  // for them or the whole plant's back catalogue becomes unapprovable.
  assert.deepEqual(gritSiloBlockers(null, [{ silo: "201", kg: 19103.5 }]), []);
  assert.deepEqual(gritSiloBlockers([], [{ silo: "201", kg: 19103.5 }]), []);
  assert.deepEqual(gritSiloBlockers(undefined), []);
});

test("the denominator is the MIXER TOTAL, not the band-resolved part", () => {
  // The question this settles: when the screen says "4,181.4 kg unassigned", is
  // that measured against what the silo drew, or against some subset of it?
  //
  // It used to be a subset. The per-silo weights were summed from gritCharges,
  // which is keyed by (silo, BAND) and diverts any charge whose bags yield no
  // band into gritUnresolvedKg — so each silo was measured against only the part
  // of itself that could be banded, and a silo with no bandable charge at all
  // did not appear. On batch 1415 that hid 39,784 kg of 96,507 — silo 203 drew
  // 11,534.5 kg and had no row, and silo 204 showed 12,998.6 of 26,258.6.
  //
  // Real figures from batch 1415, mixer truth.
  const silos = [{ silo: "204", size: "1.2-2.5", kg: 26258.6, suppliers: [sup("Premium Vinayaka", 12998.6, 4200)] }];
  const b = gritSiloBlockers(silos, [{ silo: "204", kg: 26258.6 }]);
  assert.equal(b.length, 1);
  assert.match(b[0], /13260 kg assigned to nobody/,
    "the shortfall is against the 26,258.6 kg the mixer drew, not the 12,998.6 that was bandable");

  // ...and the sheet agrees, so neither can quietly price a subset.
  const priced = priceGritSilo(silos[0]);
  assert.equal(priced.withhold, true);
  assert.equal(priced.lines[0].tonnes, 12.9986, "only the assigned share is costed");
});

test("a silo whose grit has no size band at all still gets a row", () => {
  // Silo 203 on batch 1415: 11,534.5 kg, not one charge of it bandable. It was
  // absent from the screen and from the costing, so its tonnage left the batch
  // total in silence.
  const b = gritSiloBlockers(
    [{ silo: "201", size: "0.1-0.4", kg: 19103.5, suppliers: [sup("Supreme Vinayaka", 19103.5, 4200)] }],
    [{ silo: "201", kg: 19103.5 }, { silo: "203", kg: 11534.5 }],
  );
  assert.equal(b.length, 1);
  assert.match(b[0], /Silo 203 drew 11535 kg and has not been assigned/);
});

test("a silo the mixer no longer reports cannot block a sign-off for ever", () => {
  // The trap the no-silo bucket made routine: price it, then let somebody type
  // the missing silo number on the mixer form. The bucket empties, its priced
  // lines remain, and the row now claims 2,100 kg against a mixer draw of 0 —
  // reading as pure over-assignment. It has no card on any screen, so nothing
  // could clear it, and every sign-off attempt failed for ever while the sheet
  // costed the batch cleanly without it.
  //
  // priceGritSilo already returned early on kg <= 0; this gate did not.
  const stale = [{ silo: "(no silo)", size: "0.1-0.4", kg: 0, suppliers: [sup("Someone", 2100, 5000)] }];
  assert.deepEqual(gritSiloBlockers(stale, []), [],
    "a row the mixer no longer backs must not block anything");
  // ...and the sheet agrees, as it always did.
  assert.equal(priceGritSilo(stale[0]).withhold, false);
  assert.deepEqual(priceGritSilo(stale[0]).lines, []);

  // The same shape for a real silo whose number was corrected after assignment.
  const corrected = [{ silo: "204", size: "1.2-2.5", kg: 0, suppliers: [sup("Premium Vinayaka", 12998.6, 4200)] }];
  assert.deepEqual(gritSiloBlockers(corrected, [{ silo: "205", kg: 12998.6 }]).filter((b) => b.includes("204")), [],
    "the stale 204 row is silent...");
  assert.equal(gritSiloBlockers(corrected, [{ silo: "205", kg: 12998.6 }]).length, 1,
    "...while the silo that IS in the draw is reported as unassigned");
});
