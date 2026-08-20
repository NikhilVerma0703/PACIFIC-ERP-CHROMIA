import test from "node:test";
import assert from "node:assert/strict";

import {
  DESIGN_PRESETS,
  DESIGN_SUGGESTIONS,
  findDesignPreset,
  normaliseDesign,
  presetFieldsFor,
} from "../src/lib/robo/design-presets.ts";

/* ──────────────────────────────────────────────────────────────────────────
   The plant in-charge's "robo designs - pigments & tools" sheet, transcribed
   here verbatim so a change to the presets that does not match it fails.

   Rows are as the sheet has them, in the sheet's own robot numbering. "-" and
   "na" both mean the design does not use that robot for that field, and both
   are written as "" — see presetFieldsFor for why the blanks matter as much
   as the values.

   Sheet robot -> stored machine name (MACHINE_LABEL shows these as Robo1..4):
     robo 1 -> Roycut-1   robo 2 -> Roymix   robo 3 -> Roycut-2   robo 4 -> Roycut-3
   ────────────────────────────────────────────────────────────────────────── */

type Row = [tool: string, liquid: string, powder: string];
const SHEET: ReadonlyArray<{ design: string; robo1: Row; robo2: Row; robo3: Row; robo4: Row }> = [
  {
    design: "calcatta gold",
    robo1: ["BOAT 120, PAINTING TOOL", "CB-GOLD3", ""],
    robo2: ["", "", ""],
    robo3: ["SMALL KNIFE", "CB-GOLD3", ""],
    robo4: ["BOAT 100", "LG5", ""],
  },
  {
    design: "Bellagio gold",
    robo1: ["SOMBRERO-20", "COSTA GOLD 703/140", "DVCT4"],
    robo2: ["", "", ""],
    robo3: ["DISCOTHIN", "COSTA GOLD 703/140", "DVCT4"],
    robo4: ["DISCOTHIN", "COSTA GOLD 703/140", "DVCT4"],
  },
  {
    design: "Bellagio green",
    robo1: ["SOMBRERO-20", "DARK GREY", "LIGHT GREEN"],
    robo2: ["", "", ""],
    robo3: ["DISCOTHIN", "DARK GREY", "DV4"],
    robo4: ["DISCOTHIN", "COSTA BROWN 703", "DVLM"],
  },
  {
    design: "Bellagio blue",
    robo1: ["SOMBRERO-20", "DARK GREY", "DVTQ23"],
    robo2: ["", "", ""],
    robo3: ["DISCOTHIN", "DARK GREY", "P1-TQB, P2-DV4"],
    robo4: ["DISCOTHIN", "COSTA BROWN 703", "DVLM"],
  },
  {
    design: "aureate",
    robo1: ["DISCOFAT", "IKOS WHITE", "DV KHAKHI2"],
    robo2: ["", "", ""],
    robo3: ["DISCOTHIN", "SUPER MILD BROWN", "DV KHAKHI2"],
    robo4: ["DISCOTHIN", "MM-WHITE", ""],
  },
  {
    design: "costa(milan)",
    robo1: ["DISCOFAT", "COSTA BROWN 703", "DVCT3"],
    robo2: ["", "", ""],
    robo3: ["DISCOTHIN", "COSTA BROWN 703", "DVCT3"],
    robo4: ["DISCOTHIN", "MM-WHITE", "DV8"],
  },
  {
    design: "Banyan",
    robo1: ["SOMBRERO-20", "LVBR2", "DVCTLM2"],
    // The one design where Robo2 (RoyMix) carries a liquid of its own.
    robo2: ["", "LVBR2", ""],
    robo3: ["DISCOTHIN", "LVBR2", ""],
    robo4: ["DISCOTHIN", "MM-WHITE", ""],
  },
  {
    design: "roots (Artemis)",
    robo1: ["DISCOTHIN", "COSTA BROWN 703", "DVCT2"],
    robo2: ["", "", ""],
    robo3: ["DISCOTHIN", "COSTA BROWN 703", "DVCT2"],
    robo4: ["DISCOTHIN", "IKOS WHITE", ""],
  },
  {
    design: "alabaster noir( black material)",
    robo1: ["", "", ""],
    robo2: ["", "", ""],
    robo3: ["DISCOTHIN", "IKOS WHITE", ""],
    robo4: ["DISCOTHIN", "IKOS WHITE", ""],
  },
  {
    design: "alabaster (white material)",
    robo1: ["", "", ""],
    robo2: ["", "", ""],
    robo3: ["DISCOTHIN", "DV BLACK", ""],
    robo4: ["DISCOTHIN", "DV BLACK", ""],
  },
  {
    design: "caterina",
    robo1: ["", "", ""],
    robo2: ["", "", ""],
    robo3: ["DISCOTHIN", "DARK GREY", ""],
    robo4: ["DISCOTHIN", "703/140", ""],
  },
];

const MACHINE_OF = { robo1: "Roycut-1", robo2: "Roymix", robo3: "Roycut-2", robo4: "Roycut-3" } as const;
const asFields = ([toolName, liquidName, powderName]: Row) => ({ toolName, liquidName, powderName });

