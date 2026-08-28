// The inventory screen's own decisions: what a stock row reads as, what a
// search term matches, what is hidden by default, and how 56 colours fold into
// something a person can scan.
//
// PURE, AND IT IMPORTS NOTHING — the same rule ./size.ts and ./lifecycle.ts
// state, for the same reason: `node --test` resolves ESM strictly, so a module
// reachable from tests/ carries no aliases and no dependencies. The label
// formatting is therefore repeated here rather than imported from ./size.ts;
// see SIZE TEXT below for why that is not a copy of a rule.
//
// WHY ANY OF THIS IS A DECISION. The catalogue is 56 colours over 7 series,
// three of them carrying a second finish, and every colour+finish can hold any
// number of sizes. Listed flat that is hundreds of rows of which a handful have
// stock, and the sampling incharge's question is never "list everything" — it
// is "have we got 4x4 Cappuccino in 2 cm". So:
//
//   * ROWS WITH NO PIECES ARE HIDDEN BY DEFAULT. A sampling_stock row is not
//     deleted when it empties (the quantity moves, the row does not — see the
//     model), so the shelf accumulates zeroes, and a zero is not stock. It is
//     still a fact worth reaching, which is why hiding it is a filter with a
//     switch and not a WHERE clause in the route.
//   * SEARCH IS ALL-TERMS, ACROSS EVERY FIELD. "kosmic 4x4" is one question,
//     not two, and nobody types the fields in the order the table happens to
//     put them.
//   * THE GROUPING IS THE CHART'S OWN ORDER — series position, then colour
//     position — because the person reading it has the printed chart in front
//     of them.

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

/** One (colour+finish, size) shelf, as /api/sampling/inventory returns it.
 *  A row with quantity 0 is a shelf that exists and is empty; a colour+finish
 *  with no shelf at all arrives as a row with sizeId null. */
export interface InventoryRow {
  /** sampling_stock.id, or null for a catalogue colour+finish with no shelf. */
  stockId: string | null;
  colourFinishId: string;
  seriesName: string;
  seriesPosition: number;
  colourName: string;
  colourPosition: number;
  finish: string;
  /** null when this row is a colour+finish that has never held stock. */
  sizeId: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  thicknessMm: number | null;
  quantity: number;
}

/**
 * SIZE TEXT — how a size reads, and everything it can be searched by.
 *
 * The display half is deliberately identical to sampleSizeLabel() in ./size.ts
 * ("6 × 4 in · 20 mm"), and is written out again rather than imported because
 * both files must stay import-free. That duplication is safe in a way copying a
 * RULE would not be: this is a string, not a decision, and
 * tests/samplingInventory.test.ts pins the two to each other so a change to one
 * cannot silently leave the other behind.
 *
 * The searchable half is the important one. Nobody types "6 × 4 in · 20 mm" —
 * they type "4x4", "6x4" or "20mm", so the haystack carries the compact
 * spellings too. `sampleSizeKey`'s "6x4x20" is one of them.
 */
export function sizeLabelOf(row: Pick<InventoryRow, "lengthIn" | "widthIn" | "thicknessMm">): string {
  if (row.lengthIn == null || row.widthIn == null || row.thicknessMm == null) return "—";
  return `${row.lengthIn} × ${row.widthIn} in · ${row.thicknessMm} mm`;
}

/** Everything a size can be found by, lower-cased and space-separated. */
export function sizeSearchText(row: Pick<InventoryRow, "lengthIn" | "widthIn" | "thicknessMm">): string {
  if (row.lengthIn == null || row.widthIn == null || row.thicknessMm == null) return "";
  const l = row.lengthIn, w = row.widthIn, t = row.thicknessMm;
  return [
    sizeLabelOf(row),
    `${l}x${w}x${t}`,
    `${l}x${w}`,
    // The other way round as well: 4x6 and 6x4 are ONE size (the longer edge
    // is stored as the length), so somebody who types the short edge first is
    // asking about this row and must find it.
    `${w}x${l}`,
    `${t}mm`,
  ].join(" ").toLowerCase();
}

/** The whole haystack one row is searched against. */
export function rowSearchText(row: InventoryRow): string {
  return [row.seriesName, row.colourName, row.finish, sizeSearchText(row)]
    .filter(Boolean).join(" ").toLowerCase();
}

/**
 * Does this row answer the search?
 *
 * EVERY TERM MUST MATCH, anywhere in the row — "kosmic 4x4" is one question
 * about one shelf, and an any-term match would answer it with every Kosmic
 * colour and every 4x4 in the building. An empty search matches everything,
 * which is what an empty box should mean.
 */
