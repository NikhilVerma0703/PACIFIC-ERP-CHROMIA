// The design master's rules (answers 13 and 20; round two, answers 14 and 15),
// RUN against real names and real colours: the first-guess shade, the code and
// name normalisation, the L*a*b* to sRGB conversion both ways, the lightness
// bands, the changeover hours, the PUT patch, the seed and the case-blind
// lookup. Import-free module, so node --test loads it bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guessShade, parseShade, normaliseDesignCode, normaliseDesignName, cleaningHoursFor, isAbruptJump, shadeOrMedium,
  designCodePatch, seedRows, findDesignRow, SHADES, LIGHT_WORDS, DARK_WORDS,
  // round two, answers 14 and 15
  normaliseHex, labToRgb, labToHex, hexToLab, parseLabValue, labLOf, shadeOf,
  lightnessBand, lightnessThresholds, colourLabel, LAB_RANGE, DARK_MAX_L, LIGHT_MIN_L,
} from "../src/lib/commercial/design-rules.ts";

test("guessShade: the owner's words, case-blind, as substrings of the name", () => {
  assert.equal(guessShade("Carrara Royale"), "LIGHT");
  assert.equal(guessShade("CALACATTA GOLD"), "LIGHT");
  assert.equal(guessShade("Bianco Venato"), "LIGHT");
  assert.equal(guessShade("Statuario Extra"), "LIGHT");
  assert.equal(guessShade("Ivory Cream"), "LIGHT");
  assert.equal(guessShade("Midnight Black"), "DARK");
  assert.equal(guessShade("Nero Marquina"), "DARK");
  assert.equal(guessShade("Charcoal Grey"), "DARK");
  assert.equal(guessShade("Graphite"), "DARK");
  assert.equal(guessShade("Coffee Brown"), "DARK");
  assert.equal(guessShade("Gray Mist"), "DARK", "the American spelling counts too");
  assert.equal(guessShade("Greystone"), "DARK", "matched inside a word — the yard writes names that way");
  assert.equal(guessShade("Cappuccino"), "MEDIUM");
  assert.equal(guessShade("Arva Trial"), "MEDIUM");
  // a name that says both says nothing about which end dominates
  assert.equal(guessShade("Black & White"), "MEDIUM");
  assert.equal(guessShade("Dark Carrara"), "MEDIUM");
  assert.equal(guessShade(""), "MEDIUM", "blank is a guess of the middle, never null");
  assert.equal(guessShade(null), "MEDIUM");
  assert.equal(guessShade(42), "MEDIUM");
  for (const w of [...LIGHT_WORDS]) assert.equal(guessShade(w.toUpperCase()), "LIGHT", w);
  for (const w of [...DARK_WORDS]) assert.equal(guessShade(` ${w} `), "DARK", w);
});

test("parseShade / shadeOrMedium: the three values and nothing else", () => {
  assert.deepEqual([...SHADES], ["LIGHT", "MEDIUM", "DARK"]);
  assert.equal(parseShade("light"), "LIGHT");
  assert.equal(parseShade(" Dark "), "DARK");
  assert.equal(parseShade("MEDIUM"), "MEDIUM");
  assert.equal(parseShade("bright"), null);
  assert.equal(parseShade(""), null);
  assert.equal(parseShade(null), null);
  assert.equal(parseShade(undefined), null);
  assert.equal(shadeOrMedium(null), "MEDIUM", "an unclassified design is neither end of the palette");
  assert.equal(shadeOrMedium("weird"), "MEDIUM");
  assert.equal(shadeOrMedium("dark"), "DARK");
});

test("normaliseDesignCode / normaliseDesignName: trim, upper the code, null for blank", () => {
  assert.equal(normaliseDesignCode(" pes-01 "), "PES-01");
  assert.equal(normaliseDesignCode("PES-01"), "PES-01");
  assert.equal(normaliseDesignCode(""), null);
  assert.equal(normaliseDesignCode("   "), null);
  assert.equal(normaliseDesignCode(null), null);
  assert.equal(normaliseDesignCode(undefined), null);
  assert.equal(normaliseDesignCode(7), "7");
  assert.equal(normaliseDesignName("  Carrara Royale "), "Carrara Royale", "the name keeps its case — it is the primary key as stock spells it");
  assert.equal(normaliseDesignName(""), null);
  assert.equal(normaliseDesignName(null), null);
});

