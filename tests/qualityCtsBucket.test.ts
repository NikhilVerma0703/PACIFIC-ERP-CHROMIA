import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A SLAB NOBODY INSPECTED MUST NOT COUNT AS A FAILURE.
//
// THE INCIDENT. The CEO report keeps cut-to-size slabs out of BOTH sides of the
// pass rate, because a slab diverted to another product was never given a
// verdict and counting it as a reject understates the rate by exactly those
// slabs. getQuality has said so in a comment since it was written. It
// implemented it as `qualityGrade === "CTS"`.
//
// THEN THE DATA MOVED UNDER IT. scripts/0071 and 0072 regraded all 63 cut slabs
// from grade 'CTS' to grade 'B' on the owner's decision, their real verdicts
// being unrecoverable. Measured on live Neon 2026-09-03: ZERO rows in polish_qc
// carry quality_grade 'CTS' or 'SAMPLE'. So that key matched nothing, the CTS
// bucket was permanently 0, and the 63 synthetic B verdicts fell back into
// `graded` as failures — the fixed defect, re-created by a migration rather
// than by an edit. Measured over August 2026, the month being settled:
// graded 5,865 with 5,475 passed (93.35%) against 5,840 with the same 5,475
// (93.75%), and the grade table's B row 230 against 205.
//
// AND THE OBVIOUS RE-KEY IS ALSO WRONG. Keying on polish_qc.slab_mark would
// pull genuinely graded stone out of the rate: since scripts/0070 a cut slab
// KEEPS its verdict (markQcSlabCts / markQcSlabSample write the mark and leave
// quality_grade alone — "A · Sample"), so from now on mark='CTS' with grade='A'
// is a real A that happens to have been cut. The key has to be "does this row
// carry a verdict at all", which is the legacy 'CTS'/'SAMPLE' grade write OR
// quality_grade_before_cts='CTS', the stamp 0071/0072 left precisely so a later
// reader could tell a decided B from a measured one.
//
// STRUCTURAL, like tests/inventoryMarkFilter.test.ts and for the same reason:
// dailyReport.ts and the sampling intake route import the Prisma client, so
// they cannot be imported under `node --test`. Every failure here is a number
// quietly being the wrong number, or a warning quietly not being shown, rather
// than anything throwing — which is why it is worth pinning in text.

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const dailyReport = read("../src/lib/dailyReport.ts");
const intake = read("../src/app/api/sampling/intake/route.ts");

/** Source with every `//` comment line dropped — the prose in these files
 *  quotes the old code on purpose, and a test that matched the explanation
 *  instead of the code would pass forever. */
const code = (src: string) =>
  src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const dailyCode = code(dailyReport);
const intakeCode = code(intake);

// ---------------------------------------------------------------------------
// the report
// ---------------------------------------------------------------------------

test("the report reads the column that still records a destroyed verdict", () => {
  // Without this in QC_SELECT the predicate below has nothing to read and
  // TypeScript is the only thing that would say so.
  assert.match(dailyCode, /QC_SELECT = \{[\s\S]*?qualityGradeBeforeCts: true[\s\S]*?\} satisfies/);
});

test("the CTS bucket is not keyed on the grade alone — no row carries that grade any more", () => {
  // The exact shape that went dead when 0071/0072 ran.
  assert.doesNotMatch(dailyCode, /qc\.filter\(\(r\) => r\.qualityGrade === "CTS"\)/);
  // And the surviving signal is consulted.
  assert.match(dailyCode, /qualityGradeBeforeCts\) === "CTS"/);
});

test("a slab with no verdict is out of BOTH sides of the pass rate", () => {
  // `graded` is the denominator and `passed` is drawn from it, so excluding a
  // row here excludes it from both. If this ever reads `!== "CTS"` again the
  // 63 decided B verdicts are back in the CEO's failures.
  assert.match(dailyCode, /const graded = qc\.filter\([\s\S]{0,160}?!noVerdict\(r\)\)/);
  assert.match(dailyCode, /const cts = qc\.filter\(noVerdict\)/);
  assert.match(dailyCode, /const passed = graded\.filter\(/);
});

test("the grade table and the CTS line cannot count the same slab twice", () => {
  // The table's rows come from `grades` and its total row prints `cts`
  // alongside them. Both must use the one definition, or the CEO sees 25 cut
  // slabs inside the B row AND named separately beside it — 231 B against 206.
  assert.match(dailyCode, /const grades = tally\(qc, gradeOf\)/);
  assert.match(dailyCode, /const gradeOf =/);
  assert.doesNotMatch(dailyCode, /tally\(qc, \(r\) => r\.qualityGrade \?\? "Not recorded"\)/);
  // dispatchByGrade is looked up by the label `grades` just printed, so it is
  // keyed the same way or the CTS row silently reads zero.
  assert.match(dailyCode, /dispatchByGrade: Object\.fromEntries\(\[\.\.\.new Set\(qc\.map\(gradeOf\)\)\]/);
});

test("the fault tables do not attribute faults to slabs nobody inspected", () => {
  // The 63 read B and carry no quality_issue, because no inspector ever filled
  // one in. In `bc` they would say 25 more slabs were downgraded on no faults.
  assert.match(dailyCode, /const bc = qc\.filter\(\(r\) => gradeOf\(r\) === "B"/);
});

test("the mark is deliberately NOT the key, and the file says why", () => {
  // The one that will be 'fixed' by the next reader if the reason is not on the
  // page: slab_mark is the dispatch signal, but a marked slab now keeps a real
  // grade, and a real grade belongs in the rate.
  assert.match(dailyReport, /WHY THE KEY IS THE VERDICT AND DELIBERATELY NOT THE MARK/);
  // The predicate itself must not read the mark.
  assert.doesNotMatch(dailyCode, /noVerdict = [\s\S]{0,200}slabMark/);
});

// ---------------------------------------------------------------------------
// the sampling screen
// ---------------------------------------------------------------------------

test("the sampling intake tells the incharge the slab was already cut, by reading the mark", () => {
  // markQcSlabSample refuses to move a slab fabrication already cut, and the
  // response's slabMark is how the screen says so. Read back off quality_grade
  // it returns 'B' for all 63 of those slabs and the warning disappears exactly
  // where it is true.
  assert.match(intakeCode, /select: \{ slabMark: true \}/);
  assert.match(intakeCode, /slabMark = g === "SAMPLE" \|\| g === "CTS" \? g : null/);
  // The legacy grade read survives only as the fallback for a database without
  // scripts/0057, where the grade genuinely is the mark.
  assert.match(intakeCode, /catch[\s\S]{0,400}select: \{ qualityGrade: true \}/);
});
