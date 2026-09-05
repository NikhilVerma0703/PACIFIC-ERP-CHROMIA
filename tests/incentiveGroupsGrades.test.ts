import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gradeCredit } from "../src/lib/shiftScoreMath.ts";
import { decomposeCounted, type CountedInstance } from "../src/lib/incentiveMath.ts";
// The ladder, so the owner's "7,000 means 7,000" ruling is pinned against the
// function the payout calls rather than against a restatement of it. It became
// a live question, not a hypothetical, the moment the counted total stopped
// being a whole number.
import { poolFor, nextTier, TIERS, FLOOR_SLABS } from "../src/lib/incentiveLadder.ts";

// THE MONTH INCENTIVE TABLE — /scoreboard/incentive?month=YYYY-MM.
//
// The owner asked for A / A2 / B / C columns on the table of slabs the month is
// still waiting on, was told every row on that table is ungraded by definition,
// and answered (2026-09-03, verbatim): "Maybe make a table to show graded slabs
// or show graded slabs in the same table instead of keeping it kn different
// tables". So the table became ONE table describing the month's slabs per
// design and batch, with what has been GRADED and what is STILL WAITING side by
// side — and everything that can go wrong with such a table is arithmetic that
// a person does with their eye, not an exception anything throws.
//
// TWO THINGS ARE BEING GUARDED, AND THEY ARE THE TWO THAT HAVE ALREADY SHIPPED
// BROKEN IN THIS CODEBASE:
//
//  1. A COLUMN OF NUMBERS A HUMAN ADDS UP MUST ADD UP. The inventory register
//     shipped a Cut card of 61 sitting inside a grade block whose B card
//     already held the same 61 slabs, so six cards summed to 61 more than the
//     floor total. Here the equivalent mistake is putting a routed slab in a
//     grade column, or counting a waiting slab as graded.
//
//  2. THIS TABLE AND THE PAYOUT MUST NEVER DISAGREE about what the month
//     contained. The grades come from the same rule the SCORE uses —
//     gradeCredit() over the newest QC verdict per slab — so the four grade
//     columns add back to ShiftScore's own gradeA / gradeB / gradeC.
//
// STRUCTURAL, like tests/inventoryMarkFilter.test.ts and for the same reason:
// incentiveMonth.ts imports "@/lib/prisma" through the @/ alias, which node's
// test runner cannot resolve, and page.tsx is a React server component. Neither
// can be imported under `node --test`. The live-data half below is therefore a
// MEASURED SNAPSHOT of what the code actually produced against live Neon rather
// than a query run here.

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const lib = read("../src/lib/incentiveMonth.ts");
const page = read("../src/app/scoreboard/incentive/page.tsx");
// The two OTHER surfaces that render outstanding.groups. Widening `groups` from
// "batches with slabs waiting" to "every batch the month claimed" changed what
// both of them are describing, and neither was told — the tracker printed eight
// blank rows and the notice's caption overcounted by eight. They are guarded
// here, beside the interface they consume, because a reader changing `groups`
// again will be reading THIS file and not those two.
const tracker = read("../scripts/incentive-tracker.mts");
const notice = read("../scripts/make-incentive-month-pdf.py");
// incentiveMath.ts is the one file in this chain with no @/ alias imports, so
// its arithmetic can be RUN here as well as read.
const mathLib = read("../src/lib/incentiveMath.ts");

/** THE SAME FILE WITH ITS COMMENTS TAKEN OUT.
 *
 *  Several guards below assert that a thing is ABSENT — no design-name join, no
 *  designShare field, no unfiltered row count. This codebase explains removals
 *  in prose at the place they were removed from, so those very sentences name
 *  the thing they are saying is gone and every such guard fires on the comment
 *  that documents the fix. Strip comments first and the guard means what it
 *  says. Whole-line `//` and `#` only, plus block comments: a `//` or `#` after
 *  code is inside a string far more often than not (`bullet="#"`), and eating
 *  the rest of that line would be a worse lie than the one being fixed. */