const planning = { cleaningHoursDefault: 3, cleaningHoursAbrupt: 6 };
// The settings the owner set on 2026-09-08 (round two, answer 14).
const measured = { cleaningHoursDefault: 3, cleaningHoursAbrupt: 6, darkMaxL: 30, lightMinL: 75 };

test("cleaningHoursFor: 6 on DARK → LIGHT, 3 for every other changeover, 3 with no row before", () => {
  assert.equal(cleaningHoursFor("DARK", "LIGHT", planning), 6);
  assert.equal(cleaningHoursFor("LIGHT", "DARK", planning), 3, "light to dark is the slow direction the owner asked for");
  assert.equal(cleaningHoursFor("DARK", "MEDIUM", planning), 3);
  assert.equal(cleaningHoursFor("MEDIUM", "LIGHT", planning), 3);
  assert.equal(cleaningHoursFor("LIGHT", "LIGHT", planning), 3);
  assert.equal(cleaningHoursFor("DARK", "DARK", planning), 3);
  assert.equal(cleaningHoursFor(null, "LIGHT", planning), 3, "first in the queue: the ordinary clean, never the abrupt one");
  assert.equal(cleaningHoursFor(undefined, "LIGHT", planning), 3);
  // an unknown shade counts as MEDIUM on either side
  assert.equal(cleaningHoursFor("DARK", null, planning), 3);
  assert.equal(cleaningHoursFor("DARK", "bogus", planning), 3);
  assert.equal(cleaningHoursFor("bogus", "LIGHT", planning), 3);
  // settings win, and a broken setting falls back to the owner's figures
  assert.equal(cleaningHoursFor("DARK", "LIGHT", { cleaningHoursDefault: 2, cleaningHoursAbrupt: 8 }), 8);
  assert.equal(cleaningHoursFor("LIGHT", "LIGHT", { cleaningHoursDefault: 2, cleaningHoursAbrupt: 8 }), 2);
  assert.equal(cleaningHoursFor("DARK", "LIGHT", { cleaningHoursDefault: 0, cleaningHoursAbrupt: -1 }), 6, "zero hours of cleaning is not a setting");
  assert.equal(cleaningHoursFor("DARK", "LIGHT"), 6);
  assert.equal(cleaningHoursFor("LIGHT", "LIGHT", null), 3);
  assert.equal(isAbruptJump("DARK", "LIGHT"), true);
  assert.equal(isAbruptJump("LIGHT", "DARK"), false);
  assert.equal(isAbruptJump(null, "LIGHT"), false);
});

test("designCodePatch: only the keys named; a bad shade is refused, not nulled", () => {
  assert.deepEqual(designCodePatch({ code: " pes-01 " }), { ok: true, patch: { code: "PES-01" } });
  assert.deepEqual(designCodePatch({ code: "" }), { ok: true, patch: { code: null } }, "clearing the code is allowed");
  assert.deepEqual(designCodePatch({ shade: "dark", shadeConfirmed: true }), { ok: true, patch: { shade: "DARK", shadeConfirmed: true } });
  assert.deepEqual(designCodePatch({ shade: null }), { ok: true, patch: { shade: null } });
  assert.deepEqual(designCodePatch({ shade: "" }), { ok: true, patch: { shade: null } });
  assert.deepEqual(designCodePatch({ shadeConfirmed: "true" }), { ok: true, patch: { shadeConfirmed: true } });
  assert.deepEqual(designCodePatch({ shadeConfirmed: "yes" }), { ok: true, patch: { shadeConfirmed: false } }, "only a real true confirms");
  assert.deepEqual(designCodePatch({ notes: "  owner's code list, Sept  " }), { ok: true, patch: { notes: "owner's code list, Sept" } });
  assert.deepEqual(designCodePatch({ notes: "" }), { ok: true, patch: { notes: null } });
  const bad = designCodePatch({ shade: "bright" });
  assert.equal(bad.ok, false);
  assert.match((bad as { reason: string }).reason, /LIGHT, MEDIUM, DARK/);
  assert.equal(designCodePatch({}).ok, false, "an empty body changes nothing and says so");
  assert.equal(designCodePatch({ design: "x" }).ok, false, "the design is the key, not a field");
});

