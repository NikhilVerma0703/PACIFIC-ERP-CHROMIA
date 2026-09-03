import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { slabMarkOf, SLAB_MARK_LABEL } from "../src/lib/fab/slabMark.ts";

// THE DAY THE GRADE BELT WAS CUT AWAY.
//
// tests/inventoryMarkFilter.test.ts pins the OR: a cut slab is one whose GRADE
// says cut OR whose MARK does, and every clause degrades to the grade rule when
// the mark column cannot be read. That degrade was safe for exactly one day.
//
// WHAT HAPPENED. scripts/0070 gave fg_finished_slab its slab_mark column, and
// then scripts/0071 and 0072 moved all 63 already-cut slabs from grade 'CTS' to
// grade 'B' on the owner's decision, because their real A/B/C verdicts were
// destroyed and are unrecoverable.
//
// MEASURED ON LIVE NEON, 2026-09-03, AFTER 0070/0071/0072:
//   * ZERO rows in fg_finished_slab and ZERO in polish_qc carry grade 'CTS' or
//     'SAMPLE'. The grade arm of every OR matches nothing at all.
//   * 63 rows carry slab_mark='CTS' (60 AVAILABLE, 1 status CTS, 2 DISPATCHED).
//     61 are on the floor and every one of those 61 reads grade 'B'.
//   * On-floor total 16,628 = A 8,304 + B 3,424 + C 2,346 + A2 859 + Trial 384
//     + ungraded 1,311 — so the grade cards are a partition and the cut count
//     overlaps them entirely.
//
// SO THE FALLBACK STOPPED BEING A SMALLER ANSWER AND BECAME A WRONG ONE. A
// grade-only clause counts 0 of 61 cut slabs, and its complement hands back all
// 61 as whole sellable stock. Refusing costs a phone call; answering puts
// already-cut stone on a customer's lorry.
//
// STRUCTURAL, like the file beside it and for the same reason: these modules
// import the Prisma client or React, so they cannot be imported under
// `node --test`, and every failure here is a number or a dash quietly being
// wrong rather than anything throwing.

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const searchWhere = read("../src/lib/inventory/searchWhere.ts");
const kpi = read("../src/app/api/inventory/kpi/route.ts");
const batchQuality = read("../src/app/api/inventory/batch-quality/route.ts");
const stockByDesign = read("../src/components/inventory/StockByDesign.tsx");
const dashboard = read("../src/components/inventory/InventoryDashboard.tsx");

/** The body of a top-level `export function name`, up to its closing brace. */
function fnBody(src: string, name: string): string {
  const at = src.indexOf(`export function ${name}`);
  assert.notEqual(at, -1, `${name} is gone`);
  const body = src.slice(at);
  return body.slice(0, body.indexOf("\n}"));
}

// ─────────────────────────────────────── the fallback that must not answer ──

test("the legacy-grade fallback really is dead — this is why the rest of this file exists", () => {
  // slabMarkOf(storedMark, legacyQualityGrade) is what every mark chip and the
  // export fall back to when a row carries no mark. It reads grade 'CTS' as a
  // cut slab — and after scripts/0071 and 0072 no cut slab carries that grade.
  assert.equal(SLAB_MARK_LABEL[slabMarkOf(undefined, "CTS")], "CTS", "the legacy path still works for a grade that says CTS");
  // …but this is what every one of the 61 cut slabs on the floor now looks like
  // to that fallback, and it is indistinguishable from a whole slab:
  assert.equal(slabMarkOf(undefined, "B"), "FULL_SLAB");
  assert.equal(slabMarkOf(null, "B"), "FULL_SLAB");
  // Which is the whole point: nothing may show a mark it did not read.
});

