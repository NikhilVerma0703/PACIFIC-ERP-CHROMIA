import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanAmount, findGstin, gstinCandidates, gstinChecksum, isValidGstin,
} from "../src/lib/finance/gstin.ts";

// Fixtures are REAL GSTINs taken from the company's own Tally master
// (automation/data/MASTER.xml), not invented ones. An invented GSTIN would
// almost certainly fail the check digit and make these tests pass for the
// wrong reason.
const PESPL = "33AALCP2750N1Z3";          // the company itself
const VENDORS = [
  "33GXVPK3394H1ZT",                       // A2Z Maintenance Service
  "33CVRPM3744H1Z9",                       // AAI Mathaji Electricals
  "29ATHPC9055D1ZO",                       // ABC Enterprises
  "29AAJCA7522R1ZX",                       // Accure Power Technologies
  "29CNPPK7666E2ZA",                       // Aikya Trading Company
];

test("the checksum matches every real GSTIN in the chart of accounts", () => {
  for (const g of [PESPL, ...VENDORS]) {
    assert.equal(gstinChecksum(g.slice(0, 14)), g[14], `checksum mismatch for ${g}`);
    assert.equal(isValidGstin(g), true, `${g} should validate`);
  }
});

test("a wrong check digit is rejected", () => {
  // Same 14 characters, deliberately wrong 15th.
  const wrong = PESPL.slice(0, 14) + (PESPL[14] === "1" ? "2" : "1");
  assert.equal(isValidGstin(wrong), false);
  // ...but the shape is still right, which is the distinction the extractor
  // uses to offer a low-confidence read instead of nothing.
  assert.equal(isValidGstin(wrong, false), true);
});

test("an impossible state code is rejected even with a valid shape", () => {
  const bad = "99AALCP2750N1Z3";
  assert.equal(isValidGstin(bad, false), false);
});

test("a clean bill yields the GSTIN with no repair", () => {
  const found = findGstin(`TAX INVOICE\nAcme Traders\nGSTIN: ${VENDORS[0]}\nTotal 2,400.00`);
  assert.ok(found);
  assert.equal(found.gstin, VENDORS[0]);
  assert.equal(found.method, "gstin_exact");
  assert.equal(found.edits, 0);
});

test("a readable GSTIN with no GST label anywhere is still found", () => {
  // The divergence from extract.py, pinned. Python strips separators before
  // this scan, which removes the \b boundaries the pattern needs, so it finds
  // nothing here and the bill loses its vendor identity. Verified against the
  // original: the exact path returns [] for this input.
  const found = findGstin(`ACME TRADERS\n${VENDORS[1]}\nTOTAL 900.00`);
  assert.ok(found, "a clean, checksum-valid GSTIN must not need a label");
  assert.equal(found.gstin, VENDORS[1]);
  assert.equal(found.method, "gstin_exact");
});

test("a GSTIN printed with spaces inside it is still found", () => {
  // This is what the stripping pass is actually for.
  const spaced = `${VENDORS[2].slice(0, 5)} ${VENDORS[2].slice(5, 10)} ${VENDORS[2].slice(10)}`;
  const found = findGstin(`GSTIN ${spaced}`);
  assert.ok(found);
  assert.equal(found.gstin, VENDORS[2]);
});

test("OCR damage next to a GST label is repaired via the check digit", () => {
  // O for 0 and I for 1 - the two commonest confusions - inside a real GSTIN.
  const damaged = PESPL.replace(/0/g, "O").replace(/1/g, "I");
  assert.notEqual(damaged, PESPL, "fixture must actually be damaged");

  const found = findGstin(`GSTIN ${damaged}`);
  assert.ok(found, "should recover something");
  assert.equal(found.gstin, PESPL);
  assert.equal(found.method, "gstin_repaired_checksum");
  assert.ok(found.edits > 0);
});

test("the repair search invents nothing when there is no GST label", () => {
  // The failure the label anchor exists to prevent: enough windows and
  // substitutions will eventually satisfy the check digit by chance — roughly
  // 1 in 36 per candidate — and the Python engine's own testing hit it,
  // "finding" 15HFIAA5004A5Z0 in a line of OCR noise.
  //
  // Note that string IS checksum-valid (verified), so it cannot be used as the
  // noise here: a verbatim, valid, correctly-shaped GSTIN on the page is a
  // legitimate find, not a fabrication. The distinction being tested is
  // between reading one and manufacturing one.
  const noise = "SUBT0TAL 4S9O ROUNDING O.5O THANK YOU VISIT AGAIN 8877 RS 12345678901234";
  const found = findGstin(noise);
  assert.equal(found, null, `manufactured a GSTIN from noise: ${JSON.stringify(found)}`);
});

test("a verbatim valid GSTIN is read even from an otherwise noisy line", () => {
  // The other half of the same distinction: this one is on the page, unrepaired.
  const found = findGstin("SUBTOTAL 15HFIAA5004A5Z0 ROUNDING 0.50 THANK YOU");
  assert.ok(found);
  assert.equal(found.gstin, "15HFIAA5004A5Z0");
  assert.equal(found.edits, 0);
});

test("text too short to hold a GSTIN returns nothing", () => {
  assert.equal(findGstin("GST 123"), null);
});

test("candidate enumeration refuses windows that cannot be a GSTIN", () => {
  // '#' is neither digit nor letter, so no substitution can rescue position 0.
  assert.equal(gstinCandidates("#3AALCP2750N1Z3"), null);
  // A clean window enumerates to at least itself.
  const cands = gstinCandidates(PESPL);
  assert.ok(cands && cands.some((c) => c.candidate === PESPL && c.edits === 0));
});

test("amounts survive the digits OCR invents", () => {
  assert.equal(cleanAmount("1,234.50"), 1234.5);
  assert.equal(cleanAmount("2,4OO"), 2400);      // O read for 0
  assert.equal(cleanAmount("l50"), 150);         // lowercase L read for 1
  assert.equal(cleanAmount("S00"), 500);         // S read for 5
  assert.equal(cleanAmount("abc"), null);
  assert.equal(cleanAmount(null), null);
  assert.equal(cleanAmount("1e12"), null);       // beyond any plausible bill
});
