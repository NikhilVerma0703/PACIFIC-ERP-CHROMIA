// The Pacific colour chart: series -> colour -> finish.
//
// PURE, AND IT IMPORTS NOTHING — same reason as fab/slabLoss.ts and
// finance/pipelineRules.ts: `node --test` resolves ESM strictly, so a relative
// import without a .ts extension fails at runtime while adding the extension
// fights the Next build. The seed (prisma/seed-catalogue.ts) imports THIS
// module rather than carrying its own copy of the list, so the counts the
// tests pin are the counts that reach the database.
//
// NOT SAMPLING-ONLY, deliberately. Sampling is the first module to need a
// curated colour master, but the same 56 colours are what fabrication buys
// against ("Arva White" is the material on PO 10026, see lib/fab/poParser.ts)
// and what the polishing line calls a "design" (polish_qc.design). So this
// lives in lib/catalogue, the models are Product* / product_* rather than
// Sampling*, and product_colour.name is globally unique so a PO line or a QC
// row can resolve to exactly one colour by name later. The existing
// fg_design_alias table (variant -> canonical) is the ad-hoc version of the
// same idea and can fold into this when someone wants it to.
//
// ---------------------------------------------------------------- FINISH ---
// A FINISH IS A VARIANT OF A COLOUR, NOT A COLOUR. The owner's chart lists
// "Cappuccino" and "Cappuccino (Leather)" as two lines, but they are one
// colour with two finishes — decision 3. Three of the 59 listed names are
// finish variants, so the chart's 59 lines normalise to 56 colours and 59
// colour+finish rows (56 defaults + 3 second finishes).
//
// The split is deliberately CONSERVATIVE, and both halves of the rule matter:
//   1. the name must carry an explicit marker — a trailing "(...)" or a
//      space-separated dash — so "Cappuccino Dark" (no marker) stays a whole
//      colour name, which it is: a darker colour, not a finish of Cappuccino;
//   2. the marked word must be in the CLOSED finish vocabulary below, so
//      "Cappuccino (Dark)", were it ever typed that way, would still not
//      become a finish.
// "Artemis Grey/Deepwave" has no marker either and is one colour name
// containing a slash.
//
// The vocabulary is a plain string list rather than a database enum because
// adding a finish must not need a DDL change, and because the ERP already
// stores polish type as free text (FinishedSlab.polishType — "Polish / Suede /
// Honed / Leathered"). Those spellings are close to but not the same as these;
// canonicalFinish() folds both forms onto the owner's words.

// ---------------------------------------------------------------------------
// Finishes
// ---------------------------------------------------------------------------

/**
 * THE FOUR FINISHES THE SHOP SELLS, in the owner's own words: "I need the finish
 * type of all — polished, suede, matte, leathered."
 *
 * They used to be "Polished / Leather / Suede / Honed", the spellings
 * transcribed off the printed chart. Two of those are the same finishes under
 * different names:
 *
 *     Leather -> Leathered   the owner's word, and the one polish_qc already
 *                            uses in FinishedSlab.polishType
 *     Honed   -> Matte       honed IS the matte finish. The trade says honed,
 *                            the owner says matte, and a vocabulary carrying
 *                            both would count one shelf of stock as two
 *
 * EVERY COLOUR CAN BE CUT IN ANY OF THE FOUR. The chart only printed the finish
 * variants somebody had photographed — three of 132 lines — which is why the
 * sample form offered a single option for nearly every colour: Carrara Royale
 * showed "Polished" alone because that is the only product_colour_finish row it
 * has. A sample can be cut in any finish on request, so the form now lists all
 * four and the row is created the first time one is used.
 *
 * scripts/0058 renames the two stored spellings. Adding a finish is still a seed
 * edit rather than a migration — the column is TEXT for exactly that reason.
 */
export const FINISHES = ["Polished", "Suede", "Matte", "Leathered"] as const;
export type Finish = (typeof FINISHES)[number];

/** Every colour has this finish unless the chart says otherwise. */
export const DEFAULT_FINISH: Finish = "Polished";