test("seedRows: one row per stock design not already in the master, guessed and unconfirmed, case-blind", () => {
  const rows = seedRows(
    ["Carrara Royale", "Cappuccino "],
    ["CARRARA ROYALE", "Midnight Black", "Cappuccino", "Midnight Black", "  ", null, "Arva Trial", "midnight black"],
  );
  assert.deepEqual(rows, [
    { design: "Midnight Black", shade: "DARK", shadeConfirmed: false },
    { design: "Arva Trial", shade: "MEDIUM", shadeConfirmed: false },
  ]);
  assert.deepEqual(seedRows([], []), []);
  assert.deepEqual(seedRows([], ["Bianco"]), [{ design: "Bianco", shade: "LIGHT", shadeConfirmed: false }]);
  assert.deepEqual(seedRows(["bianco"], ["Bianco"]), [], "the master's spelling and stock's are one design");
});

test("findDesignRow: the master row for a request's design, trimmed and case-blind", () => {
  const master = [{ design: "Carrara Royale", shade: "LIGHT" }, { design: "Midnight Black", shade: "DARK" }];
  assert.equal(findDesignRow(master, "carrara royale")?.shade, "LIGHT");
  assert.equal(findDesignRow(master, "  MIDNIGHT BLACK ")?.shade, "DARK");
  assert.equal(findDesignRow(master, "Cappuccino"), null, "no row → null, and the queue treats null as MEDIUM");
  assert.equal(findDesignRow(master, ""), null);
  assert.equal(findDesignRow(master, null), null);
});

// ───────────── the colour (round two, answers 14 and 15) ─────────────

test("normaliseHex: three digits or six, with or without the hash, always #RRGGBB upper case", () => {
  assert.equal(normaliseHex("#f2efe9"), "#F2EFE9");
  assert.equal(normaliseHex("f2efe9"), "#F2EFE9");
  assert.equal(normaliseHex("  #ABC "), "#AABBCC", "three digits expand, each doubled");
  assert.equal(normaliseHex("#FFF"), "#FFFFFF");
  assert.equal(normaliseHex("#ff00ff"), "#FF00FF");
  assert.equal(normaliseHex("#12345"), null, "five digits is not a hex");
  assert.equal(normaliseHex("#GGHHII"), null);
  assert.equal(normaliseHex("red"), null);
  assert.equal(normaliseHex(""), null);
  assert.equal(normaliseHex(null), null);
  assert.equal(normaliseHex(undefined), null);
});

// The three the owner can check by eye, and the ones the standard pins.
test("labToHex: D65 L*a*b* to sRGB against known values", () => {
  assert.equal(labToHex(100, 0, 0), "#FFFFFF", "L* 100 with no chroma is white");
  assert.equal(labToHex(0, 0, 0), "#000000", "L* 0 is black");
  assert.equal(labToHex(53.24, 80.09, 67.20), "#FF0000", "sRGB red");
  assert.equal(labToHex(87.73, -86.18, 83.18), "#00FF00", "sRGB green");
  assert.equal(labToHex(32.30, 79.19, -107.86), "#0000FF", "sRGB blue");
  assert.equal(labToHex(53.59, 0, 0), "#808080", "mid grey");
  assert.deepEqual(labToRgb(100, 0, 0), { r: 255, g: 255, b: 255 });
  assert.deepEqual(labToRgb(0, 0, 0), { r: 0, g: 0, b: 0 });
  // out of gamut clamps to the nearest colour the screen has, rather than
  // wrapping round to a nonsense byte
  const wild = labToRgb(100, 120, 120);
  assert.equal(wild.r, 255);
  assert.ok(wild.g >= 0 && wild.g <= 255 && wild.b >= 0 && wild.b <= 255);
  assert.equal(labToHex(-50, 0, 0), "#000000", "below black is still black");
  assert.equal(labToHex(null, undefined, "x"), "#000000", "no reading reads as black, never NaN");
});

test("hexToLab: a typed hex back to a reading, so the sequencing still has an L*", () => {
  assert.deepEqual(hexToLab("#FFFFFF"), { L: 100, a: 0, b: 0 });
  assert.deepEqual(hexToLab("#000"), { L: 0, a: 0, b: 0 });
  const red = hexToLab("#FF0000");
  assert.equal(red?.L, 53.24);
  assert.equal(red?.a, 80.09);
  assert.equal(red?.b, 67.2);
  assert.equal(hexToLab("not a hex"), null);
  assert.equal(hexToLab(null), null);
  // round trip: a hex read into a reading and derived back is the same hex
  for (const hex of ["#F2EFE9", "#3C6E71", "#1B1B1B", "#C0A98E", "#0A5FA8"]) {
    const lab = hexToLab(hex);
    assert.equal(labToHex(lab?.L, lab?.a, lab?.b), hex, hex);
  }
});

