import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLAG_THRESHOLD, findDuplicates, normaliseInvoiceNo, scoreAgainst,
  partialRatio, ratio, tokenSetRatio,
} from "../src/lib/finance/dedupe.ts";

// Every case here is one the Python module's comments call out by name. A
// duplicate reaching Tally is a duplicate payment, so these are the behaviours
// that must survive the port, not incidental details of it.

test("invoice numbers normalise to one spelling", () => {
  // The three the docstring names as the same invoice.
  assert.equal(normaliseInvoiceNo("INV-0074/26"), normaliseInvoiceNo("inv 74/26"));
  assert.equal(normaliseInvoiceNo("INV74/26"), normaliseInvoiceNo("inv 74/26"));
  assert.equal(normaliseInvoiceNo(null), "");
  // A number that is all zeros must not normalise away to nothing.
  assert.notEqual(normaliseInvoiceNo("000"), "");
});

test("fuzz.ratio matches the identical and disjoint cases", () => {
  assert.equal(ratio("", ""), 100);
  assert.equal(ratio("ABC123", "ABC123"), 100);
  assert.equal(ratio("ABC", ""), 0);
  assert.ok(ratio("INV07039", "7039") < 80, "the case the containment rule exists for");
});

test("token_set_ratio forgives extra words and word order", () => {
  assert.ok(tokenSetRatio("pacific surfaces pvt ltd", "surfaces pacific") > 90);
  assert.ok(tokenSetRatio("annai fuel service", "zenith enterprises") < 60);
});

test("partial_ratio finds the shorter string inside the longer", () => {
  assert.equal(partialRatio("7039", "INV-7039-A"), 100);
});

const base = {
  vendorGstin: "33AALCP2750N1Z3",
  vendorName: "A2Z Maintenance Service",
  invoiceNo: "INV-07039",
  netAmount: 2400,
  invoiceDate: "2026-08-01",
};

test("GSTIN plus invoice number is decisive on its own", () => {
  // Amount and date deliberately disagree: the two identifying fields should
  // carry it alone.
  const v = scoreAgainst(base, { ...base, netAmount: 99999, invoiceDate: "2025-01-01" });
  assert.ok(v.score >= 0.95, `expected decisive, got ${v.score}`);
  assert.equal(v.flagged, true);
});

test("the prefix-dropped invoice number is still caught", () => {
  // "INV-07039" one time, bare "7039" the next - the case the containment rule
  // was written for. Straight ratio alone scores this under the threshold.
  const v = scoreAgainst(base, { ...base, invoiceNo: "7039" });
  assert.equal(v.flagged, true, `expected a flag, got ${v.score}`);
});

test("same vendor, same amount, same day is flagged even with no invoice match", () => {
  // The classic double-claim: one receipt submitted twice, OCR reading the
  // number differently each time. Plain weights put this at 0.65 and let it
  // through; the rule lifts it to 0.80.
  const v = scoreAgainst(base, { ...base, invoiceNo: "COMPLETELY-OTHER-9999" });
  assert.ok(v.score >= 0.80, `expected 0.80+, got ${v.score}`);
  assert.equal(v.flagged, true);
  assert.ok(v.why.some((w) => /same vendor, amount and date/.test(w)));
});

test("amount and date alone are a coincidence, not a duplicate", () => {
  // Different vendor, different invoice, same money on the same day. In a
  // business with many small bills this happens constantly, and flagging it
  // trains people to click through warnings.
  const v = scoreAgainst(base, {
    vendorGstin: "29AAJCA7522R1ZX",
    vendorName: "Zenith Enterprises",
    invoiceNo: "ZE/2026/881",
    netAmount: 2400,
    invoiceDate: "2026-08-01",
  });
  assert.equal(v.flagged, false);
  assert.equal(v.score, 0);
});

test("a genuinely unrelated bill scores nothing", () => {
  const v = scoreAgainst(base, {
    vendorGstin: "29ATHPC9055D1ZO",
    vendorName: "Amazon",
    invoiceNo: "AMZ-1",
    netAmount: 175.5,
    invoiceDate: "2026-02-14",
  });
  assert.ok(v.score < FLAG_THRESHOLD);
  assert.equal(v.flagged, false);
});

test("amounts within a rupee are the same amount, beyond that are not", () => {
  const near = scoreAgainst(base, { ...base, invoiceNo: "X", netAmount: 2400.75 });
  assert.ok(near.why.some((w) => /same amount/.test(w)));
  const far = scoreAgainst(base, { ...base, invoiceNo: "X", netAmount: 2402 });
  assert.ok(!far.why.some((w) => /same amount/.test(w)));
});

test("findDuplicates returns the strongest first and caps the list", () => {
  const weak = { ...base, invoiceNo: "OTHER-1", netAmount: 2400, invoiceDate: "2026-08-01" };
  const strong = { ...base };
  const hits = findDuplicates(base, [weak, strong], 5);
  assert.ok(hits.length >= 1);
  assert.ok(hits[0].verdict.score >= hits[hits.length - 1].verdict.score);
  assert.equal(findDuplicates(base, [strong, strong, strong], 2).length, 2);
});
