import { test } from "node:test";
import assert from "node:assert/strict";
import { priceGritSilo } from "../src/lib/costing/gritAssign.ts";

// What one assigned silo contributes to the costing sheet. This is the money,
// and it lives in a pure function precisely so it can be checked here — report.ts
// is server-only and `node --test` cannot load it, so arithmetic left in there
// is arithmetic nothing checks.

const line = (supplier: string, kg: number, ratePerT: number | null) => ({ supplier, kg, ratePerT });

test("a fully priced silo costs at its own lines, converted to tonnes once", () => {
  const r = priceGritSilo({
    silo: "201", size: "0.1-0.4", kg: 19103.5,
    suppliers: [line("Supreme Vinayaka", 19103.5, 4200)],
  });
  assert.equal(r.withhold, false);
  assert.equal(r.missing.length, 0);
  assert.deepEqual(r.lines, [{ supplier: "Supreme Vinayaka", tonnes: 19.1035, ratePerT: 4200 }]);
  // The rate is rupees per TONNE and the weight arrives in KILOGRAMS. Getting
  // this wrong by a factor of 1000 is the whole reason the conversion is here
  // and in exactly one place.
  assert.equal(Math.round(r.lines[0].tonnes * r.lines[0].ratePerT), 80235);
});

test("two suppliers on one silo are priced separately, because that is why it is split", () => {
  const r = priceGritSilo({
    silo: "102", size: "0.6-1.2", kg: 17180,
    suppliers: [line("Premium A&A Silicates", 12998.6, 5000), line("Other Vendor", 4181.4, 6100)],
  });
  assert.equal(r.withhold, false);
  assert.equal(r.lines.length, 2);
  const total = r.lines.reduce((a, l) => a + l.tonnes * l.ratePerT, 0);
  // 12.9986 t x 5000 + 4.1814 t x 6100 — a single silo rate could not express this.
  assert.equal(Math.round(total), Math.round(12.9986 * 5000 + 4.1814 * 6100));
});

test("NULL IS NOT ZERO — an unpriced line withholds the sheet", () => {
  // The failure this prevents: costing an unpriced line at nothing prints a
  // complete-looking total with that grit missing. It does not look broken. It
  // looks like a cheap batch.
  const r = priceGritSilo({
    silo: "204", size: "1.2-2.5", kg: 12998.6,
    suppliers: [line("Premium Vinayaka", 12998.6, null)],
  });
  assert.equal(r.withhold, true, "an unpriced line must withhold the sheet");
  assert.equal(r.lines.length, 0, "nothing may be costed at zero");
  assert.equal(r.missing.length, 1);
  assert.match(r.missing[0].needs, /price per tonne for Premium Vinayaka/);
  assert.equal(r.missing[0].tonnes, 12.9986);
});

test("one priced supplier and one unpriced still withholds — no partial totals", () => {
  const r = priceGritSilo({
    silo: "102", size: "0.6-1.2", kg: 17180,
    suppliers: [line("A", 12998.6, 5000), line("B", 4181.4, null)],
  });
  assert.equal(r.withhold, true);
  assert.equal(r.lines.length, 1, "the priced half is still reported...");
  assert.equal(r.missing.length, 1, "...but the sheet is withheld on the other");
});

test("an assigned silo with no supplier at all withholds, and says what is needed", () => {
  const sized = priceGritSilo({ silo: "206", size: "# 6-8", kg: 1921.5, suppliers: [] });
  assert.equal(sized.withhold, true);
  assert.match(sized.missing[0].needs, /a supplier and a price per tonne/);

  // No size either — the sentence has to ask for both, or somebody prices a
  // silo whose size nobody has confirmed.
  const unsized = priceGritSilo({ silo: "207", size: "", kg: 1364.8, suppliers: [] });
  assert.match(unsized.missing[0].needs, /a size, a supplier and a price/);
});

test("tonnage the split does not cover is reported and withheld", () => {
  // 4,181.4 kg of silo 102 assigned to nobody — real state from batch 1415.
  const r = priceGritSilo({
    silo: "102", size: "0.6-1.2", kg: 17180,
    suppliers: [line("Premium A&A Silicates", 12998.6, 5000)],
  });
  assert.equal(r.withhold, true);
  assert.equal(r.lines.length, 1);
  assert.equal(r.missing.length, 1);
  assert.match(r.missing[0].needs, /remaining 4181.4 kg of silo 102/);
});

test("a shortfall is not reported twice when a line is also unpriced", () => {
  // Both faults at once. Reporting the same silo as short AND unpriced would
  // print the same missing tonnes under two sentences and read as two problems.
  const r = priceGritSilo({
    silo: "102", size: "0.6-1.2", kg: 17180,
    suppliers: [line("A", 12998.6, null)],
  });
  assert.equal(r.withhold, true);
  assert.equal(r.missing.length, 1, "one fault, one sentence");
  assert.match(r.missing[0].needs, /price per tonne/);
});

test("rounding: a few grams short is not a shortfall", () => {
  const r = priceGritSilo({
    silo: "201", size: "0.1-0.4", kg: 19103.5,
    suppliers: [line("Supreme Vinayaka", 19103.497, 4200)],
  });
  assert.equal(r.withhold, false, "3 g under must not withhold a whole sheet");
  assert.equal(r.missing.length, 0);
});

test("a silo the mixer never drew from contributes nothing at all", () => {
  const r = priceGritSilo({ silo: "999", size: "0.1-0.4", kg: 0, suppliers: [] });
  assert.deepEqual(r, { lines: [], missing: [], withhold: false });
});

test("OVER-ASSIGNMENT is refused, not priced", () => {
  // The split adds up to more than the mixer drew. Every line was previously
  // costed at its own kilograms, so a fat-fingered 41,814 against a silo that
  // drew 17,180 priced 24 tonnes of grit that never existed — and the sheet
  // printed as complete. Under-assignment reads as unfinished work;
  // over-assignment reads as wrong numbers, so they get different sentences.
  const r = priceGritSilo({
    silo: "102", size: "0.6-1.2", kg: 17180,
    suppliers: [line("A", 12998.6, 5000), line("B", 41814, 5000)],
  });
  assert.equal(r.withhold, true, "tonnage that was never weighed must not be costed");
  assert.equal(r.missing.length, 1);
  assert.match(r.missing[0].needs, /add up to 54812.6 kg but the mixer drew 17180 kg/);
  // Negative, so nothing can add it into a total as if it were missing stock.
  assert.ok(r.missing[0].tonnes < 0, "an excess is negative tonnage, not positive");
});

test("a hair over is tolerated, like a hair under", () => {
  const r = priceGritSilo({
    silo: "201", size: "0.1-0.4", kg: 19103.5,
    suppliers: [line("Supreme Vinayaka", 19103.503, 4200)],
  });
  assert.equal(r.withhold, false, "3 g over must not withhold a whole sheet");
  assert.equal(r.missing.length, 0);
});