test("parseLabValue: each axis inside its range, blank clears, nonsense is refused", () => {
  assert.deepEqual(parseLabValue("labL", 53.239), { ok: true, value: 53.24 });
  assert.deepEqual(parseLabValue("labL", "12"), { ok: true, value: 12 });
  assert.deepEqual(parseLabValue("labL", ""), { ok: true, value: null });
  assert.deepEqual(parseLabValue("labL", null), { ok: true, value: null });
  assert.deepEqual(parseLabValue("labA", -128), { ok: true, value: -128 });
  assert.deepEqual(parseLabValue("labB", 127), { ok: true, value: 127 });
  assert.equal(parseLabValue("labL", 101).ok, false);
  assert.equal(parseLabValue("labL", -1).ok, false);
  assert.equal(parseLabValue("labA", -129).ok, false);
  assert.equal(parseLabValue("labB", 128).ok, false);
  assert.equal(parseLabValue("labL", "grey").ok, false);
  assert.match((parseLabValue("labL", 200) as { reason: string }).reason, /between 0 and 100/);
  assert.deepEqual([...LAB_RANGE.L], [0, 100]);
  assert.deepEqual([...LAB_RANGE.a], [-128, 127]);
});

test("labLOf / shadeOf: a reading or a label, from a row or a bare word", () => {
  assert.equal(labLOf({ labL: 12 }), 12);
  assert.equal(labLOf({ labL: "12.5" }), 12.5, "a Decimal or a form string is still a reading");
  assert.equal(labLOf({ labL: null }), null);
  assert.equal(labLOf({ labL: "" }), null, "blank is no reading, never a black zero");
  assert.equal(labLOf({ labL: 101 }), null, "outside the axis is no reading");
  assert.equal(labLOf({}), null);
  assert.equal(labLOf("DARK"), null, "a shade word carries no reading");
  assert.equal(labLOf(null), null);
  assert.equal(shadeOf("dark"), "DARK");
  assert.equal(shadeOf({ shade: "light" }), "LIGHT");
  assert.equal(shadeOf({ shade: "bogus" }), null);
  assert.equal(shadeOf({}), null);
});

test("lightnessThresholds: the settings, or 30 / 75 when they are missing or crossed", () => {
  assert.deepEqual(lightnessThresholds(measured), { dark: 30, light: 75 });
  assert.deepEqual(lightnessThresholds({ darkMaxL: 20, lightMinL: 80 }), { dark: 20, light: 80 });
  assert.deepEqual(lightnessThresholds(null), { dark: DARK_MAX_L, light: LIGHT_MIN_L });
  assert.deepEqual(lightnessThresholds({}), { dark: 30, light: 75 });
  assert.deepEqual(lightnessThresholds({ darkMaxL: 80, lightMinL: 20 }), { dark: 30, light: 75 }, "crossed thresholds would make every design both");
  assert.deepEqual(lightnessThresholds({ darkMaxL: 50, lightMinL: 50 }), { dark: 30, light: 75 });
});

test("lightnessBand: the measured L* decides; the label stands in; neither is MEDIUM", () => {
  assert.equal(lightnessBand({ labL: 12 }, measured), "DARK", "Alabaster Noir");
  assert.equal(lightnessBand({ labL: 92 }, measured), "LIGHT", "super white");
  assert.equal(lightnessBand({ labL: 30 }, measured), "DARK", "at the threshold is dark");
  assert.equal(lightnessBand({ labL: 75 }, measured), "LIGHT", "at the threshold is light");
  assert.equal(lightnessBand({ labL: 50 }, measured), "MEDIUM");
  assert.equal(lightnessBand({ labL: 31 }, measured), "MEDIUM", "one step above the dark ceiling is not dark");
  // the reading beats a label that disagrees with it — the label was a guess
  assert.equal(lightnessBand({ shade: "LIGHT", labL: 12 }, measured), "DARK");
  assert.equal(lightnessBand({ shade: "DARK" }, measured), "DARK", "no reading: the label stands in");
  assert.equal(lightnessBand({}, measured), "MEDIUM", "neither: MEDIUM, and no claim is made");
  assert.equal(lightnessBand(null, measured), "MEDIUM");
  assert.equal(lightnessBand("LIGHT", measured), "LIGHT", "a bare shade word still answers");
  // the thresholds are the settings', not a constant
  assert.equal(lightnessBand({ labL: 40 }, { darkMaxL: 45, lightMinL: 90 }), "DARK");
});

