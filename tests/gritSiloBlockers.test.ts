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
