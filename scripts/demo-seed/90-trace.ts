// MAKE EVERY SLAB TRACEABLE — the module that exists because the demo failed
// its first click-through.
//
// Slab Lookup answered "No slab 900001 found at any station", and it was right
// to. The seed modules had each invented their own slab numbers:
//
//     press / oven / jot / distributor      14200 .. 14407
//     polish_entry / polish_qc              80100 .. 80219
//     fg_finished_slab                     900001 .. 900600
//
// Three numbering schemes for one plant. slabReport walks Press, Oven, Jot,
// Distributor, Kreos, PolishEntry and PolishQc looking for the number you typed,
// so a finished slab could never be found: its number existed nowhere else.
//
// THE FIX IS ONE NUMBERING, and it is applied by CLONING rather than by writing
// fresh rows. Each station's columns are read from the database and a real row
// of the same batch is copied with only the slab number changed — so every
// required field, default and enum comes along already correct, and this module
// needs no knowledge of seven models it did not write.
//
// The original station rows are left alone. A slab that reached a station and
// never became finished goods is not a bug; it is wastage, and the plant has it.
import type { Ctx } from "./run.ts";

/** The stations slabReport actually walks, in journey order. */
const STATIONS = ["press", "oven", "jot", "distributor", "polish_entry", "polish_qc"];

export async function seed(db: any, ctx: Ctx): Promise<void> {
  void ctx;
  let added = 0;

  for (const table of STATIONS) {
    try {
      // UNIQUE COLUMNS CANNOT BE COPIED. The first attempt cloned airtableId
      // and Postgres refused: "Key (airtableId)=(recDEMPRDPR0000) already
      // exists." Any column under a unique index is dropped from the copy and
      // left to its default or NULL — Postgres permits many NULLs in a unique
      // index, so the rows coexist and nothing pretends to be an Airtable
      // record it is not.
      const uniq: { column_name: string }[] = await db.$queryRawUnsafe(
        `SELECT a.attname AS column_name
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indrelid
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
          WHERE c.relname = $1 AND i.indisunique`,
        table,
      );
      // ...and a unique column that is ALSO NOT NULL cannot simply be dropped:
      // the second attempt did that and Postgres refused with 23502, because
      // airtableId is both. Those get a value GENERATED from the slab number,
      // which is unique by construction and legible as a demo row.
      const meta: { column_name: string; is_nullable: string; data_type: string }[] =
        await db.$queryRawUnsafe(
          `SELECT column_name, is_nullable, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1`,
          table,
        );
      const notNull = new Map(meta.map((m) => [m.column_name, m.is_nullable === "NO"]));
      const isText = new Map(meta.map((m) => [m.column_name, /char|text/.test(m.data_type)]));

      const generated: string[] = [];
      for (const u of uniq) {
        const c = u.column_name;
        if (c === "id") continue;
        if (notNull.get(c) && isText.get(c)) generated.push(c);
      }

      // NOT EVERY STATION SPELLS THE BATCH THE SAME WAY. press/oven/jot carry
      // `batch`; polish_qc and polish_entry carry `batch_number` and no `batch`
      // at all, so hardcoding the name made both fail. Take whichever the table
      // actually has and set them all to the slab's own batch.
      const BATCH_COLS = ["batch", "batch_number", "batch_key"];
      const present = new Set(meta.map((m) => m.column_name));
      const batchCols = BATCH_COLS.filter((c) => present.has(c));

      const skip = new Set<string>([
        "id", "slab_number", ...batchCols,
        ...uniq.map((u) => u.column_name),
      ]);

      // The columns this table really has, minus the ones we set ourselves.
      const all: { column_name: string }[] = await db.$queryRawUnsafe(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        table,
      );
      const cols = all.filter((c) => !skip.has(c.column_name));
      if (!cols.length) { console.warn(`  [trace] ${table}: no columns, skipped`); continue; }
      const carried = cols.map((c) => `"${c.column_name}"`).join(", ");
      const genCols = generated.map((c) => `"${c}"`).join(", ");
      const genVals = generated
        .map((c) => `('dm-${table}-${c}-' || f.slab_number::text)`)
        .join(", ");

      // One INSERT per table. For every finished slab, copy a row of its own
      // batch — LATERAL so the template is chosen per slab — and take the slab's
      // number and batch. Slabs whose batch has no row at this station simply
      // produce nothing, which is what LATERAL ... LIMIT 1 does naturally.
      const sql = `
        INSERT INTO "${table}" (id, slab_number${batchCols.length ? ", " + batchCols.map((c) => `"${c}"`).join(", ") : ""}${genCols ? ", " + genCols : ""}${carried ? ", " + carried : ""})
        SELECT gen_random_uuid()::text, f.slab_number
               ${batchCols.length ? ", " + batchCols.map(() => "f.batch_number").join(", ") : ""}
               ${genVals ? ", " + genVals : ""}
               ${carried ? ", " + cols.map((c) => `t."${c.column_name}"`).join(", ") : ""}
          FROM fg_finished_slab f
          CROSS JOIN LATERAL (
            SELECT * FROM "${table}" s
             WHERE ${batchCols.length ? `s."${batchCols[batchCols.length - 1]}" = f.batch_number` : "TRUE"}
             LIMIT 1
          ) t
         WHERE f.slab_number IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM "${table}" x WHERE x.slab_number = f.slab_number
           )`;
      const n: number = await db.$executeRawUnsafe(sql);
      added += n;
      console.log(`  [trace] ${table.padEnd(14)} +${n} rows now carry a finished slab's number`);
    } catch (e) {
      console.warn(`  [trace] ${table}: skipped — ${(e as Error).message.split("\n")[0]}`);
    }
  }

  // Say plainly whether the thing this module exists for now works.
  try {
    const check: { n: number }[] = await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM fg_finished_slab f
        WHERE EXISTS (SELECT 1 FROM press p WHERE p.slab_number = f.slab_number)`,
    );
    const total: { n: number }[] = await db.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM fg_finished_slab`,
    );
    console.log(`  [trace] ${check[0].n} of ${total[0].n} finished slabs now trace back to the press (${added} rows added)`);
  } catch { /* the counts are a courtesy, not the work */ }
}
