// Does every new grade figure ADD UP? Run it before trusting any of them.
//
//   npx tsx scripts/verify-grade-columns.mts 2026-08
//
// The CEO monthly report and the month incentive screen both grew grade
// columns, and both are read by a person who adds a row across and a column
// down. This script asserts that arithmetic against LIVE data rather than
// against what the code says it does, because the interesting failures here are
// all of the form "the column no longer sums to the total printed beside it".
//
// It also RE-DERIVES the figures that matter, straight from SQL, and compares
// them with what the two screens compute — a second, independent path to the
// same number is the only check worth having on a figure a human reads. That
// now includes the two screens' slab counts and the exact reason they differ:
// see THE TWO EXCLUSIONS below, which is a third implementation of the month's
// slab enumeration written to agree with neither screen by construction.
//
// NOTHING IN THIS FILE IS TYPE-CHECKED. tsconfig.json includes "**/*.ts" and
// "**/*.tsx" — not "**/*.mts" — so `npx tsc --noEmit` never opens this file,
// and a misspelt field name on one of the roll-up objects below compiles,
// runs, and prints "undefined" under a heading a human reads as a payout
// basis. That is not hypothetical: this script printed `counted undefined` on
// every month it was ever run, because it read inc.plant.counted and
// plantTotals has no such field. Hence `numOf` — every figure taken off
// plant / pool / projection / outstanding is read through it BY NAME and the
// run FAILS if the name does not resolve to a finite number. Add a field to
// the printout the same way, never with a bare property access.
//
// The guard is aimed at figures that are PRINTED WITHOUT AN ASSERTION, which is
// where a missing name does real damage: a wrong name inside eq() surfaces as
// "NaN vs 2467" and fails the run, but a wrong name inside a console.log prints
// as "undefined" beneath ALL CHECKS PASSED and is read as a fact. The lasting
// fix is one line in tsconfig.json — add "**/*.mts" to `include` and the
// compiler catches this class outright; measured 2026-09-03, that would cost
// one pre-existing error, in scripts/_rev_old_dailyReport.mts (TS7060, a
// reserved `<T>` arrow generic), and nothing in this file. That file is not
// ours to change, so the guard stays either way.
import { getMonthlyReport } from "../src/lib/monthlyReport.ts";
import { incentiveMonth, monthBounds } from "../src/lib/incentiveMonth.ts";
import { shiftKeyOf, shiftRange, MAX_SLABS_PER_HOUR, type ShiftLetter } from "../src/lib/shiftScoreMath.ts";
import { prisma } from "../src/lib/prisma.ts";

