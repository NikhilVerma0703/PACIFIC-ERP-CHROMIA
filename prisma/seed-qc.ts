/**
 * Local-development QC stock for the fabrication slab picker.
 *
 * WHY THIS EXISTS
 * ---------------
 * `polish_qc` is production data imported from the polishing line — it is never
 * created by the ERP itself. On a fresh local database it is empty, so the
 * fabrication slab picker (/api/fab/slabs) has nothing to offer and the
 * supervisor's Slab & Sink Assignment board cannot be exercised at all.
 *
 * This seeds plausible rows so the whole flow can be walked locally. It is
 * DEVELOPMENT ONLY and refuses to run against a non-local database — see the
 * guard in main(). Never point it at Neon.
 *
 * WHAT MAKES A SLAB PICKABLE (mirrored from src/app/api/fab/slabs/route.ts)
 * ------------------------------------------------------------------------
 *   - slab_number IS NOT NULL          — rows without one are skipped outright
 *   - rw_status IS NULL, or            — 686 live rows genuinely have no status
 *     rw_status <> 'RW Required and ongoing'
 *
 * "Can't be Reworked" deliberately stays pickable: it is a final grade, not work
 * in progress, and cutting a reject down into small pieces is a legitimate thing
 * to do with it.
 *
 * THICKNESS IS FREE TEXT typed by inspectors. The live distribution, by
 * frequency, is documented in src/lib/fab/qcSlabQuery.ts: "3 cm" 23910,
 * "2 cm" 16900, "3 cm to 2 cm" 2052, "12 mm" 475, "2cm to 8mm" 133, ... The
 * spellings below reproduce that spread ON PURPOSE — including the spaceless
 * and range forms — so the thickness prefilter is exercised against the same
 * mess it meets in production rather than against tidy values.
 *
 * Run:  npm run db:seed:qc
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Designs. "Arva White" leads because it is what PO 10026 orders, so the
 *  supervisor has matching stock to cut the sample PO from. */
const DESIGNS = [
  { design: "Arva White", sku: "AW-2CM", batch: "1401" },
  { design: "Carrara Royale", sku: "CR-3CM", batch: "1388" },
  { design: "Super White", sku: "SW-3CM", batch: "1376" },
  { design: "Calacatta Gold", sku: "CG-2CM", batch: "1392" },
];

const GRADES = ["A", "A", "A", "B", "B", "C"];
const BAYS = ["Bay 1", "Bay 2", "Bay 3"];

type Row = {
  airtableId: string;
  slabNumber: number;
  batchNumber: string;
  batchKey: string;
  design: string;
  sku: string;
  slabThickness: string;
  qualityGrade: string;
  rwStatus: string | null;
  dispatchStatus: string;
  bay: string;
  inspector: string;
};

function build(): Row[] {
  const rows: Row[] = [];
  let n = 146800; // 6-digit slab numbers, matching the live shape

  const push = (
    d: (typeof DESIGNS)[number],
    thickness: string,
    rwStatus: string | null,
    i: number,
  ) => {
    n += 1;
    rows.push({
      airtableId: `seedqc-${n}`, // @unique — prefixed so seeded rows are obvious
      slabNumber: n,
      batchNumber: d.batch,
      batchKey: d.batch,
      design: d.design,
      sku: d.sku,
      slabThickness: thickness,
      qualityGrade: GRADES[i % GRADES.length],
      rwStatus,
      dispatchStatus: "In Stock",
      bay: BAYS[i % BAYS.length],
      inspector: "Seed Inspector",
    });
  };

  // 24 x Arva White @ 2 cm — the stock PO 10026 is cut from. 2,233.99 sqft of
  // order against ~75 sqft of usable slab needs ~30 at zero waste, so this is
  // deliberately not quite enough: the supervisor runs out and has to notice.
  for (let i = 0; i < 24; i++) push(DESIGNS[0], "2 cm", i === 5 ? null : "Direct Ok", i);

  // 8 x 3 cm across two designs, to prove the thickness filter narrows.
  for (let i = 0; i < 8; i++) push(DESIGNS[1 + (i % 2)], "3 cm", "RW Done Ok", i);

  // The awkward spellings. All of these must still be reachable — the prefilter
  // in qcSlabQuery.thicknessPrefixes exists precisely so they are.
  push(DESIGNS[3], "3 cm to 2 cm", "Direct Ok", 0);
  push(DESIGNS[3], "2cm to 8mm", "Direct Ok", 1);
  push(DESIGNS[3], "12 mm", "Direct Ok", 2);
  push(DESIGNS[3], "2 cm to 1 cm", null, 3);

  // Final-grade rejects: still pickable by design, cut down into small pieces.
  push(DESIGNS[0], "2 cm", "Can't be Reworked", 4);
  push(DESIGNS[1], "3 cm", "Can't be Reworked", 5);

  // Rework in progress: these MUST NOT appear in the picker. If they do, the
  // eligibility filter has regressed.
  for (let i = 0; i < 3; i++) push(DESIGNS[0], "2 cm", "RW Required and ongoing", i);

  return rows;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1|@postgres[:/]/.test(url)) {
    throw new Error(
      "seed-qc refuses to run: DATABASE_URL does not look local.\n" +
      "polish_qc is production data imported from the polishing line — seeding\n" +
      "fake slabs into a real database would put phantom stock in front of the\n" +
      "shop floor. Point DATABASE_URL at the docker Postgres and try again.",
    );
  }

  const rows = build();
  let written = 0;
  for (const r of rows) {
    await prisma.polishQc.upsert({
      where: { airtableId: r.airtableId },
      update: r,
      create: r,
    });
    written++;
  }

  const pickable = rows.filter(
    (r) => r.rwStatus === null || r.rwStatus !== "RW Required and ongoing",
  ).length;

  console.log(`polish_qc: ${written} seeded slabs (upserted, safe to re-run).`);
  console.log(`  pickable in the fab slab picker: ${pickable}`);
  console.log(`  hidden as rework-in-progress:    ${written - pickable}`);
  console.log(`  Arva White @ 2 cm (PO 10026 stock): ${rows.filter((r) => r.design === "Arva White" && r.slabThickness === "2 cm" && r.rwStatus !== "RW Required and ongoing").length}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