test("every cut/whole clause refuses to answer when the mark cannot be read", () => {
  // Not "returns fewer rows" — refuses. A grade-only clause now reports a yard
  // with no cut slabs in it, and `?mark=FULL_SLAB` lists all 61 cut slabs as
  // whole stock. Both are confident wrong answers, and both load a lorry.
  const helper = searchWhere.slice(searchWhere.indexOf("function noMarkNoAnswer"));
  assert.ok(helper.length, "the fail-closed helper is gone");
  assert.match(helper.slice(0, helper.indexOf("\n}")), /throw new Error/, "noMarkNoAnswer must throw, not return an empty clause");
  for (const fn of ["cutSignalWhere", "anyCutWhere", "wholeSlabWhere"]) {
    const decl = fnBody(searchWhere, fn);
    assert.match(decl, /hasMark\s*\?/, `${fn} must still branch on hasMark`);
    assert.ok(decl.includes("noMarkNoAnswer"), `${fn} still answers without the mark — it would report 0 cut slabs of 61`);
    // The grade arm STAYS on the true branch: it costs one OR arm and it is
    // what catches a routing state the day one reappears in the grade column.
    assert.ok(decl.includes("grade"), `${fn} stopped asking the grade — a routing word written there again would go unseen`);
    assert.ok(decl.includes("slabMark"), `${fn} stopped asking the mark — nothing would be findable at all`);
  }
});

test("a negative probe verdict expires instead of latching for the life of the process", () => {
  // The old comment called a latched `false` harmless because the process would
  // "keep filtering on the grade, which is precisely what it does today". With
  // the grade emptied of routing states, one misclassified error at boot left
  // that instance refusing (or, before this change, reporting zero) until
  // somebody restarted it. finishedSlab.ts already re-probes on a TTL; so does
  // this now, and it logs.
  const probe = searchWhere.slice(searchWhere.indexOf("export function slabMarkAvailable"));
  const decl = probe.slice(0, probe.indexOf("\n}"));
  assert.ok(/MARK_RECHECK_MS/.test(searchWhere), "there is no recheck interval — a false verdict latches for the process");
  assert.ok(decl.includes("slabMarkRecheckAt"), "slabMarkAvailable never expires its negative verdict");
  assert.match(decl, /slabMarkProbe = null/, "a stale negative verdict must clear the memo so the next call re-probes");
  assert.ok(decl.includes("console.error"), "a missing mark column must be logged — every cut count is about to refuse");
  // Unchanged and still load-bearing: only a missing column is cached at all.
  assert.match(decl, /if\s*\(!isMissingSlabMarkError\(e\)\)\s*throw e/, "a database in trouble must still be rethrown, never cached");
});

test("the KPI cut count is unknown-or-true, never a grade-only zero", () => {
  assert.ok(kpi.includes("anyCutWhere"), "the cut count must use the shared grade-OR-mark clause");
  assert.ok(!/anyCutWhere\(false\)/.test(kpi), "the grade-only fallback count is back — it reads 0 while 61 slabs on the floor are cut");
  assert.match(kpi, /cut,\s*cts:\s*cut/, "cts must keep working as the same number under its old name");
  assert.ok(kpi.includes("ctsStatus"), "the CTS *status* count must keep its own name");
  // `null` is the only honest answer when the mark cannot be read. 0 is a real
  // and very different answer, and it is the one people quote against.
  assert.match(kpi, /cutCount:\s*Promise<number \| null>/, "the cut count must be nullable — unknown is not zero");
});

// ─────────────────────────────────── the Sales drill-down (the one screen) ──

test("the batch-quality route actually sends the mark it is asked for", () => {
  // THE REGRESSION. The popup's Mark column shipped reading `s.mark` while this
  // route's explicit select did not fetch slab_mark and its mapping emitted no
  // `mark` key, so every slab in the plant rendered "—" — including all 63 cut
  // ones. Before the regrade those rows at least read Grade CTS.
  assert.ok(/slabMark:\s*true/.test(batchQuality), "the select does not fetch slab_mark — the Mark column renders a dash on every slab");
  assert.ok(/mark:\s*r\.slabMark/.test(batchQuality), "the response mapping emits no `mark` key");
  // Guarded the way the other four inventory routes are, so a database without
  // scripts/0070 degrades to a stated unknown rather than a 500.
  assert.ok(batchQuality.includes("slabMarkAvailable"), "the mark read must be probed first");
  assert.ok(batchQuality.includes("isMissingSlabMarkError"), "the mark read must survive the column landing mid-request");
  // …and it must SAY when it could not read it. Silence would be read as "whole".
  assert.ok(/markAvailable,/.test(batchQuality), "the payload must carry markAvailable so the popup can say it cannot tell");
});

