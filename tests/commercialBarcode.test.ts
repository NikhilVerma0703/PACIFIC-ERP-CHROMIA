// EAN-13, pinned against the article file the owner sent on 2026-09-09
// (round three, answer 4): the twelve codes on it, the one that arrived with
// Excel's apostrophe, and the sentence that names the wrong digit.
//
// The second half is round four (DECISIONS-4.md): the series those codes form
// and the next one out of it, the duplicate two of them make, and the label
// that has to fit the edge of a 2 cm slab. Every number in it comes off his
// sheet or off the brief — an allocator checked against invented codes would
// prove only that it agrees with itself.
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
  describeGs1Prefix, gs1ItemRefWidth, composeEan13, itemRefUnderPrefix,
  highestItemRefInUse, allocateEan13, findEanCollisions, edgeLabelLayout,
  EAN13_DATA_DIGITS, GS1_PREFIX_MIN_DIGITS, GS1_PREFIX_MAX_DIGITS,
  EAN13_BAR_HEIGHT_MM, EAN13_DIGITS_HEIGHT_MM, EDGE_LABEL_CLEARANCE_MM,
  EDGE_LABEL_MARGIN_MM, EDGE_LABEL_DIGITS_MM, EDGE_LABEL_MIN_BAR_MM,
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

// ───────────── the series: prefix, reference, the next code ─────────────────
// Round four, answer 2. The nine codes above are one customer's series under
// one GS1 prefix, and the whole of autogeneration is reading that series and
// continuing it. Everything here is pinned against those nine, because they
// are the only real evidence of how his customer builds a code.

/** 872 is GS1 Netherlands; 8720847 is the prefix on every code he sent. */
const PREFIX = "8720847";

/** 126x25x2, which arrived with Excel's apostrophe. It is reference 17229 —
 *  the gap between 17228 and 17230 in the nine is not a gap at all. */
const APOSTROPHE = "'8720847172297";

test("a GS1 prefix says how many digits the item reference has", () => {
  const p = describeGs1Prefix(PREFIX);
  assert.equal(p.ok, true);
  assert.equal(p.value, PREFIX);
  assert.equal(p.refWidth, 5, "seven of the twelve are the prefix, so five are left");
  assert.equal(p.capacity, 100000, "references 00000 to 99999");
  assert.equal(p.message, null);
  assert.equal(gs1ItemRefWidth(PREFIX), 5);

  // THE NEXT CUSTOMER'S PREFIX IS A DIFFERENT LENGTH. Nothing may assume the
  // seven this one has: a nine-digit prefix leaves three digits and a thousand
  // articles, and a hard-coded five would build a code that is not theirs.
  assert.equal(gs1ItemRefWidth("123456789"), 3);
  assert.equal(describeGs1Prefix("123456789").capacity, 1000);
  assert.equal(gs1ItemRefWidth("123456"), 6, "the shortest GS1 issues");
  assert.equal(gs1ItemRefWidth("12345678901"), 1, "the longest");
  assert.equal(EAN13_DATA_DIGITS, 12);
  assert.equal(GS1_PREFIX_MIN_DIGITS, 6);
  assert.equal(GS1_PREFIX_MAX_DIGITS, 11);
  // Both ends of scripts/0082's CHECK, from the inside and from the outside.
  for (const len of [6, 7, 8, 9, 10, 11]) assert.equal(describeGs1Prefix("1".repeat(len)).ok, true, String(len));
  for (const len of [1, 5, 12, 13]) assert.equal(describeGs1Prefix("1".repeat(len)).ok, false, String(len));
});

