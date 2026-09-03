import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CUT_GRADES, CUT_MARKS } from "../src/lib/inventory/grading.ts";
import { SLAB_MARKS, slabMarkOf, SLAB_MARK_LABEL } from "../src/lib/fab/slabMark.ts";

// A CUT SLAB MUST STAY FINDABLE.
//
// THE INCIDENT. Until 2026-09-03 fabrication overwrote a cut slab's quality
// grade with 'CTS', destroying the polishing line's A/B/C verdict. The fix
// moves the fact into its own column (fg_finished_slab.slab_mark, scripts/0070)
// — and on its own that fix would have made a cut slab UNFINDABLE, because
// every inventory surface identified one by its GRADE and nothing anywhere
// filtered or counted by the MARK. The dropdown option is built from live
// values so it would have vanished; the KPI card counted grade='CTS' so it
// would have read zero; the register's CTS column counted the same and would
// have emptied.
//
// MEASURED ON LIVE NEON, 2026-09-03: 62 slabs read grade='CTS' (60 on the
// floor, 2 dispatched), fg_finished_slab.slab_mark does not exist yet, and no
// slab anywhere reads SAMPLE. So during the changeover BOTH signals are live
// and every "is this slab cut" test has to be an OR — mark alone loses the 62,
// grade alone loses everything cut from now on.
//
// STRUCTURAL, like tests/inventorySummaryColumns.test.ts and for the same
// reason: these are route modules that import the Prisma client, so they cannot
// be imported under `node --test`, and every failure here is a number quietly
// being the wrong number rather than anything throwing.

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const searchWhere = read("../src/lib/inventory/searchWhere.ts");
const summary = read("../src/app/api/inventory/summary/route.ts");
const kpi = read("../src/app/api/inventory/kpi/route.ts");
const filters = read("../src/app/api/inventory/filters/route.ts");
const exportRoute = read("../src/app/api/inventory/export/route.ts");

const SOURCES: [string, string][] = [
  ["searchWhere.ts", searchWhere],
  ["summary/route.ts", summary],
  ["kpi/route.ts", kpi],
  ["filters/route.ts", filters],
  ["export/route.ts", exportRoute],
];

// ───────────────────────────────────────────────────────────── the OR rule ──

test("the two cut states are the same two words on both sides of the OR", () => {
  // If these ever disagree, a slab cut one way is refused dispatch but filtered
  // as whole (or the other way about) — the exact split-brain this change is
  // undoing. grading.ts keeps them as separate lists on purpose; they must
  // still spell the same states.
  assert.deepEqual([...CUT_GRADES], [...CUT_MARKS]);
  assert.deepEqual([...CUT_MARKS], ["CTS", "SAMPLE"]);
  // FULL_SLAB is the only mark that is not a cut, and there is no fourth state.
  assert.deepEqual([...SLAB_MARKS], ["FULL_SLAB", "CTS", "SAMPLE"]);
  assert.deepEqual(SLAB_MARKS.filter((m) => !(CUT_MARKS as readonly string[]).includes(m)), ["FULL_SLAB"]);
});

test("a cut filter asks the grade AND the mark, never the mark alone", () => {
  // The 62 legacy rows carry the fact in the GRADE and the owner is collecting
  // their real verdicts by hand, so their grade stays 'CTS' for now. A clause
  // that dropped the grade arm would make all 62 disappear from the filter the
  // day it shipped.
  for (const fn of ["cutSignalWhere", "anyCutWhere"]) {
    const body = searchWhere.slice(searchWhere.indexOf(`export function ${fn}`));
    const decl = body.slice(0, body.indexOf("\n}"));
    assert.ok(decl.includes("grade"), `${fn} stopped asking the grade — the 62 legacy CTS rows vanish`);
    assert.ok(decl.includes("slabMark"), `${fn} stopped asking the mark — nothing cut from now on is findable`);
    assert.match(decl, /hasMark\s*\?/, `${fn} must collapse to the grade-only clause when the column is missing`);
  }
});

