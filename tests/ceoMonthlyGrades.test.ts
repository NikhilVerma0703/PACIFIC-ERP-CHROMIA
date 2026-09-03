import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_SLABS_PER_HOUR, slabsDeclared, rangeImpossible } from "../src/lib/shiftScoreMath.ts";

// THE CEO MONTHLY REPORT'S GRADE COLUMNS.
//
// WHAT THIS GUARDS. Sheet two's "What the line ran" table now carries A, A2,
// B, C, Cut and Not yet beside Slabs, and sheet three prints the month's own
// grades beside the month's QC entries. Both rest on ONE claim: that the
// grades belong to THE SLABS THE MONTH PRESSED, not to whatever QC happened to
// file during it. Measured on live Neon 2026-09-03 for August 2026, the two
// populations are nothing like each other:
//   6,390 QC entries filed in the month, of which 1,000 were for slabs the
//   month did not press (938 declared by an earlier month's MIS, 61 in no MIS
//   range at all), and 444 of the month's OWN slabs were not graded until
//   September. Pass rate 94.71% on the month's own slabs, 93.75% across every
//   entry. Grading the mix on the month's QC window would have been wrong by
//   both of those numbers at once.
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
  // Another agent measured this month's pass rate at 93.75% (5,475 of 5,840)
  // for August 2026 this morning, and the grade columns added here must not
  // have moved it. These four lines ARE that rate.
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
  // A slab pressed on 31 August is usually graded in September and is still an
  // August slab: 444 of August 2026's 6,261 slabs were graded only after the
  // month closed (live Neon, 2026-09-03). A where-clause on importedAt here
  // would drop every one of them into "Not yet".
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
  // 2026-09-03 for August 2026: 450 rows landed late, only 348 of them with a
  // verdict, and the other 102 were also inside the 954 "Not yet". July 931 vs
  // 846, June 286 vs 242. Re-measured after the gate: 350 / 846 / 242, and the
  // two figures on sheet three are now disjoint.
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
  const out = decl(monthly, "async function declaredOutside");
  assert.match(out, /dateAndTime: \{ lt: from \}/, "the outside-the-month window lost its earlier arm");
  assert.match(out, /dateAndTime: \{ gte: to \}/, "the outside-the-month window lost its later arm");
  assert.ok(out.includes("dateAndTime: null"),
    "an MIS row with no timestamp must count as OUTSIDE — the window filter cannot have claimed it for this month");
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
  const outside = decl(monthly, "async function declaredOutside");
  assert.ok(outside.includes("walkRange(r.startingSlabNumber, r.endingSlabNumber)"),
    "the provenance lookup walks ranges by a rule of its own — it must use walkRange");
  // and the enumeration must sit AFTER the shift gate, inside the same loop
  const gate = core.indexOf("if (x.shift == null) continue;");
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
  assert.ok(sheets.includes("x.numbered !== x.made"), "the sheet must detect and name a row whose two counts differ");
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
  const mix = sheets.slice(sheets.indexOf('name="What the line ran"'), sheets.indexOf("Page 2 of 3"));
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
  for (const c of ["tight", "split", "pair", "subLabel", "note"]) {
    assert.ok(!hidden.includes(`.${c}`), `.${c} is hidden in print — the new tables would not reach the PDF`);
  }
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
  assert.ok(sec.includes("must not be added together"),
    "the note must say the two totals are different populations — they overlap, and adding them counts slabs twice");
  // the measured gap, stated rather than left to the reader
  for (const f of ["r.producedSlabs", "r.qcEntriesOnOwnSlabs", "r.producedGradedAfter", "pg.ungraded"]) {
    assert.ok(sec.includes(f), `the note does not state ${f} — the CEO cannot see how much of the figure is other months' stone`);
  }
  // ...and it must not claim a provenance the database does not carry: 61 of
  // August 2026's 1,000 foreign entries sit in no MIS range in any month.
  assert.ok(!/stone from earlier batches/.test(sec),
    "the note asserts every foreign entry is earlier stone again — 61 of August's are in no MIS range at all");
  for (const f of ["r.qcEntriesElsewhere", "r.qcEntriesUnplaced"]) {
    assert.ok(sec.includes(f), `the note does not print ${f} — the split is measured and then thrown away`);
  }
});

test("the produced pass rate is built the same way as getQuality's", () => {
  // Two rates printed in one sentence must be comparable: A or A2 over the
  // four real grades, with cut-to-size out of BOTH sides. 94.71% against
  // 93.75% for August 2026 (live Neon, 2026-09-03).
  const q = sheets.slice(sheets.indexOf("function SheetQualityMonth"), sheets.indexOf("Page 3 of 3"));
  assert.match(q, /const producedGraded = pg\.A \+ pg\.A2 \+ pg\.B \+ pg\.C;/,
    "the produced denominator must be the four grades only — including cut or ungraded makes the two rates incomparable");
  assert.match(q, /100 \* \(pg\.A \+ pg\.A2\)\) \/ producedGraded/, "the produced numerator must be A or A2");
  assert.ok(q.includes("pct1(q.passRate)"), "the overall rate must still be getQuality's own");
});
