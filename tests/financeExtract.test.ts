import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extract, lineAmounts, looksLikeFuel, overallConfidence, partialRatio,
  triangulateFuelAmount,
} from "../src/lib/finance/extract.ts";
import { findGstin } from "../src/lib/finance/gstin.ts";

// Pins the TS port of automation/app/extract.py to the Python engine's
// behaviour. Inputs and expected values are lifted verbatim from
// automation/tests.py, sections "Field extraction", "Fuel triangulation and
// the plausibility ceiling", and the extraction half of "Malformed input
// battery" — plus a few extra values captured from a live run of the Python
// module (rapidfuzz 3.14.5, Python 3.14), so the port can't drift quietly.

const closeTo = (got: number, want: number, label = "") => {
  assert.ok(Math.abs(got - want) < 1e-9, `${label} expected ${want}, got ${got}`);
};

// ---------------------------------------------------------------- scorer
// The label thresholds in extract.ts were tuned against
// rapidfuzz.fuzz.partial_ratio, so the hand-rolled scorer must reproduce its
// scores, not merely correlate with them. Every expected value below is the
// float rapidfuzz itself returned for that pair.
test("partial ratio matches rapidfuzz on the label-matching cases", () => {
  const pinned: Array<[string, string, number]> = [
    // The OCR-mangled labels the table exists for.
    ["total amount", "total amcunt 2108 28", 91.66666666666666],
    ["net amount", "total amcunt 2108 28", 70.0],
    ["round off", "rounc off 0.28", 88.88888888888889],
    ["rounded off", "rounc off 0.28", 80.0],
    // Prefix windows: the needle may hang off the line's left edge, which is
    // how a lost leading character ("MOUNT", "AMOUNI") still scores 90+.
    ["amount", "amouni 1200.00", 90.9090909090909],
    ["amount", "mount : 1200.00", 90.9090909090909],
    ["mount:", "mount : 1200.00", 90.9090909090909],
    ["amount:", "mount : 1200.00", 85.71428571428572],
    // ...but MID-string windows are always exactly needle-length, which is
    // why the fragment "mount:" inside a long line caps "amount" at 83 and
    // the table needs its explicit "mount:" entry.
    ["amount", 'societies "\\mount: volume: rate product:', 83.33333333333334],
    ["ab", "xaxbx", 50.0],
    // Exact containment is 100 regardless of surroundings.
    ["kitten", "sitting kitten mitten", 100.0],
    ["amt", "amt 450.50", 100.0],
    ["amount", "kot no net : 13625 amount 3629 ___ 2214.00", 100.0],
    // Rejections that keep wrong labels from firing.
    ["total", "hotel sitara grand", 60.0],
    ["grand total", "total 450.00", 62.5],
    ["sub total", "total 450.00", 71.42857142857143],
    ["cgst", "state gst @ 2.5% 52.72", 75.0],
    ["central gst", "state gst @ 2.5% 52.72", 60.0],
    // rapidfuzz quirk: equal-length inputs are scored in both roles.
    ["abcd", "abdc", 85.71428571428572],
  ];
  for (const [a, b, want] of pinned) closeTo(partialRatio(a, b), want, `${a} / ${b}`);

  assert.equal(partialRatio("", ""), 100);
  assert.equal(partialRatio("", "abc"), 0);
  assert.equal(partialRatio("abc", ""), 0);
});

