import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// WHICH QC WRITES ARE ALLOWED TO MOVE A SLAB.
//
// THE INCIDENT. Every PolishQc EDIT ran autolinkFinishedSlabFromQc, and that
// function clears frameNumber ("location clears on re-QC; dispatch re-assigns
// it") and writes the QC row's bay back over inventory's. So fixing a typo in
// the inspector's name on a months-old QC row cleared the frame of a slab that
// dispatch had already located and silently restored a stale bay — the loading
// crew then searched a bay no event ever mentioned.
//
// The repair was to make the caller ASK for the relocation and to refuse it for
// slabs that are no longer plain stock. Both halves of that repair were then
// wrong in a way no unit test could see, because both live inside functions
// that need a database:
//
//   * the caller granted the relocation on a qualityGrade change — and saveRow
//     force-sets qualityGrade to "Not graded yet" whenever the form submits a
//     blank one, so for the 194 polish_qc rows with a NULL/blank grade (live
//     Neon, 2026-09-03) EVERY edit compared "Not graded yet" against "" and
//     claimed a grade change. The original bug, straight back through the fix.
//   * the callee refused only RESERVED and PACKED, and fg_finished_slab holds
//     ZERO rows in either (16,748 AVAILABLE, 6,536 DISPATCHED, 62 CHROMIA on
//     the same count). The guard protected nothing while 613 framed DISPATCHED
//     and CHROMIA slabs were still relocated by any QC write that asked.
//
// STRUCTURAL, like tests/inventorySummaryColumns.test.ts, and for the same
// reason: nothing throws in either failure. The write succeeds, the slab simply
// is not where the record says it is, and the only witness is a man in the yard
// who cannot find it. These assertions are the cheapest thing that notices a
// re-tightening or a re-loosening of either half.

const finishedSlab = readFileSync(new URL("../src/lib/inventory/finishedSlab.ts", import.meta.url), "utf8");
const tableActions = readFileSync(new URL("../src/app/tables/actions.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

/** The statuses a QC write may re-place, as the source actually lists them. */
function relocatableStatuses(): string[] {
  const m = finishedSlab.match(/RELOCATABLE_STATUSES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "RELOCATABLE_STATUSES is gone from finishedSlab.ts — the allow-list this file guards no longer exists");
  return [...m![1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
}

/** Every member of the Prisma SlabStatus enum. */
function slabStatuses(): string[] {
  const m = schema.match(/enum\s+SlabStatus\s*\{([^}]*)\}/);
  assert.ok(m, "enum SlabStatus is gone from schema.prisma");
  return m![1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
}

test("QC may re-place a slab only while it is still plain stock", () => {
  const allowed = relocatableStatuses();
  const all = slabStatuses();

  // Sanity first: a typo'd status name would silently refuse EVERY relocation,
  // which is the over-tight failure this whole round of fixes is about.
  for (const s of allowed) assert.ok(all.includes(s), `RELOCATABLE_STATUSES names "${s}", which is not a SlabStatus`);

  // AVAILABLE: plain stock — QC is what places it, so QC may re-place it.
  assert.ok(allowed.includes("AVAILABLE"), "AVAILABLE must stay relocatable — 16,748 rows, and QC placing plain stock is the normal case");
  // RETURNED: came back off a lorry; the re-QC IS the pass that re-places it.
  assert.ok(allowed.includes("RETURNED"), "a returned slab is re-QC'd to be re-placed — refusing it would refuse legitimate work");

  // And the statuses where inventory's location is the one the floor works from.
  for (const s of ["DISPATCHED", "CHROMIA", "RESERVED", "PACKED", "CTS"])
    assert.ok(!allowed.includes(s), `${s} slabs must NOT be relocated by a QC write — that is the incident`);
});

test("the relocation is an allow-list, not a blacklist of statuses nobody holds", () => {
  // The distinction is the entire lesson of the incomplete fix: a blacklist of
  // RESERVED/PACKED guarded 0 rows. An allow-list also means a status ADDED to
  // the schema later is non-relocatable by default, which is the safe default.
  assert.match(
    finishedSlab,
    /const held\s*=\s*!!existing\s*&&\s*!\(RELOCATABLE_STATUSES as readonly string\[\]\)\.includes\(existing\.status\)/,
    "`held` must be derived by NEGATING the allow-list — a hand-written status test drifts from RELOCATABLE_STATUSES"
  );
});

test("a QC grade edit never grants a relocation", () => {
  // The real assignment, not the `let qcRelocates = false;` declaration above it.
  const expr = [...tableActions.matchAll(/qcRelocates\s*=\s*([\s\S]*?);/g)]
    .map((x) => x[1]).find((x) => x.trim() !== "false");
  assert.ok(expr, "the qcRelocates decision is gone from saveRow");

  // Bay is the only QC field that asserts WHERE a slab is.
  assert.match(expr!, /fd\.has\("bay"\)/, "only an actually-changed bay may grant the relocation");
  // A grade says nothing about location, and — because of the force-set below —
  // reading it here fires on edits that touched no grade at all.
  assert.doesNotMatch(expr!, /qualityGrade/, "a qualityGrade change must not grant a relocation: it says nothing about where the slab is, and the auto-applied default makes it fire on unrelated edits");

  // The force-set is what made the grade comparison lie. If it is ever removed
  // this test's reasoning changes, so pin it here rather than leave it implicit.
  assert.match(
    tableActions,
    /fd\.has\("qualityGrade"\)[\s\S]{0,120}?data\.qualityGrade\s*=\s*"Not graded yet"/,
    "saveRow no longer force-sets the blank grade — re-read the qualityGrade reasoning above before relying on it"
  );
});
