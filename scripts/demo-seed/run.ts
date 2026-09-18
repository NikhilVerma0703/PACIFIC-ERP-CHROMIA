// SEED THE DEMO DATABASE — and nothing else, ever.
//
// `pacificdemo` is a separate Postgres database on the same Neon endpoint as
// production. It exists so the ERP can be shown to an outsider without a single
// real customer, price or slab being visible. Isolation is at the CONNECTION,
// not in the application: 334 files import the Prisma singleton and there are
// 282 raw SQL sites, so a "demo mode" flag that every one of them had to honour
// would leak the first time one was missed. A different database name in the
// connection string cannot leak — there is nothing to miss.
//
// THE GUARD BELOW IS THE WHOLE SAFETY MODEL. This script deletes before it
// writes, so pointed at production it would be a catastrophe. It therefore
// refuses to start unless the database it is connected to is literally called
// `pacificdemo` — checked by asking POSTGRES, not by trusting the string we
// built. Read the assertion before changing anything here.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const DEMO_DB = "pacificdemo";
const PROD_DB = "neondb";

function demoUrl(): string {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const prod = env.DATABASE_URL;
  if (!prod) throw new Error("No DATABASE_URL in .env.local");
  const url = prod.replace(`/${PROD_DB}?`, `/${DEMO_DB}?`);
  if (url === prod) throw new Error(`Refusing: could not swap /${PROD_DB} for /${DEMO_DB} in DATABASE_URL`);
  if (!url.includes(`/${DEMO_DB}?`)) throw new Error("Refusing: the swapped URL does not name the demo database");
  return url;
}

export interface Ctx {
  designs: string[];
  batches: string[];
  users: { id: string; name: string; email: string; role: string }[];
  clients: { id: string; name: string }[];
  now: Date;
  daysAgo: (n: number) => Date;
}

// Invented. None of these is a Pacific design — that is the point of them.
const DESIGNS = [
  "Aurora Mist", "Verona Grey", "Lunar Quartz", "Cascade White", "Umber Vein",
  "Selene Cream", "Basalt Noir", "Corvina Gold", "Pale Harbour", "Ferro Grey",
  "Linen Frost", "Opal Drift", "Slate Meridian", "Ivory Reef", "Bronze Canyon",
  "Nimbus White", "Cinder Storm", "Peridot Sand", "Marlow Beige", "Onyx Tide",
  "Quarry Ash", "Silver Birch", "Terra Dune", "Glacier Vein",
];
// NUMERIC, and that is not cosmetic. normalizeBatch() strips a leading run of
// letters ("C1185" -> "1185"), so a batch called "DEM.0101" canonicalises to
// ".0101" while the slab still carries "DEM.0101" — the batch lookup then joins
// nothing. Pacific's canonical batch key IS the number, so the demo uses one.
const BATCHES = Array.from({ length: 18 }, (_, i) => String(2101 + i));

async function main(): Promise<void> {
  const url = demoUrl();
  const db = new PrismaClient({ datasourceUrl: url });

  // ── the guard: ask the server which database this actually is ─────────────
  const who = await db.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
  const actual = who[0]?.db;
  if (actual !== DEMO_DB) {
    await db.$disconnect();
    throw new Error(
      `REFUSING TO SEED. Connected to "${actual}", not "${DEMO_DB}". ` +
      `This script deletes before it writes and must never run anywhere else.`,
    );
  }
  console.log(`connected to ${actual} — confirmed by the server, not by the string\n`);

  // ── WIPE FIRST. The modules use skipDuplicates, so a re-seed after a change
  //    would leave the old rows beside the new ones — and a batch number that
  //    changed format would leave slabs pointing at batches nothing else knows.
  //    Every table in the public schema, in one statement, with the guard above
  //    already satisfied.
  const tables = await db.$queryRawUnsafe<{ t: string }[]>(
    `SELECT quote_ident(tablename) AS t FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (tables.length) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((r) => r.t).join(", ")} RESTART IDENTITY CASCADE`);
    console.log(`wiped ${tables.length} tables
`);
  }

  const now = new Date();
  const ctx: Ctx = {
    designs: DESIGNS,
    batches: BATCHES,
    users: [],
    clients: [],
    now,
    daysAgo: (n: number) => new Date(now.getTime() - n * 86_400_000),
  };

  // Order matters: later modules read ctx that earlier ones fill.
  const modules = [
    "10-users", "20-catalogue", "30-production",
    "40-inventory", "50-commercial", "60-fab", "70-sampling", "80-costing",
  ];

  for (const name of modules) {
    process.stdout.write(`${name} … `);
    try {
      const mod = await import(`./${name}.ts`);
      await mod.seed(db, ctx);
      console.log("done");
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message}`);
    }
  }

  // ── what the demo now holds ───────────────────────────────────────────────
  const counts = await db.$queryRawUnsafe<{ relname: string; n: number }[]>(
    `SELECT relname, n_live_tup::int AS n FROM pg_stat_user_tables
      WHERE n_live_tup > 0 ORDER BY n_live_tup DESC LIMIT 20`,
  );
  console.log("\nrows in the demo database:");
  for (const r of counts) console.log(`   ${r.relname.padEnd(32)}${String(r.n).padStart(7)}`);
  const total = await db.$queryRawUnsafe<{ n: number }[]>(
    "SELECT COALESCE(SUM(n_live_tup),0)::int AS n FROM pg_stat_user_tables",
  );
  console.log(`   ${"TOTAL".padEnd(32)}${String(total[0]?.n ?? 0).padStart(7)}`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