test("the whole-slab filter does not lose the 1,615 ungraded slabs", () => {
  // `grade NOT IN ('CTS','SAMPLE')` is NULL for a NULL grade, so an ungraded
  // slab is neither cut nor whole and 1,309 slabs on the floor would silently
  // drop out of the "Full slab" filter. The null arm is what keeps them in.
  const body = searchWhere.slice(searchWhere.indexOf("export function wholeSlabWhere"));
  const decl = body.slice(0, body.indexOf("\n}"));
  assert.ok(decl.includes("grade: null"), "wholeSlabWhere must include rows whose grade IS NULL");
  assert.ok(decl.includes("notIn"), "wholeSlabWhere must exclude the cut grades");
  assert.ok(decl.includes("slabMark"), "wholeSlabWhere must also exclude a cut MARK when the column is there");
});

test("?grade=CTS is routed through the OR, not straight onto where.grade", () => {
  // The honest reading of "show me CTS": slabs that have been cut, whichever
  // column happens to be carrying that fact today. Half an answer is the
  // failure mode here — it looks like a complete one.
  const build = searchWhere.slice(searchWhere.indexOf("export async function buildInventoryWhere"));
  const gradeClause = build.slice(build.indexOf('if (q("grade"))'), build.indexOf('if (q("bay"))'));
  assert.ok(gradeClause.includes("cutSignalWhere"), "the CTS/SAMPLE grades must fan out to grade OR mark");
  assert.ok(gradeClause.includes("cutValueOf"), "only the cut values fan out — A/A2/B/C/Trial stay exact grade matches");
});

test("a `mark` filter exists and understands all three states", () => {
  const build = searchWhere.slice(searchWhere.indexOf("export async function buildInventoryWhere"));
  assert.ok(build.includes('q("mark")'), "there is no mark filter — a cut slab is only as findable as its grade");
  assert.ok(build.includes("parseSlabMark"), "the mark param must be parsed, so an unknown value filters nothing rather than 500ing");
  assert.ok(build.includes("wholeSlabWhere"), "mark=FULL_SLAB must be the complement of cut, not a bare column compare");
});

// ─────────────────────────────────────────────────── either deploy order ────

test("nothing touches slab_mark without a guard for the database that lacks it", () => {
  // scripts/0070 is written and UNAPPLIED (checked against information_schema
  // on live Neon, 2026-09-03). An unguarded read 500s the inventory page.
  for (const [name, src] of SOURCES) {
    if (!/slabMark|slab_mark/.test(src)) continue;
    assert.ok(
      src.includes("slabMarkAvailable") || src.includes("isMissingSlabMarkError"),
      `${name} reads the mark with no fallback for a database without scripts/0070`,
    );
  }
});

test("the probe latches only on a missing column, never on a database in trouble", () => {
  // A swallowed connection error would latch the process into grade-only reads
  // for its whole life, quietly, while looking perfectly healthy.
  const fn = searchWhere.slice(searchWhere.indexOf("export function isMissingSlabMarkError"));
  const decl = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(decl.includes("P2022"), "the missing-column code must be recognised");
  assert.ok(decl.includes("slab_mark") && decl.includes("slabMark"), "a client that does not know the field must be recognised too");
  const probe = searchWhere.slice(searchWhere.indexOf("export function slabMarkAvailable"));
  assert.match(probe.slice(0, 900), /if\s*\(!isMissingSlabMarkError\(e\)\)\s*throw e/, "anything else must be rethrown");
});

// ───────────────────────────────────────────────────────── the register ────

/** Each `count(*) FILTER (WHERE …)::int AS name` in the summary query. */
function summaryColumns(): { name: string; where: string }[] {
  return [...summary.matchAll(/count\(\*\)\s*FILTER\s*\(WHERE\s+([^)]*(?:\([^)]*\)[^)]*)*)\)::int\s+AS\s+(\w+)/gi)]
    .map((m) => ({ name: m[2].toLowerCase(), where: m[1] }));
}