/**
 * Fold every spelling in the building onto the owner's four words.
 *
 * Three vocabularies meet here: the printed chart ("Leather"), the ERP's own
 * free-text polish type ("Polish / Suede / Honed / Leathered"), and whatever a
 * person types. All of them land on one of FINISHES, or on null.
 *
 * NULL IS THE ANSWER THAT KEEPS A COLOUR NAME WHOLE, so this stays strict: the
 * day it starts guessing, "Cappuccino Dark" becomes a finish.
 */
export function canonicalFinish(word: string | null | undefined): Finish | null {
  const w = String(word ?? "").trim().toLowerCase();
  if (w === "polished" || w === "polish") return "Polished";
  if (w === "suede") return "Suede";
  if (w === "matte" || w === "matt" || w === "honed" || w === "hone") return "Matte";
  if (w === "leathered" || w === "leather") return "Leathered";
  return null;
}

// ---------------------------------------------------------------------------
// The chart, exactly as transcribed
// ---------------------------------------------------------------------------

export interface ListedSeries {
  /** The series name as printed. */
  name: string;
  /**
   * The count PRINTED IN THE SERIES HEADER — which is not always the number of
   * names underneath it. Kept as data rather than silently corrected so the
   * mismatch is visible to code and to tests; see CATALOGUE_DISCREPANCIES.
   */
  declaredCount: number;
  /** The names as listed, in chart order, including the finish variants. */
  names: string[];
}

/**
 * The seven series and their 125 listed designs — TAKEN FROM THE LIVE SITE,
 * pacific-surfaces.com/products/quartz, on 24 August 2026.
 *
 * Replaces the 56 names transcribed from the printed chart. The series are the
 * same seven; the site simply carries the full range, and each design brings
 * its CODE with it (Adonis 5059, Taj Vein P01), which is what lets a PO line or
 * a polish_qc row resolve to a colour by code rather than by spelling. Codes
 * live in DESIGN_CODES below rather than in the name, because the name is the
 * unique key and a code that changes must not fork a colour.
 *
 * ALL-CAPS NAMES ARE TITLE-CASED. The site lists "CAPPUCCINO" and "WAKANDA" in
 * caps — styling, not a different design. Left as typed they would be new
 * colours beside the existing "Cappuccino", and product_colour.name is globally
 * unique, so the shelf and its stock would split in two with no way to merge
 * them from the app. Case is normalised here, once, for that reason.
 *
 * THREE FINISH VARIANTS ARE CARRIED OVER FROM THE PRINTED CHART, not from the
 * site: the site marks every design "polished" and does not surface second
 * finishes at all. Dropping them because a web page omits them would silently
 * delete three real products, so Cappuccino (Leather), Alabaster Noir – Suede
 * and Taj Vein (Leather) stay. 125 colours, 128 colour+finish rows.
 *
 * THREE DISCREPANCIES, PRESERVED AS DATA RATHER THAN FIXED — the same rule the
 * printed chart got, because inventing an answer makes the guess permanent:
 *
 *   1. ECLIPSE'S HEADER SAYS 28 AND 30 NAMES CARRY THE ECLIPSE TAG. The
 *      /products/quartz listing tags "Artemis Grey" and "Tiffany" as Eclipse;
 *      the Eclipse collection page itself lists neither, and neither has a P
 *      code. All 30 are imported.
 *   2. VENETIA IS TAGGED NEBULA AND CODED 4006. Every other 4xxx design is
 *      Celestia and every other Nebula design is 3xxx. One of the two is wrong
 *      on the site. The tag is followed, because the tag is what the site
 *      groups by; the code is recorded unchanged so the clash stays visible.
 *   3. TEN DESIGNS HAVE NO CODE — the seven all-caps entries plus Artemis Grey,
 *      Patagonia and Tiffany. Absent from DESIGN_CODES rather than given a
 *      placeholder, so "no code" and "code unknown" cannot be confused.
 *
 * Either of the first two could change the totals. That is what the tests are
 * for.
 */