test("answer 14: abrupt is a distance — Alabaster Noir L* 12 to Super White L* 92", () => {
  const noir = { design: "Alabaster Noir", labL: 12, shade: "MEDIUM" };
  const white = { design: "Super White", labL: 92, shade: "MEDIUM" };
  assert.equal(isAbruptJump(noir, white, measured), true, "the readings say dark then light, whatever the labels say");
  assert.equal(cleaningHoursFor(noir, white, measured), 6);
  assert.equal(cleaningHoursFor(white, noir, measured), 3, "light to dark is still the slow direction");
  assert.equal(cleaningHoursFor(noir, { design: "Cappuccino", labL: 55 }, measured), 3);
  assert.equal(cleaningHoursFor({ design: "Grey", labL: 31 }, white, measured), 3, "one step above the dark ceiling is not an abrupt jump");
  // a design with no reading falls back to its label, on either side
  assert.equal(cleaningHoursFor({ design: "Midnight Black", shade: "DARK" }, white, measured), 6);
  assert.equal(cleaningHoursFor(noir, { design: "Carrara Royale", shade: "LIGHT" }, measured), 6);
  // a design with neither counts as MEDIUM: no claim, no abrupt jump
  assert.equal(cleaningHoursFor(noir, { design: "Unknown" }, measured), 3);
  assert.equal(cleaningHoursFor({ design: "Unknown" }, white, measured), 3);
  // and the thresholds are the settings': narrow them and the same pair is calm
  assert.equal(cleaningHoursFor(noir, white, { ...measured, darkMaxL: 5 }), 3);
  assert.equal(cleaningHoursFor(noir, white, { ...measured, lightMinL: 95 }), 3);
  // no row before is still the ordinary clean, whatever this row is
  assert.equal(cleaningHoursFor(null, white, measured), 3);
});

test("colourLabel: the reading where there is one, the label where there is not", () => {
  assert.equal(colourLabel("Alabaster Noir", { labL: 12 }), "Alabaster Noir L* 12");
  assert.equal(colourLabel("Super White", { labL: 92.4 }), "Super White L* 92.4");
  assert.equal(colourLabel("Super White", { labL: 92.04 }), "Super White L* 92", "one decimal is enough to explain a changeover");
  assert.equal(colourLabel("Midnight Black", { shade: "DARK" }), "Midnight Black (dark)");
  assert.equal(colourLabel("Cappuccino", null), "Cappuccino");
  assert.equal(colourLabel("Cappuccino", {}), "Cappuccino");
  assert.equal(colourLabel(null, { design: "From the row", labL: 12 }), "From the row L* 12");
});