test("the Sales popup never prints a dash for a mark it did not read", () => {
  const cell = stockByDesign.slice(stockByDesign.indexOf("<MarkChip") - 400, stockByDesign.indexOf("<MarkChip") + 200);
  assert.ok(/qcMarks/.test(cell), "the Mark cell does not gate on whether the mark was actually read");
  // legacyGrade must NOT be passed here any more: it resolves 'B' to FULL_SLAB,
  // and with hideWhole that prints "—" over an already-cut slab, on the one
  // per-slab list the Sales login has.
  assert.ok(!/<MarkChip[^>]*legacyGrade/.test(stockByDesign), "the popup still falls back to the grade — every cut slab reads B and prints a dash");
  // And it says so once, in words, not only as a column of question marks.
  assert.ok(stockByDesign.includes("!qcMarks &&"), "there is no banner telling Sales the mark could not be read");
});

// ──────────────────────────────────────────────── the KPI strip's arithmetic ─

test('the "Grades (in stock)" cards are a partition again', () => {
  const from = dashboard.indexOf("Grades (in stock)");
  const to = dashboard.indexOf("Thickness (in stock)");
  assert.ok(from > 0 && to > from, "the grade block is gone from the dashboard");
  const gradeBlock = dashboard.slice(from, to);
  // On-floor A 8,304 + A2 859 + B 3,424 + C 2,346 + Trial 384 + ungraded 1,311
  // = 16,628 = the on-floor total. The cut card's 61 are all grade B, so
  // rendering it here made the block claim 16,689 slabs — 61 too many.
  assert.ok(!/kpi\.cut/.test(gradeBlock), "the grade-OR-mark cut count is back inside the Grades block — it double-counts 61 grade-B slabs");
  assert.ok(!/kpi\.cts\b/.test(gradeBlock), "same card under its older key — still an overlap under a heading that says Grades");
  for (const k of ["kpi.gradeA", "kpi.gradeB", "kpi.gradeC", "kpi.printing"]) {
    assert.ok(gradeBlock.includes(k), `${k} is missing from the grade block`);
  }
});

test("the cut count is rendered outside the grade block, and says it overlaps", () => {
  const stockBlock = dashboard.slice(dashboard.indexOf('">Stock</p>'), dashboard.indexOf("Grades (in stock)"));
  assert.ok(/kpi\.cut\s*\?\?\s*kpi\.cts/.test(stockBlock), "the cut count is not rendered in the Stock row — it is not shown anywhere outside Grades");
  assert.ok(stockBlock.includes("ctsStatus"), "the CTS *status* card must stay beside it — they are different questions");
  // A number that overlaps its neighbours must say so where somebody hovering
  // it will read it, or it will be added into them again.
  assert.match(stockBlock, /do NOT add this number/, "the cut card carries no note saying it overlaps the grade cards");
});

test("an unknown count renders as a question mark, never as zero", () => {
  // 0 means "no cut stock here" and gets quoted against. The route sends null
  // for "the mark could not be read", and the card must show that as unknown.
  const cardFn = dashboard.slice(dashboard.indexOf("const card = ("), dashboard.indexOf("const inputCls"));
  assert.match(cardFn, /value: number \| null \| undefined/, "the card helper cannot express an unknown count");
  assert.match(cardFn, /typeof value === "number" \? value\.toLocaleString\("en-IN"\) : "\?"/, "a null count must print ? rather than being coerced to a number");
});