test("a prefix that cannot be used says why, because it stops every barcode for that client", () => {
  const none = describeGs1Prefix(null);
  assert.equal(none.ok, false);
  assert.equal(none.value, null);
  assert.equal(none.refWidth, 0);
  assert.match(none.message ?? "", /no GS1 company prefix on file/);
  assert.deepEqual(describeGs1Prefix(""), describeGs1Prefix("   "), "blank is blank");

  const short = describeGs1Prefix("12345");
  assert.equal(short.ok, false);
  assert.match(short.message ?? "", /6 to 11 digits and this one has 5/);

  const letter = describeGs1Prefix("87208O7");
  assert.equal(letter.ok, false);
  assert.match(letter.message ?? "", /"O" is not one of them/);

  // It comes off the same spreadsheets the codes do, so it is tidied the same.
  assert.equal(describeGs1Prefix("'8720847").value, PREFIX);
  assert.equal(describeGs1Prefix(" 8720 847 ").value, PREFIX);
});

test("composeEan13 rebuilds every code the customer sent from its reference", () => {
  const refs = [17222, 17223, 17224, 17225, 17226, 17228, 17230, 17231, 17232];
  refs.forEach((ref, i) => {
    assert.equal(composeEan13(PREFIX, ref), OWNERS_CODES[i], String(ref));
    assert.equal(isValidEan13(composeEan13(PREFIX, ref)), true, String(ref));
  });
  assert.equal(composeEan13(PREFIX, 17229), "8720847172297", "the one with the apostrophe");
  assert.equal(composeEan13(PREFIX, 17233), "8720847172334", "and the next one, which nobody has typed yet");

  // A short reference is padded, because 8720847 + "5" is not a code.
  assert.equal(composeEan13(PREFIX, 0), "8720847000002");
  assert.equal(composeEan13(PREFIX, 5), "8720847000057");
  assert.equal(composeEan13(PREFIX, "17233"), "8720847172334", "typed, not a number");
  assert.equal(composeEan13(PREFIX, 17233n), "8720847172334", "or Prisma's BigInt");

  // A reference too big for the digits it has left is refused, never trimmed:
  // trimming it would quietly produce a DIFFERENT article's code.
  assert.equal(composeEan13(PREFIX, 100000), null);
  assert.equal(composeEan13(PREFIX, 99999), "8720847999993");
  assert.equal(composeEan13("123456789", 1000), null, "three digits hold 0 to 999");
  assert.equal(composeEan13("12345", 1), null, "and an unusable prefix makes nothing");
  assert.equal(composeEan13(PREFIX, -1), null);
  assert.equal(composeEan13(PREFIX, 1.5), null);
});

test("itemRefUnderPrefix reads the reference back out — this is how the highest in use is found", () => {
  assert.equal(itemRefUnderPrefix(PREFIX, "8720847172228"), 17222);
  assert.equal(itemRefUnderPrefix(PREFIX, "8720847172327"), 17232);
  assert.equal(itemRefUnderPrefix(PREFIX, APOSTROPHE), 17229, "tidied before it is read");
  assert.equal(itemRefUnderPrefix(PREFIX, "8720847000002"), 0);

  // A code under somebody else's prefix is not this client's series.
  assert.equal(itemRefUnderPrefix(PREFIX, "5901234123457"), null);
  assert.equal(itemRefUnderPrefix("8720848", "8720847172228"), null);
  assert.equal(itemRefUnderPrefix(PREFIX, ""), null);
  assert.equal(itemRefUnderPrefix(PREFIX, "872084717222"), null, "twelve digits is not a code");
  assert.equal(itemRefUnderPrefix(null, "8720847172228"), null, "and no prefix reads nothing");

  // A STORED CODE WITH A WRONG CHECK DIGIT STILL SPENDS ITS REFERENCE. The
  // column's constraint only counts digits, so this row exists, and pretending
  // 17240 were free would hand it out a second time.
  assert.equal(isValidEan13("8720847172401"), false, "the check digit should be 7");
  assert.equal(itemRefUnderPrefix(PREFIX, "8720847172401"), 17240);

  assert.equal(highestItemRefInUse(PREFIX, OWNERS_CODES), 17232);
  assert.equal(highestItemRefInUse(PREFIX, [...OWNERS_CODES, APOSTROPHE]), 17232);
  assert.equal(highestItemRefInUse(PREFIX, []), null, "a client who has spent nothing");
  assert.equal(highestItemRefInUse(PREFIX, ["5901234123457"]), null, "nor has this one");
});