const code = (src: string, hash = false) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "")
     .split("\n").filter((l) => !/^\s*\/\//.test(l) && !(hash && /^\s*#/.test(l))).join("\n");

/** The body of a named function/arrow declaration, up to its closing brace at
 *  column 0 or 2 — enough to scope an assertion to one place. */
const after = (src: string, marker: string, chars = 4000) => {
  const i = src.indexOf(marker);
  assert.notEqual(i, -1, `could not find ${JSON.stringify(marker)} — this guard would be vacuous`);
  return src.slice(i, i + chars);
};

/** SCOPED BY THE NEXT DECLARATION, NOT BY A CHARACTER COUNT. Two guards below
 *  read claimedByMonth() and both used `after(lib, …, 3000)`; adding a comment
 *  to the function pushed its `slabClaimAward` arm past 3,000 characters and
 *  the guard failed on prose rather than on code, which is the one way a
 *  structural test can cry wolf. Bounded by the declaration that follows it
 *  instead, so it cannot go vacuous OR spurious as the function is documented. */
const claimedByMonthFn = () => {
  const i = lib.indexOf("async function claimedByMonth");
  const j = lib.indexOf("export async function incentiveMonth");
  assert.ok(i !== -1 && j > i, "claimedByMonth or the function after it has been renamed — this guard would be vacuous");
  return lib.slice(i, j);
};

/** THE SAME LESSON, THE SAME WEEK, THE SECOND FUNCTION. Four guards below read
 *  the design+batch loop with `after(lib, …, 4000)`, and on 2026-09-05 adding
 *  the slow-design marker (a field, an increment and their comments) pushed the
 *  A2/A branches past 4,000 characters — so the guard failed while the rule it
 *  guards was untouched. Bumping the number would only move the next failure,
 *  so this is bounded by the comment that ends the loop, exactly as
 *  claimedByMonthFn is bounded by the declaration after it. */
const groupLoop = () => {
  const i = lib.indexOf("// ---- One row per design+batch the month claimed");
  const j = lib.indexOf("// THE DRIFT ALARM'S OTHER HALF");
  assert.ok(i !== -1 && j > i, "the design+batch loop or the comment after it has been renamed — this guard would be vacuous");
  return lib.slice(i, j);
};

// ───────────────────────────────── the population widened, deliberately ────

test("the table's rows are every batch the month CLAIMED, not only the ones still waiting", () => {
  // THE STRUCTURAL CHANGE, AND THE ONE THAT IS EASY TO MISS. `groups` used to be
  // built by walking `slabs` — the outstanding list — so a design+batch the
  // month pressed and QC has since finished did not exist as a row at all. That
  // is right for a backlog and wrong the moment the row shows grades: the batch
  // that graded best is the one with nothing left waiting, so it would have been
  // the one batch missing from a table of grades.
  const block = groupLoop();
  assert.match(block, /for \(const \[slab, own\] of claimed\)/,
    "groups must be built from the month's CLAIMED slabs; building from `slabs` again loses every fully-graded batch");
  assert.ok(!/for \(const s of slabs\) \{[\s\S]{0,120}rowFor/.test(block),
    "groups is being walked from the outstanding list again — the fully graded batches vanish");
});

test("the claim is rebuilt under the score's own rules, not a second opinion", () => {
  // claimedByMonth() exists because ShiftScore reports the slabs it could NOT
  // count by number and the ones it could only as a total. If it drifts from
  // scoreShift the table stops describing the month the payout paid for.
  const fn = claimedByMonthFn();
  assert.match(fn, /shiftKeyOf/, "shift membership must be the score's window rule");
  assert.match(fn, /MAX_SLABS_PER_HOUR/, "a typo'd range must be dropped here exactly as scoreShift drops it");
  assert.match(fn, /stdMultiplier/, "the lower-multiplier-wins rule decides which row names the design");
  assert.match(fn, /mult < cur\.mult/, "lower multiplier must win, as in scoreShift's rowBySlab");
  assert.match(fn, /shiftRange\(anchor, letter\)\.end > now/,
    "a shift still running is not scored, so its slabs are not claimed either");
  assert.match(fn, /slabClaimAward/,
    "a slab two shifts both claimed scores for neither unless an admin awarded it — it must not appear here when it does not appear in the payout");
  assert.match(fn, /owner\.delete\(n\)/, "an unruled contested slab must be dropped from the table");
});

// ─────────────────────────────────── grades: one slab, one column, once ────

test("a grade column can only ever hold a real verdict — gradeCredit decides", () => {
  // CTS and SAMPLE are ROUTINGS. A slab sent to cut-to-size was diverted before
  // anyone asked whether it was good, so it belongs in neither side of a grade
  // figure. gradeCredit() is the rule that already excludes them from the money;
  // reusing it here is what stops this table inventing a second rule that drifts.
  const block = groupLoop();
  assert.match(block, /gradeCredit\(q\?\.qualityGrade\)/,
    "the grade columns must be keyed on gradeCredit, not on a hand-rolled string test");
  assert.match(block, /if \(credit == null\) \{/, "a row with no countable verdict must not reach a grade column");
  // …and that slab is not silently absorbed into `claimed` either, or the row
  // would stop adding up while looking like it added up.
  assert.match(block, /unreconciled \+= 1;\s*\n\s*continue;/,
    "an unreconciled slab must be counted and skipped, never folded into a grade or into `claimed`");
});

test("A2 is tested before A, or every A2 lands in the A column", () => {
  // "A2".startsWith("A") is true. This is the same shape of bug that made
  // gradeCredit score CTS as a reject for months, because "CTS".startsWith("C").
  const block = groupLoop();
  const a2 = block.indexOf('u === "A2"');
  const a = block.indexOf('u.startsWith("A")');
  assert.ok(a2 !== -1 && a !== -1, "both branches must exist — A and A2 are separate columns");
  assert.ok(a2 < a, "the exact A2 test must come first, or the A2 column reads zero and A absorbs it");
});

test("routed slabs stay out of the four grade columns, on both sides", () => {
  // The register's shipped bug, in this table's shape: a cut count sitting
  // inside a grade block that already contained the same slabs.
  const block = groupLoop();
  const gradeArm = block.slice(block.indexOf("g.claimed += 1; g.graded += 1;"));
  assert.ok(!/stages/.test(gradeArm.slice(0, 600)),
    "the graded arm touches `stages` — a slab would be counted as graded AND as outstanding");
  // The waiting arm is the mirror image: it may only touch stages, never a grade.
  const waitArm = block.slice(block.indexOf("if (waiting) {"), block.indexOf("const q = verdictOf.get(slab);"));
  assert.ok(!/grade[AB2C]/.test(waitArm), "the waiting arm writes a grade column — the same slab would appear twice");
});

test("there is no second grade share on the row, and no name join to build one from", () => {
  // THE DESIGN-LEVEL SHARE IS GONE, AND THIS IS THE GUARD THAT KEEPS IT GONE.
  // `designShare` / `designGraded` joined the MIS design SPELLING to the QC
  // design SPELLING with a raw GROUP BY over polish_qc, and the two are not the
  // same vocabulary. On live August 2026 (measured 2026-09-03) it printed
  // "none graded yet" on 7 of the 41 rows whose own Graded column on the same
  // line read 115 / 19 / 7 / 6 / 5 / 5 / 4 — 161 graded slabs denied, because
  // MIS says 'GLENCO - 2', 'Glenco-2', 'Viola', 'Statuario trail-2', 'Toffee
  // lite trial', '08', 'Super White & Albester White' and QC has none of those
  // designs. Where it DID match it borrowed: QC's one 'GLENCO' bucket holds 206
  // graded slabs INCLUDING the GLENCO-2 ones, so GLENCO / D1411 — 50 graded of
  // its own — printed "95.4% on 206". A rebuilt version must roll up THESE rows
  // by MIS design; it must never go back to QC's spelling.
  assert.ok(!/designShare|designGraded/.test(code(lib)),
    "the design-level share is back in incentiveMonth.ts — if a design figure is wanted, roll up the rows' own counts by MIS design, never re-join to QC's spelling");
  assert.ok(!/designShare|designGraded/.test(code(page)), "the page draws a design-level share again");
  assert.ok(!/upper\(trim\(design\)\)/.test(code(lib)),
    "a design name join is back — this is the join that printed 'none graded yet' over 161 graded slabs");
});

test("routings are kept out of the grade columns by gradeCredit, which is now the only rule", () => {
  // The removed query carried its own WHERE guard against 'CTS' / 'SAMPLE' /
  // 'PRINT%'. Removing it removes that guard, so the ONLY thing keeping a
  // routing out of a grade column is gradeCredit() returning null — which is
  // also what keeps it out of the money, so the two cannot drift apart. Live
  // Neon 2026-09-03: 0 rows in polish_qc carry a routing as a GRADE (scripts
  // 0071/0072 moved all 63 to slab_mark='CTS' and regraded them 'B'), so this
  // is a guard against a restored dump, not against today's data.
  assert.equal(gradeCredit("CTS"), null);
  assert.equal(gradeCredit("SAMPLE"), null);
  assert.equal(gradeCredit("Printing"), null);
  assert.equal(gradeCredit("Not graded yet"), null);
});

// ─────────────────────────────────────────────── the arithmetic, on paper ──

test("gradeCredit is the scale the row's own share is computed on", () => {
  // The share column is (A + A2 + B/2) / graded. That is gradeCredit's scale and
  // nothing else, so a row's share and the money the same slabs earned move
  // together.
  assert.equal(gradeCredit("A"), 1);
  assert.equal(gradeCredit("A2"), 1);
  assert.equal(gradeCredit("B"), 0.5);
  assert.equal(gradeCredit("C (Reject)"), 0);
  assert.equal(gradeCredit("CTS"), null);
  assert.equal(gradeCredit("Not graded yet"), null);
  assert.match(lib, /\(g\.gradeA \+ g\.gradeA2 \+ g\.gradeB \* 0\.5\) \/ g\.graded/,
    "the row share must be built on gradeCredit's scale");
  assert.match(lib, /g\.graded >= MIN_GRADED_TO_SAY/,
    "a share on a handful of slabs says nothing and must not be printed");
});

// ────────────────────────────────────── the invariant, over live August ────

/** WHAT THE CODE ACTUALLY PRODUCED, against live Neon on 2026-09-03, for
 *  /scoreboard/incentive?month=2026-08 — the month being settled.
 *
 *  [design, batch, claimed, A, A2, B, C, graded, stillOutstanding, routed, decidedB]
 *
 *  Frozen on purpose. The plant is live and these numbers move every time QC
 *  grades another slab (they moved twice while this was being measured: 5,303
 *  graded to 5,305 inside forty minutes). What CANNOT move is the arithmetic,
 *  and that is what is asserted — over a real month's real shape, including the
 *  awkward parts the invariant has to survive: a batch with nothing graded yet
 *  (Carrara Beige D1431), eight batches with nothing left waiting, two spellings
 *  of one design on the same batch number (GLENCO - 2 / Glenco-2, D1412), a
 *  batch whose number was typed without its D (Carrara Cloud 1399), and one MIS
 *  row that named two designs at once. */
const AUGUST_2026: [string, string, number, number, number, number, number, number, number, number, number][] = [
  ["DESERT SILK", "D1422", 205, 48, 0, 7, 3, 58, 147, 0, 0],
  ["TIFFINY", "D1432", 126, 2, 8, 0, 0, 10, 116, 0, 0],
  ["Calacatta Gold", "D1425", 235, 130, 21, 5, 14, 170, 65, 0, 0],
  ["Carrara Beige", "D1431", 54, 0, 0, 0, 0, 0, 54, 0, 0],
  ["Calacatta Grey", "D1427", 66, 4, 3, 0, 6, 13, 53, 0, 0],
  ["Brilliant White", "D1405", 127, 39, 3, 33, 2, 77, 50, 0, 0],
  ["Carrara Cloud", "D1430", 515, 458, 4, 1, 7, 470, 45, 0, 0],
  ["ARTEMIS", "D1428", 46, 0, 0, 0, 2, 2, 44, 0, 0],
  ["Bellagio Green", "D1404", 283, 200, 23, 3, 19, 245, 38, 0, 0],
  ["Arva White", "D1413", 440, 361, 16, 26, 4, 407, 33, 0, 23],
  ["Pebble ice", "D1414", 422, 388, 2, 3, 0, 393, 29, 0, 0],
  ["Simply White", "D1403", 747, 665, 35, 5, 14, 719, 28, 0, 0],
  ["Aureate", "D1423", 301, 98, 167, 1, 7, 273, 28, 0, 0],
  ["Carrara Cloud", "D1399", 236, 184, 4, 16, 5, 209, 27, 0, 0],
  ["Costa", "D1409", 165, 129, 8, 0, 1, 138, 27, 0, 0],
  ["Super White", "D1406", 290, 239, 9, 12, 8, 268, 22, 0, 0],
  ["Hazel Gold", "D1410", 193, 139, 27, 4, 3, 173, 20, 0, 0],
  ["Venatino (Marmi)", "D1400", 85, 53, 1, 2, 11, 67, 18, 0, 0],
  ["Sparkle White", "D1415", 233, 216, 0, 0, 2, 218, 15, 0, 0],
  ["Carrara Royale", "D1429", 425, 406, 4, 1, 0, 411, 14, 0, 0],
  ["Honey dew", "D1426", 203, 142, 40, 1, 8, 191, 12, 0, 0],
  ["Oasis", "D1424", 144, 112, 13, 5, 2, 132, 12, 0, 0],
  ["Carrara Royale", "D1402", 174, 151, 6, 1, 5, 163, 11, 0, 0],
  ["Stella", "D1401", 103, 89, 1, 1, 1, 92, 11, 0, 0],
  ["Eminence", "D1408", 58, 11, 12, 26, 0, 49, 9, 0, 0],
  ["GLENCO - 2", "D1412", 122, 102, 3, 5, 5, 115, 7, 0, 2],
  ["Carrara Cloud", "1399", 30, 20, 1, 0, 3, 24, 6, 0, 0],
  ["Toffee lite trial", "D1433", 11, 5, 1, 0, 0, 6, 5, 0, 0],
  ["GLENCO", "D1411", 54, 48, 1, 0, 1, 50, 4, 0, 0],
  ["Ashen bloom", "D1419", 6, 2, 1, 0, 0, 3, 3, 0, 0],
  ["Alabester White", "D1407", 50, 44, 4, 0, 1, 49, 1, 0, 0],
  ["Glenco", "D1411", 34, 30, 2, 0, 1, 33, 1, 0, 0],
  ["08", "D1409", 8, 6, 1, 0, 0, 7, 1, 0, 0],
  ["Venatino (Marmi)", "1400", 22, 18, 1, 3, 0, 22, 0, 0, 0],
  ["Super White & Albester White", "D1406 & D1407", 19, 18, 1, 0, 0, 19, 0, 0, 0],
  ["Azun cascade", "D1420", 5, 5, 0, 0, 0, 5, 0, 0, 0],
  ["Glenco-2", "D1412", 5, 5, 0, 0, 0, 5, 0, 0, 0],
  ["Ijen blue", "D1421", 5, 5, 0, 0, 0, 5, 0, 0, 0],
  ["Statuario trail-2", "D1417", 5, 0, 0, 5, 0, 5, 0, 0, 0],
  ["Super white Calacatta", "D1418", 5, 4, 0, 1, 0, 5, 0, 0, 0],
  ["Viola", "D1416", 4, 0, 0, 4, 0, 4, 0, 0, 0],
];

const col = (i: number) => AUGUST_2026.reduce((a, r) => a + (r[i] as number), 0);

test("every row of live August adds up, both ways", () => {
  // THE WHOLE POINT OF PUTTING GRADED AND WAITING ON ONE LINE. If either of
  // these fails, a person reading one row cannot tell what happened to the
  // batch, and the two halves are describing different sets of slabs.
  for (const [design, batch, claimed, a, a2, b, c, graded, waiting, routed] of AUGUST_2026) {
    const where = `${design} / ${batch}`;
    assert.equal(a + a2 + b + c, graded, `${where}: A + A2 + B + C must equal graded`);
    assert.equal(graded + waiting + routed, claimed, `${where}: graded + waiting + routed must equal claimed`);
  }
});

test("the month's totals are the score's totals — the table cannot disagree with the payout", () => {
  // These are ShiftScore's own figures for August 2026, rolled up by
  // incentiveMath's plantTotals and read off the same run: claimed 6,261,
  // gradeA 4,999 (which is A + A2 together — the score does not split them),
  // gradeB 171, gradeC 135. If the four grade columns stop summing to them, the
  // table is telling the owner a different story from the one his money is
  // calculated from.
  assert.equal(col(2), 6261, "claimed");
  assert.equal(col(3) + col(4), 4999, "A + A2 must equal ShiftScore's gradeA");
  assert.equal(col(5), 171, "B must equal ShiftScore's gradeB");
  assert.equal(col(6), 135, "C must equal ShiftScore's gradeC");
  assert.equal(col(7), 5305, "graded");
  assert.equal(col(8), 956, "still outstanding");
  assert.equal(col(9), 0, "routed");
  assert.equal(col(7) + col(8) + col(9), col(2), "the totals line must add up too, or the footer lies about the column above it");
});

test("no slab is on the table twice, and none has fallen off it", () => {
  // A partition: each claimed slab is in exactly one grade column or exactly one
  // stage. Summing every cell in the table must therefore give the population
  // exactly twice — once through the grade/waiting split and once as `claimed`.
  const cells = col(3) + col(4) + col(5) + col(6) + col(8) + col(9);
  assert.equal(cells, col(2), "the cells of one row must partition its claimed slabs, no more and no fewer");
});

test("the widened population is what makes eight batches visible at all", () => {
  // These eight had nothing left waiting, so the old table — built from the
  // outstanding list — did not contain them. Between them they are 70 slabs and
  // 70 verdicts the month's record was missing, and the reason the table is
  // longer than it was (41 rows against 33) is exactly this.
  const finished = AUGUST_2026.filter((r) => r[8] === 0);
  assert.equal(finished.length, 8, "eight August batches have nothing waiting");
  assert.equal(finished.reduce((a, r) => a + r[2], 0), 70, "and 70 slabs with them");
  assert.equal(AUGUST_2026.length, 41, "41 design+batch rows claimed in August 2026");
});

test("the decided-B slabs are counted as B and named, not hidden and not doubled", () => {
  // scripts/0071 and 0072 regraded all 63 cut slabs to 'B' because their real
  // verdicts were unrecoverable. gradeCredit() sees a plain 'B' and pays each
  // half a slab of credit, so the payout counted them — and so must this table,
  // or its B column and the money would disagree. `decidedB` is a SUBSET marker
  // rendered inside the B cell, never a column of its own: 25 of August's 171 B
  // slabs, 23 on Arva White D1413 and 2 on GLENCO - 2 D1412.
  assert.equal(col(10), 25, "25 decided-B slabs in August");
  for (const r of AUGUST_2026) assert.ok(r[10] <= r[5], `${r[0]}: decidedB cannot exceed the B column it is a subset of`);
  assert.match(lib, /qualityGradeBeforeCts/, "decidedB must be read from the flag scripts/0071 stamped, not guessed");
  assert.match(lib, /g\.gradeB \+= 1;\s*\n\s*if \(String\(q\.qualityGradeBeforeCts/,
    "a decided slab must be counted in B FIRST and marked second — marking instead of counting would lose it from the total");
});

// ───────────────────────────────────────────────────────────── the screen ──

test("the page draws claimed, all four grades and the waiting stages", () => {
  for (const f of ["g.claimed", "g.gradeA", "g.gradeA2", "g.gradeB", "g.gradeC", "g.graded", "g.share", "g.decidedB"]) {
    assert.ok(page.includes(f), `the table does not draw ${f}`);
  }
  assert.match(page, /const WAIT_STAGES = STAGES\.filter\(\(s\) => s !== "routed"\)/,
    "routed must have its own column outside the waiting subtotal, or the waiting column and the stage columns beside it stop agreeing");
  assert.match(page, /g\.count - g\.stages\.routed/,
    "the waiting subtotal must exclude routed — `count` holds waiting AND routed");
});

test("the table carries a totals line, and it is summed from the rows on screen", () => {
  // A total fetched from somewhere else can be right while the column above it
  // is wrong, and nobody can tell which to believe.
  assert.match(page, /<tfoot>/, "the table has no totals line — nobody can check a column of 41 rows by eye");
  assert.match(page, /outstanding\.groups\.reduce\(\(a, g\) => a \+ f\(g\), 0\)/,
    "the totals must be summed from the rendered rows, not read off a month-wide figure");
});

test("the header, the body and the footer have the same number of columns", () => {
  // A colSpan that does not match the row under it shifts every heading one
  // column left and silently relabels the whole table.
  const table = page.slice(page.indexOf("The month by design and batch"));
  const grab = (open: string, close: string) => table.slice(table.indexOf(open) + open.length, table.indexOf(close));
  const width = (s: string) =>
    (s.match(/<t[hd][\s>/]/g) ?? []).length + (s.match(/WAIT_STAGES\.map/g) ?? []).length * 4 - (s.match(/WAIT_STAGES\.map/g) ?? []).length;
  const head = grab("<thead>", "</thead>");
  const rows = head.split("</tr>");
  const groupRow = rows[0];
  const labelRow = rows[1];
  const spans = [...groupRow.matchAll(/colSpan=\{(\d+)\}/g)].reduce((a, m) => a + Number(m[1]), 0);
  assert.equal(spans, width(labelRow), "the grouped header's colSpans do not cover the columns beneath them");
  assert.equal(width(grab("<tbody>", "</tbody>")), width(labelRow), "a body row has a different number of cells from the header");
  assert.equal(width(grab("<tfoot>", "</tfoot>")), width(labelRow), "the totals line has a different number of cells from the header");
});

test("the grade columns are NOT behind the payout gate, and the gate is still shut", () => {
  // tests/incentivePayoutFlag.test.ts pins SHOW_PAYOUT_AMOUNTS to false and pins
  // what it covers. A grade COUNT is the month's work, not a promise of money,
  // so the new columns are deliberately outside it — but adding them must not
  // have opened anything either.
  assert.match(page, /const SHOW_PAYOUT_AMOUNTS = false;/, "the payout gate must stay shut");
  const table = page.slice(page.indexOf("The month by design and batch"), page.indexOf("QC grading, last 14 days"));
  assert.ok(!/SHOW_PAYOUT_AMOUNTS/.test(table), "the batch table must neither read the gate nor need it");
  assert.ok(!/inr\(|lakh\(|pctSalary|bands\[/.test(table), "no rupee figure or share-of-pool may appear in this table");
});

test("the screen says the table is complete, because a truncated one reads as complete", () => {
  // This is a screen the owner settles payroll from. If a cap is ever added it
  // has to be visible; while there is none, the page says so.
  const table = page.slice(page.indexOf("The month by design and batch"), page.indexOf("QC grading, last 14 days"));
  assert.ok(/capped or collapsed/.test(table), "the table must state whether it is showing everything");
  assert.ok(!/\.slice\(0, \d+\)/.test(table), "the batch table is silently truncated — say so on the screen or remove the cap");
});

// ───────────────────────── the consumers of the widened `groups` interface ──

test("the tracker's waiting table filters to rows with something waiting", () => {
  // MEASURED, live Neon 2026-09-03, August 2026: outstanding.groups is 41 rows,
  // 33 with slabs waiting and 8 with none. scripts/incentive-tracker.mts renders
  // them under Design | Batch | Waiting | Counts x2 | (five stages), so those 8
  // came out as blank rows — a zero in Waiting and a dash in every stage cell —
  // under a heading that says what is still to come.
  assert.match(tracker, /const waitingGroups = outstanding\.groups\.filter\(\(g\) => g\.count > 0\)/,
    "the tracker must filter groups to the ones with something waiting before rendering its backlog table");
  assert.match(tracker, /const groupRows = waitingGroups\.map/,
    "the rows must come from the filtered list, or the filter is decorative");
  assert.match(tracker, /design-and-batch groups with slabs still waiting/,
    "any count printed beside the table must count the rows the table is showing");
  assert.ok(tracker.includes("${fmt(waitingGroups.length)} design-and-batch groups with slabs still waiting"),
    "the printed count must be the filtered length, not outstanding.groups.length");
});

test("the tracker's empty state is reachable again", () => {
  // `groupRows || "Nothing waiting."` became unreachable the moment groups held
  // every batch the month claimed: any month that pressed anything produced
  // rows, so a month with a genuinely clear backlog would have printed a table
  // of zeros instead of saying it was clear. Filtering restores it.
  const src = code(tracker);
  assert.ok(src.includes("groupRows ||"), "the empty state must still exist");
  assert.ok(src.includes("Nothing waiting."), "the empty state's words must still exist");
  const i = src.indexOf("const waitingGroups");
  const j = src.indexOf("groupRows ||");
  assert.ok(i !== -1 && i < j, "the filter must come before the empty-state fallback that depends on it");
});

test("the printed notice counts the rows it is describing, not the list they came from", () => {
  // THE SENTENCE THE MONTH IS SETTLED FROM. It read "The {len(O['groups'])}
  // design-and-batch groups with slabs waiting, largest 10 shown" — true at 33,
  // false at 41, and nothing else on the printed page revealed the difference.
  // The table body was never wrong: rows are sorted by waiting count and sliced
  // to ten, so all ten still had slabs waiting. Only the caption lied.
  assert.ok(notice.includes('waiting_groups = [g for g in O["groups"] if g["count"] > 0]'),
    "the notice must filter to the waiting rows before counting or slicing them");
  assert.ok(notice.includes("groups = waiting_groups[:10]"), "the ten shown must come from the filtered list");
  assert.ok(notice.includes("The {len(waiting_groups)} design-and-batch groups with slabs waiting"),
    "the caption must count the waiting groups");
  assert.ok(!code(notice, true).includes("The {len(O['groups'])} design-and-batch groups with slabs waiting"),
    "the caption is counting the whole claimed population again and calling it 'with slabs waiting'");
  assert.ok(notice.includes("claimed {len(O['groups'])} groups in all"),
    "the caption should state both numbers rather than quietly dropping the wider one");
});

test("the notice refuses a snapshot written before the grade columns existed", () => {
  // docs/incentive/<month>.json is written by scripts/incentive-month.mts. A
  // snapshot cut before 2026-09-03 has designShare/designGraded and no per-row
  // grade counts, so the notice would either crash mid-render or — far worse if
  // the fields were defaulted — print a blank quality column over batches QC has
  // finished. Say so and stop.
  assert.ok(notice.includes('if _g and "share" not in _g[0]'), "the notice must check the snapshot's shape");
  assert.match(notice, /sys\.exit\(/, "an out-of-date snapshot must stop the render, not be papered over");
  assert.ok(!/designShare|designGraded/.test(code(notice, true)), "the notice still reads the removed design-level share");
});

// ────────────────────────────── one quantity, one reading, on one screen ────

test("the screen says its 'A' counts A2, wherever it counts A2", () => {
  // TWO VALUES OF 'A', 423 APART, ON ONE SCREEN. shiftScore buckets on
  // u.startsWith("A"), so plant.gradeA is A and A2 added — correct, and NOT to
  // be changed: gradeCredit pays both a whole slab. But the batch table splits
  // them, so on live August 2026 the Grade-share KPI read "5,000 A" while the
  // table's footer read A 4,577 + A2 423 (measured 2026-09-03; both move as QC
  // grades, the 423 gap between the two readings does not).
  assert.ok(page.includes("A and A2 · ${fmt(plant.gradeB)} B"),
    "the Grade-share KPI's sub-line must say its A counts A2 as well");
  assert.match(page, /<th className="py-2 pr-3">A\+A2 \/ B \/ C<\/th>/,
    "the three-shifts table's grade column must say the same — it draws the same plant.gradeA");
  assert.match(page, /counts <b>A and A2 together<\/b>/,
    "the working popover spells the sum out and must name what it is summing");
  // …and the table that DOES split them says so too, with the arithmetic that
  // ties the two readings together on the page rather than in a reviewer's head.
  const table = page.slice(page.indexOf("The month by design and batch"), page.indexOf("QC grading, last 14 days"));
  assert.match(table, /A and A2 are separate columns here and nowhere else on this page/,
    "the batch table must reconcile its split columns against the page's combined figure");
});

test("shiftScore's bucketing is left alone — this was never a maths fix", () => {
  // If someone 'fixes' the KPI by splitting A2 out of plant.gradeA, the KPI stops
  // agreeing with the money: gradeCredit pays A2 a whole slab, so credit and
  // rawShare would be computed over a differently-shaped A. The page must not
  // recompute either.
  assert.equal(gradeCredit("A"), gradeCredit("A2"), "A and A2 earn the same credit — that is why the score adds them");
  assert.ok(!/plant\.gradeA\s*-\s*/.test(page), "the page is arithmetically un-mixing plant.gradeA — label it instead");
});

// ─────────────────────────────────────────── the drift alarm, both ways ────

test("the drift alarm is two-sided", () => {
  // `unreconciled` only ever caught a slab the REBUILD believed in that the
  // score did not. The opposite drift — a slab the score reports as outstanding
  // that the rebuild has not got — reached no row at all, because the groups
  // loop iterates `claimed`. The page would then print "Claimed, not yet counted
  // — N" on one card and a smaller still-waiting total two inches below, with
  // nothing to say why. Both measure 0 on live August 2026 (2026-09-03: 953
  // outstanding, 953 summed from the rows).
  assert.match(lib, /unclaimed: number;/, "the reverse drift needs a field of its own, or it stays silent");
  assert.match(lib, /for \(const s of slabs\) if \(!claimed\.has\(s\.slab\)\) unclaimed \+= 1;/,
    "the reverse drift must be counted against the score's own outstanding list");
  assert.ok(lib.includes("outstanding: { total: slabs.length, claimed: monthClaimed, unreconciled, unclaimed,"),
    "both halves must be reported");
  assert.match(page, /outstanding\.unclaimed > 0 &&/, "the page must show the reverse drift, not just the forward one");
});

test("the two derivations of 'which shifts have ended' agree", () => {
  // TWO CLOCKS. scoreRange() takes its own new Date() inside itself, strictly
  // later than the `now` incentiveMonth was called with and passes down to
  // claimedByMonth — so a shift instance ending between the two was scored and
  // not claimed, and its outstanding slabs landed on no row. The gap is
  // milliseconds wide and opens once every eight hours. The fix is a UNION, not
  // a swap: an instance scoreRange dropped for having neither slabs nor a crew
  // still passes the `now` test and must still be claimed, or the rebuild would
  // silently shrink instead of drifting loudly.
  const fn = claimedByMonthFn();
  assert.match(fn, /shiftRange\(anchor, letter\)\.end > now && !scored\.has\(key\)/,
    "a shift must count as ended if it ended by our clock OR scoreRange scored it");
  assert.ok(lib.includes("claimedByMonth(from, data.to, now, new Set(data.shifts.map((s) => `${s.anchor}${s.shift}`)))"),
    "the scored set must be the shifts scoreRange actually returned");
});

// ────────────── the heading's claim, and the slabs it deliberately leaves out ─

/** WHAT THE MONTH'S RANGES CLAIMED, AND WHAT THIS TABLE SHOWS OF IT — the three
 *  months a reader can page back to, measured on live Neon 2026-09-03 two ways:
 *  by running incentiveMonth() itself, and independently by expanding every MIS
 *  range in SQL and counting distinct slab numbers.
 *
 *    month      shown (`claimed`)   dropped (`contested`)   distinct claimed
 *    2026-06                2,541                       3              2,544
 *    2026-07                5,424                       6              5,430
 *    2026-08                6,261                       0              6,261
 *
 *  The dropped slabs are 144295, 144296 and 144340 (June) and 147766, 147767
 *  and 148112-148115 (July). Two shifts' ranges cover each of them and no admin
 *  has ruled, so the payout gives them to NEITHER shift and no row of a table
 *  keyed on design+batch can hold them — which is right, and was unsaid.
 *
 *  FROZEN, AND UNLIKE THE GRADE COUNTS THESE DO NOT MOVE AS QC WORKS. A month's
 *  claim changes only when an MIS range is retyped or a ruling is filed
 *  (slab_claim_award held 0 rows when this was measured, so every contested
 *  slab was an unruled one). They are here to pin the ARITHMETIC — shown +
 *  dropped = claimed — not to pin today's figures. */
const CLAIM_BY_MONTH: [string, number, number, number][] = [
  ["2026-06", 2541, 3, 2544],
  ["2026-07", 5424, 6, 5430],
  ["2026-08", 6261, 0, 6261],
];

test("the two halves of the month's claim add back to the month's claim", () => {
  // THE ARITHMETIC THE HEADING NOW PRINTS. If these two figures stop adding to
  // the distinct claim, the sentence on the screen is wrong again — and it was
  // wrong the quiet way: 3 short on June, 6 on July, exact on August, so the
  // only month anybody was looking at was the one that could not reveal it.
  for (const [month, shown, dropped, distinct] of CLAIM_BY_MONTH) {
    assert.equal(shown + dropped, distinct, `${month}: claimed + contested must be every slab the ranges claimed`);
  }
  assert.ok(CLAIM_BY_MONTH.some(([, , dropped]) => dropped > 0),
    "a month with contested slabs must stay in this table, or the clause is never exercised");
  assert.ok(CLAIM_BY_MONTH.some(([, , dropped]) => dropped === 0),
    "a month with none must stay too — the clause must NOT render 'and 0 more'");
});

test("the count the screen apologises with is the count actually dropped", () => {
  // NOT the count of contested slabs. An AWARDED slab is not contested any
  // more: it scores for the shift the admin gave it to and stays on a row, so
  // counting it would have the page apologise for a slab it is showing. The
  // increment therefore has to sit inside the unruled arm, beside the delete.
  const fn = claimedByMonthFn();
  assert.match(fn, /if \(!awarded\.has\(n\)\) \{ owner\.delete\(n\); dropped \+= 1; \}/,
    "the dropped count must be incremented exactly where the slab is deleted, not from contested.length");
  assert.ok(!/contested: contested\.length/.test(fn),
    "an awarded slab would be counted as dropped — the page would name a slab it is drawing");
  assert.match(fn, /return \{ owner, contested: dropped \}/, "the count must come back with the map it describes");
  assert.match(fn, /Promise<\{ owner: Map<number, ClaimedSlab>; contested: number \}>/,
    "the signature must carry both, so a caller cannot take the map and drop the count");
  assert.ok(lib.includes("const { owner: claimed, contested } = await claimedByMonth("),
    "incentiveMonth must destructure both halves — taking only the map is how the figure went unsaid the first time");
  assert.match(lib, /contested: number;/, "outstanding.contested must be part of the interface, not a local");
  assert.ok(lib.includes("unreconciled, unclaimed, contested, byStage"), "and it must actually be returned");
});

test("the screen names the dropped slabs where the heading is, and only when there are some", () => {
  const table = page.slice(page.indexOf("The month by design and batch"), page.indexOf("QC grading, last 14 days"));
  // The OLD sentence, verbatim. It claimed the table held every slab the
  // ranges claimed, and it held that minus the contested ones.
  assert.ok(!page.includes("Every slab the month&apos;s MIS ranges claimed, one row per design and batch"),
    "the heading's blurb still claims the table holds EVERY claimed slab — it holds the payable ones");
  assert.match(table, /claimed and the payout can attribute to one shift/,
    "the blurb must say what the population actually is");
  // Both the heading clause and the paragraph are conditional: on August, today,
  // there are none, and "and 0 more" would be worse than saying nothing.
  assert.ok(table.includes("{outstanding.contested > 0 && <> payable of {fmt(tot.claimed + outstanding.contested)} claimed</>}"),
    "the heading must carry both figures and their gap, and must not render the qualifier on a month with none");
  assert.match(table, /\{outstanding\.contested > 0 && \(\s*\n\s*<p/,
    "the explanation must be conditional on the same figure");
  assert.ok(table.includes("{fmt(tot.claimed + outstanding.contested)} distinct slabs in all"),
    "the page must print the total the two halves add to, or a reader cannot do the sum");
  // The disputes are rulable, and the scoreboard is where that happens. A page
  // that names an exclusion without a way to resolve it is a dead end.
  assert.match(table, /Rule on them<\/Link>/, "the clause must link to where a ruling is filed");
});

test("the same slabs are not given two different counts on one screen", () => {
  // outstanding.contested (this file's rebuild) and openDisputes
  // (scoreRange's totals.contested) are two derivations of ONE set, and the
  // page prints both — the heading clause and the amber "waiting on" card.
  // They agreed exactly on all three months above, measured 2026-09-03. If a
  // future change makes one of them mean something else, this is the guard
  // that has to be read: they must stay two readings of one quantity, or one
  // of the two sentences has to stop calling them "claimed by two shifts".
  assert.match(page, /\{fmt\(m\.openDisputes\)\} slabs claimed by two shifts, awaiting a ruling/,
    "the amber card's wording is the other reading of the same slabs");
  assert.match(lib, /THE SAME SLABS scoreRange COUNTS AS `totals\.contested`/,
    "the interface must say the two figures are one quantity, or a reader will 'fix' the gap between them");
});

// ─────────────────────── the routed column: zero is the expected reading ────

test("the routed stage is keyed on the GRADE, and a non-zero value is a regression", () => {
  // MEASURED ON LIVE NEON 2026-09-03, all time, every distinct value:
  //   SELECT quality_grade, count(*) FROM polish_qc GROUP BY 1
  //   -> A / 'Not graded yet' / A2 / B / 'C (Reject)' / NULL, and nothing else.
  // shiftScore.ts sets verdict 'cts' only for a grade of exactly 'CTS' and
  // 'printing' only for one starting 'PRINT', so stages.routed is structurally
  // zero and has been since scripts/0071 and 0072 regraded the 63 cut slabs.
  // That is the owner's decision working, not a gap: a cut slab keeps its
  // verdict and still earns credit.
  assert.equal(gradeCredit("CTS"), null, "a routing is not a verdict");
  assert.match(lib, /o\.verdict === "cts" \|\| o\.verdict === "printing" \? "routed"/,
    "routed must stay keyed on the QC verdict");
  // THE ONE CHANGE THAT MUST NEVER BE MADE TO 'FIX' THE EMPTY COLUMN. Re-keying
  // routed onto slab_mark would move the 63 decided-B slabs out of B into a
  // routing, scoring them 0 instead of half a slab each — August alone would
  // fall by 12.5 counted slabs (25 x 1/2, measured 2026-09-03) and the owner's
  // ruling would be undone by a screen tidy-up.
  // code() first: the prose above names the very column it forbids reading, so
  // an unstripped guard would fire on the sentence that documents the rule.
  assert.ok(!/slabMark|slab_mark/.test(code(lib)),
    "the routed stage is being keyed on slab_mark — that scores the owner's 63 decided-B slabs at zero and undoes his ruling");
  assert.ok(!/slabMark|slab_mark/.test(code(page)), "the page is reading slab_mark to fill the routed column");
  assert.match(lib, /`routed` IS EXPECTED TO BE ZERO, AND ITS BEING ZERO IS THE POINT/,
    "the Stage doc must say so, or the next reader treats an empty column as a bug");
});

test("the screen says zero is the expected reading, rather than showing a column of dashes", () => {
  const table = page.slice(page.indexOf("The month by design and batch"), page.indexOf("QC grading, last 14 days"));
  // A column that can only ever be empty and says nothing about itself reads as
  // a measurement of nothing happening. It is not one — it is a tripwire.
  assert.match(table, /expected 0<\/span>/, "the Routed column head must say what to expect of it");
  assert.match(table, /That column reads zero, and zero is the reading to expect/,
    "the note under the table must state it in prose as well as in the head");
  assert.match(table, /regression rather than throughput/,
    "the note must say what a NON-zero value would mean, which is the only reason to keep the column");
  assert.match(table, /scripts\/0072/, "and must point at the standing check that owns that regression");
  // The old sentence said a cut slab "sits in its own column and in none of the
  // four grades". Since 0071/0072 it sits in the B column and NOT in that one,
  // so the sentence asserted the opposite of what the data does.
  assert.ok(!page.includes("a slab sent to cut-to-size was diverted before anyone judged it, so it sits in its own"),
    "the note still says a cut slab lands in the Routed column — since scripts/0071 and 0072 it lands in B by decision");
  assert.match(table, /a cut slab now keeps\s*\n?\s*the verdict it was given/,
    "the note must say where a cut slab actually goes");
  // …and the KPI beside it must not print a permanently-zero term as if it were
  // one of the month's live figures.
  const kpi = after(page, 'label="Still to grade"', 700);
  assert.match(kpi, /outstanding\.byStage\.routed > 0 \?/,
    "the 'Still to grade' KPI prints '0 routed' unconditionally — a tripwire dressed as a measurement");
  assert.match(kpi, /a routing written into the grade/,
    "when it does fire, the KPI must say what it means");
});

test("the routed column still exists, and the row's invariant still names it", () => {
  // KEEPING IT IS THE DECISION, NOT AN OVERSIGHT. It is the visible proof that
  // no routing has been folded into a grade — the exact bug the inventory
  // register shipped twice — and the printed invariant graded + waiting +
  // routed = claimed is what a reader checks a row with.
  assert.match(page, /const WAIT_STAGES = STAGES\.filter\(\(s\) => s !== "routed"\)/,
    "routed must stay outside the waiting subtotal");
  const table = page.slice(page.indexOf("The month by design and batch"), page.indexOf("QC grading, last 14 days"));
  assert.match(table, /graded \+ still waiting \+ routed = claimed/, "the invariant must still name all three terms");
  assert.match(table, /g\.stages\.routed \? "text-amber-700"/, "the column must still be rendered");
  assert.equal(CLAIM_BY_MONTH.length, 3, "the months measured above are the evidence for 'expected 0'");
});

// ───────────────────────── the counted total, and the parts that make it ────
//
// THE KPI SAID "5,105½ good slabs + 1,327 counted a second time" UNDER A VALUE
// OF 6,432, and 5,105.5 + 1,327 is 6,432.5. The half-slab discrepancy read as a
// rounding note. It was two errors, of fourteen slabs and of thirteen and a
// half, pointing in opposite directions and very nearly cancelling:
//
//   * slowSlabs is a COUNT OF THE SLABS the doubling applied to. What the
//     doubling CONTRIBUTES is credit — gradeCredit x (multiplier - 1) — and a
//     slow slab that graded B is one slab and half a slab. So the count runs
//     above the contribution by half for every slow B.
//   * scoreShift rounds EVERY SHIFT INSTANCE (points = Math.round(weighted)).
//     A weighted total can only end in .0 or .5, and Math.round takes .5 UP, so
//     the drift is one-directional, grows with the instance count, and sat
//     inside `counted` with no name.
//
// AND THEN THE PAYOUT FIGURE ITSELF MOVED, ON PURPOSE (2026-09-04). Naming the
// rounding was not enough: `rounding` was DEFINED as points - (credit +
// doubling), and a leftover makes a row add up whether or not it is right, so
// the three-term identity could not fail and a half-slab error in `doubling`
// simply moved into the leftover with every check still green — reviewers
// demonstrated 92 of 184 such errors invisible. scoreShift therefore stopped
// rounding each shift instance and keeps the exact weighted total, on the
// owner's decision, and the term is deleted rather than explained.
//
// SO THE COUNTED TOTAL FELL, AND ONLY EVER FELL — a half can only round UP, so
// the old figure was inflated on every month in the data and never deflated:
// August 6,434 -> 6,420.5, July 4,581 -> 4,565, June 1,934 -> 1,929.5, with the
// three shift shares moving by up to 0.03 of a percentage point (all measured
// 2026-09-04). Not one of the three months changed tier or pool, because all
// three sit below the 7,000 floor. The identity a reader adds up is now
//
//     credit + doubling = counted
//
// in two terms with no remainder, and a gap between the scorer's total and the
// rebuild's is a MISMATCH, named by day / letter / size, instead of a silent
// entry in a column.
//
// AND THE OWNER'S RULING GOES WITH IT (2026-09-04, on whether 6,999.5 should
// unlock the Rs 3,00,000): "Agreed — 7,000 should mean 7,000." Now that a
// counted total can end in a half that is a live question, so it is pinned at
// the bottom of this file rather than left to poolFor's `>=` being read
// correctly by the next person.
//
// The live figures MOVE HOUR BY HOUR as QC files, so none is asserted as a
// constant here; scripts/verify-grade-columns.mts recomputes them against live
// data and asserts the arithmetic there. What is asserted HERE is the
// arithmetic itself, which does not move: decomposeCounted is pure and imports
// no @/ alias, so unlike incentiveMonth.ts it can be RUN rather than only read.

// gradeA / gradeB are REQUIRED on a row now, and every row below sets them:
// decomposeCounted builds credit as gradeA + gradeB / 2, straight off the
// integer grade counts, rather than as rawQuality x graded — a divide followed
// by a multiply back, which is not exact for every reachable pair and was
// caught out by an ulp on live 2026-07-18 shift B. The defaults here are the
// empty row, not a shortcut: a row that means to have credit says so in its own
// grade counts.
const mkInstance = (o: Partial<CountedInstance> & { anchor: string; shift: CountedInstance["shift"] }): CountedInstance =>
  ({ quantity: 1, people: [], graded: 0, gradeA: 0, gradeB: 0, rawQuality: null, points: 0, ...o });

test("credit + doubling IS the counted total, in two terms and with no remainder", () => {
  // Two instances of A, the first of them ending in a half: 5 A and 5 B is 7.5
  // credit, +2 doubling is 9.5, and 9.5 is what the scorer now hands over. It
  // used to hand over Math.round(9.5) = 10 and the extra half sat in a third
  // column called `rounding`.
  const rows = [
    mkInstance({ anchor: "2026-08-01", shift: "A", graded: 10, gradeA: 5, gradeB: 5, rawQuality: 0.75, points: 9.5 }),
    mkInstance({ anchor: "2026-08-02", shift: "A", graded: 4, gradeA: 1, gradeB: 2, rawQuality: 0.5, points: 2 }),
    mkInstance({ anchor: "2026-08-01", shift: "B", graded: 6, gradeA: 2, gradeB: 2, rawQuality: 0.5, points: 3 }),
  ];
  const d = decomposeCounted(rows, new Map([["2026-08-01A", 2]]));
  assert.equal(d.byLetter.A.credit, 9.5, "7.5 + 2 good slabs");
  assert.equal(d.byLetter.A.doubling, 2);
  assert.equal(d.byLetter.A.points, 11.5, "the counted total, and it ends in a half");
  // EXACTLY, not within a tolerance: every term is an exact multiple of a half
  // (gradeCredit in {0, ½, 1}, the slow multiplier in {1, 2}) and a half is
  // exactly representable in float64.
  for (const p of [d.byLetter.A, d.byLetter.B, d.byLetter.C, d.plant])
    assert.equal(p.credit + p.doubling, p.points, "the printed row must add to the printed total");
  assert.equal(d.plant.points, 14.5);
  assert.equal(d.disagreements, 0);
  assert.deepEqual(d.mismatches, []);
  // The deleted third term must not come back as a field that is always zero:
  // that is the same leftover with a smaller value, and a reader would add it.
  for (const k of ["rounding", "roundedUp", "exact"])
    assert.ok(!(k in d.plant), `CountedParts still carries \`${k}\`, which the identity has no room for`);
});

test("the doubling is CREDIT, and a slow grade B makes it smaller than the slab count", () => {
  // The exact shape the old sub-line got wrong: two slow slabs, one A and one
  // B. The COUNT is 2. The CREDIT they add is 1 + 0.5. Printing the count where
  // the contribution belongs overstates the month by half a slab per slow B —
  // 14 slabs on live August 2026, measured 2026-09-03 and moving as QC files.
  const rows = [mkInstance({ anchor: "2026-08-01", shift: "C", graded: 2, gradeA: 1, gradeB: 1, rawQuality: 0.75, points: 3 })];
  const d = decomposeCounted(rows, new Map([["2026-08-01C", 1.5]]));
  assert.equal(d.byLetter.C.credit, 1.5, "one A and one B");
  assert.equal(d.byLetter.C.doubling, 1.5, "NOT 2 — the B doubles to one slab, not to two");
  assert.equal(d.byLetter.C.points, 3, "and 1.5 + 1.5 is the counted total, with nothing over");
  assert.equal(d.disagreements, 0);
});

test("eight half-slab instances total four slabs, not eight", () => {
  // THIS IS THE INFLATION THE CHANGE REMOVES, at its purest. Eight instances of
  // one grade B each is four good slabs. Under the old scorer each instance was
  // Math.round(0.5) = 1 and the month counted EIGHT — a 100% overstatement on
  // this shape, +13.5 slabs on live August 2026 across 92 real instances. A
  // half can only round UP, so the drift was one-directional: the counted total
  // was inflated on every full month in the data and never once deflated.
  const rows = Array.from({ length: 8 }, (_, i) =>
    mkInstance({ anchor: `2026-08-0${i + 1}`, shift: "B", graded: 1, gradeB: 1, rawQuality: 0.5, points: 0.5 }));
  const d = decomposeCounted(rows, new Map());
  assert.equal(d.byLetter.B.instances, 8);
  assert.equal(d.byLetter.B.credit, 4, "eight halves");
  assert.equal(d.byLetter.B.points, 4, "…and four is what the month counts");
  assert.equal(d.byLetter.B.credit + d.byLetter.B.doubling, d.byLetter.B.points);
  assert.equal(d.disagreements, 0);
});

test("a HALF-slab disagreement is caught and named, which is the whole point of deleting the leftover", () => {
  // THE 92-OF-184 BLIND SPOT, in one row. The old acceptance window was
  // `drift < -1e-9 || drift > 0.5 + 1e-9` — any gap in [0, +½] was read as
  // "that is the per-instance rounding" — so a doubling that came back half a
  // slab short landed in `rounding` and every check stayed green. The window is
  // symmetric now (|gap| > 1e-9), because there is no rounding left for a gap
  // to be.
  //
  // Ten A and two B is 11 credit; the scorer's exact total is 14.5, so the
  // doubling must be 3.5. Hand in 3 and it is a mismatch of exactly half a
  // slab — invisible before, named now.
  const rows = [mkInstance({ anchor: "2026-08-01", shift: "A", graded: 12, gradeA: 10, gradeB: 2, rawQuality: 11 / 12, points: 14.5 })];
  const good = decomposeCounted(rows, new Map([["2026-08-01A", 3.5]]));
  assert.equal(good.disagreements, 0, "11 + 3.5 = 14.5, and the row is right");
  assert.deepEqual(good.mismatches, []);
  const bad = decomposeCounted(rows, new Map([["2026-08-01A", 3]]));
  assert.equal(bad.disagreements, 1, "11 + 3 = 14 against a score of 14.5 is a contradiction, not a rounding note");
  // …and it says WHICH day, WHICH letter and BY HOW MUCH, so the reader can go
  // and look. A bare count is not something anyone can act on.
  assert.deepEqual(bad.mismatches, [{ anchor: "2026-08-01", shift: "A", points: 14.5, rebuilt: 14, gap: 0.5 }]);
  assert.equal(bad.disagreements, bad.mismatches.length, "the count must be the list's length, not a second tally");
  // The row now visibly does NOT add up, which is the honesty the change buys:
  // under the leftover it added up regardless.
  assert.notEqual(bad.byLetter.A.credit + bad.byLetter.A.doubling, bad.byLetter.A.points);
});

test("mismatches come worst-gap-first, then oldest", () => {
  // A reader chasing one starts with the one that moves the total most.
  const rows = [
    mkInstance({ anchor: "2026-08-03", shift: "A", graded: 2, gradeA: 2, rawQuality: 1, points: 4 }),
    mkInstance({ anchor: "2026-08-01", shift: "B", graded: 2, gradeA: 2, rawQuality: 1, points: 5 }),
    mkInstance({ anchor: "2026-08-02", shift: "C", graded: 2, gradeA: 2, rawQuality: 1, points: 4 }),
  ];
  const d = decomposeCounted(rows, new Map());
  // credit is 2 on every row (two grade A), no doubling is handed in, so each
  // gap is that row's points less 2.
  assert.deepEqual(d.mismatches.map((x) => [x.anchor, x.shift, x.gap]),
    [["2026-08-01", "B", 3], ["2026-08-02", "C", 2], ["2026-08-03", "A", 2]]);
});

test("the decomposition counts the instances rollUpByLetter counts, and no others", () => {
  // Same filter, or `credit` here and `credit` on the three-shifts table are
  // sums over two different populations and the row stops adding up.
  const rows = [
    mkInstance({ anchor: "2026-08-01", shift: "A", quantity: 0, people: [], graded: 0, rawQuality: null, points: 0 }),
    mkInstance({ anchor: "2026-08-02", shift: "A", quantity: 0, people: ["Ramesh"], graded: 2, gradeA: 2, rawQuality: 1, points: 2 }),
  ];
  const d = decomposeCounted(rows, new Map());
  assert.equal(d.byLetter.A.instances, 1, "an instance with no slabs and no crew is not a shift");
  assert.match(after(mathLib, "export function decomposeCounted", 1400), /r\.quantity > 0 \|\| r\.people\.length > 0/,
    "the filter must be the one rollUpByLetter uses");
  assert.match(after(mathLib, "export function rollUpByLetter", 400), /r\.quantity > 0 \|\| r\.people\.length > 0/,
    "…and that is where it is copied from");
});

test("the doubling's credit is totalled per shift instance, because the score does not report it", () => {
  // scoreShift accumulates `weighted` into a local and returns it; the slow
  // slabs' share of that total does not survive the function, only `slowSlabs`,
  // which is a count. So the credit is
  // totalled off the same claim rebuild the grade columns use, keyed by
  // shiftKeyOf's own string so it lands on the instance the score scored.
  assert.match(lib, /const doublingByInstance = new Map<string, number>\(\)/,
    "the doubling must be accumulated per shift instance");
  assert.match(lib, /doublingByInstance\.set\(own\.key, \(doublingByInstance\.get\(own\.key\) \?\? 0\) \+ credit \* \(own\.mult - 1\)\)/,
    "…as gradeCredit x (mult - 1), which is what a slow slab ADDS, not how many slabs there are");
  assert.match(claimedByMonthFn(), /owner\.set\(n, \{ mult, design: r\.design \?\? null, batch: r\.batch \?\? null, key \}\)/,
    "the claim must carry the shift instance that claimed the slab");
  assert.match(lib, /decomposeCounted\(data\.shifts, doublingByInstance\)/,
    "and the decomposition must be built from the SCORE's instances, not from the rebuild's own");
});

test("the screen prints the doubling's CREDIT, in an identity with no leftover", () => {
  const kpi = after(page, 'label="Counted good slabs"', 400);
  assert.match(kpi, /decomposition\.plant\.doubling/, "the sub-line must print the doubling's credit");
  assert.ok(!/\.rounding/.test(code(kpi)), "the sub-line still prints a rounding term, which no longer exists");
  assert.ok(!/good slabs \+ \$\{fmt\(plant\.slowSlabs\)\} counted a second time/.test(page),
    "the sub-line is printing the slow-slab COUNT as the doubling's contribution again");
  // The "Counted twice" KPI is still a slab count and must say so — that is what
  // a shift wants to know. What it must not do is claim to be the contribution.
  const twice = after(page, 'label="Counted twice"', 400);
  assert.match(twice, /a count of SLABS/, "the count must be labelled a count");
  assert.ok(!/each added once more, so \+\$\{fmt\(plant\.slowSlabs\)\} to the count/.test(page),
    "the KPI still asserts the slab count is what the doubling adds");
  // …and the three-shifts table must let a reader add the row across.
  const table = page.slice(page.indexOf("The three shifts"), page.indexOf("What each person would take"));
  // THE NEGATIVE ASSERTIONS RUN ON THE COMMENT-STRIPPED SOURCE. This codebase
  // explains a removal in prose at the place it was removed from, so the very
  // sentences saying the rounding term is gone contain the string that says it
  // is present — the same trap `code()` exists for further up this file.
  const tableCode = code(table);
  assert.match(table, /Good \+ doubling = Counted/, "the table must state the identity it now satisfies");
  assert.ok(!/Good \+ doubling \+ rounding = Counted/.test(tableCode), "the three-term identity is back on the screen");
  assert.match(table, /half\(d\.doubling\)/, "a Doubling column, per letter");
  assert.match(table, /half\(decomposition\.plant\.doubling\)/, "…and on the plant row, or the footer runs narrower than the header");
  // THE ROUNDING COLUMN AND ITS HEADER GO TOGETHER OR THE ROW RUNS NARROWER
  // THAN THE HEADER — the same failure the two 100% cells are guarded against
  // in tests/incentivePayoutFlag.test.ts.
  assert.ok(!/drift\(d\.rounding\)/.test(tableCode), "the per-letter Rounding cell is still drawn");
  assert.ok(!/drift\(decomposition\.plant\.rounding\)/.test(tableCode), "the plant row's Rounding cell is still drawn");
  assert.ok(!/>Rounding</.test(tableCode), "the Rounding header outlived the column it heads");
  // THE COUNTED CELLS MUST USE THE HALF FORMATTER. fmt() is
  // toLocaleString({maximumFractionDigits: 0}) and rounds UP: fmt(6420.5) is
  // "6,421", one clear of the KPI two inches above that prints half(pool
  // .counted) = "6,420½", and the row Good + Doubling would not add across to
  // it. This is the defect the change would otherwise reintroduce at the last
  // moment, on the screen, having removed it from the score.
  assert.match(table, /half\(l\.points\)/, "the per-letter Counted cell must print halves");
  assert.match(table, /half\(plant\.points\)/, "…and so must the plant row's");
  assert.ok(!/fmt\(l\.points\)/.test(tableCode) && !/fmt\(plant\.points\)/.test(tableCode),
    "a counted total is going through fmt(), which rounds 6420.5 up to 6,421");
  assert.match(table, /decomposition\.mismatches\.length > 0/,
    "the screen must say when the score and the rebuild have stopped agreeing");
  assert.match(table, /x\.anchor/, "…and name the day");
  assert.match(table, /x\.gap/, "…and the size of the gap");
});

// ── THE OWNER'S LADDER RULING ───────────────────────────────────────────────
// 2026-09-04, asked whether a month at 6,999.5 counted slabs should unlock the
// Rs 3,00,000: "Agreed — 7,000 should mean 7,000."
//
// poolFor() already tested `countedSlabs >= t.slabs`, so this needed no code
// change — but a ruling that lives only in a `>=` nobody has read is one
// well-meant Math.round away from being reversed, and it only became reachable
// at all when the counted total stopped being a whole number. Pinned here
// against the SAME function the payout calls.
test("7,000 means 7,000 — a month at 6,999½ unlocks nothing", () => {
  assert.equal(poolFor(6999.5), 0, "half a slab short is short");
  assert.equal(poolFor(6999.9), 0);
  assert.equal(poolFor(7000), TIERS[0].pool, "and 7,000 exactly does unlock");
  assert.equal(nextTier(6999.5)?.slabs, TIERS[0].slabs, "6,999½ is still reaching for the 7,000 row");
  assert.equal(FLOOR_SLABS, TIERS[0].slabs, "the floor the screens compare against is the first rung");
  // Every rung, at the half-slab boundary: half a slab past a rung pays that
  // rung and no more, and half a slab short of the next pays the one below.
  for (let i = 0; i < TIERS.length; i++) {
    assert.equal(poolFor(TIERS[i].slabs), TIERS[i].pool, `${TIERS[i].slabs} pays its own row`);
    assert.equal(poolFor(TIERS[i].slabs - 0.5), i === 0 ? 0 : TIERS[i - 1].pool,
      `${TIERS[i].slabs}½ short must pay the row below, not this one`);
    assert.equal(poolFor(TIERS[i].slabs + 0.5), TIERS[i].pool, "half a slab past a rung is not the next rung");
  }
});

test("no float creep can tip a half-slab month over a rung", () => {
  // The pathology checked rather than assumed. Every value the system can
  // produce is an exact multiple of a half — gradeCredit is in {0, ½, 1} and
  // the slow multiplier in {1, 2} — and a half is exactly representable in
  // float64, so a sum of 13,999 of them is exactly 6999.5 and not 6999.50001.
  // That is why the `>=` needs NO epsilon, and why adding one would hand back
  // the generosity the ruling refuses.
  let n = 0;
  for (let i = 0; i < 13_999; i++) n += 0.5;
  assert.equal(n, 6999.5);
  assert.equal(poolFor(n), 0, "13,999 halves is not 7,000 slabs");
  n += 0.5;
  assert.equal(n, 7000);
  assert.equal(poolFor(n), TIERS[0].pool);
});

test("nothing on the path from the scorer to the ladder rounds the counted total", () => {
  // The ruling is only worth pinning if the figure reaching poolFor is the
  // scorer's own. Source-text, because incentiveMonth.ts imports "@/lib/prisma"
  // and cannot be run under `node --test`.
  const scorer = read("../src/lib/shiftScore.ts");
  const ret = after(scorer, "export async function scoreShift", 30_000);
  assert.ok(!/points:\s*Math\.round/.test(ret), "scoreShift is rounding the weighted total again");
  assert.ok(!/goodSlabs:\s*Math\.round/.test(ret), "scoreShift is rounding the credit again");
  // plant.points -> counted -> poolFor, with nothing in between. The slice runs
  // from the assignment to the returned `pool` object, which is where poolFor
  // is actually called; anything that rounded `counted` would have to sit
  // inside it.
  const path = code(lib).slice(code(lib).indexOf("const counted = plant.points"));
  assert.notEqual(path.indexOf("poolFor(counted)"), -1, "the ladder must be read off `counted` itself");
  const upToLadder = path.slice(0, path.indexOf("poolFor(counted)"));
  assert.ok(!/Math\.(round|ceil)\(\s*counted/.test(upToLadder),
    "counted is being rounded UP on its way to the ladder — that pays a pool on half a slab nobody pressed");
  assert.ok(!/counted\s*=\s*Math\./.test(upToLadder), "counted is being reassigned through a rounding function");
  assert.match(path, /nextTier\(counted\)/, "…and so must the rung it is still reaching for");
});

test("the verification script re-derives the decomposition instead of certifying the old one", () => {
  // scripts/verify-grade-columns.mts printed "credit + slow slabs counted twice
  // = <sum> exact … (residual -0.5)" directly above ALL CHECKS PASSED, so the
  // one line it printed about the figure the ladder is read off was hiding the
  // drift it exists to surface.
  const v = read("../scripts/verify-grade-columns.mts");
  assert.ok(!code(v).includes("+ slow slabs counted twice ${shown(slowSlabs)}"),
    "the script still prints the slab count as the exact total's second term");
  assert.match(v, /decomposition\.plant\.doubling/, "the doubling must be read from the decomposition");
  // The three residual assertions are replaced by the ONE the two-term identity
  // earns. A residual check can only restate the leftover's definition; this
  // one can fail.
  assert.ok(!code(v).includes("decomposition.plant.rounding"), "the script still reads the deleted rounding term");
  assert.ok(!code(v).includes("decomposition.plant.exact"), "the script still reads the deleted exact term");
  assert.match(v, /credit \+ doubling = counted, the figure the ladder is read off/,
    "the identity must be ASSERTED against the ladder's own figure");
  assert.match(v, /no shift instance where the score and the rebuilt decomposition disagree/,
    "and the per-instance disagreement count must fail the run");
  // shown() defaults to 0 digits and (6420.5).toFixed(0) is "6421", so a
  // counted total printed with the default would be rounded UP directly above
  // ALL CHECKS PASSED, one slab clear of the wall notice.
  assert.ok(!code(v).includes("shown(counted)"), "the counted total is printed with 0 digits and rounds up");
  assert.ok(!code(v).includes("shown(l.points)"), "a letter's counted total is printed with 0 digits");
  // And the owner's ruling is exercised against the live ladder, not assumed.
  assert.match(v, /poolFor\(6999\.5\)/, "the verification run must exercise the 7,000-means-7,000 ruling");
});

test("the notice prints the same three parts, and refuses a snapshot without them", () => {
  assert.ok(!code(notice, true).includes('slow_extra = P["points"] - P["credit"]'),
    "the notice still infers the difficulty rule's worth as points - credit, which is the doubling AND the rounding drift");
  assert.ok(notice.includes('DEC = M["decomposition"]'), "the notice must read the snapshot's own decomposition");
  assert.ok(notice.includes('if "decomposition" not in M'),
    "a snapshot cut before the decomposition existed must stop the render, as the grade-column guard beside it does");
  assert.match(notice, /the difficulty rule caught \{num\(P\['slowSlabs'\]\)\} good slabs/,
    "the slab count must be described as a count of slabs");
  assert.match(notice, /<b>\{half\(doubling\)\}<\/b> counted slabs/, "and the rule's worth must be the credit it adds");
  // THE THIRD SHAPE GUARD. A snapshot cut before 2026-09-04 carries an inflated
  // counted total (by up to 16 slabs) and a dead `rounding` key, and this
  // notice no longer prints that term — so without a guard it would render
  // silently and go on the wall wrong.
  assert.ok(notice.includes('{"rounding", "roundedUp", "exact"} & set(_dp)'),
    "a snapshot cut before the exact counted total must stop the render, as the two guards beside it do");
  assert.match(notice, /_dp\["credit"\] \+ _dp\["doubling"\] - _dp\["points"\]/,
    "…and so must a snapshot whose two terms do not add to the counted total");
  assert.ok(!code(notice, true).includes('DEC["plant"]["rounding"]'), "the notice still reads the deleted rounding term");
  assert.ok(!code(notice, true).includes('DEC["plant"]["exact"]'), "the notice still reads the deleted exact term");
  assert.ok(!/def drift\(/.test(notice), "drift() is dead once the rounding term goes");
  // THE SCREEN AND THE WALL MUST NOT PRINT ONE TOTAL TWO WAYS. Python's int()
  // TRUNCATES, so num(6420.5) is "6,420"; the ERP's fmt() rounds UP to "6,421".
  // Left alone, the notice and the screen would print August's total ONE SLAB
  // APART, in opposite directions from the truth. Every counted figure goes
  // through half() on both sides.
  assert.ok(!/num\(counted\)/.test(notice), "a counted total is going through num(), which truncates 6420.5 to 6,420");
  assert.ok(!/num\(l\["points"\]\)/.test(notice) && !/num\(l\['points'\]\)/.test(notice),
    "a letter's counted total is going through num()");
  assert.match(notice, /half\(counted\)/, "the counted total must print halves");
  assert.match(notice, /half\(l\["points"\]\)/, "…and so must the per-letter Counted cell");
  assert.match(notice, /num\(FLOOR\)/, "the floor stays whole — a rung is a target, not a measurement");
});

test("the launcher's tracker prints the same decomposition, and the same halves, as the screen", () => {
  // A PRE-EXISTING DIVERGENCE, fixed here because the formatter swap opened the
  // file anyway. page.tsx's sub-line was corrected on 2026-09-03 to print the
  // doubling's CREDIT; this copy was never brought along and went on printing
  // the slab COUNT, so a reader holding the launcher up beside the screen saw
  // two different decompositions of one total.
  assert.ok(!/good slabs \+ \$\{fmt\(plant\.slowSlabs\)\} counted a second time/.test(tracker),
    "the tracker still prints the slow-slab COUNT as the doubling's contribution");
  assert.ok(!/each added once more, so \+\$\{fmt\(plant\.slowSlabs\)\} to the count/.test(tracker),
    "…and still asserts the slab count is what the doubling adds");
  assert.match(tracker, /half\(decomposition\.plant\.doubling\)/, "it must print the doubling's credit");
  // Its own fmt() is Intl en-IN wrapped in an explicit Math.round, so it rounds
  // 6420.5 UP to 6,421 — one above the pool.counted KPI on the same page, which
  // already uses half().
  assert.ok(!/fmt\(l\.points\)/.test(tracker) && !/fmt\(plant\.points\)/.test(tracker),
    "a counted total is going through the tracker's fmt(), which rounds it up");
  assert.match(tracker, /half\(l\.points\)/, "the per-letter Counted cell must print halves");
  assert.match(tracker, /half\(plant\.points\)/, "…and so must the plant row's");
});

// ─── slowClaimed: THE 2x MARK ON A PAYROLL SCREEN, GUARDED ──────────────────
// Three mutants of incentiveMonth.ts passed the whole suite on 2026-09-05:
// delete the subtraction on the unreconciled path; move the increment below the
// waiting branch so waiting slabs are never counted; drop the `own.mult > 1`
// guard so every design is marked 2x. The agent sent to close that died with a
// half-built transpiler harness; these are the plain structural guards instead,
// scoped by groupLoop() like the rest of this file, and the LIVE identity
// (sum(slowClaimed) = slow waiting + slow graded) lives in
// scripts/verify-grade-columns.mts, where the database is.
test("slowClaimed is counted off the CLAIM row's multiplier, before the waiting branch", () => {
  const block = groupLoop();
  const inc = block.indexOf("if (own.mult > 1) g.slowClaimed += 1");
  const branch = block.indexOf("if (waiting) {");
  assert.ok(inc > 0, "the increment is gone — every row will read slowClaimed 0 and no design is marked");
  assert.ok(branch > 0, "the waiting branch has moved; re-scope this guard");
  assert.ok(inc < branch, "the increment must run BEFORE the waiting/graded split, or waiting slabs are never counted");
  assert.ok(!block.includes("if (waiting.mult > 1) g.slowClaimed"), "the multiplier must be read off `own`, the claim row, not the TrackedSlab copy");
});

test("a slab dropped as unreconciled is taken back OUT of slowClaimed", () => {
  const block = groupLoop();
  const dec = block.indexOf("if (own.mult > 1) g.slowClaimed -= 1");
  const cont = block.indexOf("unreconciled += 1");
  assert.ok(dec > 0, "the subtraction is gone — an unreconciled slow slab stays inside slowClaimed while it leaves `claimed`, and the row can read 2x N/M with N > M");
  assert.ok(cont > 0 && dec < cont, "the subtraction must sit on the unreconciled path, before the continue");
});

test("the 2x mark tells a wholly slow row from a mixed one without a hover", () => {
  const page = read("../src/app/scoreboard/incentive/page.tsx");
  assert.ok(page.includes("g.slowClaimed > 0 &&"), "the mark must fire only when some slab doubled");
  assert.ok(page.includes("g.slowClaimed !== g.claimed &&"),
    "a MIXED row must show its proportion inline — TIFFINY / D1432 was marked 2x with 13 of 126 doubled and only a tooltip said so");
  assert.ok(/\{fmt\(g\.slowClaimed\)\}\/\{fmt\(g\.claimed\)\}/.test(page), "the proportion is slowClaimed/claimed, in that order");
});
