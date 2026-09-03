import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_SLABS_PER_HOUR, slabsDeclared, rangeImpossible } from "../src/lib/shiftScoreMath.ts";

// THE CEO MONTHLY REPORT'S GRADE COLUMNS.
//
// WHAT THIS GUARDS. Sheet two's design table now carries A, A2,
// B, C, Cut and Not yet beside Slabs, and sheet three prints the month's own
// grades beside the month's QC entries. Both rest on ONE claim: that the
// grades belong to THE SLABS THE MONTH PRESSED, not to whatever QC happened to
// file during it. Measured on live Neon 2026-09-03 for August 2026, the two
// populations are nothing like each other:
//   6,390 QC entries filed in the month, of which 1,000 were for slabs the
//   month did not press (939 carrying a number some other MIS hour declared,
//   61 in no range this report can read), and 367 of the month's OWN slabs had
//   their QC row arrive only in September. Pass rate 94.6% on the month's own
//   slabs, 93.8% across every entry. Grading the mix on the month's QC window
//   would have been wrong by both of those numbers at once.
//
// EVERY FIGURE IN THIS FILE IS A MEASUREMENT WITH A DATE ON IT, NOT A SPEC.
// August's grade counts climb hour by hour while QC files: its "graded after
// the month" figure read 348 on the morning of 2026-09-03 and 367 that
// evening. Nothing here asserts a count against the database — the assertions
// are all structural, and the numbers are only the evidence for why the
// structure has to be that way. If a figure quoted here disagrees with the
// live database, the figure is stale; re-derive with
// scripts/verify-grade-columns.mts and scripts/check-monthly-vs-daily.mts and
// do NOT "fix" working code to match a comment.
//
// AND ONE ARITHMETIC. The six grade figures must add across to the design's
// slabs and down to the month's, with cut-to-size in its own column and never
// inside B — the register already shipped that bug once (a Cut card of 61
// sitting inside a grade block whose B card held the same 61 slabs, so six
// cards summed 61 past the floor total).
//
// STRUCTURAL, like tests/inventoryMarkFilter.test.ts and for the same reason:
// lib/dailyReport and lib/monthlyReport import the Prisma client through the
// @/ alias, which node's test runner resolves for neither. lib/shiftScoreMath
// has no imports at all, so the range rule below IS executed for real; the
// rest is asserted against the source, because every failure here is a number
// quietly being the wrong number rather than anything throwing.

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const daily = read("../src/lib/dailyReport.ts");
const monthly = read("../src/lib/monthlyReport.ts");
const sheets = read("../src/app/report/ceo/MonthlySheets.tsx");
const css = read("../src/app/report/ceo/report.module.css");

/** The source with every comment removed. Assertions about what the PAGE
 *  SAYS must read only what the page says: this file's own explanations quote
 *  the wrong sentences they exist to forbid ("got a verdict only in the month
 *  after", "most of it other months' slabs"), and a guard that matches its own
 *  rationale is a guard that fires on nothing. Crude on purpose — a "//" or
 *  "/*" inside a string literal would confuse it, and there are none here. */
const noComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ 	]*\/\/.*$/gm, " ");
const sheetsSaid = noComments(sheets);

/** The body of a top-level declaration, up to its closing brace at column 0. */
function decl(src: string, needle: string): string {
  const i = src.indexOf(needle);
  assert.notEqual(i, -1, `could not find \`${needle}\` — this guard would be vacuous`);
  const rest = src.slice(i);
  const end = rest.indexOf("\n}");
  return end === -1 ? rest : rest.slice(0, end);
}

// ──────────────────────────────────────────────── one verdict rule, shared ──

