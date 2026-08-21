import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// CONTAINMENT. The owner's hardest constraint on silo-wise grit, verbatim:
//
//   "it should just flag and override in the costing table only and not is
//    silo/mixer fifo or anywhere else"
//
// A size or supplier entered in costing must never reach a Silo record, a mixer
// cycle, the FIFO bag allocator, silo stock, the deficit tools, silo correction,
// the detailed or slab report, or the Telegram bot. Every one of those reads the
// same silo data this feature compares against.
//
// This file is the proof, and it is deliberately structural rather than
// behavioural: it fails at the IMPORT, before an offending call can be written,
// so the failure lands on whoever adds the edge rather than on whoever later
// notices the silo table changed. An intention in a comment is not containment.

const ROOT = join(import.meta.dirname, "..");
const COSTING = join(ROOT, "src/lib/costing");

/** Every module in the costing domain. */
function costingFiles(): string[] {
  return readdirSync(COSTING).filter((f) => f.endsWith(".ts")).map((f) => join(COSTING, f));
}

/** The modules that own, mutate or report silo and mixer state. A costing
 *  module reaching any of them is the edge this feature must not have. */
const FORBIDDEN_IMPORTS = [
  "@/lib/silo", "@/lib/siloCorrection", "@/lib/siloClass", "@/lib/backfill",
  "@/lib/automations-silo", "@/lib/automations-stock", "@/lib/mixerFifo",
  "@/lib/mixerSharing", "@/lib/detailedReport", "@/lib/slabReport",
  "@/lib/telegramAsk", "@/lib/rmStock", "@/lib/erp",
];

test("no costing module imports the silo, mixer, FIFO or report modules", () => {
  const offences: string[] = [];
  for (const file of costingFiles()) {
    const src = readFileSync(file, "utf8");
    for (const banned of FORBIDDEN_IMPORTS) {
      // `from "<banned>"` or `from "<banned>/..."` — not a substring match, so
      // "@/lib/siloCorrection" does not trip the "@/lib/silo" rule spuriously.
      const re = new RegExp(`from\\s+["']${banned.replace(/[/\\-]/g, "\\$&")}(["'/])`);
      if (re.test(src)) offences.push(`${file.replace(ROOT + "/", "")} imports ${banned}`);
    }
  }
  assert.deepEqual(offences, [], `costing reached into silo/mixer territory:\n${offences.join("\n")}`);
});

test("no costing module WRITES to a silo or mixer row, by any route", () => {
  // The import ban above catches module edges. It does not catch raw SQL, and
  // batchData.ts already SELECTs from silo directly — reading is the whole point
  // of comparing against the bag records. What must never happen is a write.
  //
  // So this asserts the thing the owner actually asked for, rather than the
  // thing that is easy to assert: no costing module may mutate silo or mixer
  // state through Prisma or through raw SQL.
  const offences: string[] = [];
  const WRITE = [
    /\b(prisma|db|tx)\.silo\.(update|updateMany|upsert|create|createMany|delete|deleteMany)\b/,
    /\b(prisma|db|tx)\.mixerCycle\.(update|updateMany|upsert|create|createMany|delete|deleteMany)\b/,
    /\bUPDATE\s+"?silo"?\b/i,
    /\bINSERT\s+INTO\s+"?silo"?\b/i,
    /\bDELETE\s+FROM\s+"?silo"?\b/i,
    /\bUPDATE\s+"?mixer_cycle"?\b/i,
    /\bINSERT\s+INTO\s+"?mixer_cycle"?\b/i,
    /\bDELETE\s+FROM\s+"?mixer_cycle"?\b/i,
  ];
  for (const file of costingFiles()) {
    const src = readFileSync(file, "utf8");
    for (const re of WRITE) {
      if (re.test(src)) offences.push(`${file.replace(ROOT + "/", "")} matches ${re}`);
    }
  }
  assert.deepEqual(offences, [], `costing wrote to silo/mixer state:\n${offences.join("\n")}`);
});

test("the grit assignment module imports nothing at all", () => {
  // It holds the comparison rules. Anything it imported would become reachable
  // from every caller of a matcher, which is how a containment boundary rots.
  const src = readFileSync(join(COSTING, "gritAssign.ts"), "utf8");
  assert.equal(/^\s*import\s/m.test(src), false, "gritAssign.ts must stay import-free");
});