test("the allocator continues the series and never fills the 17227 gap", () => {
  const a = allocateEan13({ prefix: PREFIX, inUse: OWNERS_CODES });
  assert.equal(a.ok, true);
  assert.equal(a.ref, 17233, "above the highest in use, not into the hole at 17227");
  assert.equal(a.ean, "8720847172334");
  assert.equal(isValidEan13(a.ean), true);
  assert.equal(a.nextFloor, 17234);
  assert.equal(a.message, null);

  // 17227 is missing from his sheet and 17229 only looks missing — it is the
  // row Excel wrote with an apostrophe. Either way the allocator goes above.
  const withApostrophe = allocateEan13({ prefix: PREFIX, inUse: [...OWNERS_CODES, APOSTROPHE] });
  assert.equal(withApostrophe.ref, 17233);

  // A run of blank articles, allocated one after another by feeding nextFloor
  // back in. None of them may be 17227 and none may repeat.
  const gap = composeEan13(PREFIX, 17227);
  assert.equal(gap, "8720847172273");
  const run: string[] = [];
  let floor: number | null = 0;
  for (let i = 0; i < 5; i++) {
    const next = allocateEan13({ prefix: PREFIX, inUse: OWNERS_CODES, floor });
    assert.equal(next.ok, true, String(i));
    run.push(next.ean as string);
    floor = next.nextFloor;
  }
  assert.deepEqual(run, [
    "8720847172334", "8720847172341", "8720847172358", "8720847172365", "8720847172372",
  ]);
  assert.equal(new Set(run).size, run.length, "no code twice");
  assert.equal(run.includes(gap as string), false, "and never the gap");
  for (const c of run) assert.equal(isValidEan13(c), true, c);

  // Codes under other prefixes are somebody else's series, so the caller may
  // hand over the whole column without filtering it first.
  const noisy = allocateEan13({ prefix: PREFIX, inUse: [...OWNERS_CODES, "5901234123457", "4006381333931"] });
  assert.equal(noisy.ean, "8720847172334");
});

test("the floor is a floor and not a counter — the greater of the two wins", () => {
  // A hand-entered code above the counter cannot be handed out again.
  const behind = allocateEan13({ prefix: PREFIX, inUse: OWNERS_CODES, floor: 100 });
  assert.equal(behind.ref, 17233, "the codes in use win");

  // And a deleted row cannot rewind the series onto a number already printed.
  const ahead = allocateEan13({ prefix: PREFIX, inUse: OWNERS_CODES, floor: 20000 });
  assert.equal(ahead.ref, 20000, "the stored floor wins");
  assert.equal(ahead.ean, "8720847200006");
  assert.equal(allocateEan13({ prefix: PREFIX, inUse: [], floor: 20000n }).ref, 20000, "Prisma's BigInt");
  assert.equal(allocateEan13({ prefix: PREFIX, inUse: [], floor: "20000" }).ref, 20000);

  // A client with nothing yet starts at the bottom of their own space.
  const fresh = allocateEan13({ prefix: PREFIX });
  assert.equal(fresh.ref, 0);
  assert.equal(fresh.ean, "8720847000002");
  assert.equal(allocateEan13({ prefix: PREFIX, inUse: null, floor: null }).ref, 0);
});

test("the allocator refuses with a sentence rather than a wrong code", () => {
  const none = allocateEan13({ prefix: null, inUse: OWNERS_CODES });
  assert.equal(none.ok, false);
  assert.equal(none.ean, null);
  assert.equal(none.ref, null);
  assert.equal(none.nextFloor, null);
  assert.match(none.message ?? "", /no GS1 company prefix on file/);

  const bad = allocateEan13({ prefix: "12345" });
  assert.equal(bad.ok, false);
  assert.match(bad.message ?? "", /6 to 11 digits/);

  // The end of the reference space under this prefix. 99999 is spent, so there
  // is no next one and no amount of retrying makes one.
  const full = allocateEan13({ prefix: PREFIX, inUse: ["8720847999993"] });
  assert.equal(full.ok, false);
  assert.equal(full.ean, null);
  assert.match(full.message ?? "", /run from 00000 to 99999/);
  assert.match(full.message ?? "", /second company prefix/);

  // Small prefix, small space: three digits run out after 999.
  const tiny = allocateEan13({ prefix: "123456789", floor: 1000 });
  assert.equal(tiny.ok, false);
  assert.match(tiny.message ?? "", /run from 000 to 999/);
  assert.equal(allocateEan13({ prefix: "123456789", floor: 999 }).ean, "1234567899992");
});

