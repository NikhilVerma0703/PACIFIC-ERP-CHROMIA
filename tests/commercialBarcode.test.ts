// EAN-13, pinned against the article file the owner sent on 2026-09-09
// (round three, answer 4): the twelve codes on it, the one that arrived with
// Excel's apostrophe, and the sentence that names the wrong digit.
//
// Import-free module, so node --test loads it bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseEan, eanCheckDigit, isValidEan13, describeEan, ean13Bars, ean13Text,
  isEan13Magnification, ean13ModuleMm, ean13WidthMm,
  EAN13_LENGTH, EAN13_MODULES, EAN13_GUARD, EAN13_CENTRE,
  EAN13_MODULE_MM, EAN13_MAGNIFICATION_MIN, EAN13_MAGNIFICATION_MAX,
  EAN13_LABEL_MAGNIFICATION, EAN13_QUIET_LEFT_MODULES, EAN13_QUIET_RIGHT_MODULES,
  EAN13_DRAWN_MODULES,
} from "../src/lib/commercial/barcode.ts";

/** Every code on `Desert Silk Crate BARCODE.docx` that the brief pins. */
const OWNERS_CODES = [
  "8720847172228", "8720847172235", "8720847172242", "8720847172259",
  "8720847172266", "8720847172280", "8720847172303", "8720847172310",
  "8720847172327",
];

test("the owner's codes are all valid EAN-13", () => {
  for (const c of OWNERS_CODES) {
    assert.equal(isValidEan13(c), true, c);
    assert.equal(eanCheckDigit(c.slice(0, 12)), Number(c[12]), c);
    assert.deepEqual(describeEan(c), { ok: true, value: c, message: null }, c);
  }
  assert.equal(EAN13_LENGTH, 13);
});

test("normaliseEan strips Excel's text prefix and the spaces around it", () => {
  // His file carries 126x25x2 as '8720847172297 — the apostrophe stops Excel
  // turning thirteen digits into 8.72085E+12, and it has leaked onto the
  // printed label (DECISIONS-3.md 4).
  assert.equal(normaliseEan("'8720847172297"), "8720847172297");
  assert.equal(normaliseEan("  '8720847172297  "), "8720847172297");
  assert.equal(normaliseEan("’8720847172297"), "8720847172297", "the curly quote Word leaves behind");
  assert.equal(normaliseEan("8720 8471 7229 7"), "8720847172297", "read aloud and typed back");
  assert.equal(isValidEan13("'8720847172297"), true);
  assert.equal(describeEan("'8720847172297").ok, true);
  assert.equal(describeEan("'8720847172297").value, "8720847172297");
  // Nothing else is stripped: a hyphen is a different kind of code, not a
  // dirty EAN, and deleting it would hide the real mistake.
  assert.equal(normaliseEan("872-0847172297"), "872-0847172297");
  assert.equal(isValidEan13("872-0847172297"), false);
  assert.equal(normaliseEan(null), "");
  assert.equal(normaliseEan(undefined), "");
  assert.equal(normaliseEan(8720847172228), "8720847172228", "a number that survived the spreadsheet");
});

test("eanCheckDigit: twelve digits in, one out; anything else is -1", () => {
  assert.equal(eanCheckDigit("872084717222"), 8);
  assert.equal(eanCheckDigit("872084717223"), 5);
  assert.equal(eanCheckDigit("872084717230"), 3);
  assert.equal(eanCheckDigit("000000000000"), 0);
  assert.equal(eanCheckDigit("590123412345"), 7, "the textbook example");
  assert.equal(eanCheckDigit("8720847172228"), -1, "thirteen is not twelve");
  assert.equal(eanCheckDigit("87208471722"), -1);
  assert.equal(eanCheckDigit("87208471722a"), -1);
  assert.equal(eanCheckDigit(""), -1);
});

test("describeEan names the digit that is wrong — the reason this is code and not a CHECK constraint", () => {
  const v = describeEan("8720847172223");
  assert.equal(v.ok, false);
  assert.match(v.message ?? "", /check digit should be 8, not 3/);
  assert.match(v.message ?? "", /8720847172228/, "and offers the code those twelve digits make");
  assert.equal(v.value, "8720847172223", "the tidied code comes back so the form can show what it judged");
});

test("describeEan: blank is fine, a short paste is completed, a letter is named", () => {
  // An article need not carry a barcode; its crate simply prints without bars.
  assert.deepEqual(describeEan(""), { ok: true, value: null, message: null });
  assert.deepEqual(describeEan("   "), { ok: true, value: null, message: null });
  assert.deepEqual(describeEan(null), { ok: true, value: null, message: null });

  const short = describeEan("872084717222");
  assert.equal(short.ok, false);
  assert.match(short.message ?? "", /twelve/);
  assert.match(short.message ?? "", /check digit is 8/);
  assert.match(short.message ?? "", /8720847172228/);

  const long = describeEan("87208471722288");
  assert.equal(long.ok, false);
  assert.match(long.message ?? "", /thirteen digits and this one has 14/);

  const letter = describeEan("87208471722O8");
  assert.equal(letter.ok, false);
  assert.match(letter.message ?? "", /"O" is not one of them/, "the capital O typed for a zero");
});

// ─────────────────────────── the bars ───────────────────────────────────────

/** Read the modules back to digits, so the test checks the ENCODING rather
 *  than re-stating the alphabet the module already holds. */
