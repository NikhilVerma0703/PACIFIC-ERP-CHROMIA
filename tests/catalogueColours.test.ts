import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHART_ONLY,
  CATALOGUE_SERIES, CATALOGUE_COLOURS, DEFAULT_FINISH, FINISHES,
  canonicalFinish, splitFinish, normaliseCatalogue,
  catalogueCounts, catalogueDiscrepancies, catalogueProblems,
} from "../src/lib/catalogue/colours.ts";

// The colour chart is master data typed once from a printed sheet, and
// prisma/seed-catalogue.ts writes it to production. Two things can go wrong
// later and neither announces itself: someone edits the list and changes the
// totals, or someone "tidies" a name and turns a colour into a finish (or a
// finish into a colour). These pin both. The seed imports the SAME module, so
// what is asserted here is what reaches the database.

// ---------------------------------------------------------------------------
// The finish rule
// ---------------------------------------------------------------------------

test("a bracketed finish splits off the colour", () => {
  assert.deepEqual(splitFinish("Cappuccino (Leather)"), { colour: "Cappuccino", finish: "Leathered", marked: true });
  assert.deepEqual(splitFinish("Taj Vein (Leather)"), { colour: "Taj Vein", finish: "Leathered", marked: true });
});

test("an EN-DASH separator splits too — it is not a hyphen", () => {
  // "Alabaster Noir – Suede" is written with U+2013. A parser that only knew
  // "-" would keep the whole string as a colour name and the chart would gain
  // a 57th colour that is really a finish of the 56th.
  const endash = splitFinish("Alabaster Noir – Suede");
  assert.deepEqual(endash, { colour: "Alabaster Noir", finish: "Suede", marked: true });
  // The plain hyphen and the em-dash behave the same, so retyping the name on
  // a keyboard without an en-dash does not create a second colour.
  assert.deepEqual(splitFinish("Alabaster Noir - Suede"), endash);
  assert.deepEqual(splitFinish("Alabaster Noir — Suede"), endash);
});

test("CAPPUCCINO DARK IS A COLOUR, NOT A FINISH OF CAPPUCCINO", () => {
  // The single most expensive mistake available in this list: folding this
  // into Cappuccino would merge two genuinely different products' stock.
  // There is no marker, so nothing splits.
  assert.deepEqual(splitFinish("Cappuccino Dark"), { colour: "Cappuccino Dark", finish: DEFAULT_FINISH, marked: false });
  // And it survives as its own colour in the real catalogue, next to
  // Cappuccino, which is the one carrying two finishes.
  const dark = CATALOGUE_COLOURS.find((c) => c.name === "Cappuccino Dark");
  const capp = CATALOGUE_COLOURS.find((c) => c.name === "Cappuccino");
  assert.ok(dark, "Cappuccino Dark must be its own colour");
  assert.deepEqual(dark?.finishes, ["Polished"]);
  assert.deepEqual(capp?.finishes, ["Polished", "Leathered"]);
});

test("a marker with a word that is not a finish leaves the name whole", () => {
  // Both halves of the rule matter. This one has the bracket but not the
  // vocabulary, so it stays a colour name rather than inventing a "Dark"
  // finish.
  assert.deepEqual(splitFinish("Cappuccino (Dark)"), { colour: "Cappuccino (Dark)", finish: DEFAULT_FINISH, marked: false });
  assert.equal(splitFinish("Latte Luxe – Batch 2").colour, "Latte Luxe – Batch 2");
});

test("a slash in a name is part of the name", () => {
  assert.deepEqual(splitFinish("Artemis Grey/Deepwave"), { colour: "Artemis Grey/Deepwave", finish: DEFAULT_FINISH, marked: false });
});

test("a hyphenated colour name is not split — the dash must have spaces", () => {
  assert.equal(splitFinish("Blue-Suede").colour, "Blue-Suede");
  assert.equal(splitFinish("Blue-Suede").marked, false);
});

test("whitespace is not part of a name", () => {
  assert.deepEqual(splitFinish("  Taj   Vein  (Leather) "), { colour: "Taj Vein", finish: "Leathered", marked: true });
});