// ─────────────────── one barcode, one article ────────────────────────────────
// Round four, answer 2: "do not let duplicate barcodes be entered. If something
// is already there in the data flag it and don't generate barcodes till it's
// fixed." His own file breaks the rule, so the collision has to be nameable.

test("findEanCollisions names the two articles that share a code", () => {
  const found = findEanCollisions([
    { id: "a1", ean: "8720847172228", label: "101x19.5x2" },
    { id: "a2", ean: "8720847172266", label: "220x19.5x2" },
    { id: "a3", ean: "8720847172266", label: "220x15x2" },
    { id: "a4", ean: null, label: "no code yet" },
    { id: "a5", ean: "", label: "nor this one" },
  ]);
  assert.equal(found.length, 1, "one collision, and a blank code is not a claim");
  assert.equal(found[0].ean, "8720847172266");
  assert.deepEqual(found[0].rows.map((r) => r.id), ["a2", "a3"]);
  assert.equal(
    found[0].message,
    "8720847172266 is on both 220x19.5x2 and 220x15x2. One of them has to give it up before any barcode for this client is generated or printed.",
  );
});

test("findEanCollisions: the apostrophe is the same claim, three rows read as three", () => {
  // The losing row is stored without a code, so a clean file has nothing.
  assert.deepEqual(findEanCollisions([
    { id: "a1", ean: "8720847172228" },
    { id: "a2", ean: "8720847172266" },
  ]), []);
  assert.deepEqual(findEanCollisions([]), []);

  // '8720847172297 and 8720847172297 are one code typed two ways, which is
  // exactly the pair the database's unique index would reject.
  const excel = findEanCollisions([
    { id: "a1", ean: APOSTROPHE, label: "126x25x2" },
    { id: "a2", ean: "8720847172297", label: "126x25x2 again" },
  ]);
  assert.equal(excel.length, 1);
  assert.equal(excel[0].ean, "8720847172297");

  const three = findEanCollisions([
    { id: "a1", ean: "8720847172266", label: "220x19.5x2" },
    { id: "a2", ean: "8720847172266", label: "220x15x2" },
    { id: "a3", ean: "8720847172266", label: "126x25x2" },
  ]);
  assert.equal(three.length, 1);
  assert.equal(three[0].rows.length, 3);
  assert.match(three[0].message, /is on 220x19\.5x2, 220x15x2 and 126x25x2\./);

  // With no label there is still a row to go and look at.
  const bare = findEanCollisions([{ id: "a1", ean: "8720847172266" }, { id: "a2", ean: "8720847172266" }]);
  assert.match(bare[0].message, /both a1 and a2/);

  // Validity is not required. Two rows carrying the same mistyped digits
  // collide in the index just as hard as two carrying the same good ones.
  const wrong = findEanCollisions([{ id: "a1", ean: "8720847172263" }, { id: "a2", ean: "8720847172263" }]);
  assert.equal(wrong.length, 1);
  assert.equal(isValidEan13("8720847172263"), false);
});

// ──────────────── the label on the edge of a 2 cm slab ───────────────────────
// Round four, answer 3: "we have to paste it on a 2cm slab so lower than 2cm
// width. Length can be anything proportional."

