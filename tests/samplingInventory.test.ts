import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterInventory, groupInventory, matchesSearch, rowSearchText,
  sizeLabelOf, sizeSearchText, summariseInventory, type InventoryRow,
} from "../src/lib/sampling/inventory.ts";
import { sampleSizeKey, sampleSizeLabel } from "../src/lib/sampling/size.ts";

// The inventory screen's own decisions, and only those: the pure size rules are
// already covered by samplingSize.test.ts and the lifecycle by
// samplingLifecycle.test.ts. What is new here is everything that exists because
// MOST OF THE CATALOGUE IS EMPTY — 56 colours, 59 colour+finish rows, and a
// handful of shelves with anything on them:
//
//   * an empty shelf is not stock, and is hidden by default;
//   * a colour nobody has ever cut is a different fact from an empty shelf;
//   * "no results" and "none left" must not render as the same sentence;
//   * a search is one question, not one question per word.

const row = (over: Partial<InventoryRow> = {}): InventoryRow => ({
  stockId: "st1",
  colourFinishId: "cf1",
  seriesName: "Kosmic",
  seriesPosition: 1,
  colourName: "Cappuccino",
  colourPosition: 3,
  finish: "Polished",
  sizeId: "sz1",
  lengthIn: 6,
  widthIn: 4,
  thicknessMm: 20,
  quantity: 5,
  ...over,
});

// ---------------------------------------------------------------------------
// THE SIZE READS THE SAME EVERYWHERE, AND IS SEARCHABLE THE WAY PEOPLE TYPE
// ---------------------------------------------------------------------------

test("A SIZE LABEL HERE IS THE SAME STRING size.ts WRITES", () => {
  // sizeLabelOf duplicates sampleSizeLabel's text, because both files must stay
  // import-free (node --test resolves ESM strictly). That is only safe while
  // something holds the two together — this is that something. If one is
  // changed and the other is not, this fails.
  for (const s of [
    { lengthIn: 6, widthIn: 4, thicknessMm: 20 },
    { lengthIn: 4, widthIn: 4, thicknessMm: 30 },
    { lengthIn: 12.5, widthIn: 3.25, thicknessMm: 12 },
  ]) {
    assert.equal(sizeLabelOf(s), sampleSizeLabel(s), "the two labels have drifted apart");
  }
});

test("a row with no size at all has no label to show", () => {
  // A colour+finish nobody has ever cut. "null × null in" would be worse than
  // a dash.
  assert.equal(sizeLabelOf({ lengthIn: null, widthIn: null, thicknessMm: null }), "—");
  assert.equal(sizeSearchText({ lengthIn: null, widthIn: null, thicknessMm: null }), "");
});

test("A SIZE IS FOUND BY EVERY SPELLING SOMEBODY WOULD TYPE", () => {
  const hay = sizeSearchText({ lengthIn: 6, widthIn: 4, thicknessMm: 20 });
  // Nobody types "6 × 4 in · 20 mm" into a search box.
  for (const typed of ["6x4x20", "6x4", "20mm", "6 × 4 in"]) {
    assert.ok(hay.includes(typed.toLowerCase()), `"${typed}" should find this size`);
  }
  // And the key size.ts uses as the identity of a size is one of them, so a
  // person reading a log line can paste it straight into the box.
  assert.ok(hay.includes(sampleSizeKey({ lengthIn: 6, widthIn: 4, thicknessMm: 20 })));
});

test("4x6 FINDS THE 6x4 SHELF — THEY ARE ONE SIZE", () => {
  // size.ts folds them onto one row by storing the longer edge as the length. A
  // search that did not fold them the same way would tell somebody holding a
  // 4x6 piece that there are none, while 12 sat on the shelf.
  assert.ok(matchesSearch(row(), "4x6"));
  assert.ok(matchesSearch(row(), "6x4"));
});

// ---------------------------------------------------------------------------
// SEARCH IS ONE QUESTION
// ---------------------------------------------------------------------------

test("EVERY TERM MUST MATCH, NOT ANY OF THEM", () => {
  const r = row();                        // Kosmic / Cappuccino / Polished / 6x4x20
  assert.ok(matchesSearch(r, "cappuccino 6x4"), "both terms are true of this shelf");
  assert.ok(!matchesSearch(r, "cappuccino 8x8"), "an any-term match would return this");
  assert.ok(!matchesSearch(r, "nebula cappuccino"));
});

test("search ignores case, extra spaces and field order", () => {
  const r = row();
  for (const q of ["CAPPUCCINO", "  polished   kosmic  ", "20mm cappuccino", "kosmic"]) {
    assert.ok(matchesSearch(r, q), `"${q}" should match`);
  }
});

test("an empty box is not a filter", () => {
  assert.ok(matchesSearch(row(), ""));
  assert.ok(matchesSearch(row(), "   "));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.ok(matchesSearch(row(), undefined as any));
});

