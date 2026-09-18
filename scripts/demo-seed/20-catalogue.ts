/**
 * DEMO SEED — module 20: catalogue
 * =============================================================================
 * Target: the `pacificdemo` database ONLY. Every series, colour, item code and
 * alias below is invented — none of them is a Pacific name.
 *
 * `db` is an already-connected PrismaClient pointed at the demo database and is
 * used directly. This file deliberately imports NOTHING — in particular not
 * "@/lib/prisma", which is the production singleton.
 *
 * WRITES, in dependency order (product_colour needs a series to hang off):
 *
 *   product_series           6  invented ranges, the chart's top level
 *   product_colour          24  one per ctx.designs name, four per series
 *   product_colour_finish   40  every colour in Polished — the row stock is
 *                              actually counted against — plus a second finish
 *                              on two colours in three
 *   sampling_size           10  length/width in INCHES, thickness in MILLIMETRES,
 *                              longer edge first (the rule in lib/sampling/size.ts)
 *   fg_design_alias          8  variant -> canonical, so the inventory merge
 *                              screen has something to merge
 *   commercial_design_code  24  the owner's item code, shade, hex and L*a*b*
 *
 * Ids are explicit ("demo-col-01") rather than cuid, so foreign keys can be
 * wired without reading rows back and a second run with skipDuplicates is a
 * no-op. What lands in ctx is nonetheless read BACK out of the database, so a
 * table that failed contributes an empty list rather than ids that do not exist.
 *
 * ADDS TO ctx:
 *   ctx.series         { id, name, position }[]
 *   ctx.colours        { id, name, seriesId }[]
 *   ctx.colourFinishes { id, colourId, colourName, finish }[]   <- sampling stock
 *   ctx.samplingSizes  { id, lengthIn, widthIn, thicknessMm, label }[]
 *   ctx.designCodes    { design, code, shade }[]
 */

export type Ctx = {
  designs: string[];
  batches: string[];
  users: { id: string; name: string; email: string; role: string }[];
  clients: { id: string; name: string }[];
  now: Date;
  daysAgo: (n: number) => Date;
  [k: string]: any;
};

/**
 * The finish vocabulary is a plain string in the schema, not an enum, so adding
 * one is a seed edit rather than a migration. These four are the spellings
 * src/lib/catalogue/colours.ts declares; Polished is the default.
 */
const DEFAULT_FINISH = "Polished";
const SECOND_FINISHES = ["Suede", "Matte", "Leathered"];

/** Invented ranges. Deliberately none of Pacific's own seven series names. */
const SERIES_NAMES = ["Alloro", "Cirrus", "Monolith", "Fresco", "Pelagic", "Terrano"];

/** Only reached if ctx.designs is empty, which the contract says it never is. */
const FALLBACK_DESIGNS = [
  "Aurora Mist", "Verona Grey", "Selene White", "Marlowe Cream",
  "Cobalt Drift", "Cortona Sand", "Belvoir Pearl", "Nimbus Ivory",
  "Corsica Storm", "Brigantine Blue", "Palermo Mocha", "Tundra Frost",
  "Keswick Stone", "Solara Beige", "Ravello Smoke", "Tivoli Snow",
  "Basalt Noir", "Meridian Taupe", "Larkspur Vein", "Orvieto Ash",
  "Ossian Quartz", "Zephyr Linen", "Umbria Clay", "Halcyon Shell",
];

/**
 * length_in, width_in, thickness_mm. THICKNESS IS PART OF THE SIZE, so 4x4 in
 * 2 cm and 4x4 in 3 cm are two rows, not one. 20 = 2 cm, 30 = 3 cm, 12 = 12 mm.
 * The longer edge is always first — 6x4 and 4x6 are the same size.
 */
const SIZES: Array<[number, number, number]> = [
  [4, 4, 20],
  [4, 4, 30],
  [6, 4, 20],
  [6, 4, 30],
  [6, 6, 12],
  [8, 4, 20],
  [8, 8, 20],
  [10, 6, 30],
  [12, 4, 20],
  [12, 12, 20],
];

/** Plausible quartz hexes, pale first, cycled across the designs. */
const HEXES = [
  "#F4F1EA", "#E8E4DC", "#DCD6CB", "#CFC8BC", "#C2B9AB", "#B4AA9B",
  "#A69A8B", "#988B7B", "#8A7C6C", "#7C6E5E", "#6E6051", "#605244",
  "#F7F5F0", "#EDE9E1", "#E1DBD1", "#D3CCC0", "#C6BDAF", "#B8AE9F",
  "#4A4038", "#3C332C", "#2E2721", "#5B5048", "#877C70", "#9B9084",
];