test("the CTS rule lives in ONE place and both reports read it", () => {
  // Two surfaces with two grade predicates is how the CEO's pass rate and the
  // CEO's mix table come to disagree about the same 25 slabs. dailyReport owns
  // the rule; monthlyReport must import it rather than write its own.
  assert.match(daily, /export const noVerdict\s*=/, "dailyReport no longer exports the no-verdict rule");
  assert.match(daily, /export const gradeOf\s*=/, "dailyReport no longer exports gradeOf");
  const g = decl(daily, "export function getQuality");
  assert.ok(!/const noVerdict\s*=/.test(g), "getQuality has grown a LOCAL noVerdict again — there are two rules now");
  assert.ok(!/const gradeOf\s*=/.test(g), "getQuality has grown a LOCAL gradeOf again — there are two rules now");

  assert.match(monthly, /import \{[\s\S]*?\bgradeOf\b[\s\S]*?\} from "@\/lib\/dailyReport"/,
    "monthlyReport must import gradeOf from dailyReport, not define a grade predicate of its own");
  const gp = decl(monthly, "async function gradeProduced");
  assert.ok(!/qualityGradeBeforeCts\s*===|["']CTS["']\s*,\s*["']SAMPLE["']/.test(gp),
    "gradeProduced is testing the CTS columns itself — that is a second rule, and it will drift from getQuality's");
  assert.ok(gp.includes("gradeOf("), "gradeProduced must bucket through the shared gradeOf");
});

test("the shared rule still asks BOTH signals", () => {
  // quality_grade 'CTS'/'SAMPLE' is the legacy write, still taken by any
  // database without scripts/0070 or when the mirror push fails.
  // quality_grade_before_cts 'CTS' is what scripts/0071 and 0072 stamped on
  // the 63 rows they regraded to 'B'. Measured on live Neon 2026-09-03 the
  // first arm matches NOTHING (0 rows read 'CTS' or 'SAMPLE'), so dropping the
  // second arm silently returns all 63 to the pass rate as failures — the
  // exact defect the CTS bucket exists to prevent.
  const rule = daily.slice(daily.indexOf("export const noVerdict"), daily.indexOf("export const gradeOf"));
  assert.ok(rule.includes("NO_VERDICT.has"), "the legacy grade arm is gone — a database without scripts/0070 grades cut slabs as rejects");
  assert.ok(rule.includes("qualityGradeBeforeCts"), "the before-CTS arm is gone — the 63 regraded slabs fall back into the pass rate as B");
  assert.match(daily, /const NO_VERDICT = new Set\(\["CTS", "SAMPLE"\]\)/, "the two routing states must stay exactly those two words");
});

test("getQuality's own arithmetic is untouched", () => {
  // The CEO's all-entries pass rate for August 2026 measured 93.75% on
  // 2026-09-03, and neither the grade columns nor anything since may move it.
  // These four lines ARE that rate — the assertions are on the lines, not on
  // the number, because the number climbs as QC files.
  const g = decl(daily, "export function getQuality");
  assert.ok(g.includes('const grades = tally(qc, gradeOf);'), "the grade tally must still key on gradeOf");
  assert.ok(g.includes("const cts = qc.filter(noVerdict);"), "the CTS bucket must still be the no-verdict rows");
  assert.match(g, /const graded = qc\.filter\(\(r\) =>\s*\n?\s*r\.qualityGrade && r\.qualityGrade !== "Not graded yet" && !noVerdict\(r\)\)/,
    "the graded denominator changed — the CEO's pass rate moved");
  assert.match(g, /const passed = graded\.filter\(\(r\) => r\.qualityGrade === "A" \|\| r\.qualityGrade === "A2"\)/,
    "the pass numerator changed — the CEO's pass rate moved");
  assert.ok(g.includes("ungraded: qc.length - graded.length - cts.length"), "the ungraded figure changed");
});

// ───────────────────────────────────────── which slabs the grades belong to ──

test("the produced-slab QC fetch is NOT windowed on the month", () => {
  // A slab pressed on 31 August is usually polished and inspected in September
  // and is still an August slab: the QC row for 455 of August 2026's 6,261
  // slabs was stamped after the month closed, 367 of them carrying a verdict
  // (live Neon, evening of 2026-09-03 — this climbs daily). A where-clause on
  // importedAt here would drop every one of them into "Not yet".
  const gp = decl(monthly, "async function gradeProduced");
  const where = gp.slice(gp.indexOf("findMany"), gp.indexOf("select: PRODUCED_QC_SELECT"));
  assert.ok(where.includes("slabNumber: { in:"), "the produced grades must be fetched BY SLAB NUMBER");
  assert.ok(!where.includes("importedAt"), "the produced-slab fetch has been windowed on the month — slabs graded next month vanish");
  assert.ok(!where.includes("createdTime"), "the produced-slab fetch has been windowed on the month — slabs graded next month vanish");
});

test("the IN list is chunked under the Postgres bind cap", () => {
  // A month is already 6,261 numbers and Postgres caps a statement at 32,767
  // bind parameters; present() in lib/incentiveMonth is the house pattern.
  const gp = decl(monthly, "async function gradeProduced");
  assert.match(gp, /i \+= 5000/, "the produced-slab fetch is no longer chunked");
  assert.match(gp, /numbers\.slice\(i, i \+ 5000\)/, "the chunk slice must match the step, or slabs are skipped or re-sent");
});

test("one row per slab, the newest — not one row per QC entry", () => {
  // A re-graded slab has several QC rows. Counting rows would push the six
  // grade figures past the design's own slab count, which is precisely the
  // adds-up invariant the columns exist to keep. shiftScore settles this the
  // same way, on the same stamp, so payout and report cannot name different
  // verdicts for one slab.
  const gp = decl(monthly, "async function gradeProduced");
  assert.match(gp, /createdTime \?\? q\.importedAt/, "the newest-verdict stamp must be createdTime falling back to importedAt, as shiftScore has it");
  assert.match(gp, /if \(!latest\.has\(n\)\) latest\.set\(n, q\)/, "the newest row per slab must win");
  assert.match(gp, /for \(const \[slab, design\] of slabOwner\)/,
    "the tally must walk the SLABS, not the QC rows — walking rows loses every ungraded slab and double-counts re-graded ones");
});

test("'graded after the month' counts VERDICTS, and reads one clock", () => {
  // The figure both sheets print as "graded only in the month after" used to
  // increment on any latest QC row stamped after the window closed, including
  // rows still reading "Not graded yet" — so it overlapped the "still carry no
  // verdict at all" figure printed in the same sentence. Measured on live Neon
  // 2026-09-03 for August 2026: 455 latest rows landed after the window, only
  // 367 of them carrying a verdict, and the rest were also inside the "Not
  // yet" figure printed beside it as though the two were disjoint. July 846,
  // June 242, on the gated count. August's numbers climb through the day; the
  // GATE is what this test guards, not the count.
  const gp = decl(monthly, "async function gradeProduced");
  const gate = gp.slice(gp.indexOf("total[bucket]++"), gp.indexOf("gradedAfterMonth++") + 20);
  assert.ok(gate.includes('bucket !== "cut"') && gate.includes('bucket !== "ungraded"'),
    "the late-verdict count is not gated on the bucket — ungraded slabs are being reported as graded");
  assert.ok(gate.includes("stamp(q) >= monthEnd"),
    "the arrival must be read with the SAME stamp that picked the latest row (createdTime ?? importedAt)");
  assert.ok(!/q\.importedAt\.getTime\(\) >=/.test(gp),
    "a second clock is back: importedAt alone drops every row written since the June 2026 cutover with a null importedAt");
});

test("every QC entry in the window lands in exactly one provenance bucket", () => {
  // Sheet three used to call every entry that was not this month's slab
  // "stone from earlier batches". Measured on live Neon 2026-09-03, 61 of
  // August's 1,000 such entries carry a slab number NO MIS range in any month
  // covers, so that sentence asserted a provenance the data does not carry.
  // The three buckets must be exhaustive and disjoint, because the sheet
  // prints them as a split of the entries filed and a reader adds them up.
  const g = decl(monthly, "export async function getMonthlyReport");
  const loop = g.slice(g.indexOf("const qcFrom ="), g.indexOf("// Causes:"));
  assert.ok(loop.includes("qcFrom.own++") && loop.includes("qcFrom.elsewhere++") && loop.includes("qcFrom.unplaced++"),
    "the three buckets are not all filled");
  assert.equal((loop.match(/\belse\b/g) ?? []).length, 2,
    "the buckets must be one if / else if / else chain — anything else can count an entry twice or not at all");
  assert.ok(loop.includes("core.slabOwner.has(r.slabNumber)"), "the month's own slabs must be settled first, on the same map the grades use");
  assert.ok(monthly.includes("qcEntriesElsewhere:") && monthly.includes("qcEntriesUnplaced:"),
    "the split is not carried out to the sheet");
  const out = decl(monthly, "async function declaredElsewhere");
  // THE COMPLEMENT, NOT A SECOND WINDOW — the F4 fix. This lookup used to take
  // "every MIS row whose dateAndTime is OUTSIDE the month", which is a
  // different ROW filter from the month's own enumeration (that one also
  // requires an hour label). A slab number declared only by a blank-hour row of
  // THIS month therefore sat in neither set and sheet three printed it as
  // being in no MIS range at all — while the next month's report, for which
  // the same row is outside the window, called it another month's stone.
  // Measured on live Neon 2026-09-03: 28 of June 2026's 6,124 such entries,
  // 19 of July's 352, 0 of August's 61; after the fix July's split reads
  // 344/333 and June's 28,437/6,096, and the buckets still add to `inspected`.
  assert.ok(!/dateAndTime/.test(out),
    "declaredElsewhere is windowed on dateAndTime again — that is a second row filter, and a slab a blank hour of THIS month declared falls between the two sets");
  assert.ok(!/hour/.test(out),
    "declaredElsewhere has grown an hour-label filter of its own — it must read every row this range rule can read");
  assert.match(out, /if \(!own\.has\(sn\)\) declared\.add\(sn\)/,
    "the elsewhere set must be the exact COMPLEMENT of the month's own slabs, or the two buckets are not exhaustive");
  assert.ok(monthly.includes("declaredElsewhere(core.slabOwner)"),
    "the provenance lookup must be handed the same map the grade columns partition");
});

// ─────────────────────────────────────────────── the enumeration's exclusions ──

test("the slab enumeration applies the mix's own exclusions, not looser ones", () => {
  // If the grades cover a different set of hours from the Slabs column beside
  // them, the row invites an arithmetic that is not true. Three exclusions:
  // an hour that reaches no shift (already `continue`d above the enumeration),
  // an impossible range, and a range that is backwards or starts at zero.
  const guard = monthly.slice(monthly.indexOf("const walkRange ="), monthly.indexOf("const addDaysTo"));
  assert.ok(guard.includes("MAX_SLABS_PER_HOUR"), "the wide-range guard is gone — one typo'd hour can swallow the month");
  assert.ok(guard.includes("a <= 0"), "the zero/negative start guard is gone — it is in shiftScore.claimedSlabs and the two must agree");
  assert.ok(guard.includes("b < a"), "the backwards-range guard is gone");
  // ONE guard, TWO readers. sheet three now asks whether a QC entry's slab
  // number was declared by an MIS hour in ANOTHER month; if that lookup walked
  // ranges by different rules from the month's own enumeration, a slab could
  // be this month's on page two and another month's on page three.
  const core = decl(monthly, "async function monthCore");
  assert.ok(core.includes("walkRange(x.slabFrom, x.slabTo)"), "monthCore stopped using the shared range guard");
  const outside = decl(monthly, "async function declaredElsewhere");
  assert.ok(outside.includes("walkRange(r.startingSlabNumber, r.endingSlabNumber)"),
    "the provenance lookup walks ranges by a rule of its own — it must use walkRange");
  // and the enumeration must sit AFTER the shift gate, inside the same loop
  const gate = core.indexOf("if (x.shift == null) {");
  assert.ok(gate !== -1 && gate < core.indexOf("walkRange(x.slabFrom"),
    "the enumeration escaped the shift gate — it would count hours the Slabs column does not");
  assert.match(monthly, /import \{ MAX_SLABS_PER_HOUR \} from "@\/lib\/shiftScoreMath"/,
    "MAX_SLABS_PER_HOUR must come from the file that owns it, not be retyped as a literal");
});

test("the guard agrees with the shared range math for every shape of range", () => {
  // The one thing here that runs for real. `made` (slabsDeclared) is what the
  // Slabs column counts; the enumeration must accept exactly the ranges that
  // produced a slab count and refuse exactly those that did not, or the grade
  // columns and the Slabs column describe different hours.
  const enumerable = (a: number | null, b: number | null) =>
    !(a == null || b == null || a <= 0 || b < a || b - a >= MAX_SLABS_PER_HOUR);
  const cases: [number | null, number | null][] = [
    [154962, 154973],                                  // an ordinary hour: 12 slabs
    [1, 1],                                            // one slab
    [100, 100 + MAX_SLABS_PER_HOUR - 1],               // exactly 60 wide, still accepted
    [100, 100 + MAX_SLABS_PER_HOUR],                   // 61 wide — refused, both sides
    [100, 30000],                                      // the June 2026 30,000-slab nights
    [154973, 154962],                                  // backwards
    [null, 154973], [154962, null], [null, null],      // half-typed and untyped
  ];
  for (const [a, b] of cases) {
    const counted = slabsDeclared(a, b) != null;
    if (a != null && a > 0) {
      assert.equal(enumerable(a, b), counted,
        `range ${a}..${b}: the enumeration and slabsDeclared disagree — grades and Slabs would cover different hours`);
    }
    // and an hour the report SETS ASIDE as impossible must never be enumerated
    if (rangeImpossible(a, b)) assert.equal(enumerable(a, b), false, `range ${a}..${b} is set aside but was enumerated`);
  }
  // A start of zero is refused here even though slabsDeclared would count it;
  // that is deliberate and matches shiftScore.claimedSlabs. Slab 0 does not
  // exist, and enumerating from it walks numbers no press ever made.
  assert.equal(enumerable(0, 5), false, "a range starting at 0 must not be enumerated");
});

test("slab numbers partition the month — first claim wins", () => {
  // Without this the grade columns would not add DOWN the page: a number two
  // designs both typed would be counted on both rows. August 2026 has exactly
  // one such number (152439, re-typed by hour 12-13 on 5 August, live Neon
  // 2026-09-03), which is why the sheet also prints the gap rather than
  // hiding it.
  const core = decl(monthly, "async function monthCore");
  assert.match(core, /const held = slabOwner\.get\(sn\);[\s\S]{0,120}if \(held === undefined\) slabOwner\.set\(sn, k\)/,
    "the enumeration must not overwrite an earlier claim, or a slab lands on two design rows");
  assert.ok(monthly.includes("numbered:"), "the mix row must report its DISTINCT slab count beside `made`");
});

// ───────────────────────────── the two slab counts, IN the table (F1) ──

test("the reconciling count is a COLUMN, not a footnote", () => {
  // THE OWNER'S OWN QUESTION. He put page one's "6,262 SLABS PRODUCED" beside
  // page two's total row (Slabs 6,262, six grade cells summing to 6,261) and
  // the incentive screen's "6,261 SLABS", and asked which was right. Both are:
  // 6,261 is the slab count and 6,262 counts one slab twice, because the 12-13
  // hour of 5 August starts on 152439, the number the 11-12 hour of the same
  // day and batch already ended on (confirmed on live Neon 2026-09-03 by
  // expanding every August range — exactly one number in the month is claimed
  // twice). The difference was explained only in a 6.7pt note UNDER the table,
  // and .split now lets that table break across printed pages carrying its
  // header and not its note. So the figure has to be in the table.
  const mix = sheets.slice(sheets.indexOf('name="What the line ran'), sheets.indexOf("Page 2 of 3"));
  assert.ok(mix.includes(">Slabs<span") || /Slabs<span className=\{s\.colSub\}/.test(mix),
    "the Slabs column no longer says WHICH count it is — two different numbers read as one quantity again");
  assert.ok(/Numbers<span className=\{s\.colSub\}/.test(mix),
    "the mix table has no Numbers column — the reconciling figure is back in a footnote the continuation page does not carry");
  assert.ok(mix.includes("{m2.numbered ? num(m2.numbered) : NDASH}"),
    "the design rows do not print their distinct-number count");
  assert.ok(mix.includes("{num(r.producedSlabs)}"),
    "the total row does not print the month's distinct-number count — the column cannot be added up");
  // and the Slabs column must still be `made`: sum(mix.made) === r.made is the
  // invariant scripts/check-monthly-vs-daily.mts enforces, and every target
  // and achievement figure on the report is built on it.
  assert.ok(mix.includes("{num(m2.made)}") && mix.includes("{num(r.made)}"),
    "the Slabs column stopped counting what the hours declared");
  // page one must not print the claim count under an unqualified label either
  const one = sheets.slice(sheets.indexOf("function SheetMonth"), sheets.indexOf("Page 1 of 3"));
  assert.ok(one.includes("const exact = r.made === r.producedSlabs;"),
    "sheet one no longer knows whether its headline figure is the slab count");
  assert.match(one, /exact \? `Slabs produced\$\{soFar\}` : `Slabs claimed/,
    "the KPI tile calls the claim count 'slabs produced' with no caveat again — on a month with a re-typed number that is one slab more than the plant made");
});

test("the deficit is split into its TWO causes, and neither is called the other", () => {
  // 'N SLAB NUMBERS WERE CLAIMED TWICE' IS FALSE WHERE AN HOUR TYPED 0 -> 0.
  // slabsDeclared reads 0->0 as one slab; walkRange refuses to walk from zero
  // (shiftScore.claimedSlabs refuses it too). So made - numbered is not a
  // duplicate count. Measured on live Neon 2026-09-03: April 2026's 35-slab
  // deficit is 13 hours that typed 0->0 (design blank, on 2 and 6 April) plus
  // 22 numbers genuinely typed twice; July 2025 is 15 of 119 and August 2025
  // 6 of 65. The middle quantity — claims, the part of `made` walkRange can
  // read — is what separates them.
  const core = decl(monthly, "async function monthCore");
  assert.match(core, /e\.claims \+= range\[1\] - range\[0\] \+ 1;/,
    "the walkable claim count is gone — the note cannot tell a re-typed number from an unreadable range");
  assert.match(core, /if \(x\.made != null\) \{ e\.unreadable \+= x\.made; e\.unreadableHours\+\+; \}/,
    "an hour that counted slabs but named no slab number is being dropped silently again");
  for (const f of ["claimedSlabs:", "typedTwice:", "unreadableSlabs:", "unreadableHours:"]) {
    assert.ok(monthly.includes(f), `the month does not carry \`${f}\` out to the sheet`);
  }
  const note = sheets.slice(sheets.indexOf("const retyped ="), sheets.indexOf("Page 2 of 3"));
  assert.ok(note.includes("r.mix.filter((x) => x.claims > x.numbered)"),
    "the re-typed rows must be selected on claims vs numbers, not on made vs numbers — made includes hours that named nothing");
  assert.ok(note.includes("r.mix.filter((x) => x.unreadable > 0)"), "the unreadable-range rows are no longer listed");
  assert.ok(/typed\s*\n?\s*twice<\/strong>/.test(note) || note.includes("typed\n            twice</strong>"),
    "the duplicate sentence lost its name");
  assert.ok(note.includes("whose slab range cannot be a slab number"),
    "the second fault is not named — thirteen hours that typed 0->0 are being reported as duplicates");
  assert.ok(!/slab number\{[^}]*\} claimed\s*\n?\s*twice/.test(note),
    "the note asserts the whole deficit is numbers claimed twice again");
});