function decode(bits: number[]): string {
  const s = bits.join("");
  assert.equal(s.slice(0, 3), EAN13_GUARD);
  assert.equal(s.slice(45, 50), EAN13_CENTRE);
  assert.equal(s.slice(92), EAN13_GUARD);
  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const G = L.map((c) => Array.from(c).reverse().map((b) => (b === "1" ? "0" : "1")).join(""));
  const R = L.map((c) => Array.from(c).map((b) => (b === "1" ? "0" : "1")).join(""));
  const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  let parity = "";
  let left = "";
  for (let i = 0; i < 6; i++) {
    const chunk = s.slice(3 + i * 7, 10 + i * 7);
    const l = L.indexOf(chunk), g = G.indexOf(chunk);
    assert.ok(l >= 0 || g >= 0, `left digit ${i} is not an L or G code: ${chunk}`);
    parity += l >= 0 ? "L" : "G";
    left += String(l >= 0 ? l : g);
  }
  let right = "";
  for (let i = 0; i < 6; i++) {
    const chunk = s.slice(50 + i * 7, 57 + i * 7);
    const r = R.indexOf(chunk);
    assert.ok(r >= 0, `right digit ${i} is not an R code: ${chunk}`);
    right += String(r);
  }
  const lead = PARITY.indexOf(parity);
  assert.ok(lead >= 0, `no leading digit has parity ${parity}`);
  return `${lead}${left}${right}`;
}

test("ean13Bars: 95 modules, guards in place, and it decodes back to the code", () => {
  for (const c of [...OWNERS_CODES, "8720847172297", "5901234123457", "0000000000000"]) {
    const bits = ean13Bars(c);
    assert.ok(bits, c);
    assert.equal(bits!.length, EAN13_MODULES, c);
    assert.ok(bits!.every((b) => b === 0 || b === 1), "modules are 0 or 1 and nothing else");
    assert.equal(decode(bits!), c, c);
  }
  // The leading digit is carried by the parity of the left six and is drawn
  // nowhere: two codes differing only in it must differ in the bars.
  assert.notDeepEqual(ean13Bars("8720847172228"), ean13Bars("9720847172221"));
});

test("ean13Bars refuses what it cannot draw — no barcode beats a wrong barcode", () => {
  assert.equal(ean13Bars("8720847172223"), null, "a bad check digit draws nothing");
  assert.equal(ean13Bars("872084717222"), null);
  assert.equal(ean13Bars(""), null);
  assert.equal(ean13Bars(null), null);
  assert.equal(ean13Bars("87208471722O8"), null);
  // The apostrophe from the spreadsheet still draws.
  assert.equal(ean13Bars("'8720847172297")?.length, EAN13_MODULES);
});

test("ean13Text splits the code the way it prints under the bars", () => {
  assert.deepEqual(ean13Text("8720847172228"), { lead: "8", left: "720847", right: "172228" });
  assert.equal(ean13Text("8720847172223"), null);
});

// ───────────────────── how big it is printed ────────────────────────────────
// A symbol drawn outside EAN-13's magnification range, or with a quiet zone
// under 11 modules on the left, fails at the CUSTOMER'S gate — where nobody
// here sees it. So the geometry is pinned, not eyeballed.

test("the crate label's magnification is inside the band EAN-13 is specified for", () => {
  assert.equal(EAN13_MODULE_MM, 0.33, "the nominal module at magnification 1.00");
  assert.equal(EAN13_MAGNIFICATION_MIN, 0.8);
  assert.equal(EAN13_MAGNIFICATION_MAX, 2.0);
  assert.equal(isEan13Magnification(EAN13_LABEL_MAGNIFICATION), true, "what the crate label prints at");

  for (const inside of [0.8, 1, 1.5, 2]) assert.equal(isEan13Magnification(inside), true, String(inside));
  for (const outside of [0.79, 2.01, 0, -1, "", null, NaN]) {
    assert.equal(isEan13Magnification(outside), false, String(outside));
  }
  // The first cut of the label drew a flat 2.1 pt module — 0.741 mm, 2.24× —
  // over the top of the range. That number must never come back.
  assert.equal(isEan13Magnification(2.1 / 2.834645669 / EAN13_MODULE_MM), false, "the old 2.1 pt module");
});

test("the drawn symbol carries its own quiet zones and still fits the 100 x 70 label", () => {
  assert.equal(EAN13_QUIET_LEFT_MODULES, 11, "before the start guard");
  assert.equal(EAN13_QUIET_RIGHT_MODULES, 7, "after the end guard");
  assert.equal(EAN13_DRAWN_MODULES, EAN13_QUIET_LEFT_MODULES + EAN13_MODULES + EAN13_QUIET_RIGHT_MODULES);
  assert.equal(EAN13_DRAWN_MODULES, 113);

  assert.equal(ean13ModuleMm(1), EAN13_MODULE_MM);
  assert.ok(Math.abs(ean13ModuleMm() - 0.495) < 1e-9, "0.33 mm at 1.5x");

  // The label is 100 mm wide with 8 mm margins, so the symbol and both quiet
  // zones have 84 mm to sit in.
  const room = 100 - 8 - 8;
  assert.ok(ean13WidthMm() < room, `${ean13WidthMm()} mm must fit ${room} mm`);
  assert.ok(ean13WidthMm(EAN13_MAGNIFICATION_MAX) < room, "and it still fits at the top of the band");
  // WHY THE ZONE IS DRAWN RATHER THAN BORROWED FROM THE PAGE MARGIN. At the
  // old 2.1 pt module the 8 mm margin was 10.8 modules — under the 11 the left
  // zone needs — and nothing in the code said so. It happens to be enough at
  // 1.5x, and that is exactly the kind of accident a page-size change breaks.
  const oldModuleMm = 2.1 / 2.834645669;
  assert.ok(8 < EAN13_QUIET_LEFT_MODULES * oldModuleMm, "the old module width outgrew the 8 mm margin");
  assert.ok(8 > EAN13_QUIET_LEFT_MODULES * ean13ModuleMm(), "at 1.5x the margin would have covered it — by luck");
});