for (const row of SHEET) {
  test(`${row.design} matches the reference sheet on all four robots`, () => {
    const preset = findDesignPreset(row.design);
    assert.ok(preset, `${row.design} must be in DESIGN_PRESETS — the sheet lists it`);
    for (const key of ["robo1", "robo2", "robo3", "robo4"] as const) {
      assert.deepEqual(
        presetFieldsFor(preset, MACHINE_OF[key]),
        asFields(row[key]),
        `${row.design} / ${key} (${MACHINE_OF[key]})`,
      );
    }
  });
}

test("the sheet and the presets hold the same designs, no more and no fewer", () => {
  // An extra preset is as much a defect as a missing one: it would be offered
  // in the dropdown and auto-fill values nobody wrote down.
  assert.equal(DESIGN_PRESETS.length, SHEET.length);
  const fromSheet = new Set(SHEET.map((r) => normaliseDesign(r.design)));
  for (const p of DESIGN_PRESETS) {
    assert.ok(
      fromSheet.has(normaliseDesign(p.design)) || (p.aliases ?? []).some((a) => fromSheet.has(normaliseDesign(a))),
      `${p.design} is in the presets but not on the sheet`,
    );
  }
});

test("no design can leak another design's values onto a machine it does not use", () => {
  /* The bug this replaces. Applying a preset used to fill only what the design
     mentioned, so the machines and the fields it left blank kept the previous
     design's values and the card showed two recipes mixed together.

     ALABASTER uses neither Robo1 nor Robo2, and BANYAN has no powder on Robo3
     where BELLAGIO GOLD has DVCT4 — the two shapes that bit. */
  const alabaster = findDesignPreset("alabaster (white material)");
  assert.deepEqual(presetFieldsFor(alabaster, "Roycut-1"), { toolName: "", liquidName: "", powderName: "" });
  assert.deepEqual(presetFieldsFor(alabaster, "Roymix"), { toolName: "", liquidName: "", powderName: "" });

  assert.equal(presetFieldsFor(findDesignPreset("Banyan"), "Roycut-2").powderName, "");
  assert.equal(presetFieldsFor(findDesignPreset("Bellagio gold"), "Roycut-2").powderName, "DVCT4");
});

test("a machine that is not on the sheet at all reads blank, not undefined", () => {
  // Whatever the Machines master holds, every card gets a definite answer.
  assert.deepEqual(presetFieldsFor(findDesignPreset("Banyan"), "Roycut-9"), { toolName: "", liquidName: "", powderName: "" });
  assert.deepEqual(presetFieldsFor(null, "Roycut-1"), { toolName: "", liquidName: "", powderName: "" });
  assert.deepEqual(presetFieldsFor(undefined, "Roymix"), { toolName: "", liquidName: "", powderName: "" });
});

test("a design the sheet does not list has no preset, and is still allowed", () => {
  // Nothing is filled and nothing is cleared — the operator fills the card by
  // hand, exactly as before presets existed.
  assert.equal(findDesignPreset("SOME NEW DESIGN"), null);
  assert.equal(findDesignPreset(""), null);
  assert.equal(findDesignPreset("   "), null);
});

test("the plant's own spellings all reach the right row", () => {
  const same = (a: string, b: string) => assert.equal(findDesignPreset(a), findDesignPreset(b), `${a} vs ${b}`);
  same("calcatta gold", "CALACATTA GOLD");
  same("calacatta", "CALACATTA GOLD");
  same("costa milan", "COSTA (MILAN)");
  same("milan", "COSTA (MILAN)");
  same("artemis", "ROOTS (ARTEMIS)");
  same("alabaster black", "ALABASTER NOIR (BLACK MATERIAL)");
  same("alabaster", "ALABASTER (WHITE MATERIAL)");
  // and case, spacing and punctuation are not what tells them apart
  same("  bellagio   GOLD ", "BELLAGIO GOLD");
});

test("alabaster black and alabaster white stay two different designs", () => {
  // They differ only by a word and their Robo3/Robo4 liquids are opposites —
  // IKOS WHITE against DV BLACK. An alias collapsing them would put the wrong
  // liquid on the card every time.
  const black = findDesignPreset("alabaster noir");
  const white = findDesignPreset("alabaster white");
  assert.notEqual(black, white);
  assert.equal(presetFieldsFor(black, "Roycut-2").liquidName, "IKOS WHITE");
  assert.equal(presetFieldsFor(white, "Roycut-2").liquidName, "DV BLACK");
});

test("every design offered in the dropdown resolves to its own preset", () => {
  assert.equal(DESIGN_SUGGESTIONS.length, DESIGN_PRESETS.length);
  for (const name of DESIGN_SUGGESTIONS) {
    assert.equal(findDesignPreset(name)?.design, name);
  }
});

test("no two presets answer to the same name", () => {
  // An alias that collides with another design's name would make the first one
  // listed win, silently, for every slab logged under it.
  const seen = new Map<string, string>();
  for (const p of DESIGN_PRESETS) {
    for (const name of [p.design, ...(p.aliases ?? [])]) {
      const key = normaliseDesign(name);
      const prev = seen.get(key);
      assert.equal(prev, undefined, `"${name}" is claimed by both ${prev} and ${p.design}`);
      seen.set(key, p.design);
    }
  }
});