test("hours that reach no shift are counted and printed, not dropped in silence", () => {
  // monthCore skips any MIS row whose `hour` cell is blank, because the day
  // figure (assembleDay sums the three shifts) skips it too — and that
  // exclusion was printed NOWHERE. Measured on live Neon 2026-09-03: June 2026
  // has 11 such rows declaring 104 slabs, every one of those numbers present in
  // `press` AND in `polish_entry`, so the report said June made 2,471 across
  // 2,467 numbers when the plant's own MIS declares 2,575 across 2,544 — and
  // /scoreboard/incentive counts them and the payout pays for them. July has
  // 3 rows / 19 slabs, August none. Counted the way an impossible range
  // (day.wideHours) already is, and NOT folded into `made`: moving a
  // historical production figure and an achievement percentage is the owner's
  // decision, not this file's.
  const core = decl(monthly, "async function monthCore");
  assert.match(core, /if \(x\.shift == null\) \{[\s\S]{0,400}unlabelled\.hours\+\+/,
    "a blank-hour row is skipped without being counted again");
  assert.match(core, /unlabelled\.slabs \+= x\.made/, "the slabs on a blank-hour row are not counted");
  assert.ok(!/unlabelled\.slabs.*\bmade \+=/.test(monthly) && !/made \+= unlabelled/.test(monthly),
    "blank-hour slabs have been folded into `made` — that moves a production figure the owner may already have reported");
  assert.ok(monthly.includes("unlabelled: core.unlabelled"), "the figure is measured and then thrown away");
  assert.ok(sheets.includes("{r.unlabelled.slabs > 0 && ("),
    "the sheet does not print the excluded slabs — the exclusion is invisible again");
  assert.ok(sheets.includes("{num(r.made + r.unlabelled.slabs)}"),
    "the sheet must show made + excluded, so a reader can add the two figures up and check them");
});

test("a claim taken by ANOTHER design is recorded, and the note says so", () => {
  // First claim wins across the whole MONTH, not within a design, so the row
  // that loses a number did nothing wrong. June 2026: slab 144340 is kept by
  // Taj Aureate and claimed again by Carrara Royale, so Carrara Royale prints
  // 79 slabs across 78 distinct numbers although its own hours typed 79
  // distinct numbers (live Neon, 2026-09-03; July's 27 overlaps and August's 1
  // are all same-design). The note used to blame the row's own double-typing
  // in every case, which for that row is simply false.
  const core = decl(monthly, "async function monthCore");
  assert.match(core, /else if \(held !== k\) \{ e\.contested\+\+/,
    "a cross-design claim is no longer counted — the note cannot tell the two faults apart");
  assert.ok(monthly.includes("contestedWith"), "the row must record WHICH design holds the number, or the note cannot name it");
  assert.ok(monthly.includes("contestedWith: [...m.contestedWith].map"),
    "contestedWith must be resolved to the printed spelling, not the folded key");
  assert.ok(sheets.includes("anyContested"), "the sheet no longer distinguishes a contested row from a self-retyped one");
  assert.match(sheets, /already claimed by \$\{m2\.contestedWith\.join\(" and "\)\}/,
    "the note must name the design that holds the number");
  assert.ok(!/The gap is a typed range, not a missing slab/.test(sheets),
    "the note still asserts the old single cause for every row");
});

test("the newest QC row per slab is chosen by a TOTAL order", () => {
  // `rows.sort((a, b) => stamp(b) - stamp(a))` leaves rows that share a stamp
  // in Prisma's fetch order, which across several 5,000-row chunks is not a
  // defined order — so which verdict a re-graded slab reports could change
  // between two runs of the same report. No slab in polish_qc carries two rows
  // on one stamp today (measured 2026-09-03), so this cannot bite yet; the
  // point is that it cannot start to.
  const gp = decl(monthly, "async function gradeProduced");
  const sort = gp.slice(gp.indexOf("rows.sort("), gp.indexOf("const latest"));
  assert.ok(sort.includes("importedAt.getTime()"),
    "the stamp tie has no second key — the newest-row-per-slab choice rides on Prisma's fetch order");
  assert.ok(/a\.id [<>] b\.id/.test(sort),
    "the sort has no final total-order key; two rows sharing both timestamps still tie");
  assert.ok(/id: true/.test(monthly.slice(monthly.indexOf("const PRODUCED_QC_SELECT"), monthly.indexOf("type ProducedQcRow"))),
    "the tie-break key is not selected, so it is undefined at runtime");
});

// ───────────────────────────────────────────────── the columns must add up ──

test("Cut is its own column and is never folded into a grade", () => {
  // CTS and SAMPLE are routing states, not verdicts. A cut slab inside B is
  // the same slab shown twice to a reader who adds the row across.
  const gp = decl(monthly, "async function gradeProduced");
  const bucket = gp.slice(gp.indexOf("const bucket"), gp.indexOf("t[bucket]++"));
  assert.match(bucket, /g === "CTS" \? "cut"/, "the CTS bucket is gone — cut slabs would land in `ungraded` or a grade");
  for (const [g, k] of [["A", "A"], ["A2", "A2"], ["B", "B"], ['C (Reject)', "C"]]) {
    assert.ok(bucket.includes(`"${k}"`), `the ${g} bucket is missing`);
  }
  assert.ok(bucket.includes(': "ungraded"'), "there must be a catch-all bucket, or a slab can fall out of the six entirely");
  // exactly one increment per slab, into exactly one bucket
  assert.match(gp, /t\[bucket\]\+\+; t\.slabs\+\+;/, "a slab must be counted once, in one bucket, and once in the total");
  assert.match(gp, /total\[bucket\]\+\+; total\.slabs\+\+;/, "the month total must accumulate the same way as the design rows");
});

test("the six grade figures add across to slabs and down to the month", () => {
  // The invariant the columns are printed under, asserted on the shape that
  // produces it: every slab in slabOwner increments exactly one of the six on
  // its design's tally AND the same one on the month total, and slabs is
  // incremented alongside. So per row A+A2+B+C+cut+ungraded === slabs, and
  // summing the rows gives the month's own distinct slab count.
  const gp = decl(monthly, "async function gradeProduced");
  const body = gp.slice(gp.indexOf("for (const [slab, design] of slabOwner)"));
  assert.equal((body.match(/t\[bucket\]\+\+/g) ?? []).length, 1, "a slab must not be bucketed twice");
  assert.equal((body.match(/t\.slabs\+\+/g) ?? []).length, 1, "a slab must not be counted twice in its row total");
  assert.equal((body.match(/total\[bucket\]\+\+/g) ?? []).length, 1, "a slab must not be bucketed twice in the month total");
  // …and the type keeps the six named, so a seventh cannot appear untotalled
  const tally = decl(monthly, "export type GradeTally");
  for (const k of ["slabs", "A:", "A2:", "B:", "C:", "cut:", "ungraded:"]) {
    assert.ok(tally.includes(k), `GradeTally lost \`${k}\``);
  }
});

// ──────────────────────────────────────────────────────────── what prints ──

test("the mix table prints the six columns and a total row", () => {
  const mix = sheets.slice(sheets.indexOf('name="What the line ran'), sheets.indexOf("Page 2 of 3"));
  for (const h of [">A<", ">A2<", ">B<", ">C<", ">Cut<", ">Not yet<"]) {
    assert.ok(mix.includes(h), `the mix table has no ${h} column header`);
  }
  for (const f of ["m2.grades.A", "m2.grades.A2", "m2.grades.B", "m2.grades.C", "m2.grades.cut", "m2.grades.ungraded"]) {
    assert.ok(mix.includes(f), `the mix rows do not print ${f}`);
  }
  assert.ok(mix.includes("All designs"), "the mix table has no total row — the columns cannot be checked by eye");
  for (const f of ["pg.A", "pg.A2", "pg.B", "pg.C", "pg.cut", "pg.ungraded"]) {
    assert.ok(mix.includes(f), `the total row does not sum ${f}`);
  }
  // The Slabs column must still be `made`, which is what sums to the month's
  // output — the invariant lib/monthlyReport exists to keep.
  assert.ok(mix.includes("{num(m2.made)}") && mix.includes("{num(r.made)}"), "the Slabs column stopped counting what the hours declared");
});

test("both new tables reach the printed page at all", () => {
  // The cron renders this to PDF. A table that is screen-only never reaches
  // the CEO. This one CAN be checked from the source: it is a question about
  // which selectors sit inside @media print, not about geometry.
  const printBlock = css.slice(css.indexOf("@media print"));
  const hidden = printBlock.slice(0, printBlock.indexOf("}"));
  // .colSub carries the one word that tells Slabs from Numbers; hidden in
  // print, the PDF has two adjacent numeric columns with no way to tell which
  // is the claim count and which the slab count.
  for (const c of ["tight", "split", "pair", "subLabel", "note", "colSub"]) {
    assert.ok(!hidden.includes(`.${c}`), `.${c} is hidden in print — the new tables would not reach the PDF`);
  }
  assert.ok(!/\.colSub[^{]*\{[^}]*display:\s*none/.test(css), ".colSub must not be hidden anywhere");
  assert.match(css, /\.colSub \{[^}]*display: block/,
    ".colSub must be a block, or .t th's white-space: nowrap puts the qualifier on the header's own line and widens a twelve-column table");
  assert.ok(sheets.includes("${s.tight}"), "the mix table does not use the narrowed class");
  assert.ok(!/\.tight[^{]*\{[^}]*display:\s*none/.test(css), ".tight must not be hidden anywhere");
});

test("the mix table is set to break across pages, not to jump one", () => {
  // THIS IS A SOURCE ASSERTION AND NOT A MEASUREMENT, and the test it replaces
  // pretended otherwise: it was named "the wide one does not spill the page"
  // and only grepped the stylesheet for class names, so it passed while the
  // page spilled. Nothing in this repo can lay out a page — there is no
  // headless browser in package.json and jsdom does no layout — so the
  // geometry was measured by hand, in a real browser, at print geometry
  // (184.6mm content box, .sheet at padding 0 / min-height 0, Calibri) on
  // 2026-09-03 against the 1,027px A4 print box:
  //     August 2026 sheet two  1,291px  ->  1,172px   (36 design rows)
  //     July 2026   sheet two  1,331px  ->  1,236px
  //     June 2026   sheet two    867px  ->    797px   (fits either way)
  //     June 2026   sheet three   985px ->    996px   (fits, 31px to spare)
  // August still does not fit — 36 designs cannot — so what the source must
  // guarantee is the SAFE degradation: the table may break at a row boundary
  // with its header repeated, instead of .keep shoving all 659px of it onto a
  // further physical sheet and leaving 10cm of white behind.
  //
  // RE-MEASURED 2026-09-03 (evening), same geometry, after the Numbers column
  // and the two-line headers went in: the mix table is TWELVE columns wide and
  // still 698px — no horizontal overflow, the header sub-line costs 9px of
  // height (551 -> 560px), and August sheet two stands 1,237px. Wider than the
  // page, as before and for the same reason; .split is still what makes that
  // safe. These are layout measurements of live data, so the row counts (and
  // therefore the heights) move month by month — re-measure, do not trust.
  assert.ok(!/\$\{s\.keep\}[^>]*\$\{s\.tight\}|\$\{s\.tight\}[^>]*\$\{s\.keep\}/.test(sheets),
    "the mix table carries .keep again — at 36 designs that does not keep it on the page, it only moves the whole block");
  assert.ok(sheets.includes("${s.split}"), "the mix table must be marked as one that may break across pages");
  const split = css.slice(css.indexOf(".split {"), css.indexOf(".pair {"));
  assert.match(split, /\.split \{[^}]*break-inside: auto/, ".split must let the table itself break");
  assert.match(split, /\.split thead \{[^}]*table-header-group/,
    "the header must repeat, or the continuation page carries eleven unnamed columns");
  assert.match(split, /\.split tr \{[^}]*break-inside: avoid/, "a ROW must not be split across two pages");
  // and .tight must actually buy vertical room, which is what its comment
  // used to claim falsely: font-size and horizontal padding save zero pixels.
  const tight = css.slice(css.indexOf(".tight {"), css.indexOf(".split {"));
  assert.match(tight, /\.tight td \{[^}]*padding-top/, ".tight is back to horizontal padding only — it saves no vertical space at all");
  assert.match(tight, /\.tight td \{[^}]*line-height/, ".tight lost its line-height — the 36-row table grows 108px again");
  assert.ok(/1,291px/.test(css), "the measured before-figure has gone from the stylesheet; without it the next reader repeats the mistake");
});

test("sheet three shows the two populations side by side, labelled", () => {
  const sec = sheets.slice(sheets.indexOf('name="Quality grades"'), sheets.indexOf('name="Quality across the month"'));
  assert.ok(sec.includes("s.pair"), "the two grade tables are not side by side — the gap the owner asked to see is invisible");
  assert.equal((sec.match(/s\.subLabel/g) ?? []).length, 2, "each table must be labelled, or nobody can tell which is which");
  assert.ok(sec.includes("PRODUCED_ROWS"), "the produced-slab table is gone");
  assert.ok(sec.includes("q.grades.map"), "the all-entries table is gone — the owner asked for BOTH");
  assert.ok(sec.includes("Distinct slab numbers") && sec.includes("Total QC entries"),
    "each table needs its own total row, on its own denominator");
  // ONE QUANTITY, ONE READING. The left table counts distinct slab NUMBERS
  // (6,261 in August 2026) while page one's KPI tile and page two's Slabs
  // column count what the hours CLAIMED (6,262) — July is 5,411 against 5,438.
  // Labelling both "Slabs produced" put two numbers under one phrase on one
  // document, so the total row and the sub-label now say which one this is.
  assert.ok(!/<td>Slabs produced<\/td>/.test(sec),
    "the left total row is labelled with the KPI's own words again — two different numbers now read as one quantity");
  assert.ok(sec.includes("by distinct slab number"), "the left table's label no longer says what it counts");
  assert.ok(sec.includes("r.made === r.producedSlabs"),
    "the note must name the claims-vs-numbers difference where it prints, not leave it to a note on another page");
  assert.ok(/must not\s+be added together/.test(sec),
    "the note must say the two totals are different populations — they overlap, and adding them counts slabs twice");
  // the measured gap, stated rather than left to the reader
  for (const f of ["r.producedSlabs", "r.qcEntriesOnOwnSlabs", "r.producedGradedAfter", "pg.ungraded"]) {
    assert.ok(sec.includes(f), `the note does not state ${f} — the CEO cannot see how much of the figure is other months' stone`);
  }
  // ...and it must not claim a provenance the database does not carry: 61 of
  // August 2026's 1,000 foreign entries sit in no MIS range this report reads.
  assert.ok(!/stone from earlier batches/.test(noComments(sec)),
    "the note asserts every foreign entry is earlier stone again — 61 of August's are in no MIS range at all");
  for (const f of ["r.qcEntriesElsewhere", "r.qcEntriesUnplaced"]) {
    assert.ok(sec.includes(f), `the note does not print ${f} — the split is measured and then thrown away`);
  }
  // ...nor a provenance it can no longer prove either way (F4). "in no MIS
  // range at all" was false twice over: a blank-hour row of THIS month could
  // put a slab there, and so could a range the report deliberately refuses to
  // walk — all 14 of August 2026's placeable unplaced numbers sit only inside
  // ranges 10,015 to 1,227,644 slabs wide (live Neon, 2026-09-03).
  assert.ok(!/no MIS range at all/.test(noComments(sec)),
    "the third bucket claims the record is silent about those slabs; it can only claim this report cannot read a range for them");
  assert.ok(sec.includes("no MIS range this report can read"),
    "the third bucket must be worded as what it can actually claim");
  assert.ok(/an hour of this month that reached no\s+shift/.test(sec),
    "the second bucket still says 'another month's MIS' alone — it now also holds this month's own unlabelled hours");
});

test("the pair degenerates safely on a month with no QC entries in its window", () => {
  // getQuality windows polish_qc on importedAt, and every pre-cutover row was
  // imported in June 2026 — so for April 2026 `inspected` is 0 and `passRate`
  // null (verified on live Neon 2026-09-03 through getMonthlyReport itself:
  // inspected 0, own/elsewhere/unplaced all 0, while the left table still shows
  // 2,900 graded of 3,236). The sheet rendered an empty right-hand table with a
  // total of 0, an em-dash for the pass rate in mid-sentence, "Every one of
  // them was for a slab this month declared" about stone that does not exist,
  // and "341 … absent from the right" against nothing. Those months are
  // reachable: page.tsx clamps ?m= at the top and not at the bottom.
  const q = sheets.slice(sheets.indexOf("function SheetQualityMonth"), sheets.indexOf("Page 3 of 3"));
  assert.match(q, /const hasEntries = q\.inspected > 0;/,
    "the pair is not guarded on whether any QC entry can be read at all");
  assert.ok(/\{hasEntries && \([\s\S]{0,200}All QC entries filed this month/.test(q),
    "the right-hand table is not gated — it renders with no rows and a total of 0 on a pre-cutover month");
  assert.ok(/\{!hasEntries && <div aria-hidden/.test(q),
    "the surviving table has no spacer beside it — on its own it stretches the full sheet width and reads as a different table from every other month's");
  assert.ok(/hasEntries \? \(\s*\n\s*<>QC filed/.test(q),
    "the 'QC filed N entries' sentence is ungated; on a month with none it asserts a table that is not there");
  assert.ok(q.includes("No QC entry falls in this month"),
    "nothing says WHY the second table is missing — a reader is left to assume the plant inspected nothing");
  assert.ok(/\{hasEntries && <> against <strong>\{pct1\(q\.passRate\)\}/.test(q),
    "the second pass rate must only print when there is a second population to have one — otherwise the sentence carries an em-dash where a number belongs");
  // the "every one of them" branch may not be reachable with nothing filed
  const every = q.indexOf("Every one of them was for a slab this month declared");
  assert.ok(every > q.indexOf("hasEntries ? (") && every < q.indexOf("No QC entry falls in this month"),
    "the 'every one of them' branch sits outside the hasEntries arm — it can print about stone that does not exist");
});

test("the produced pass rate is built the same way as getQuality's, and the sheet says which to quote", () => {
  // Two rates printed in one sentence must be comparable: A or A2 over the
  // four real grades, with cut-to-size out of BOTH sides. 94.6% against 93.8%
  // for August 2026 (live Neon, 2026-09-03 — both move as QC files).
  const q = sheets.slice(sheets.indexOf("function SheetQualityMonth"), sheets.indexOf("Page 3 of 3"));
  assert.match(q, /const producedGraded = pg\.A \+ pg\.A2 \+ pg\.B \+ pg\.C;/,
    "the produced denominator must be the four grades only — including cut or ungraded makes the two rates incomparable");
  assert.match(q, /100 \* \(pg\.A \+ pg\.A2\)\) \/ producedGraded/, "the produced numerator must be A or A2");
  assert.ok(q.includes("pct1(q.passRate)"), "the overall rate must still be getQuality's own");
  // F7. The two tables are the same width, the same styling and adjacent, and
  // the right-hand one carries the familiar 93.75% headline — which makes the
  // WRONG table the sticky one. Two rates in one sentence with nothing saying
  // which is the month's quality is not a choice a reader should have to make.
  assert.ok(q.includes("quote the left-hand table"),
    "nothing tells the reader which table is the month's quality — the familiar headline rate wins by default");
  assert.ok(q.includes("★ Quote this one"), "the left table's own label does not mark it");
  assert.ok(!/most of it other months/.test(noComments(q)),
    "the note asserts most of the right-hand table is other months' stone — for August 2026 it is 1,000 of 6,390");
});

test("the late-verdict figure is described as an ARRIVAL, not a grading date", () => {
  // F5. polish_qc.created_time has been NULL on every row written since the
  // June 2026 cutover (measured 2026-09-03: 0 of the 11,853 rows imported from
  // July 2026 on carry one; the column's last value anywhere is 8 June 2026),
  // so for a recent month the only timestamp is the Airtable import. August
  // 2026's 367 late rows are ALL on the import stamp — imported 1-3 September
  // for stone pressed to 31 August, against an in-window press-to-import lag of
  // 1 day median and 7 at the 95th percentile: pipeline latency, not a late
  // verdict. April 2026 is the other case: 340 of its 341 carry a real
  // created_time. So the count is split and the sentence adapts.
  const gp = decl(monthly, "async function gradeProduced");
  assert.match(gp, /if \(q\.createdTime == null\) lateOnImportStamp\+\+;/,
    "the split between a real grading time and a bare import stamp is gone — the sheet cannot tell the two months apart");
  assert.ok(monthly.includes("producedGradedAfterOnImportStamp:"), "the split is measured and then thrown away");
  assert.ok(!/got a verdict only in the month after|were graded only after the month closed/.test(sheetsSaid),
    "a sheet is claiming a grading date the timestamp does not carry");
  assert.ok(/The QC row for[\s\S]{0,140}arrived only after the month\s+closed/.test(sheetsSaid),
    "sheet two no longer says the QC ROW arrived late");
  assert.ok(sheetsSaid.includes("only the Airtable import stamp"),
    "the caveat is gone — a reader takes the import stamp for a verdict date");
  assert.ok(sheets.includes("r.producedGradedAfterOnImportStamp === 0"),
    "the sentence no longer adapts; on a pre-cutover month it would deny a created_time that is there");
});

test("no comment reasserts the duplicate claim scripts/0073 deleted", () => {
  // F7. The 152439 overlap was REAL and is REPAIRED: commit b3a102b applied
  // scripts/0073, and on live Neon 2026-09-03 August 2026 read made 6,261,
  // producedSlabs 6,261, typedTwice 0 — the same run that this guard exists to
  // keep the prose honest about. Two comments went on describing the state that
  // commit removed, in the present tense, because a measured figure had been
  // written down as though it were a spec. So: a source file may still tell the
  // story of the overlap — it is why the partition below it exists — but every
  // place that quotes the 6,262 must also say it was repaired, or the sentence
  // is a live claim about a state that is gone.
  //
  // Deliberately NOT a database assertion. The figure moves with every MIS
  // edit; what must not move is the tense. scripts/verify-grade-columns.mts and
  // scripts/check-monthly-vs-daily.mts are where the live numbers are re-derived.
  for (const [name, src] of [["dailyReport.ts", daily], ["monthlyReport.ts", monthly]] as const) {
    for (let i = src.indexOf("6,262"); i >= 0; i = src.indexOf("6,262", i + 1)) {
      const near = src.slice(Math.max(0, i - 300), i + 300);
      assert.ok(/0073|until|had (?:re-)?typed/.test(near),
        `${name} quotes August's 6,262 without saying scripts/0073 repaired it — the overlap is gone and the sentence reads as present tense`);
    }
  }
  // And the fix must not have been made by simply deleting the history: the
  // repair is the reason the two counts are printed side by side at all.
  assert.ok(/scripts\/0073|0073/.test(monthly),
    "monthlyReport no longer names the script that closed the overlap it partitions against");
});

test("scripts/0073 states a 5 August day figure the data actually produces", () => {
  // F6. The header claimed "the 5 August day row goes 313 -> 312" and its
  // checklist repeated 312. Nothing produces either. Measured on live Neon
  // 2026-09-03, after the trim: getDailyReport('2026-08-05').day = {made 321,
  // target 345, pct 93.04}, the CEO monthly's 2026-08-05 row agrees, and the
  // MIS calendar-label day (00:00-24:00 IST) is a different question at 325.
  // The trim narrowed one hour by one slab, so 322 -> 321.
  //
  // The SQL was correct and is applied; only the prose was wrong — which is the
  // whole point of this guard. A script that has already run against live data
  // is not thereby a trustworthy description of what it did.
  const s0073 = read("../scripts/0073-mis-152439-claimed-twice.sql");
  assert.ok(s0073.includes("322 -> 321"),
    "the corrected day figure is gone from the header");
  // The forbidden thing is the ASSERTION, not the word: the correction note
  // above has to quote 312 and 313 in order to say they were never measured.
  // So the guard bans the shapes that state them as the figure.
  assert.ok(!/313\s*->|->\s*312|row is 312/.test(s0073),
    "the unmeasured 312/313 day figure is being stated as the 5 August day row again");
  assert.ok(s0073.includes("CORRECTED AFTER THE FACT"),
    "the note saying an applied script's prose was wrong has been dropped — the next reader will trust the next assertion");
  // The action_log payload is the part that WAS measured and is written to the
  // database. It must survive any prose repair untouched.
  assert.ok(s0073.includes("'august_made', '6262 -> 6261, now equal to the distinct slab count'"),
    "the action_log payload changed — that row is already in the database and describes what ran");
});