const month = process.argv[2] ?? "2026-08";
let failures = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "  ok  " : " FAIL "} ${label}${detail ? "   " + detail : ""}`);
};
const eq = (label: string, a: number, b: number, detail = "") =>
  ok(label, a === b, `${a} vs ${b}${detail ? " — " + detail : ""}`);

// ---- the field-name guard described in the header ------------------------
// Reads `path`'s last segment off `bag` and insists on a finite number. A name
// that does not exist arrives as undefined, which is exactly the bug this
// guard exists for, so it is named in the failure rather than printed as a
// figure. `nullable` is for the genuinely-null fields (a month with nothing
// graded has no share); null is a value, undefined is a typo.
const badFields: string[] = [];
let fieldsRead = 0;
const numOf = (bag: unknown, path: string, nullable = false): number | null => {
  const key = path.slice(path.lastIndexOf(".") + 1);
  const v = (bag as Record<string, unknown> | null | undefined)?.[key];
  fieldsRead++;
  if (v === null && nullable) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    badFields.push(`${path} = ${v === undefined ? "undefined (no such field)" : String(v)}`);
    return NaN;
  }
  return v;
};
const shown = (n: number | null, digits = 0) => (n == null ? "n/a" : n.toFixed(digits));

console.log(`\n=== ${month} — CEO MONTHLY REPORT =========================\n`);
const r = await getMonthlyReport(month);
const g = r.producedGrades;

// ---- the row arithmetic, on every row, not a sample -----------------------
let rowsBad = 0;
for (const m of r.mix) {
  const t = m.grades;
  if (t.A + t.A2 + t.B + t.C + t.cut + t.ungraded !== t.slabs) rowsBad++;
  if (t.slabs !== m.numbered) rowsBad++;
}
eq(`every one of ${r.mix.length} design rows adds across`, rowsBad, 0);

// ---- and the columns down the page ---------------------------------------
const col = (k: "A" | "A2" | "B" | "C" | "cut" | "ungraded" | "slabs") =>
  r.mix.reduce((a, m) => a + m.grades[k], 0);
for (const k of ["A", "A2", "B", "C", "cut", "ungraded", "slabs"] as const) {
  eq(`column ${k} sums down the page to the month total`, col(k), g[k]);
}
eq("the six buckets partition the month's own slabs",
   g.A + g.A2 + g.B + g.C + g.cut + g.ungraded, g.slabs);
eq("the month's distinct slab numbers", g.slabs, r.producedSlabs);
eq("sum(mix.made) is still the month's made", r.mix.reduce((a, m) => a + m.made, 0), r.made);

// ---- the provenance split must be exhaustive -----------------------------
eq("own + elsewhere + unplaced === every QC entry filed",
   r.qcEntriesOnOwnSlabs + r.qcEntriesElsewhere + r.qcEntriesUnplaced, r.quality.inspected);

// ---- the pass rate, PRINTED so a human can watch it -----------------------
// NOT a spec, and no figure is asserted here. August 2026 read 93.75% on
// 2026-09-03 and it moves every time QC files a row — the plant is live and
// this month's stone is still being graded. What this block is for is the
// refactor question: the verdict rule now lives in dailyReport's noVerdict /
// gradeOf and getQuality calls it, so if extracting it moved the CEO's
// headline quality number, that refactor is wrong however clean it looks. Run
// the script before and after such a change and compare these two lines; do
// not compare them against a number typed in a comment.
// passRate is null on a month with nothing graded — .toFixed() on it throws,
// and nothing type-checks this file to say so (see the header).
console.log(`\n  pass rate (all QC entries filed) : ${r.quality.passRate == null ? "n/a — nothing graded" : r.quality.passRate.toFixed(2) + "%"}`);
console.log(`  graded ${r.quality.graded}  passed ${r.quality.passed}  inspected ${r.quality.inspected}`);
const producedGraded = g.A + g.A2 + g.B + g.C;
console.log(`  pass rate (this month's own stone): ${producedGraded === 0 ? "n/a" : (((g.A + g.A2) / producedGraded) * 100).toFixed(2) + "%"}  on ${producedGraded} graded`);

// ---- the figure that was wrong once, printed so a human can sanity-check it -
// producedGradedAfter counted ROWS that arrived late, including rows still
// reading "Not graded yet", and so double-counted those slabs with `ungraded`
// in a sentence a reader takes as disjoint. It is now gated on the verdict, and
// the assertion that matters is that it can never exceed the graded population
// nor overlap the ungraded one.
ok("graded-after-the-month cannot exceed the graded population",
   r.producedGradedAfter <= producedGraded,
   `${r.producedGradedAfter} late of ${producedGraded} graded`);
console.log(`  of the month's own slabs, ${r.producedGradedAfter} got their verdict only after it closed`);
console.log(`  and ${g.ungraded} still carry no verdict at all (these two sets must not overlap)`);

console.log(`\n=== ${month} — MONTH INCENTIVE ============================\n`);
const inc = await incentiveMonth(month);
const gr = inc.outstanding.groups;
let gBad = 0, cBad = 0;
for (const x of gr) {
  if (x.gradeA + x.gradeA2 + x.gradeB + x.gradeC !== x.graded) gBad++;
  const waiting = Object.entries(x.stages)
    .filter(([k]) => k !== "routed")
    .reduce((a, [, v]) => a + (v as number), 0);
  if (x.graded + waiting + x.stages.routed !== x.claimed) cBad++;
}
eq(`the four grade columns sum to graded, on all ${gr.length} rows`, gBad, 0);
eq("graded + waiting + routed === claimed, on every row", cBad, 0);
eq("the rows' waiting adds to outstanding.total",
   gr.reduce((a, x) => a + Object.values(x.stages).reduce((b, v) => b + (v as number), 0), 0),
   inc.outstanding.total);

// ---- EVERY FIGURE BELOW IS READ BY NAME, THROUGH THE GUARD ----------------
// plant is plantTotals()'s return, pool/projection are incentiveMonth's own
// objects. The names are checked at runtime because nothing type-checks this
// file (see the header). `counted` lives on POOL, not on plant: plant's
// equivalent is `points`, and pool.counted is assigned from it.
const counted = numOf(inc.pool, "pool.counted");
const points = numOf(inc.plant, "plant.points");
const credit = numOf(inc.plant, "plant.credit");
const slowSlabs = numOf(inc.plant, "plant.slowSlabs");
const plantClaimed = numOf(inc.plant, "plant.claimed");
const plantGraded = numOf(inc.plant, "plant.graded");
const plantUngraded = numOf(inc.plant, "plant.ungraded");
const poolNow = numOf(inc.pool, "pool.poolNow");
const floor = numOf(inc.pool, "pool.floor");
const share = numOf(inc.projection, "projection.share", true);
const projectedReal = numOf(inc.projection, "projection.projectedReal");
const poolReal = numOf(inc.projection, "projection.poolReal");
const projectedAll = numOf(inc.projection, "projection.projectedAll");
const outTotal = numOf(inc.outstanding, "outstanding.total");
const outReal = numOf(inc.outstanding, "outstanding.real");
const outClaimed = numOf(inc.outstanding, "outstanding.claimed");
const outUnreconciled = numOf(inc.outstanding, "outstanding.unreconciled");
// pool.next is null once the top tier is reached, so its two numbers are read
// only when it is there — and its ABSENCE is checked, not assumed.
const nextTier = (inc.pool as { next?: unknown }).next;
if (nextTier === undefined) badFields.push("pool.next = undefined (no such field)");
const nextSlabs = nextTier == null ? null : numOf(nextTier, "pool.next.slabs");
const nextPool = nextTier == null ? null : numOf(nextTier, "pool.next.pool");
ok("every plant / pool / projection / outstanding field this script prints exists and is a number",
   badFields.length === 0, badFields.join("; ") || `${fieldsRead} fields read by name, all present`);

const rowsWaiting = gr.filter((x) => Object.values(x.stages).some((v) => (v as number) > 0)).length;
console.log(`\n  design+batch rows: ${gr.length} claimed, ${rowsWaiting} with something waiting`);
console.log(`  outstanding ${outTotal}  real ${outReal}  unreconciled ${outUnreconciled}`);
console.log(`  A ${gr.reduce((a, x) => a + x.gradeA, 0)}  A2 ${gr.reduce((a, x) => a + x.gradeA2, 0)}` +
            `  B ${gr.reduce((a, x) => a + x.gradeB, 0)}  C ${gr.reduce((a, x) => a + x.gradeC, 0)}` +
            `  graded ${gr.reduce((a, x) => a + x.graded, 0)}`);

// ---- THE LADDER FIGURE, which is the one the payout is read off -----------
// `counted` is what the tier ladder is looked up on, so it gets its own lines
// and its own arithmetic. points = credit with slow-product slabs counted
// twice, summed per shift instance AFTER scoreShift rounds each one — so it
// need not equal credit + slowSlabs exactly, and the residual is printed
// rather than asserted away.
console.log(`\n  counted (the ladder's own figure) : ${shown(counted)}`);
eq("pool.counted is plant.points", counted ?? NaN, points ?? NaN);
console.log(`  credit ${shown(credit, 1)} + slow slabs counted twice ${shown(slowSlabs)}` +
            ` = ${shown((credit ?? NaN) + (slowSlabs ?? NaN), 1)} exact,` +
            ` ${shown(points)} after per-shift rounding` +
            ` (residual ${shown((points ?? NaN) - (credit ?? NaN) - (slowSlabs ?? NaN), 1)})`);
console.log(`  pool now ${shown(poolNow)} on a ${shown(floor)}-slab floor;` +
            ` next tier ${nextSlabs == null ? "none — top of the ladder" : `${shown(nextSlabs)} slabs for ${shown(nextPool)}`}`);
console.log(`  projection at share ${share == null ? "n/a" : (share * 100).toFixed(2) + "%"}:` +
            ` real ${shown(projectedReal, 1)} (pool ${shown(poolReal)}), all ${shown(projectedAll, 1)}`);
eq("plant.graded + plant.ungraded === plant.claimed", (plantGraded ?? NaN) + (plantUngraded ?? NaN), plantClaimed ?? NaN);
eq("outstanding.claimed is the rows' claimed", outClaimed ?? NaN, gr.reduce((a, x) => a + x.claimed, 0));
eq("outstanding.claimed is plant.claimed", outClaimed ?? NaN, plantClaimed ?? NaN);
// REPORTED, NOT ASSERTED. plant.graded comes from scoreRange's own count;
// the groups' graded comes from the QC lookup the rebuild does afterwards,
// milliseconds later, on a live plant. A slab that grades in between is graded
// on one and waiting on the other — one slab on August at 2026-09-03 — and the
// pair moves in opposite directions, which is why `claimed` above is asserted
// and this is not. A difference of more than a handful, or one that survives a
// re-run, is not a race.
const groupsGraded = gr.reduce((a, x) => a + x.graded, 0);
if (groupsGraded !== plantGraded)
  console.log(`  NOTE the score counted ${shown(plantGraded)} graded / ${shown(plantUngraded)} waiting,` +
              ` the rebuild ${groupsGraded} / ${outTotal} — ${Math.abs(groupsGraded - (plantGraded ?? NaN))}` +
              ` slab(s) graded between the two reads. Re-run: a real fault does not move.`);

console.log(`\n=== CROSS-SCREEN ========================================\n`);
const incB = gr.reduce((a, x) => a + x.gradeB, 0);
const incGraded = gr.reduce((a, x) => a + x.graded, 0);
const incClaimed = gr.reduce((a, x) => a + x.claimed, 0);

// ---- REPORTED, NOT ASSERTED, AND HERE IS WHY -----------------------------
// The incentive screen and the CEO report describe the same stone. They count
// it for different purposes and need not agree exactly — but a large gap means
// one of them is wrong, and the owner settles payroll from both. So the gap is
// PRINTED, loudly, and only the arithmetic each screen owes on its own figures
// is asserted.
//
// WHY EQUALITY IS NOT AN INVARIANT — and it is no longer an open question.
// The two enumerations of "the slabs this month made" differ, in BOTH
// directions, month by month, and the cause is now settled: each screen drops
// a different set of slabs, for its own defensible reason.
//
//   * The CEO report walks the mix's own hour rows and skips any row that
//     reaches no shift, i.e. whose `hour` label is blank — see monthlyReport's
//     "Only rows that reach a shift" guard. Those rows' slab ranges are
//     therefore in no design row and in no grade column.
//   * The incentive walks scoreRange's claimed set, which drops any slab two
//     SHIFTS both claimed and no admin has awarded: it scores for neither, so
//     it is in no payout row either.
//
// A slab in the first set is missing from the report and present on the
// incentive; a slab in the second is the other way round. The gap is the
// difference of the two, and THE TWO EXCLUSIONS below re-derives both from MIS
// and asserts exactly that — so a THIRD cause appearing (a row with no
// timestamp at all, a window that stops tiling, a guard that stops matching)
// fails the run instead of being absorbed into a gap already labelled
// "explained". Both screens are being changed to disclose their own exclusion
// where they print the figure; this script is what keeps those disclosures
// honest.
//
// What the script printed on 2026-09-03, on live Neon — a record of the shape
// of the thing, not a target, since every grade figure here moves as QC files:
// June 2026 gapped +74 (77 blank-hour slabs the report dropped, less 3
// contested the incentive dropped), July +13 (19 less 6), August 0 — August
// has neither exclusion, which is exactly why it reconciles slab for slab.
// Re-run the script for today's figures; do not trust these.
const say = (label: string, a: number, b: number) =>
  console.log(`  ${a === b ? "agree " : "DIFFER"} ${label.padEnd(34)} report ${String(a).padStart(6)}   incentive ${String(b).padStart(6)}` +
              (a === b ? "" : `   gap ${b - a > 0 ? "+" : ""}${b - a}`));
say("the month's slab count", g.slabs, incClaimed);
say("still waiting", g.ungraded, inc.outstanding.total);
say("grade A", g.A, gr.reduce((a, x) => a + x.gradeA, 0));
say("grade A2", g.A2, gr.reduce((a, x) => a + x.gradeA2, 0));
say("grade C", g.C, gr.reduce((a, x) => a + x.gradeC, 0));

// ---- AND THE ONE PLACE THEY DELIBERATELY DO NOT ---------------------------
// B and `graded` differ by the cut-to-size count, and that is CORRECT on both
// screens for opposite reasons:
//
//   * The CEO report asks "how did the stone we inspected grade?". The 63 slabs
//     scripts/0071 and 0072 regraded to 'B' were never inspected — the verdict
//     was destroyed and the B is a DECISION. They belong in the Cut column and
//     out of both sides of the pass rate.
//   * The incentive screen asks "what is the month paid for?". gradeCredit()
//     sees a plain 'B' and pays each one half a slab, so the table must count
//     them under B or it would contradict the payout printed beside it.
//
// Both right, same word, two numbers. THE EQUATION "incentive B - report B =
// cut" IS ONLY TRUE WHEN THE TWO SCREENS ARE DESCRIBING THE SAME SLABS. It is
// printed only then, and asserted only when nothing else on this page differs
// either — because a slab that grades between the report's QC fetch and the
// incentive's would move B by one and has nothing to do with cut-to-size. On a
// month whose slab sets differ, the difference is cut PLUS however the disputed
// slabs graded, and the line says so instead of printing an identity that does
// not hold. (2026-09-03: August asserted and held, 171 - 146 = 25; June printed
// 129 - 120 = 9 against a cut count of 11 and was not asserted.)
say("grade B (cut counted as B by payout)", g.B, incB);
const sameSlabs = g.slabs === incClaimed;
const noDrift = g.A === gr.reduce((a, x) => a + x.gradeA, 0)
  && g.A2 === gr.reduce((a, x) => a + x.gradeA2, 0)
  && g.C === gr.reduce((a, x) => a + x.gradeC, 0)
  && g.ungraded === inc.outstanding.total;
if (sameSlabs && noDrift) {
  eq("incentive B - report B is EXACTLY the cut count", incB - g.B, g.cut,
     `the two screens hold the same ${g.slabs} slabs and agree on A, A2, C and waiting, so cut is the only difference left`);
} else if (sameSlabs) {
  console.log(`         the two screens hold the same ${g.slabs} slabs but do not agree on A / A2 / C / waiting,`);
  console.log(`         so QC graded something between the two reads: B differs by ${incB - g.B} against a cut count of ${g.cut}.`);
  console.log(`         Re-run before believing it — this is asserted only on a run with no drift.`);
} else {
  console.log(`         NOT an equation this month. The two screens describe DIFFERENT slab sets`);
  console.log(`         (report ${g.slabs}, incentive ${incClaimed}, ${Math.abs(incClaimed - g.slabs)} slabs apart — see THE TWO EXCLUSIONS`);
  console.log(`         below). Incentive B - report B is ${incB - g.B}: the ${g.cut} cut slab(s) the report keeps out of B,`);
  console.log(`         moved again by however those ${Math.abs(incClaimed - g.slabs)} slabs graded. The equation holds only when the sets match.`);
}
say("graded", producedGraded, incGraded);

console.log(`\n  CEO report, month's own slabs        : ${g.slabs}`);
console.log(`  Incentive, slabs the month claimed   : ${incClaimed}`);
console.log(`  CEO report, own slabs still ungraded : ${g.ungraded}`);
console.log(`  Incentive, still waiting             : ${inc.outstanding.total}`);
console.log(`  B: report ${g.B} (cut kept out) vs incentive ${incB} (cut paid as B) — difference ${incB - g.B}` +
            `${sameSlabs ? `, cut ${g.cut}` : `; the report keeps ${g.cut} cut slabs out of B, and the slab-set gap moves it again`}`);

// ==========================================================================
// THE TWO EXCLUSIONS, RE-DERIVED FROM MIS — the check that keeps the
// explanation above honest.
//
// A THIRD implementation of "which slab numbers did this month make", written
// from the MIS rows directly and agreeing with NEITHER screen by construction:
// it keeps both exclusions and reports each separately. The four conditions on
// a range are the ones monthlyReport's walkRange and incentiveMonth's
// claimedByMonth both apply (finite both ends, start above zero, end not before
// start, width under MAX_SLABS_PER_HOUR — imported, so the width cannot drift
// apart from theirs), and the window is the same 06:00→06:00 IST tiling.
//
// It asserts four things:
//   1. it reproduces the CEO report's own count,
//   2. it reproduces the incentive's own count,
//   3. the gap between them is EXACTLY (blank-hour slabs the report dropped and
//      no other row claimed) minus (contested slabs the incentive dropped),
//   4. and no slab reaches the incentive from outside the rows the report
//      fetched at all — the check that catches a third cause, e.g. a MIS row
//      with a `date` but no `date_and_time`, which the incentive reads and the
//      report's where-clause cannot see.
// Verified on live Neon 2026-09-03 for 2026-06, 2026-07 and 2026-08; run it
// for today's figures rather than trusting any number in this comment.
//
// IF EITHER SCREEN EVER CHANGES WHICH SLABS IT COUNTS — as opposed to merely
// disclosing what it drops — check 1 or check 2 is the first thing to fail, and
// the mirror below is what must be brought back into step with it. That is the
// intended failure mode: a third path is only worth having while it is known to
// be independent, so it fails rather than quietly re-deriving the new rule.
//
// NOT ASSERTED FOR A MONTH STILL RUNNING: the CEO report caps its days at
// today's report day while the incentive scores every shift that has ENDED, so
// the two legitimately cover different spans and the identity is not owed.
const validRange = (a: unknown, b: unknown): [number, number] | null => {
  const s = a == null || !Number.isFinite(Number(a)) ? null : Number(a);
  const e = b == null || !Number.isFinite(Number(b)) ? null : Number(b);
  return s == null || e == null || s <= 0 || e < s || e - s >= MAX_SLABS_PER_HOUR ? null : [s, e];
};

console.log(`\n=== THE TWO EXCLUSIONS (re-derived from MIS) =============\n`);
const { from, to } = monthBounds(month);
const lo = shiftRange(from, "A").start;
const hi = shiftRange(to, "C").end;
const mis = await prisma.mis.findMany({
  where: {
    OR: [
      { dateAndTime: { gte: lo, lt: hi } },
      { AND: [{ dateAndTime: null }, { date: { gte: lo, lt: hi } }] },
    ],
  },
  select: { hour: true, date: true, dateAndTime: true, startingSlabNumber: true, endingSlabNumber: true },
});

const now = new Date();
const reportSet = new Set<number>();   // what the CEO report's enumeration keeps
const blankSet = new Set<number>();    // ranges on rows the report skips for having no hour label
const incSet = new Set<number>();      // what the incentive claims, before the contested drop
const claimedBy = new Map<number, Set<string>>();
let blankRows = 0, blankRangeRows = 0, blankSpan = 0, noTimestamp = 0;

for (const row of mis) {
  const range = validRange(row.startingSlabNumber, row.endingSlabNumber);
  // ---- the CEO report's side: timestamped rows only (its where-clause), and
  // only rows that reach a shift — hourStart() returns null for a blank label,
  // and assembleHours then leaves `shift` null, which monthCore skips.
  if (row.dateAndTime) {
    const hourLabel = row.hour ? Number(String(row.hour).slice(0, 2)) : null;
    if (hourLabel === null) {
      blankRows++;
      if (range) {
        blankRangeRows++;
        blankSpan += range[1] - range[0] + 1;
        for (let n = range[0]; n <= range[1]; n++) blankSet.add(n);
      }
    } else if (range) for (let n = range[0]; n <= range[1]; n++) reportSet.add(n);
  } else noTimestamp++;
  // ---- the incentive's side: dateAndTime when it is there, else the IST day
  // LABEL in `date`, bucketed by shiftKeyOf, and only shift instances that have
  // ended — claimedByMonth's own rules.
  const ts = row.dateAndTime ?? row.date;
  if (!ts || !range) continue;
  const key = shiftKeyOf(new Date(ts));
  const anchor = key.slice(0, 10), letter = key.slice(10) as ShiftLetter;
  if (anchor < from || anchor > to) continue;
  if (shiftRange(anchor, letter).end > now) continue;
  for (let n = range[0]; n <= range[1]; n++) {
    incSet.add(n);
    let who = claimedBy.get(n);
    if (!who) claimedBy.set(n, who = new Set());
    who.add(key);
  }
}

const contested = [...claimedBy].filter(([, who]) => who.size > 1).map(([n]) => n);
const awarded = new Set<number>();
for (let i = 0; i < contested.length; i += 5000) {
  const rows = await prisma.slabClaimAward.findMany({
    where: { slabNumber: { in: contested.slice(i, i + 5000) } },
    select: { slabNumber: true },
  });
  for (const a of rows) awarded.add(Number(a.slabNumber));
}
const dropped = contested.filter((n) => !awarded.has(n));
const incKept = new Set([...incSet].filter((n) => !dropped.includes(n)));
const everySlab = new Set([...reportSet, ...blankSet, ...incSet]);
const blankOnly = [...blankSet].filter((n) => !reportSet.has(n)).length;
const reportOnly = [...reportSet].filter((n) => !incKept.has(n)).length;

console.log(`  MIS rows in the month's window                     : ${mis.length}` +
            `${noTimestamp ? `  (${noTimestamp} with no date_and_time — see check 4)` : ""}`);
console.log(`  the report's enumeration, re-derived               : ${reportSet.size} distinct slab numbers`);
console.log(`  dropped by the REPORT, blank hour label            : ` + (blankRows === 0 ? "none" :
            `${blankRows} row(s), ${blankRangeRows} of them carrying a usable range,` +
            ` covering ${blankSpan} slab numbers, ${blankOnly} claimed by no other row`));
console.log(`  dropped by the INCENTIVE, two shifts both claimed  : ` + (contested.length === 0 ? "none" :
            `${contested.length} contested, ${awarded.size} awarded, ${dropped.length} dropped`));
console.log(`  the incentive's enumeration, re-derived            : ${incKept.size} distinct slab numbers`);
console.log(`  slabs the report holds that the incentive does not : ${reportOnly}`);
console.log(`  every slab number either screen can see            : ${everySlab.size}\n`);

if (r.monthToDate) {
  console.log(`  NOT CHECKED — ${month} is still running. The CEO report caps its days at today's`);
  console.log(`  report day and the incentive scores every ENDED shift, so the two cover different`);
  console.log(`  spans and owe no identity. Re-run once the month has closed.`);
} else {
  eq("1. the CEO report's slab count, re-derived from MIS", reportSet.size, r.producedSlabs);
  eq("2. the incentive's slab count, re-derived from MIS", incKept.size, incClaimed);
  eq("3. the gap is blank-hour-dropped minus contested-dropped",
     incClaimed - g.slabs, blankOnly - dropped.length,
     `${blankOnly} the report dropped less ${dropped.length} the incentive dropped — a third cause would break this`);
  eq("4. no slab reaches the incentive from outside the rows the report fetched",
     everySlab.size, reportSet.size + blankOnly,
     "a MIS row with no date_and_time, or a window that stopped tiling, lands here");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