export const CATALOGUE_SERIES: ListedSeries[] = [
  {
    name: "Aurora",
    declaredCount: 8,
    names: [
      "Echo White",   // 1001
      "Arva White",   // 1002
      "Cemento",   // 1004
      "Classic Gray",   // 1005
      "Pebbles Ice",   // 1006
      "Star Cluster",   // 1008
      "White Blizzard",   // 1011
      "Ultima White",   // 1014
    ],
  },
  {
    name: "Solids",
    declaredCount: 2,
    names: [
      "Brilliant White",   // 1003
      "Super White",   // 1009
    ],
  },
  {
    name: "Luminara",
    declaredCount: 3,
    names: [
      "Mystique",   // 2006
      "Oasis",   // 2009
      "Zenith",   // 2013
    ],
  },
  {
    name: "Nebula",
    declaredCount: 35,
    names: [
      "Alabaster",   // 3001
      "Alabaster Noir",   // 3003
      "Alabaster Noir – Suede",
      "Alchemy",   // 3004
      "Antonio",   // 3006
      "Arena",   // 3007
      "Arya Pearl",   // 3009
      "Atlantis",   // 3010
      "Aureate",   // 3014
      "Banyan",   // 3015
      "Bellagio",   // 3016
      "Belleza",   // 3017
      "Bohemia",   // 3018
      "Breeze",   // 3019
      "Cleopatra",   // 3024
      "Cosmopolitan",   // 3025
      "Costa",   // 3026
      "Dazzle",   // 3027
      "Elvis",   // 3031
      "Eminence",   // 3033
      "Fern",   // 3036
      "Hazel Gold",   // 3039
      "Hermes",   // 3040
      "Honeydew",   // 3041
      "Ibiza",   // 3044
      "Ikos",   // 3045
      "Iris Blue",   // 3046
      "Iris Gray",   // 3048
      "Tramento",   // 3050
      "Ashford",   // 3052
      "Artemis",   // 3058
      "Glacial Silver",   // 3059
      "Deepwave",   // 3061
      "Soft Veil",   // 3063
      "Venetia",   // 4006
      "Caterina",   // no design code on the site
      "Arya",   // printed chart only — see CHART_ONLY
      "Artemis Grey/Deepwave",   // printed chart only — see CHART_ONLY
    ],
  },
  {
    name: "Celestia",
    declaredCount: 5,
    names: [
      "Stella",   // 4002
      "Seasons",   // 4005
      "Wintersky",   // 4008
      "Silken",   // 4010
      "Desert Brown",   // 4013
    ],
  },
  {
    name: "Kosmic",
    declaredCount: 42,
    names: [
      "Aspen Aura",   // 5001
      "Coastal Pearl",   // 5007
      "Driftwood",   // 5010
      "Franklin",   // 5011
      "Galactic Halo",   // 5012
      "Golden Dawn",   // 5013
      "Havelock",   // 5014
      "Irish Cream",   // 5016
      "Nestos",   // 5024
      "Oakville",   // 5025
      "Ruskin",   // 5028
      "Stellar Ember",   // 5031
      "Suzuka",   // 5033
      "Tokyo",   // 5034
      "Venus Glow",   // 5036
      "Latte Luxe",   // 5040
      "Venice",   // 5041
      "Mockingbird",   // 5050
      "Kandice",   // 5054
      "Skyline",   // 5056
      "Larvik",   // 5058
      "Adonis",   // 5059
      "Alps",   // 5060
      "Medusa",   // 5062
      "Merlot",   // 5063
      "French Vanilla",   // 5064
      "Florence",   // 5067
      "Cherry Hill",   // 5068
      "Walnut",   // 5070
      "San Marino",   // 5071
      "Paradise City",   // 5072
      "Valencia",   // 5073
      "Venezia",   // 5074
      "Havana",   // 5075
      "Matcha Mist",   // 5076
      "Sakura",   // 5077
      "Astral Mist",   // no design code on the site
      "Bianco Cristallo",   // no design code on the site
      "Cappuccino",   // no design code on the site
      "Cappuccino (Leather)",
      "Maple Gaze",   // no design code on the site
      "Poseidon",   // no design code on the site
      "Wakanda",   // no design code on the site
      "Cappuccino Dark",   // printed chart only — see CHART_ONLY
    ],
  },
  {
    name: "Eclipse",
    declaredCount: 28,
    names: [
      "Taj Vein",   // P01
      "Taj Vein (Leather)",
      "Mintara",   // P02
      "Elano",   // P03
      "Elvion",   // P04
      "Arlina",   // P05
      "Rovena",   // P06
      "Mirano",   // P07
      "Linera",   // P08
      "Orva",   // P09
      "Almond Mist",   // P10
      "Cascade",   // P11
      "Winter Haze",   // P12
      "Stone Lily",   // P13
      "Himalayan Vein",   // P14
      "Crimson Flow",   // P15
      "Snowveil",   // P16
      "Silver Haven",   // P17
      "Frost Vein",   // P18
      "Cinder Flow",   // P19
      "Silverscape",   // P20
      "Ashen Bloom",   // P21
      "Horizon Veil",   // P22
      "Mossline",   // P23
      "Velluto",   // P24
      "Orenda",   // P25
      "Mossveil",   // P26
      "Lumina Cristal",   // P28
      "Artemis Grey",   // no design code on the site
      "Patagonia",   // no design code on the site
      "Tiffany",   // no design code on the site
      "Statuario",   // printed chart only — see CHART_ONLY
    ],
  },
];