test("no magnification in the legal band fits a full-height EAN-13 on a 2 cm edge", () => {
  assert.equal(EAN13_BAR_HEIGHT_MM, 22.85, "the nominal bar height at 1.00");
  assert.equal(EAN13_DIGITS_HEIGHT_MM, 2.75, "and the digits under them");

  // At the BOTTOM of the band, which is the smallest the symbol is specified
  // at: 18.28 mm of bars plus 2.2 mm of digits is 20.48 mm, taller than the
  // slab is thick before a single millimetre of margin is allowed for.
  assert.ok(Math.abs(EAN13_BAR_HEIGHT_MM * EAN13_MAGNIFICATION_MIN - 18.28) < 1e-9);
  assert.ok(Math.abs(EAN13_DIGITS_HEIGHT_MM * EAN13_MAGNIFICATION_MIN - 2.2) < 1e-9);
  assert.ok((EAN13_BAR_HEIGHT_MM + EAN13_DIGITS_HEIGHT_MM) * EAN13_MAGNIFICATION_MIN > 20);

  // So every magnification in the band truncates on a 20 mm edge, and there is
  // no arrangement of the trade that does not. Shrinking the module to buy the
  // height back is not an option that exists.
  for (const m of [0.8, 1, 1.25, 1.5, 2]) {
    assert.ok((EAN13_BAR_HEIGHT_MM + EAN13_DIGITS_HEIGHT_MM) * m > 20, String(m));
    const r = edgeLabelLayout(20, m);
    assert.equal(r.ok, true, String(m));
    assert.equal(r.label?.truncated, true, String(m));
  }
});

test("a 2 cm edge lands on the brief's label: 18.0 tall, 13.4 of bars, about 58 long", () => {
  const r = edgeLabelLayout(20);
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
  const label = r.label!;

  assert.equal(label.magnification, EAN13_LABEL_MAGNIFICATION, "1.5, unchanged — the module is not what gives");
  assert.equal(label.heightMm, 18, "2 mm of clearance on a 20 mm edge");
  assert.equal(label.marginMm, 1);
  assert.equal(label.barHeightMm, 13.4);
  assert.equal(label.digitsHeightMm, 2.6);
  assert.equal(label.moduleMm, 0.495);
  assert.equal(EDGE_LABEL_CLEARANCE_MM, 2);
  assert.equal(EDGE_LABEL_MARGIN_MM, 1);
  assert.equal(EDGE_LABEL_DIGITS_MM, 2.6);

  // The parts add up to the whole, which is the one thing a layout must do.
  assert.equal(label.marginMm * 2 + label.barHeightMm + label.digitsHeightMm, label.heightMm);
  assert.equal(label.heightMm + EDGE_LABEL_CLEARANCE_MM, 20, "and the whole fits the edge");

  // The length is free, so it is whatever the symbol and its quiet zones need.
  assert.equal(label.symbolWidthMm, 55.935);
  assert.ok(Math.abs(label.symbolWidthMm - ean13WidthMm()) < 1e-9);
  assert.equal(label.lengthMm, 57.935, "about 58 mm, as the brief rounds it");
  assert.equal(label.lengthMm, label.symbolWidthMm + 2 * label.marginMm);

  // A truncated symbol, deliberately: 13.4 mm is 59% of the nominal 22.85 and
  // 20.875 mm short of what 1.50 is specified at.
  assert.equal(label.truncated, true);
  assert.equal(label.percentOfNominalHeight, 59);
  assert.equal(label.fullBarHeightMm, 34.275);
  assert.equal(label.truncatedByMm, 20.875);
  assert.equal(label.barHeightMm + label.truncatedByMm, label.fullBarHeightMm);
});