export function matchesSearch(row: InventoryRow, search: string): boolean {
  const terms = String(search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = rowSearchText(row);
  return terms.every((t) => hay.includes(t));
}

/**
 * The rows the screen shows.
 *
 * `includeEmpty` is the "show everything" switch. Off — the default — a shelf
 * has to hold at least one piece to be listed, which is what "what is in stock"
 * means. On, every shelf and every colour+finish that has never held one is
 * listed too, so "we have never cut Nebula Ash" is answerable on the same
 * screen as "we have four".
 *
 * THE SEARCH IS APPLIED EITHER WAY. Searching for a colour that is out of stock
 * and being shown an empty table is the one case where the default would lie,
 * so the caller is given the count of what the switch is hiding (see
 * summariseInventory) and can say so.
 */
export function filterInventory(
  rows: InventoryRow[],
  opts: { search?: string; includeEmpty?: boolean } = {},
): InventoryRow[] {
  const search = opts.search ?? "";
  const includeEmpty = opts.includeEmpty === true;
  return (rows ?? []).filter((r) => (includeEmpty || Number(r?.quantity) > 0) && matchesSearch(r, search));
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export interface InventorySizeNode {
  sizeId: string | null;
  label: string;
  lengthIn: number | null;
  widthIn: number | null;
  thicknessMm: number | null;
  quantity: number;
}
export interface InventoryFinishNode {
  colourFinishId: string;
  finish: string;
  quantity: number;
  sizes: InventorySizeNode[];
}
export interface InventoryColourNode {
  colourName: string;
  quantity: number;
  finishes: InventoryFinishNode[];
}
export interface InventorySeriesNode {
  seriesName: string;
  quantity: number;
  colours: InventoryColourNode[];
}

/**
 * series -> colour -> finish -> size, in the printed chart's order.
 *
 * Sorted by POSITION, not by name: product_series.position and
 * product_colour.position exist precisely so a pick-list reads the way the
 * chart on the wall does, and re-sorting alphabetically here would throw that
 * away. Name is the tie-break so the order is total and the table cannot
 * reshuffle between two renders of the same data.
 *
 * Sizes sort largest first — the big pieces are the ones being given away, and
 * a 4x4 offcut pile is the bottom of every list.
 *
 * Quantities are summed at every level from the rows themselves rather than
 * being carried in from a second query: one number, one source.
 */
export function groupInventory(rows: InventoryRow[]): InventorySeriesNode[] {
  const series = new Map<string, {
    name: string; position: number;
    colours: Map<string, {
      name: string; position: number;
      finishes: Map<string, { colourFinishId: string; finish: string; sizes: InventorySizeNode[] }>;
    }>;
  }>();

  for (const r of rows ?? []) {
    if (!r) continue;
    const s = series.get(r.seriesName) ?? { name: r.seriesName, position: Number(r.seriesPosition ?? 0), colours: new Map() };
    series.set(r.seriesName, s);
    const c = s.colours.get(r.colourName) ?? { name: r.colourName, position: Number(r.colourPosition ?? 0), finishes: new Map() };
    s.colours.set(r.colourName, c);
    const f = c.finishes.get(r.finish) ?? { colourFinishId: r.colourFinishId, finish: r.finish, sizes: [] };
    c.finishes.set(r.finish, f);
    // A colour+finish with no shelf arrives as a row with sizeId null. It
    // contributes the finish (so "show everything" can list it) and no size —
    // "— , 0" as a size row would read as a size nobody can name.
    if (r.sizeId !== null) {
      f.sizes.push({
        sizeId: r.sizeId,
        label: sizeLabelOf(r),
        lengthIn: r.lengthIn,
        widthIn: r.widthIn,
        thicknessMm: r.thicknessMm,
        quantity: Number(r.quantity ?? 0),
      });
    }
  }

  const byPosition = (a: { position: number; name: string }, b: { position: number; name: string }) =>
    a.position - b.position || a.name.localeCompare(b.name);

  return [...series.values()].sort(byPosition).map((s) => {
    const colours = [...s.colours.values()].sort(byPosition).map((c) => {
      const finishes = [...c.finishes.values()]
        .sort((a, b) => a.finish.localeCompare(b.finish))
        .map((f) => {
          const sizes = f.sizes.slice().sort((a, b) =>
            (b.lengthIn ?? 0) - (a.lengthIn ?? 0) ||
            (b.widthIn ?? 0) - (a.widthIn ?? 0) ||
            (b.thicknessMm ?? 0) - (a.thicknessMm ?? 0));
          return { colourFinishId: f.colourFinishId, finish: f.finish, sizes, quantity: total(sizes) };
        });
      return { colourName: c.name, finishes, quantity: finishes.reduce((n, f) => n + f.quantity, 0) };
    });
    return { seriesName: s.name, colours, quantity: colours.reduce((n, c) => n + c.quantity, 0) };
  });
}

function total(sizes: InventorySizeNode[]): number {
  return sizes.reduce((n, s) => n + s.quantity, 0);
}

/**
 * The three numbers above the table, and the one that makes the default
 * honest: how many shelves the "in stock only" filter is currently hiding.
 *
 * `hiddenEmpty` counts against the SEARCH, not against the whole catalogue — a
 * search for "cappuccino" that finds nothing has to be able to say "3 empty
 * shelves match" rather than a bare "no results", which reads as "no such
 * colour".
 */
export interface InventorySummary {
  /** Shelves listed under the current filter. */
  shelves: number;
  /** Pieces on them. */
  pieces: number;
  /** Distinct colour+finish rows listed. */
  colours: number;
  /** Shelves the "in stock only" default is hiding from this search. */
  hiddenEmpty: number;
}

export function summariseInventory(
  rows: InventoryRow[],
  opts: { search?: string; includeEmpty?: boolean } = {},
): InventorySummary {
  const shown = filterInventory(rows, opts);
  const matched = (rows ?? []).filter((r) => r && matchesSearch(r, opts.search ?? ""));
  return {
    shelves: shown.filter((r) => r.sizeId !== null).length,
    pieces: shown.reduce((n, r) => n + Number(r.quantity ?? 0), 0),
    colours: new Set(shown.map((r) => r.colourFinishId)).size,
    hiddenEmpty: opts.includeEmpty === true ? 0 : matched.length - shown.length,
  };
}