/**
 * FOUR NAMES THAT ARE ON THE PRINTED CHART AND NOT ON THE WEBSITE.
 *
 * Kept, not dropped. The seed upserts by name, so removing a name here does not
 * delete its product_colour row — it simply stops maintaining it, leaving a
 * colour in the database that no longer appears in the chart while its sampling
 * stock still points at it. That is the fork described on ProductColour, and it
 * cannot be undone from the app.
 *
 * Two of these look like the site RESOLVING something rather than dropping it,
 * and two look like genuine absences. Recorded either way, because "the website
 * does not list it" is not the same fact as "we do not make it":
 *
 *   Artemis Grey/Deepwave  the site carries "Artemis Grey" (Eclipse) and
 *                          "Deepwave" (Nebula 3061) as two separate designs.
 *                          The slashed name is very likely the older way of
 *                          writing the pair.
 *   Arya                   the site carries "Arya Pearl" (3009). Possibly the
 *                          same design renamed, possibly a different one.
 *   Cappuccino Dark        no equivalent on the site at all.
 *   Statuario              no equivalent on the site at all.
 *
 * Confirm each with the owner before removing any of them. Until then they stay
 * in the chart and stay orderable.
 */
export const CHART_ONLY: string[] = [
  "Artemis Grey/Deepwave",
  "Arya",
  "Cappuccino Dark",
  "Statuario",
];

export const DESIGN_CODES: Record<string, string> = {
  "Adonis": "5059",
  "Alabaster": "3001",
  "Alabaster Noir": "3003",
  "Alchemy": "3004",
  "Almond Mist": "P10",
  "Alps": "5060",
  "Antonio": "3006",
  "Arena": "3007",
  "Arlina": "P05",
  "Artemis": "3058",
  "Arva White": "1002",
  "Arya Pearl": "3009",
  "Ashen Bloom": "P21",
  "Ashford": "3052",
  "Aspen Aura": "5001",
  "Atlantis": "3010",
  "Aureate": "3014",
  "Banyan": "3015",
  "Bellagio": "3016",
  "Belleza": "3017",
  "Bohemia": "3018",
  "Breeze": "3019",
  "Brilliant White": "1003",
  "Cascade": "P11",
  "Cemento": "1004",
  "Cherry Hill": "5068",
  "Cinder Flow": "P19",
  "Classic Gray": "1005",
  "Cleopatra": "3024",
  "Coastal Pearl": "5007",
  "Cosmopolitan": "3025",
  "Costa": "3026",
  "Crimson Flow": "P15",
  "Dazzle": "3027",
  "Deepwave": "3061",
  "Desert Brown": "4013",
  "Driftwood": "5010",
  "Echo White": "1001",
  "Elano": "P03",
  "Elvion": "P04",
  "Elvis": "3031",
  "Eminence": "3033",
  "Fern": "3036",
  "Florence": "5067",
  "Franklin": "5011",
  "French Vanilla": "5064",
  "Frost Vein": "P18",
  "Galactic Halo": "5012",
  "Glacial Silver": "3059",
  "Golden Dawn": "5013",
  "Havana": "5075",
  "Havelock": "5014",
  "Hazel Gold": "3039",
  "Hermes": "3040",
  "Himalayan Vein": "P14",
  "Honeydew": "3041",
  "Horizon Veil": "P22",
  "Ibiza": "3044",
  "Ikos": "3045",
  "Iris Blue": "3046",
  "Iris Gray": "3048",
  "Irish Cream": "5016",
  "Kandice": "5054",
  "Larvik": "5058",
  "Latte Luxe": "5040",
  "Linera": "P08",
  "Lumina Cristal": "P28",
  "Matcha Mist": "5076",
  "Medusa": "5062",
  "Merlot": "5063",
  "Mintara": "P02",
  "Mirano": "P07",
  "Mockingbird": "5050",
  "Mossline": "P23",
  "Mossveil": "P26",
  "Mystique": "2006",
  "Nestos": "5024",
  "Oakville": "5025",
  "Oasis": "2009",
  "Orenda": "P25",
  "Orva": "P09",
  "Paradise City": "5072",
  "Pebbles Ice": "1006",
  "Rovena": "P06",
  "Ruskin": "5028",
  "Sakura": "5077",
  "San Marino": "5071",
  "Seasons": "4005",
  "Silken": "4010",
  "Silver Haven": "P17",
  "Silverscape": "P20",
  "Skyline": "5056",
  "Snowveil": "P16",
  "Soft Veil": "3063",
  "Star Cluster": "1008",
  "Stella": "4002",
  "Stellar Ember": "5031",
  "Stone Lily": "P13",
  "Super White": "1009",
  "Suzuka": "5033",
  "Taj Vein": "P01",
  "Tokyo": "5034",
  "Tramento": "3050",
  "Ultima White": "1014",
  "Valencia": "5073",
  "Velluto": "P24",
  "Venetia": "4006",
  "Venezia": "5074",
  "Venice": "5041",
  "Venus Glow": "5036",
  "Walnut": "5070",
  "White Blizzard": "1011",
  "Winter Haze": "P12",
  "Wintersky": "4008",
  "Zenith": "2013",
};