test("the haystack carries the series, the colour, the finish and the size", () => {
  const hay = rowSearchText(row());
  for (const part of ["kosmic", "cappuccino", "polished", "6x4x20"]) {
    assert.ok(hay.includes(part), `${part} must be searchable`);
  }
});

// ---------------------------------------------------------------------------
// AN EMPTY SHELF IS NOT STOCK
// ---------------------------------------------------------------------------

test("A ZERO SHELF IS HIDDEN BY DEFAULT AND REACHABLE ON REQUEST", () => {
  // sampling_stock rows are not deleted when they empty — the quantity moves,
  // the row does not — so the shelf accumulates zeroes, and "what is in stock"
  // does not mean "every row that has ever existed".
  const rows = [row({ quantity: 4 }), row({ stockId: "st2", sizeId: "sz2", quantity: 0 })];
  assert.equal(filterInventory(rows).length, 1);
  assert.equal(filterInventory(rows, { includeEmpty: true }).length, 2);
});

test("a negative quantity is not treated as stock either", () => {
  // It should never happen — checkRelease exists to stop it — but if a row ever
  // went negative, listing it as "in stock" would be the count lying twice.
  assert.equal(filterInventory([row({ quantity: -2 })]).length, 0);
});

test("the search applies whether or not empties are shown", () => {
  const rows = [
    row({ colourName: "Cappuccino", quantity: 0 }),
    row({ stockId: "st2", colourFinishId: "cf2", colourName: "Arva White", quantity: 3 }),
  ];
  assert.deepEqual(filterInventory(rows, { search: "arva" }).map(r => r.colourName), ["Arva White"]);
  assert.deepEqual(
    filterInventory(rows, { search: "cappuccino", includeEmpty: true }).map(r => r.colourName),
    ["Cappuccino"],
  );
});

// ---------------------------------------------------------------------------
// "NO RESULTS" AND "NONE LEFT" ARE DIFFERENT SENTENCES
// ---------------------------------------------------------------------------

test("THE DEFAULT SAYS HOW MUCH IT IS HIDING FROM THIS SEARCH", () => {
  // The whole reason the route sends the empty rows at all. A search for a
  // colour that is out of stock must be answerable with "none left" rather than
  // with the silence that reads as "no such colour".
  const rows = [
    row({ colourName: "Cappuccino", quantity: 0 }),
    row({ stockId: "st2", sizeId: "sz2", colourName: "Cappuccino", quantity: 0 }),
    row({ stockId: "st3", colourFinishId: "cf2", colourName: "Arva White", quantity: 7 }),
  ];
  const s = summariseInventory(rows, { search: "cappuccino" });
  assert.equal(s.shelves, 0);
  assert.equal(s.pieces, 0);
  assert.equal(s.hiddenEmpty, 2, "two empty Cappuccino shelves matched and were hidden");
});

test("nothing is 'hidden' once everything is shown", () => {
  const rows = [row({ quantity: 0 })];
  assert.equal(summariseInventory(rows, { includeEmpty: true }).hiddenEmpty, 0);
});

test("a search that matches nothing at all hides nothing", () => {
  // Distinguishable from the case above by hiddenEmpty being 0: the screen then
  // says "no colour, finish or size matches" instead of offering a switch that
  // would reveal the same emptiness.
  const s = summariseInventory([row({ quantity: 4 })], { search: "artemis" });
  assert.equal(s.shelves, 0);
  assert.equal(s.hiddenEmpty, 0);
});

test("the summary counts pieces, shelves and colour+finish rows separately", () => {
  const rows = [
    row({ quantity: 4 }),
    row({ stockId: "st2", sizeId: "sz2", quantity: 6 }),                       // same shelf item, 2nd size
    row({ stockId: "st3", colourFinishId: "cf2", finish: "Leather", quantity: 1 }),
  ];
  const s = summariseInventory(rows);
  assert.equal(s.pieces, 11);
  assert.equal(s.shelves, 3);
  assert.equal(s.colours, 2, "Polished and Leather are two counted rows of one colour");
});

test("a colour+finish that has never held stock is not counted as a shelf", () => {
  // sizeId null is "nobody has ever cut this", not "a shelf holding nothing" —
  // and calling it a shelf would inflate every count on the screen by the 50-odd
  // colours nobody has ever sampled.
  const rows = [row({ stockId: null, sizeId: null, lengthIn: null, widthIn: null, thicknessMm: null, quantity: 0 })];
  const s = summariseInventory(rows, { includeEmpty: true });
  assert.equal(s.shelves, 0);
  assert.equal(s.colours, 1);
});

// ---------------------------------------------------------------------------
// THE TREE IS THE PRINTED CHART'S ORDER
// ---------------------------------------------------------------------------