test("the height follows the stone: thicker gets taller bars with nobody choosing it", () => {
  const two = edgeLabelLayout(20).label!;
  const three = edgeLabelLayout(30).label!;
  assert.equal(three.heightMm, 28, "2 mm of clearance again");
  assert.equal(three.barHeightMm, 23.4, "ten more millimetres of stone is ten more of bar");
  assert.ok(three.barHeightMm > two.barHeightMm);
  assert.ok(three.truncatedByMm < two.truncatedByMm, "and less truncation");
  assert.equal(three.truncated, true, "still truncated at 1.5, though: full height wants 34.275");
  assert.equal(three.lengthMm, two.lengthMm, "the length is the symbol's, not the stone's");

  // Percentages are against the NOMINAL 22.85, so a thick edge reads over 100
  // while the symbol is still short of what this magnification specifies.
  assert.equal(three.percentOfNominalHeight, 102);
  assert.ok(three.barHeightMm < three.fullBarHeightMm);

  // Stock thick enough carries the whole symbol and then stops growing: the
  // label is as tall as the symbol rather than as tall as the edge.
  const thick = edgeLabelLayout(60).label!;
  assert.equal(thick.truncated, false);
  assert.equal(thick.truncatedByMm, 0);
  assert.equal(thick.barHeightMm, 34.275);
  assert.equal(thick.heightMm, 38.875);
  assert.ok(thick.heightMm + EDGE_LABEL_CLEARANCE_MM < 60);

  // The changeover is 34.275 mm of bars plus the 6.6 mm the clearance, the two
  // margins and the digits take. Nothing on a slab is anywhere near it, which
  // is the point: on real stone the symbol is always truncated.
  assert.equal(edgeLabelLayout(40.875).label?.truncated, false);
  assert.equal(edgeLabelLayout(40.874).label?.truncated, true);
});

test("under about 6 mm of bars it refuses, rather than printing something that scans as nothing", () => {
  assert.equal(EDGE_LABEL_MIN_BAR_MM, 6);

  // 12 mm of stone leaves 5.4 mm of bars once the clearance, the two margins
  // and the digits are taken off — under the floor, so no label.
  const thin = edgeLabelLayout(12);
  assert.equal(thin.ok, false);
  assert.equal(thin.label, null);
  assert.match(thin.reason ?? "", /5\.4 mm for the bars/);
  assert.match(thin.reason ?? "", /scans as nothing/);
  assert.match(thin.reason ?? "", /crate label/, "and it says where to put the barcode instead");

  // 13 mm clears it by four tenths of a millimetre.
  const just = edgeLabelLayout(13);
  assert.equal(just.ok, true);
  assert.equal(just.label?.barHeightMm, 6.4);
  assert.equal(edgeLabelLayout(12.6).ok, true, "the floor itself is allowed");
  assert.equal(edgeLabelLayout(12.59).ok, false);

  const nothing = edgeLabelLayout(5);
  assert.equal(nothing.ok, false);
  assert.match(nothing.reason ?? "", /nothing at all for the bars/);

  // It refuses, it does not throw: the caller is printing a crate's worth of
  // labels and has to say this one sentence while printing the rest.
  for (const bad of [0, -20, null, undefined, "", "wide", NaN]) {
    const r = edgeLabelLayout(bad);
    assert.equal(r.ok, false, String(bad));
    assert.match(r.reason ?? "", /thickness of the piece in millimetres/, String(bad));
  }
});

test("edgeLabelLayout will not lay out at a magnification the symbol is not specified at", () => {
  for (const outside of [0.79, 2.01, 0, -1]) {
    const r = edgeLabelLayout(20, outside);
    assert.equal(r.ok, false, String(outside));
    assert.equal(r.label, null, String(outside));
    assert.match(r.reason ?? "", /only specified between magnification 0\.8 and 2/, String(outside));
  }
  // The module follows the magnification, which is the point of asking.
  assert.equal(edgeLabelLayout(20, 0.8).label?.moduleMm, 0.264);
  assert.equal(edgeLabelLayout(20, 2).label?.moduleMm, 0.66);
  assert.ok((edgeLabelLayout(20, 2).label?.lengthMm ?? 0) > (edgeLabelLayout(20, 0.8).label?.lengthMm ?? 0));
  // And the bars are the edge's, not the magnification's, in every one of them.
  assert.equal(edgeLabelLayout(20, 0.8).label?.barHeightMm, 13.4);
  assert.equal(edgeLabelLayout(20, 2).label?.barHeightMm, 13.4);
});