const n2 = (i: number) => String(i + 1).padStart(2, "0");

/**
 * How long ago colour i was added, in days. One function rather than two
 * copies of the expression, because a second finish is dated FROM it: a
 * finish must never carry a date earlier than the colour it belongs to.
 */
const colourAgeDays = (i: number) => Math.max(1, 88 - i * 3);

export async function seed(db: any, ctx: Ctx): Promise<void> {
  // product_colour.name is UNIQUE ACROSS EVERY SERIES, deliberately, so a
  // duplicate in ctx.designs would abort the whole createMany. Fold it first.
  const seen = new Set<string>();
  const designs = (ctx.designs && ctx.designs.length ? ctx.designs : FALLBACK_DESIGNS)
    .map((d) => (d || "").trim())
    .filter((d) => {
      if (!d || seen.has(d.toLowerCase())) return false;
      seen.add(d.toLowerCase());
      return true;
    })
    .slice(0, 24);

  // users.id, no hard FK — the Sales/Chromia precedent the schema notes.
  const authorId = ctx.users && ctx.users.length ? ctx.users[0].id : null;

  // ───────────────────────────────────────────────────────────────── series ──
  const seriesRows = SERIES_NAMES.map((name, i) => ({
    id: `demo-ser-${n2(i)}`,
    name,
    position: i + 1,
    createdAt: ctx.daysAgo(90),
  }));

  try {
    await db.productSeries.createMany({ data: seriesRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  // ──────────────────────────────────────────────────────────────── colours ──
  // Four per series in chart order, added a few days apart across the last
  // quarter so an "added" column has a shape rather than one spike.
  const colourRows = designs.map((name, i) => ({
    id: `demo-col-${n2(i)}`,
    seriesId: seriesRows[i % seriesRows.length].id,
    name,
    position: Math.floor(i / seriesRows.length) + 1,
    createdAt: ctx.daysAgo(colourAgeDays(i)),
  }));

  try {
    await db.productColour.createMany({ data: colourRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  // ─────────────────────────────────────────────────────────── colour+finish ──
  // Polished for every colour, plus a second finish on two in three: 24 + 16.
  // The second finish steps per GROUP of three, not per colour: indexing by
  // i%3 would only ever pick the first two, and Leathered would never appear.
  const finishRows: any[] = [];
  colourRows.forEach((c, i) => {
    finishRows.push({
      id: `demo-cf-${n2(i)}a`,
      colourId: c.id,
      finish: DEFAULT_FINISH,
      createdAt: c.createdAt,
    });
    if (i % 3 !== 2) {
      finishRows.push({
        id: `demo-cf-${n2(i)}b`,
        colourId: c.id,
        finish: SECOND_FINISHES[Math.floor(i / 3) % SECOND_FINISHES.length],
        createdAt: ctx.daysAgo(Math.max(1, colourAgeDays(i) - 18)),
      });
    }
  });

  try {
    await db.productColourFinish.createMany({ data: finishRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  // ────────────────────────────────────────────────────────────────── sizes ──
  const sizeRows = SIZES.map(([lengthIn, widthIn, thicknessMm], i) => ({
    id: `demo-size-${n2(i)}`,
    lengthIn,
    widthIn,
    thicknessMm,
    createdById: authorId,
    createdAt: ctx.daysAgo(Math.max(1, 85 - i * 5)),
  }));

  try {
    await db.samplingSize.createMany({ data: sizeRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  // ──────────────────────────────────────────────────────────────── aliases ──
  // The spellings the polishing line actually types, pointed at the canonical
  // name. fg_design_alias.variant is UNIQUE, so the list is deduped by variant
  // before it is written, case-insensitively.
  const aliasSeeds: Array<{ variant: string; canonical: string }> = [];
  const pushAlias = (variant: string, canonical: string) => {
    const v = (variant || "").trim();
    if (!v || !canonical || v === canonical) return;
    if (aliasSeeds.some((a) => a.variant.toLowerCase() === v.toLowerCase())) return;
    aliasSeeds.push({ variant: v, canonical });
  };
  designs.slice(0, 6).forEach((d, i) => {
    if (i % 3 === 0) pushAlias(d.toUpperCase(), d);          // shouted by the importer
    else if (i % 3 === 1) pushAlias(d.replace(/ /g, "-"), d); // hyphenated by hand
    else pushAlias(d.replace(/ /g, ""), d);                   // space dropped
    pushAlias(`${d} ${i % 2 === 0 ? "2CM" : "POL"}`, d);      // thickness/finish tacked on
  });
  const aliasRows = aliasSeeds.slice(0, 8).map((a, i) => ({
    id: `demo-alias-${n2(i)}`,
    variant: a.variant,
    canonical: a.canonical,
    createdBy: authorId,
    createdAt: ctx.daysAgo(Math.max(1, 60 - i * 6)),
  }));

  try {
    await db.designAlias.createMany({ data: aliasRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  // ─────────────────────────────────────────────────── commercial design code ──
  // One row per canonical design: the item code the planning queue quotes and
  // the shade it sequences by. L* carries the shade (light runs before dark),
  // a*/b* a little warmth. shade_confirmed is false on most of them, which is
  // the honest state — the shade is a first guess from the name until the owner
  // reads it off a sample.
  const codeRows = designs.map((design, i) => {
    const shade = i % 3 === 0 ? "LIGHT" : i % 3 === 1 ? "MEDIUM" : "DARK";
    const labL =
      shade === "LIGHT" ? 88 - i * 0.4 : shade === "MEDIUM" ? 64 - i * 0.3 : 34 + i * 0.2;
    return {
      design,
      code: `PQ-${101 + i * 3}`,
      shade,
      shadeConfirmed: i % 4 === 0,
      colourName: design,
      hex: HEXES[i % HEXES.length],
      labL: Number(labL.toFixed(2)),
      labA: Number(((i % 5) - 2 + 0.5).toFixed(2)),
      labB: Number(((i % 7) + 1.25).toFixed(2)),
      notes: i % 6 === 0 ? "Shade guessed from the name; not read off a sample yet." : null,
      updatedById: authorId,
    };
  });

  try {
    await db.commercialDesignCode.createMany({ data: codeRows, skipDuplicates: true });
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  // ──────────────────────────────────────────────────────────────────── ctx ──
  // Read back rather than assumed: if a table above failed, later modules get
  // an empty list and skip, instead of a foreign key pointing at nothing.
  ctx.series = [];
  ctx.colours = [];
  ctx.colourFinishes = [];
  ctx.samplingSizes = [];
  ctx.designCodes = [];

  try {
    ctx.series = await db.productSeries.findMany({
      where: { id: { in: seriesRows.map((s) => s.id) } },
      select: { id: true, name: true, position: true },
      orderBy: { position: "asc" },
    });
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  try {
    ctx.colours = await db.productColour.findMany({
      where: { id: { in: colourRows.map((c) => c.id) } },
      select: { id: true, name: true, seriesId: true },
    });
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  try {
    const rows = await db.productColourFinish.findMany({
      where: { id: { in: finishRows.map((f) => f.id) } },
      select: { id: true, colourId: true, finish: true },
    });
    const nameById = new Map(colourRows.map((c) => [c.id, c.name]));
    ctx.colourFinishes = rows.map((r: any) => ({
      id: r.id,
      colourId: r.colourId,
      colourName: nameById.get(r.colourId) ?? null,
      finish: r.finish,
    }));
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  try {
    const rows = await db.samplingSize.findMany({
      where: { id: { in: sizeRows.map((s) => s.id) } },
      select: { id: true, lengthIn: true, widthIn: true, thicknessMm: true },
    });
    ctx.samplingSizes = rows.map((r: any) => ({
      id: r.id,
      lengthIn: Number(r.lengthIn),
      widthIn: Number(r.widthIn),
      thicknessMm: r.thicknessMm,
      label: `${Number(r.lengthIn)}x${Number(r.widthIn)} ${r.thicknessMm}mm`,
    }));
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  try {
    ctx.designCodes = await db.commercialDesignCode.findMany({
      where: { design: { in: designs } },
      select: { design: true, code: true, shade: true },
    });
  } catch (e) {
    console.warn("  [catalogue] skipped:", (e as Error).message);
  }

  console.log(
    `\n  [catalogue] series ${ctx.series.length}, colours ${ctx.colours.length}, ` +
      `colour-finishes ${ctx.colourFinishes.length}, sizes ${ctx.samplingSizes.length}, ` +
      `aliases ${aliasRows.length}, design codes ${ctx.designCodes.length}`,
  );
}