test("bit-parallel scorer agrees with a naive reference on random strings", () => {
  // Reference: plain DP LCS + the rapidfuzz window set (prefixes, full
  // windows, suffixes), with none of extract.ts's skip optimisations. If the
  // optimised scorer ever diverges, a threshold somewhere just moved.
  const refLcs = (a: string, b: string): number => {
    const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
      new Array<number>(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    return dp[a.length][b.length];
  };
  const refRatio = (a: string, b: string): number => {
    if (!a.length && !b.length) return 100;
    if (!a.length || !b.length) return 0;
    return (200 * refLcs(a, b)) / (a.length + b.length);
  };
  const refImpl = (s1: string, s2: string): number => {
    const m = s1.length;
    const n = s2.length;
    if (!m) return n ? 0 : 100;
    let best = 0;
    for (let i = 1; i < m; i++) best = Math.max(best, refRatio(s1, s2.slice(0, i)));
    for (let i = 0; i < n - m; i++) best = Math.max(best, refRatio(s1, s2.slice(i, i + m)));
    for (let i = Math.max(0, n - m); i < n; i++) best = Math.max(best, refRatio(s1, s2.slice(i)));
    return best;
  };
  const refPartial = (a: string, b: string): number => {
    if (!a.length && !b.length) return 100;
    if (!a.length || !b.length) return 0;
    const [s1, s2] = a.length <= b.length ? [a, b] : [b, a];
    let best = refImpl(s1, s2);
    if (best !== 100 && a.length === b.length) best = Math.max(best, refImpl(s2, s1));
    return best;
  };

  // Deterministic PRNG so a failure is reproducible.
  let seed = 0x2f6e2b1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const alphabet = "abc :";
  const randStr = (max: number) => {
    const len = Math.floor(rnd() * (max + 1));
    let s = "";
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    return s;
  };
  for (let t = 0; t < 1000; t++) {
    const a = randStr(8);
    const b = randStr(11);
    closeTo(partialRatio(a, b), refPartial(a, b), `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  }
});

// ------------------------------------------------------- field extraction
// tests.py lines 94-134, verbatim.

const BILL = [
  "HOTEL SITARA GRAND",
  "Phone: 04024112221/9246569444",
  "FSSAI No. 13623012000760",
  "7039 Date 29-06-26 Time 22.40",
  "Chicken 555 1 445.00 445.00",
  "Total Amcunt 2108 28",          // OCR: lost decimal, mangled label
  "State GST @ 2.5% 52.72",
  "Central GST @ 2.5% 52.72",
  "Rounc Off 0.28",
  "Net Amount 2214.00",
].join("\n");

test("field extraction on the OCR-damaged restaurant bill", () => {
  const e = extract(BILL, BILL.split("\n"), 60.0);
  assert.equal(e.vendor_name.value, "HOTEL SITARA GRAND", "vendor from caps run");
  assert.equal(e.net_amount.value, 2214.00, "net amount");
  assert.equal(e.taxable_value.value, 2108.28, "taxable via lost-decimal repair");
  assert.equal(e.cgst.value, 52.72);
  assert.equal(e.sgst.value, 52.72);
  assert.equal(e.round_off.value, 0.28);
  assert.equal(e.arithmetic_ok, true, "arithmetic reconciles");
  assert.equal(e.invoice_date.value, "2026-06-29", "date parsed day-first");

  // Extra pins from a live Python run: the promotion path, not just the sum.
  assert.equal(e.taxable_value.method, "reclassified_pretax");
  assert.equal(e.net_amount.method, "arithmetic_promoted");
  assert.equal(e.net_amount.confidence, 0.85);
  assert.deepEqual(e.line_items,
    [{ description: "Chicken 555", qty: 1, rate: 445, amount: 445 }]);
  assert.deepEqual(e.notes, [
    "The labelled total (2108.28) is the pre-tax amount; " +
    "net of 2214.00 confirmed by adding the taxes",
  ]);
  assert.equal(overallConfidence(e), 0.62);
});

test("recovers net when its label is unreadable", () => {
  // Pre-tax total promotion: the net line is unreadable, so the matcher lands
  // on the pre-tax "Total Amount". Posting that would short the claim 105.72.
  const noNet = BILL.replace("Net Amount 2214.00",
    "KOT NO Net : 13625 Amount 3629 ___ 2214.00");
  const e = extract(noNet, noNet.split("\n"), 60.0);
  assert.equal(e.net_amount.value, 2214.00);
});

test("phone number is not read as an amount", () => {
  const e = extract("SHOP NAME\nPhone No: 7559738899\nTotal 450.00");
  assert.equal(e.net_amount.value, 450.00);
  assert.equal(e.vendor_name.value, "SHOP NAME");
});

test("repairs a corrupted year", () => {
  const e = extract("SHOP\nDate; 30/06/7026\nTotal 100.00");
  assert.equal(e.invoice_date.value, "2026-06-30");
});

// ------------------------------------- fuel + the plausibility ceiling
// tests.py lines 135-194, verbatim.

test("fuel bill: amount recovered from rate x volume", () => {
  const fuel = "BALAKRISHNALAH AND CO\n" +
    "Nozzle Preset Volume Density kg/m3 Rate\n" +
    "DIESEL 103.00 14.45 1500.00";
  assert.equal(looksLikeFuel(fuel), true, "recognises a fuel bill");
  const e = extract(fuel, fuel.split("\n"), 45.0);
  assert.equal(e.net_amount.value, 1500.00, "recovers amount from rate x volume");
  assert.equal(e.net_amount.method, "fuel_triangulated", "says how it got there");
  // Live-run pins: confidence and the exact human-readable explanation.
  assert.equal(e.net_amount.confidence, 0.75);
  assert.deepEqual(e.notes, [
    "Fuel bill: amount confirmed by 103/litre x 14.45 litres = 1,488.35, matching 1,500.00",
  ]);
});

test("triangulation rejects degenerate triples", () => {
  assert.equal(triangulateFuelAmount([103.0, 1.0, 103.0]), null,
    "ignores rate-restated-as-amount triples");
  assert.equal(triangulateFuelAmount([5.0, 20.0, 100.0]), null,
    "needs a plausible rate");
  assert.deepEqual(triangulateFuelAmount([3.0, 103.0, 14.45, 1500.0]), {
    amount: 1500.0,
    explanation: "103/litre x 14.45 litres = 1,488.35, matching 1,500.00",
  });
});

test("refuses an implausible total rather than guessing", () => {
  // The exact failure this guard exists for: a fuel bill whose Amount and
  // Volume columns collided into "91500. 4." for a 915-rupee purchase.
  const collided = "PETROL PUMP\nAmount Volume : goa! 91500. 4.\nNozzle Preset litre";
  const e = extract(collided, collided.split("\n"), 40.0);
  assert.equal(e.net_amount.value, null);
  // Either explanation is acceptable — "the label was there but no value was
  // written like money" (more precise) or "the only candidate was too large".
  // What must never happen is a blank field with no reason given.
  assert.ok(e.notes.some((n) => n.includes("left blank") || n.includes("too large")),
    `explains why it was left blank: ${JSON.stringify(e.notes)}`);
});

test("reads the bare 'AMOUNT' label through OCR damage", () => {
  // The bare "Amount" label, as fuel pumps print it, with the leading letter
  // mangled by OCR. Taken from a real bill the user reported.
  const pump = '| | , PRN | | Societies "\\MOUNT: VOLUME: RATE PRODUCT: DENSITy: ' +
    "NOZZLE VEHICLE INVOIce NO: No 103 ye No: NO: 14 1200.00 DIESEL " +
    "8215 + 5 Noy 5 2017994 89 lL | kg ENTERED 9529347 INR/L INR.";
  const e = extract(pump, pump.split("\n"), 42.0);
  assert.equal(e.net_amount.value, 1200.00);
  // Live-run pins, quirks included: these are what the Python engine
  // actually produced for this page, ported faithfully.
  assert.equal(e.net_amount.confidence, 0.357);
  assert.equal(e.vendor_name.value, "VOLUME RATE PRODUCT");
  assert.equal(e.invoice_no.value, "OIce");
});

test("the mangled bare-amount label family", () => {
  const cases: Array<[string, string, number | null]> = [
    ["MOUNT : 1200.00", "leading A lost", 1200.00],
    ["AMOUNI 1200.00", "trailing T mangled", 1200.00],
    ["Amt 450.50", "abbreviated", 450.50],
    // No value on the line is money-formatted, so nothing may be claimed —
    // 8215 is the fuel density, not the total.
    ["AMOUNT: 103 14 8215 2017994", "no money-formatted value", null],
  ];
  for (const [text, label, want] of cases) {
    const full = "PUMP\n" + text;
    const e = extract(full, full.split("\n"), 40.0);
    assert.equal(e.net_amount.value, want, `amount label: ${label}`);
  }
});

test("merged decimals are not treated as money formatting", () => {
  // A decimal point this code inserted while repairing "2108 28" must not be
  // mistaken for money formatting on a weak label.
  assert.deepEqual(lineAmounts("amount: 103 14", true), [[103.14, false]]);
  assert.deepEqual(lineAmounts("Total Amcunt 2108 28"), [2108.28]);
});

test("still fills a plausible unlabelled amount", () => {
  const e = extract("SHOP\nno label\n450.00");
  assert.equal(e.net_amount.value, 450.00);
  assert.equal(e.net_amount.method, "largest_amount_fallback");
});

// ------------------------------------------------- malformed input battery
// tests.py lines 741-768, the extraction assertions.

test("non-Latin bill does not crash and fabricates nothing", () => {
  const hindi = "होटल सीताारा\nकुल राशि 500.00\nधन्यवाद";
  const e = extract(hindi, hindi.split("\n"), 40.0);
  assert.equal(e.vendor_gstin.value, null, "no fabricated GSTIN");
  // Live-run pin: the amount still comes through the largest-value fallback.
  assert.equal(e.net_amount.value, 500.0);
});

test("empty and whitespace-only text do not crash", () => {
  assert.equal(extract("", [], 0.0).net_amount.value, null);
  assert.equal(extract("   \n  \n", ["   "], 0.0).net_amount.value, null);
});

test("impossible date (29 Feb 2025) is dropped, amount kept", () => {
  const e = extract("SHOP\nDate: 29-02-2025\nTotal 100.00");
  assert.equal(e.invoice_date.value, null);
  assert.equal(e.net_amount.value, 100.0);
});

test("two GSTINs: picks a valid one, no crash", () => {
  const two = "GSTIN: 27AAPFU0939F1ZV something GSTIN: 29AAGCB7383J1Z4";
  const found = findGstin(two);
  assert.ok(found);
  assert.ok(["27AAPFU0939F1ZV", "29AAGCB7383J1Z4"].includes(found.gstin));
});

test("50k-token bill extracts without blowing up", () => {
  const huge = "word ".repeat(50000) + " Total 250.00";
  const e = extract(huge, huge.split("\n"), 50.0);
  assert.equal(e.net_amount.value, 250.0);
});
