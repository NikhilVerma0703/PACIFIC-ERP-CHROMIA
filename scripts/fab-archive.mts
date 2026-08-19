// Dump every Fab table to a JSON archive before anything destructive touches
// them. Written to /db-archives, which .gitignore already reserves for exactly
// this: "local database dumps taken before a destructive migration. Real
// backups — ignored so they stay out of git, NOT because they are disposable."
//
//     npx tsx scripts/fab-archive.mts [outDir]
//
// Restoring is a deliberate act, not a script: read the archive, decide what
// belongs, and insert it back in dependency order. The point of this file is
// that the decision remains possible.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

const outDir = process.argv[2] ?? "db-archives";
mkdirSync(outDir, { recursive: true });

const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE 'fab%' ORDER BY 1`,
);

const archive: Record<string, unknown[]> = {};
let total = 0;
for (const { table_name } of tables) {
  const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${table_name}"`);
  archive[table_name] = rows;
  total += rows.length;
  console.log(`${table_name.padEnd(28)} ${String(rows.length).padStart(6)}`);
}

// A timestamp cannot come from inside the archive it names, so it is taken
// here and written into the file as well as the filename.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = join(outDir, `fab-${stamp}.json`);
writeFileSync(
  file,
  JSON.stringify(
    { takenAt: new Date().toISOString(), database: "neondb", tables: Object.keys(archive), rows: total, archive },
    (_k, v) => (typeof v === "bigint" ? Number(v) : v),
    1,
  ),
);
console.log(`\n${total} rows from ${tables.length} tables -> ${file}`);
await prisma.$disconnect();