test("the finish vocabulary is closed, and folds the ERP's other spellings in", () => {
  // polish_qc / FinishedSlab.polishType say "Polish / Suede / Honed /
  // Leathered"; the owner says "Polished" and "Leather". Both spellings must
  // land on one value or the same finish appears twice in a pick-list.
  assert.equal(canonicalFinish("Leathered"), "Leathered");
  assert.equal(canonicalFinish("leather"), "Leathered", "the chart's spelling folds onto the owner's");
  assert.equal(canonicalFinish("POLISH"), "Polished");
  assert.equal(canonicalFinish(" suede "), "Suede");
  // HONED IS MATTE. The trade says one, the owner says the other, and a
  // vocabulary carrying both would count one shelf of stock as two.
  assert.equal(canonicalFinish("Honed"), "Matte");
  assert.equal(canonicalFinish("hone"), "Matte");
  assert.equal(canonicalFinish("matte"), "Matte");
  assert.equal(canonicalFinish("Matt"), "Matte");
  // The four the shop sells, in the owner's words.
  assert.deepEqual([...FINISHES], ["Polished", "Suede", "Matte", "Leathered"]);
  // Not finishes.
  assert.equal(canonicalFinish("Dark"), null);
  assert.equal(canonicalFinish("Deepwave"), null);
  assert.equal(canonicalFinish(""), null);
  assert.equal(canonicalFinish(null), null);
  assert.equal(canonicalFinish(undefined), null);
});

test("a bare finish word on its own is a colour, not a finish with no colour", () => {
  // Stripping it would leave an empty name and an unwritable row.
  assert.deepEqual(splitFinish("Leathered"), { colour: "Leathered", finish: DEFAULT_FINISH, marked: false });
});

// ---------------------------------------------------------------------------
// The counts
// ---------------------------------------------------------------------------

test("THE CHART IS 7 SERIES, 132 LISTED NAMES, 129 COLOURS, 3 SECOND FINISHES", () => {
  // The whole point of this file. If an edit to the list moves any of these,
  // it should be because someone decided to move it.
  //
  // 129 = the 125 designs on pacific-surfaces.com/products/quartz PLUS the 4
  // that are on the printed chart and not on the site (CHART_ONLY). The
  // catalogue is a UNION and never a replacement: either source can have missed
  // something, and a name dropped from here stops being maintained while its
  // sampling stock keeps pointing at the orphaned row.
  const counts = catalogueCounts();
  assert.equal(counts.series, 7, "seven series — the owner says six, see the seed");
  assert.equal(counts.listedNames, 132);
  assert.equal(counts.colours, 129, "132 listed names minus the 3 that are finishes");
  assert.equal(counts.colourFinishes, 132, "one colour+finish row per listed name");
  assert.equal(counts.multiFinishColours, 3);
  // Nothing the site carries and nothing the chart carried may go missing.
  const names = new Set(CATALOGUE_COLOURS.map((c) => c.name));
  for (const n of CHART_ONLY) assert.ok(names.has(n), `${n} was dropped from the chart`);
});

test("the three second finishes are exactly the three the owner named", () => {
  const multi = CATALOGUE_COLOURS.filter((c) => c.finishes.length > 1);
  assert.deepEqual(
    multi.map((c) => `${c.name}: ${c.finishes.join(" + ")}`),
    [
      "Alabaster Noir: Polished + Suede",
      "Cappuccino: Polished + Leathered",
      "Taj Vein: Polished + Leathered",
    ],
  );
  // Each one's base colour is listed in the SAME series as its variant. If a
  // future edit put "X (Leather)" in a series that does not list X, the colour
  // count would move and the assertion above would catch it — this says why.
  for (const c of multi) {
    const series = CATALOGUE_SERIES.find((s) => s.names.includes(c.name));
    assert.equal(series?.name, c.series, `${c.name} must be listed under ${c.series}`);
  }
});

test("every colour belongs to a listed series and carries a known finish", () => {
  const seriesNames = new Set(CATALOGUE_SERIES.map((s) => s.name));
  for (const c of CATALOGUE_COLOURS) {
    assert.ok(seriesNames.has(c.series), `${c.name} points at unknown series ${c.series}`);
    assert.ok(c.name.length > 0, "a colour with no name cannot be a pick-list entry");
    assert.ok(c.finishes.length > 0, `${c.name} has no finish`);
    for (const f of c.finishes) assert.ok(FINISHES.includes(f), `${c.name} has unknown finish ${f}`);
    assert.equal(new Set(c.finishes).size, c.finishes.length, `${c.name} lists a finish twice`);
  }
});

