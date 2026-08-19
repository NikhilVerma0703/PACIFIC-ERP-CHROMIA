// Clear the Fab module's transactional data so the module can be started fresh.
//
//     npx tsx scripts/fab-archive.mts     # take the archive FIRST
//     npx tsx scripts/fab-reset.mts       # then this
//
// WHAT IS KEPT, AND WHY ONLY THIS
// fab_machine is the only master here: seven machines describing the physical
// shop, created by prisma/seed.ts and by nothing else — /api/fab/machines is
// GET-only, so there is no screen that can put them back. Everything else is a
// record of work. fab_operation looks like a catalogue by its name and is not:
// it carries pieceId, operatorId and a start time, and is written when an
// operator starts a job.
//
// TRUNCATE WITHOUT CASCADE, DELIBERATELY
// Every fab table that references another is in the list, so one multi-table
// TRUNCATE resolves the order itself. Leaving CASCADE off makes Postgres
// REFUSE if some table outside this list points into it, instead of quietly
// emptying that table too. An error here is the safety feature.
import { prisma } from "@/lib/prisma";

const KEEP = new Set(["fab_machine"]);

const tables = (
  await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'fab%' ORDER BY 1`,
  )
).map((t) => t.table_name);

const target = tables.filter((t) => !KEEP.has(t));

const countOf = async (t: string) =>
  Number((await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}"`))[0].n);

const before: Record<string, number> = {};
for (const t of tables) before[t] = await countOf(t);

console.log("Clearing:");
for (const t of target) console.log(`  ${t.padEnd(28)} ${String(before[t]).padStart(6)}`);
console.log("Keeping:");
for (const t of tables.filter((t) => KEEP.has(t))) console.log(`  ${t.padEnd(28)} ${String(before[t]).padStart(6)}`);

const list = target.map((t) => `"${t}"`).join(", ");
await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY`);

let cleared = 0;
for (const t of tables) {
  const after = await countOf(t);
  if (KEEP.has(t)) {
    if (after !== before[t]) throw new Error(`${t} was meant to be kept but changed: ${before[t]} -> ${after}`);
  } else {
    if (after !== 0) throw new Error(`${t} still holds ${after} rows`);
    cleared += before[t];
  }
}
console.log(`\nCleared ${cleared} rows from ${target.length} tables. ${tables.length - target.length} table kept intact.`);
await prisma.$disconnect();