// --------------------------------------------------------------- the schema

const SCHEMA = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");

function modelBlock(name: string): string {
  const m = SCHEMA.match(new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `model ${name} not found in schema.prisma`);
  return m![1];
}

test("neither grit assignment table relates to anything", () => {
  for (const model of ["CostingBatchGritSilo", "CostingBatchGritSupplier"]) {
    const body = modelBlock(model);
    assert.equal(/@relation/.test(body), false, `${model} must have no @relation`);
    // A field typed Silo or MixerCycle is a traversable edge even without an
    // explicit @relation attribute.
    assert.equal(/\b(Silo|MixerCycle|FinishedSlab)(\[\])?\s*(@|$)/m.test(body), false,
      `${model} must not carry a field typed as a silo/mixer/slab model`);
  }
});

test("the Silo model gains no back-reference to costing", () => {
  // The other direction matters just as much: a back-reference would let a silo
  // query pull an assignment in, and then somebody would write through it.
  const body = modelBlock("Silo");
  assert.equal(/CostingBatchGrit/.test(body), false,
    "Silo must not reference the grit assignment tables");
});

test("the price lives on the SPLIT LINE, and the silo still carries no money", () => {
  // THIS REVERSES scripts/0049's rule, on the owner's instruction (2026-08-21).
  // The old test asserted neither assignment table carried money at all, on the
  // grounds that the price lived in costing_batch_material. That turned out to
  // be unreachable: report.ts prices an assigned silo from a line keyed
  // `grit-silo-<n>`, and the only route that writes that table validates against
  // a fixed catalogue which cannot contain a silo number. Every assigned batch
  // therefore reported its grit unpriced and withheld the whole sheet - batch
  // 1415 in production, six silos, zero priced lines.
  //
  // Worth knowing: the old assertion could not have caught this field anyway.
  // It tested for a column named `rate` on a word boundary, and the column
  // is `ratePerT`, so it never matched. It would have gone on passing while
  // asserting something false, which is worse than not testing it at all.
  const silo = modelBlock("CostingBatchGritSilo");
  const supplier = modelBlock("CostingBatchGritSupplier");

  // The SILO still holds no money. A rate here would price a whole silo at one
  // figure, which is the thing the supplier split exists to avoid: a silo is
  // split BECAUSE the supplier differs, and a different supplier is a different
  // invoice at a different price.
  for (const money of ["ratePerT", "rate", "price", "amount", "cost", "inr", "rupees"]) {
    assert.equal(new RegExp(`^\\s*${money}\\b`, "mi").test(silo), false,
      `CostingBatchGritSilo must not carry a "${money}" column`);
  }

  // The SPLIT LINE holds exactly one money column, and it is NULLABLE.
  assert.match(supplier, /^\s*ratePerT\s+Float\?/mi,
    "the rate must be Float? - null means unpriced, and 0 would mean free");
  for (const money of ["price", "amount", "cost", "inr", "rupees"]) {
    assert.equal(new RegExp(`^\\s*${money}\\b`, "mi").test(supplier), false,
      `CostingBatchGritSupplier must not also carry a "${money}" column`);
  }

  // Null must stay expressible. A default would make "not priced yet"
  // unrepresentable and silently cost unpriced grit at that default.
  assert.equal(/^\s*ratePerT\s+Float\?\s+@default/mi.test(supplier), false,
    "ratePerT must have no default - unpriced has to stay distinct from priced");
});

test("the migration creates only — it alters, drops and moves nothing", () => {
  const sql = readFileSync(join(ROOT, "scripts/0049-costing-grit-silo-assignment.sql"), "utf8");
  const statements = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  for (const destructive of ["DROP TABLE", "DROP COLUMN", "ALTER TABLE", "DELETE FROM", "UPDATE ", "TRUNCATE"]) {
    assert.equal(statements.toUpperCase().includes(destructive), false,
      `0049 must not contain ${destructive}`);
  }
  // Re-runnable, like every hand-applied script in this repo.
  const creates = statements.match(/CREATE (TABLE|UNIQUE INDEX|INDEX)/g) ?? [];
  const guarded = statements.match(/CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS/g) ?? [];
  assert.equal(creates.length, guarded.length, "every CREATE in 0049 must be IF NOT EXISTS");
});