// ---------------------------------------------------------------------------
// Name -> colour + finish
// ---------------------------------------------------------------------------

export interface SplitName {
  /** The colour name with any finish marker removed. */
  colour: string;
  /** The finish the marker named, or DEFAULT_FINISH when there was none. */
  finish: Finish;
  /** True when the listed name carried a finish marker. */
  marked: boolean;
}

/** Collapse runs of whitespace and trim — "  Taj   Vein " -> "Taj Vein". */
function tidy(name: string): string {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Split one listed chart name into a colour and a finish.
 *
 *   "Cappuccino (Leather)"      -> Cappuccino  / Leather
 *   "Alabaster Noir – Suede"    -> Alabaster Noir / Suede   (en-dash)
 *   "Cappuccino Dark"           -> Cappuccino Dark / Polished   (NOT a finish)
 *   "Artemis Grey/Deepwave"     -> Artemis Grey/Deepwave / Polished
 *   "Cappuccino (Dark)"         -> Cappuccino (Dark) / Polished (unknown word)
 *
 * A bare finish word on its own ("Leather") is a colour called Leather, not a
 * finish with no colour: stripping it would leave nothing to name the row.
 */
export function splitFinish(listedName: string): SplitName {
  const name = tidy(listedName);

  // Trailing "(...)": the bracket is the marker.
  const bracket = /^(.*\S)\s*\(([^()]+)\)$/.exec(name);
  if (bracket) {
    const finish = canonicalFinish(bracket[2]);
    if (finish) return { colour: tidy(bracket[1]), finish, marked: true };
  }

  // Trailing " - " / " – " / " — ": the dash must be SPACE-SEPARATED, so a
  // hyphenated colour name ("Blue-Grey") is never split.
  const dash = /^(.*\S)\s+[-–—]\s+(\S.*)$/.exec(name);
  if (dash) {
    const finish = canonicalFinish(dash[2]);
    if (finish) return { colour: tidy(dash[1]), finish, marked: true };
  }

  return { colour: name, finish: DEFAULT_FINISH, marked: false };
}

// ---------------------------------------------------------------------------
// The normalised catalogue
// ---------------------------------------------------------------------------

export interface CatalogueColour {
  /** The series this colour is listed under. */
  series: string;
  /** The colour name, finish marker removed. */
  name: string;
  /** Every finish this colour is listed in, in chart order. */
  finishes: Finish[];
}

/**
 * Fold the listed names into distinct colours.
 *
 * Order is preserved (series order, then first appearance within the series)
 * so the seed writes a stable, chart-shaped list and a re-run does not
 * reshuffle anything.
 *
 * A finish variant whose base colour is NOT separately listed still produces
 * the colour — with only that finish, not a default Polished it was never
 * listed in. All three of today's variants do have their base listed, in the
 * same series; the counts test would fail loudly if that stopped being true.
 */
export function normaliseCatalogue(series: ListedSeries[] = CATALOGUE_SERIES): CatalogueColour[] {
  const out: CatalogueColour[] = [];
  const index = new Map<string, CatalogueColour>();
  for (const s of series) {
    for (const listed of s.names) {
      const { colour, finish } = splitFinish(listed);
      // NUL delimiter: it cannot appear in a series or a colour name, so
      // "A" + "B C" and "A B" + "C" cannot collide into one key.
      const key = `${s.name}\u0000${colour.toLowerCase()}`;
      let row = index.get(key);
      if (!row) {
        row = { series: s.name, name: colour, finishes: [] };
        index.set(key, row);
        out.push(row);
      }
      if (!row.finishes.includes(finish)) row.finishes.push(finish);
    }
  }
  return out;
}

/** The chart, normalised. 56 colours, three of which carry a second finish. */
export const CATALOGUE_COLOURS: CatalogueColour[] = normaliseCatalogue();

export interface CatalogueCounts {
  series: number;
  /** Names printed on the chart, finish variants included. */
  listedNames: number;
  /** The header numbers added up — 57, which is NOT listedNames. */
  declaredNames: number;
  /** Distinct colours after the finish variants are folded in. */
  colours: number;
  /** Colour+finish rows: one per listed name. */
  colourFinishes: number;
  /** Colours carrying more than one finish. */
  multiFinishColours: number;
}

export function catalogueCounts(series: ListedSeries[] = CATALOGUE_SERIES): CatalogueCounts {
  const colours = normaliseCatalogue(series);
  return {
    series: series.length,
    listedNames: series.reduce((n, s) => n + s.names.length, 0),
    declaredNames: series.reduce((n, s) => n + s.declaredCount, 0),
    colours: colours.length,
    colourFinishes: colours.reduce((n, c) => n + c.finishes.length, 0),
    multiFinishColours: colours.filter((c) => c.finishes.length > 1).length,
  };
}

export interface CatalogueDiscrepancy {
  series: string;
  declared: number;
  listed: number;
}

/** Series whose printed header count does not match the names underneath it.
 *  Today: Eclipse only (10 declared, 12 listed). Reported rather than fixed —
 *  see the note on CATALOGUE_SERIES. */
export function catalogueDiscrepancies(series: ListedSeries[] = CATALOGUE_SERIES): CatalogueDiscrepancy[] {
  return series
    .filter((s) => s.declaredCount !== s.names.length)
    .map((s) => ({ series: s.name, declared: s.declaredCount, listed: s.names.length }));
}

/**
 * Things that would make the catalogue unwritable, as opposed to merely
 * unverified. The seed refuses to run when this is non-empty, because a
 * half-written master list in production is worse than no run at all.
 *
 * The header-count mismatches above are deliberately NOT problems: they are
 * facts about the chart. These are contradictions in the list itself.
 */
export function catalogueProblems(series: ListedSeries[] = CATALOGUE_SERIES): string[] {
  const problems: string[] = [];
  const seriesSeen = new Set<string>();
  for (const s of series) {
    const key = s.name.toLowerCase();
    if (seriesSeen.has(key)) problems.push(`Series "${s.name}" is listed twice.`);
    seriesSeen.add(key);
    if (!tidy(s.name)) problems.push("A series has no name.");
  }

  // product_colour.name is globally unique, so the same colour name under two
  // series would fail the seed's second upsert with a constraint error.
  const owner = new Map<string, string>();
  for (const c of normaliseCatalogue(series)) {
    if (!c.name) {
      problems.push(`Series "${c.series}" lists an empty colour name.`);
      continue;
    }
    const key = c.name.toLowerCase();
    const already = owner.get(key);
    if (already && already !== c.series) {
      problems.push(`Colour "${c.name}" is listed under both ${already} and ${c.series}.`);
    }
    owner.set(key, c.series);
  }
  return problems;
}