test("SERIES AND COLOURS SORT BY CHART POSITION, NOT ALPHABETICALLY", () => {
  // product_series.position and product_colour.position exist precisely so a
  // pick-list reads the way the chart on the wall does. Sorting by name here
  // would throw that away, and the person reading has the chart in front of
  // them.
  const rows = [
    row({ seriesName: "Nebula", seriesPosition: 2, colourName: "Ash", colourPosition: 1 }),
    row({ seriesName: "Kosmic", seriesPosition: 1, colourName: "Zircon", colourPosition: 1, colourFinishId: "cf2" }),
    row({ seriesName: "Kosmic", seriesPosition: 1, colourName: "Alba", colourPosition: 2, colourFinishId: "cf3" }),
  ];
  const tree = groupInventory(rows);
  assert.deepEqual(tree.map(s => s.seriesName), ["Kosmic", "Nebula"]);
  assert.deepEqual(tree[0].colours.map(c => c.colourName), ["Zircon", "Alba"],
    "Zircon is position 1 and comes first even though A sorts before Z");
});

test("equal positions fall back to the name, so the table cannot reshuffle", () => {
  const rows = [
    row({ seriesName: "Solids", seriesPosition: 0, colourFinishId: "cf1" }),
    row({ seriesName: "Aurora", seriesPosition: 0, colourFinishId: "cf2" }),
  ];
  assert.deepEqual(groupInventory(rows).map(s => s.seriesName), ["Aurora", "Solids"]);
});

test("QUANTITIES ADD UP AT EVERY LEVEL, FROM THE ROWS THEMSELVES", () => {
  const rows = [
    row({ finish: "Polished", colourFinishId: "cf1", sizeId: "sz1", quantity: 4 }),
    row({ finish: "Polished", colourFinishId: "cf1", sizeId: "sz2", lengthIn: 4, widthIn: 4, quantity: 6 }),
    row({ finish: "Leather", colourFinishId: "cf2", sizeId: "sz1", quantity: 2 }),
    row({ colourName: "Arva White", colourPosition: 9, colourFinishId: "cf3", sizeId: "sz1", quantity: 1 }),
  ];
  const [series] = groupInventory(rows);
  assert.equal(series.quantity, 13);
  const cappuccino = series.colours.find(c => c.colourName === "Cappuccino")!;
  assert.equal(cappuccino.quantity, 12);
  assert.deepEqual(cappuccino.finishes.map(f => [f.finish, f.quantity]), [["Leather", 2], ["Polished", 10]]);
});

test("SIZES READ LARGEST FIRST", () => {
  // The big pieces are the ones being given away; a 4x4 offcut pile is the
  // bottom of every list.
  const rows = [
    row({ sizeId: "a", lengthIn: 4, widthIn: 4, thicknessMm: 20, quantity: 1 }),
    row({ sizeId: "b", lengthIn: 12, widthIn: 4, thicknessMm: 20, quantity: 1 }),
    row({ sizeId: "c", lengthIn: 6, widthIn: 4, thicknessMm: 30, quantity: 1 }),
    row({ sizeId: "d", lengthIn: 6, widthIn: 4, thicknessMm: 20, quantity: 1 }),
  ];
  const sizes = groupInventory(rows)[0].colours[0].finishes[0].sizes;
  assert.deepEqual(sizes.map(s => s.sizeId), ["b", "c", "d", "a"]);
});

test("A NEVER-CUT COLOUR SHOWS ITS FINISH AND NO SIZE ROW", () => {
  // The finish has to appear — that is the answer to "do we have any Nebula
  // Ash" — but a size row reading "— ×0" would be a size nobody can name.
  const rows = [row({
    colourName: "Nebula Ash", stockId: null, sizeId: null,
    lengthIn: null, widthIn: null, thicknessMm: null, quantity: 0,
  })];
  const [series] = groupInventory(rows);
  assert.equal(series.colours[0].finishes.length, 1);
  assert.deepEqual(series.colours[0].finishes[0].sizes, []);
  assert.equal(series.quantity, 0);
});

test("grouping an empty list is an empty tree, not a crash", () => {
  assert.deepEqual(groupInventory([]), []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.deepEqual(groupInventory(undefined as any), []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.deepEqual(groupInventory([null as any]), []);
});

test("the tree is built from the FILTERED rows, so the two agree", () => {
  // The screen composes them in this order; if it did not, a series header
  // would show a total that included shelves the table below was hiding.
  const rows = [row({ quantity: 0 }), row({ stockId: "st2", sizeId: "sz2", quantity: 5 })];
  const [series] = groupInventory(filterInventory(rows));
  assert.equal(series.quantity, 5);
  assert.equal(series.colours[0].finishes[0].sizes.length, 1);
});
