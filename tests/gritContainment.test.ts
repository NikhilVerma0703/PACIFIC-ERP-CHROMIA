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

test("no money column on either assignment table", () => {
  // The price lives in costing_batch_material and nowhere else. A rate here
  // would be a second pricing path and a rupee value on a screen that carries
  // none — see scripts/0049 for the full reasoning.
  for (const model of ["CostingBatchGritSilo", "CostingBatchGritSupplier"]) {
    const body = modelBlock(model);
    for (const money of ["rate", "price", "amount", "cost", "inr", "rupees"]) {
      assert.equal(new RegExp(`^\\s*${money}\\b`, "mi").test(body), false,
        `${model} must not carry a "${money}" column`);
    }
  }
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