test("designCodePatch: the colour fields, validated, with the typed hex back-filling the reading", () => {
  assert.deepEqual(designCodePatch({ colourName: "  Alabaster Noir " }), { ok: true, patch: { colourName: "Alabaster Noir" } });
  assert.deepEqual(designCodePatch({ colourName: "" }), { ok: true, patch: { colourName: null } });
  // A whole reading and no hex derives the swatch (the mirror of the back-fill,
  // tested on its own below).
  assert.deepEqual(designCodePatch({ labL: "12", labA: 0.5, labB: -1.25 }),
    { ok: true, patch: { labL: 12, labA: 0.5, labB: -1.25, hex: labToHex(12, 0.5, -1.25) } });
  assert.deepEqual(designCodePatch({ labL: null }), { ok: true, patch: { labL: null } });
  assert.equal(designCodePatch({ labL: 120 }).ok, false);
  assert.equal(designCodePatch({ labA: -200 }).ok, false);
  assert.match((designCodePatch({ hex: "nope" }) as { reason: string }).reason, /#F2EFE9/);
  assert.deepEqual(designCodePatch({ hex: "#fff", labL: 100, labA: 0, labB: 0 }),
    { ok: true, patch: { hex: "#FFFFFF", labL: 100, labA: 0, labB: 0 } }, "a dialog sending all five is taken as sent");
  // answer 15: a hex typed on its own still leaves the queue a number to read
  assert.deepEqual(designCodePatch({ hex: "#FF0000" }), { ok: true, patch: { hex: "#FF0000", labL: 53.24, labA: 80.09, labB: 67.2 } });
  // clearing the hex does not invent a reading for null
  assert.deepEqual(designCodePatch({ hex: "" }), { ok: true, patch: { hex: null } });
  assert.deepEqual(designCodePatch({ hex: null }), { ok: true, patch: { hex: null } });
  // the colour and the code travel independently: one save cannot clear the other
  assert.deepEqual(designCodePatch({ code: "PES-01" }), { ok: true, patch: { code: "PES-01" } });
});

test("designCodePatch: a reading sent alone derives the swatch — the mirror of the back-fill (answer 15)", () => {
  // The whole reading, no hex: the swatch follows the numbers. Without this a
  // re-read left the PREVIOUS colour's hex on the row, and a typed hex is what
  // decides, so the stale swatch would have gone on deciding.
  const red = designCodePatch({ labL: 53.24, labA: 80.09, labB: 67.2 });
  assert.deepEqual(red, { ok: true, patch: { labL: 53.24, labA: 80.09, labB: 67.2, hex: labToHex(53.24, 80.09, 67.2) } });
  assert.equal((red as { patch: { hex: string } }).patch.hex, "#FF0000", "the reading round-trips to the hex it came from");
  assert.deepEqual(designCodePatch({ labL: 100, labA: 0, labB: 0 }),
    { ok: true, patch: { labL: 100, labA: 0, labB: 0, hex: "#FFFFFF" } });

  // Two axes and a missing one derive nothing — half a reading is not a colour.
  assert.deepEqual(designCodePatch({ labL: 50 }), { ok: true, patch: { labL: 50 } });
  assert.deepEqual(designCodePatch({ labL: 50, labA: 1 }), { ok: true, patch: { labL: 50, labA: 1 } });
  // Clearing the reading clears it; it does not invent a hex for three nulls.
  assert.deepEqual(designCodePatch({ labL: null, labA: null, labB: null }),
    { ok: true, patch: { labL: null, labA: null, labB: null } });
  // A body that names the hex has said what it wants: an explicit clear stays
  // cleared even beside a full reading, and a typed hex is not overwritten.
  assert.deepEqual(designCodePatch({ hex: "", labL: 50, labA: 0, labB: 0 }),
    { ok: true, patch: { hex: null, labL: 50, labA: 0, labB: 0 } });
  assert.deepEqual(designCodePatch({ hex: "#123456", labL: 50, labA: 0, labB: 0 }),
    { ok: true, patch: { hex: "#123456", labL: 50, labA: 0, labB: 0 } });
});

test("designCodePatch: a hex box holding something that is not a hex is refused, whatever else the body carries", () => {
  // The colour dialog runs this very call with the RAW box (answer 15), so a
  // mistyped hex disables Save with this wording instead of quietly saving the
  // hex derived from the reading — which is not what the box was showing.
  const bad = designCodePatch({ colourName: "Alabaster Noir", hex: "F2EFE", labL: 92.1, labA: 0.4, labB: 3.2 });
  assert.equal(bad.ok, false);
  assert.match((bad as { reason: string }).reason, /#F2EFE9/);
  assert.equal(designCodePatch({ hex: "#12345" }).ok, false, "five digits is neither a #RGB nor a #RRGGBB");
  assert.equal(designCodePatch({ hex: "rebeccapurple" }).ok, false, "a CSS colour name is not a hex");
});

test("the seed leaves the colour empty (answer 15): it is read off a sample, never guessed", () => {
  const rows = seedRows([], ["Alabaster Noir", "Super White"]);
  assert.deepEqual(rows.map((r) => Object.keys(r).sort()), [
    ["design", "shade", "shadeConfirmed"],
    ["design", "shade", "shadeConfirmed"],
  ], "no colourName, no hex, no L*a*b* — a guessed reading would look measured");
  assert.equal(rows[0].shadeConfirmed, false);
  assert.equal(rows[1].shade, "LIGHT", "the label is still guessed from the name");
});
