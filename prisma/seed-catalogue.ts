/**
 * The Pacific colour chart: 7 series, 59 listed names, 56 colours.
 *
 * WHY THIS EXISTS
 * ---------------
 * The sampling module counts stock against a colour and a finish, and until
 * now the ERP had no curated colour master at all — polish_qc.design is free
 * text imported from the polishing line, fg_design_alias exists precisely
 * because that text has several spellings per colour, and the chromia and robo
 * "design" tables are about print artwork and machine programs. This writes the
 * owner's chart into product_series / product_colour / product_colour_finish,
 * which are deliberately NOT sampling-scoped: fabrication buys against these
 * same names (PO 10026 is Arva White) and should read them from here later.
 *
 * THIS IS MASTER DATA, NOT TEST DATA — the opposite of seed-qc.ts, which
 * refuses to run anywhere but a local database because it invents production
 * rows. This one is meant to be run against production; the chart IS the
 * truth, and a colour that is not in it cannot have stock counted against it.
 *
 * So there is NO environment guard, deliberately. There is an INTEGRITY guard
 * instead: catalogueProblems() runs before anything is written and aborts the
 * whole seed if the list has become self-contradictory (the same colour name
 * under two series would fail halfway through, leaving a production catalogue
 * half-written, which is worse than not running).
 *
 * IDEMPOTENT. Every write is an upsert keyed on the natural key — series name,
 * colour name, colour+finish — so re-running changes nothing. It is also
 * CORRECTIVE: re-running moves a colour that has been re-classified in the
 * source list back to the series the list says, and re-numbers positions. If
 * someone re-classifies a colour in the database by hand, the next run of this
 * will undo it. The list in src/lib/catalogue/colours.ts is the master.
 *
 * TWO NUMBERS IN THE SOURCE CHART DO NOT ADD UP. Neither has been verified
 * against the physical chart, and neither is silently corrected here:
 *
 *   1. ECLIPSE'S HEADER SAYS 10; TWELVE NAMES ARE LISTED. The printed
 *      numbering runs 1-8 and then repeats 7 and 8, so the last two lines
 *      (Elvion, Mintara) look like an addition nobody renumbered — but they
 *      could equally be two names that belong to another series. All 12 are
 *      imported.
 *   2. THE OWNER SAYS "6 SERIES"; THE CHART HAS 7. The likeliest reading is
 *      that Solids — Brilliant White and Super White — is not a range to him
 *      but a leftover bucket. All 7 are imported, Solids included.
 *
 * Both are printed at the end of every run so nobody has to read this comment
 * to find out, and tests/catalogueColours.test.ts pins them so a future edit to
 * the list cannot change the totals in silence.
 *
 * THREE OF THE 59 NAMES ARE FINISHES, NOT COLOURS (the owner's decision 3):
 * Cappuccino (Leather), Taj Vein (Leather) and Alabaster Noir - Suede are the
 * second finish of a colour that is listed separately. "Cappuccino Dark" is NOT
 * one of them — it is its own colour. The rule is in
 * src/lib/catalogue/colours.ts, which this imports rather than restates, so
 * what the tests pin is what reaches the database.
 *
 * Run:  npm run db:seed:catalogue
 */

import { PrismaClient } from "@prisma/client";
import {
  CATALOGUE_SERIES,
  CATALOGUE_COLOURS,
  FINISHES,
  catalogueCounts,
  catalogueDiscrepancies,
  catalogueProblems,
} from "../src/lib/catalogue/colours.ts";

const prisma = new PrismaClient();

async function main() {
  const problems = catalogueProblems();
  if (problems.length > 0) {
    throw new Error(
      "seed-catalogue refuses to run: the colour list contradicts itself.\n" +
      problems.map((p) => `  - ${p}`).join("\n") +
      "\nFix src/lib/catalogue/colours.ts first. Nothing has been written.",
    );
  }

  const counts = catalogueCounts();
  const seriesId = new Map<string, string>();

  for (const [i, s] of CATALOGUE_SERIES.entries()) {
    const row = await prisma.productSeries.upsert({
      where: { name: s.name },
      update: { position: i },
      create: { name: s.name, position: i },
    });
    seriesId.set(s.name, row.id);
  }

  let colours = 0;
  let finishes = 0;
  // position is the colour's place WITHIN ITS SERIES, so a pick-list filtered
  // to one series reads the way the printed chart does — hence a counter per
  // series rather than the index into the flat list.
  const nextPosition = new Map<string, number>();
  for (const c of CATALOGUE_COLOURS) {
    const parentId = seriesId.get(c.series);
    if (!parentId) throw new Error(`No series row for "${c.series}" — nothing written for ${c.name}.`);
    const position = nextPosition.get(c.series) ?? 0;
    nextPosition.set(c.series, position + 1);
    const colour = await prisma.productColour.upsert({
      where: { name: c.name },
      update: { seriesId: parentId, position },
      create: { name: c.name, seriesId: parentId, position },
    });
    colours++;
    // EVERY COLOUR IN EVERY FINISH.
    //
    // The owner: "I need the finish type of all — polished, suede, matte,
    // leathered", and later: "I said you to pull every colour, so now whatever
    // data I say, in production I need to feed to the DB as well."
    //
    // This used to write only the finishes the CHART listed, which is three
    // non-default rows out of 132 lines — so Carrara Royale had a Polished row
    // and nothing else, and the sample form could offer nothing else either.
    // But the chart printed the variants somebody had PHOTOGRAPHED, not the
    // finishes the shop can cut: any colour can be cut in any of the four on
    // request.
    //
    // So all four are written for every colour. 129 colours x 4 = 516 rows, and
    // a row with no stock against it costs nothing — the inventory screen hides
    // empty shelves by default, which is what that behaviour is for.
    //
    // The chart's own listing is still not lost: c.finishes is what the printed
    // chart said, and it is reported below so a re-classification still shows.
    for (const finish of FINISHES) {
      await prisma.productColourFinish.upsert({
        where: { colourId_finish: { colourId: colour.id, finish } },
        update: {},
        create: { colourId: colour.id, finish },
      });
      finishes++;
    }
  }

  console.log(`Catalogue seeded (upserted, safe to re-run).`);
  console.log(`  series:            ${CATALOGUE_SERIES.length}`);
  console.log(`  colours:           ${colours}`);
  console.log(`  colour+finishes:   ${finishes}  (every colour x ${FINISHES.length} finishes: ${FINISHES.join(", ")})`);
  console.log(`  second finishes:   ${counts.multiFinishColours} — ${CATALOGUE_COLOURS.filter((c) => c.finishes.length > 1).map((c) => `${c.name} (${c.finishes.join(", ")})`).join("; ")}`);
  console.log("");
  console.log("  UNVERIFIED NUMBERS IN THE SOURCE CHART — imported as listed, not corrected:");
  for (const d of catalogueDiscrepancies()) {
    console.log(`    ${d.series}: the header says ${d.declared}, ${d.listed} names are listed. All ${d.listed} imported.`);
  }
  console.log(`    The owner describes 6 series; the chart has ${CATALOGUE_SERIES.length}. All ${CATALOGUE_SERIES.length} imported, Solids included.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