test("colour names are unique across the whole catalogue, not just per series", () => {
  // product_colour.name is globally @unique so fabrication and QC can resolve a
  // colour without knowing its series. A duplicate would fail the seed halfway
  // through, in production.
  const names = CATALOGUE_COLOURS.map((c) => c.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(catalogueProblems(), [], "the seed refuses to run while this is non-empty");
});

test("Arva White is in the catalogue, because fabrication already buys it", () => {
  // PO 10026 orders "Arva White Prefab (2cm)" (lib/fab/poParser.ts). This is
  // the colour that has to resolve when fabrication starts reading this table,
  // and it is why the catalogue is product_* rather than sampling_*.
  const arva = CATALOGUE_COLOURS.find((c) => c.name === "Arva White");
  assert.equal(arva?.series, "Aurora");
});

// ---------------------------------------------------------------------------
// The discrepancies, preserved on purpose
// ---------------------------------------------------------------------------

test("THREE SERIES LIST MORE THAN THEIR HEADER CLAIMS — recorded, not fixed", () => {
  // declaredCount is the number the SITE prints in each collection header. The
  // lists are longer because the chart-only names were added back to them and,
  // for Eclipse, because /products/quartz tags two designs (Artemis Grey,
  // Tiffany) that the Eclipse collection page itself does not list. Nobody has
  // reconciled these against the physical chart, so every name is imported and
  // the mismatch stays data rather than a comment somebody deletes.
  assert.deepEqual(catalogueDiscrepancies(), [
    { series: "Nebula",  declared: 35, listed: 38 },   // +Arya, +Artemis Grey/Deepwave, +1 finish line
    { series: "Kosmic",  declared: 42, listed: 44 },   // +Cappuccino Dark, +1 finish line
    { series: "Eclipse", declared: 28, listed: 32 },   // +Statuario, +Artemis Grey, +Tiffany, +1 finish line
  ]);
  // The four series whose header agrees with their list.
  for (const name of ["Aurora", "Solids", "Luminara", "Celestia"]) {
    const s = CATALOGUE_SERIES.find((x) => x.name === name);
    assert.equal(s?.names.length, s?.declaredCount, `${name} header and list must agree`);
  }
  assert.equal(catalogueCounts().declaredNames, 123, "headers add up to 123, nine short of the 132 listed");
});

test("Solids is one of the seven — the owner's \"6 series\" is the discrepancy", () => {
  assert.ok(CATALOGUE_SERIES.some((s) => s.name === "Solids"));
  assert.deepEqual(
    CATALOGUE_SERIES.map((s) => s.name),
    ["Aurora", "Solids", "Luminara", "Nebula", "Celestia", "Kosmic", "Eclipse"],
  );
});

// ---------------------------------------------------------------------------
// Folding behaviour, on a list this file controls
// ---------------------------------------------------------------------------

test("chart order is preserved, and a colour appears once however many finishes it has", () => {
  const rows = normaliseCatalogue([
    { name: "Test", declaredCount: 3, names: ["Beta", "Beta (Leathered)", "Alpha"] },
  ]);
  assert.deepEqual(rows, [
    { series: "Test", name: "Beta", finishes: ["Polished", "Leathered"] },
    { series: "Test", name: "Alpha", finishes: ["Polished"] },
  ]);
});

test("a finish variant whose base is not listed gets that finish only", () => {
  // Not a default Polished it was never listed in — that would be inventing
  // stock-keeping for a product nobody has said exists.
  const rows = normaliseCatalogue([
    { name: "Test", declaredCount: 1, names: ["Solo (Suede)"] },
  ]);
  assert.deepEqual(rows, [{ series: "Test", name: "Solo", finishes: ["Suede"] }]);
});

test("the same name twice in one series is one colour, not two", () => {
  const rows = normaliseCatalogue([
    { name: "Test", declaredCount: 2, names: ["Echo White", "echo white"] },
  ]);
  assert.equal(rows.length, 1);
});

test("the same colour under two series is reported, because the seed cannot write it", () => {
  const problems = catalogueProblems([
    { name: "One", declaredCount: 1, names: ["Shared"] },
    { name: "Two", declaredCount: 1, names: ["Shared"] },
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Shared.*One.*Two/);
});