test("every register column is summed when alias-merged designs collapse", () => {
  // KEYS drives the merge: two raw design names that fold to one canonical name
  // are added key by key. A column missing from KEYS keeps only the FIRST
  // group's number and silently under-reports for every merged design — which
  // is a wrong number on the screen and nothing thrown anywhere.
  const keys = (summary.match(/const KEYS = \[([^\]]*)\]/) ?? [])[1] ?? "";
  const declared = new Set([...keys.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const cols = summaryColumns();
  assert.ok(cols.length >= 16, `only ${cols.length} columns parsed — this guard would be vacuous`);
  for (const c of cols) assert.ok(declared.has(c.name), `column "${c.name}" is missing from KEYS and will not survive an alias merge`);
});

test("the register reports cut slabs, and NOT by stealing a row from A/B/C", () => {
  const cols = summaryColumns();
  const cut = cols.find((c) => c.name === "cut");
  assert.ok(cut, "the register has no cut column — nothing on it answers 'which of these have been cut'");
  assert.match(cut!.where, /status\s*<>\s*'DISPATCHED'/, "the cut column must count stock on the floor, like the columns beside it");
  // The grade columns are a PARTITION and must stay one, or the register stops
  // adding up: a slab graded A and marked CTS belongs in A, counted once.
  for (const name of ["a", "a2", "b", "c", "cts", "printing", "trial"]) {
    const col = cols.find((c) => c.name === name);
    assert.ok(col, `the ${name} grade column is gone from the register`);
    assert.ok(!/slab_mark/.test(col!.where), `the ${name} column now counts the mark too — the grade columns no longer sum to Slabs`);
  }
  // …and the cut column really does ask both signals.
  assert.ok(summary.includes("slab_mark IN ('CTS','SAMPLE')"), "the cut column must count a cut MARK");
  assert.ok(summary.includes("grade IN ('CTS','SAMPLE')"), "the cut column must still count a cut GRADE (the 62 legacy rows)");
});

// ─────────────────────────────────────────────────────────── KPI & filters ──

test("the KPI cut card counts one query, not two added together", () => {
  // All 62 live CTS slabs carry BOTH signals, so byGrade + byMark would report
  // 120 cut slabs where there are 60 on the floor.
  assert.ok(!/cts:\s*g_\("CTS"\)/.test(kpi), "cts still counts the grade alone — it reads zero once fabrication stops writing that grade");
  assert.ok(kpi.includes("anyCutWhere"), "the cut count must use the shared grade-OR-mark clause");
  assert.match(kpi, /cut,\s*cts:\s*cut/, "cts must keep working as the same number under its old name");
  // The three CTS-ish things must stay separately named.
  assert.ok(kpi.includes("ctsStatus"), "the CTS *status* count must keep its own name");
});

test("the filter row can still offer a cut option after the grade stops carrying it", () => {
  assert.ok(filters.includes("marks:"), "the filters payload has no marks array — the CTS option vanishes with the grade");
  assert.ok(filters.includes("offerableMarks"), "the mark options must be derived, not hardcoded off values nothing has");
  // Same approval gate as every other list on this route.
  const call = filters.slice(filters.indexOf('groupBy({ by: ["slabMark"]'));
  assert.match(call.slice(0, 200), /where:\s*base/, "the mark list must not enumerate stock the caller may not see");
});

// ────────────────────────────────────────────────────────────── the export ──

test("the export carries the mark beside the grade, with a width for it", () => {
  const header = (exportRoute.match(/const header = \[([^\]]*)\]/) ?? [])[1] ?? "";
  const names = [...header.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(names.includes("Grade"), "the export lost its Grade column");
  assert.equal(names[names.indexOf("Grade") + 1], "Mark", "Mark belongs immediately after Grade — the two facts read together");
  const cols = (exportRoute.match(/ws\["!cols"\] = \[([^\]]*)\]/) ?? [])[1] ?? "";
  assert.equal(
    [...cols.matchAll(/\{\s*wch:/g)].length,
    names.length,
    "one column width per header — a short list silently leaves the tail columns at Excel's default",
  );
});

test("a row with no mark still exports as cut when its grade says so", () => {
  // The 62 legacy rows, and every row on a database without scripts/0070.
  assert.equal(SLAB_MARK_LABEL[slabMarkOf(undefined, "CTS")], "CTS");
  assert.equal(SLAB_MARK_LABEL[slabMarkOf(null, "CTS")], "CTS");
  assert.equal(SLAB_MARK_LABEL[slabMarkOf("CTS", "A")], "CTS", "the mark wins when both speak — it is the fact, the grade is the shadow");
  assert.equal(SLAB_MARK_LABEL[slabMarkOf(undefined, "A")], "Full slab");
  assert.equal(SLAB_MARK_LABEL[slabMarkOf("FULL_SLAB", null)], "Full slab");
  assert.ok(exportRoute.includes("slabMarkOf(r.slabMark, r.grade)"), "the export must fall back to the legacy grade for rows with no mark");
});
