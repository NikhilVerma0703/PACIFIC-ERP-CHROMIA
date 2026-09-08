// The design master's rules (answers 13 and 20), RUN against real names: the
// first-guess shade, the code and name normalisation, the changeover hours,
// the PUT patch, the seed and the case-blind lookup. Import-free module, so
// node --test loads it bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guessShade, parseShade, normaliseDesignCode, normaliseDesignName, cleaningHoursFor, isAbruptJump, shadeOrMedium,
  designCodePatch, seedRows, findDesignRow, SHADES, LIGHT_WORDS, DARK_WORDS,
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
