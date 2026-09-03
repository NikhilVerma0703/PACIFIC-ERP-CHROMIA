import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gradeCredit } from "../src/lib/shiftScoreMath.ts";

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

// ───────────────────────────────── the population widened, deliberately ────

test("the table's rows are every batch the month CLAIMED, not only the ones still waiting", () => {
  // THE STRUCTURAL CHANGE, AND THE ONE THAT IS EASY TO MISS. `groups` used to be
  // built by walking `slabs` — the outstanding list — so a design+batch the
  // month pressed and QC has since finished did not exist as a row at all. That
  // is right for a backlog and wrong the moment the row shows grades: the batch
  // that graded best is the one with nothing left waiting, so it would have been
  // the one batch missing from a table of grades.
  const block = after(lib, "// ---- One row per design+batch the month claimed", 4000);
  assert.match(block, /for \(const \[slab, own\] of claimed\)/,
    "groups must be built from the month's CLAIMED slabs; building from `slabs` again loses every fully-graded batch");
  assert.ok(!/for \(const s of slabs\) \{[\s\S]{0,120}rowFor/.test(block),
    "groups is being walked from the outstanding list again — the fully graded batches vanish");
});

test("the claim is rebuilt under the score's own rules, not a second opinion", () => {
  // claimedByMonth() exists because ShiftScore reports the slabs it could NOT
  // count by number and the ones it could only as a total. If it drifts from
  // scoreShift the table stops describing the month the payout paid for.
  const fn = after(lib, "async function claimedByMonth", 3000);
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
  const block = after(lib, "// ---- One row per design+batch the month claimed", 4000);
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
  const block = after(lib, "// ---- One row per design+batch the month claimed", 4000);
  const a2 = block.indexOf('u === "A2"');
  const a = block.indexOf('u.startsWith("A")');
  assert.ok(a2 !== -1 && a !== -1, "both branches must exist — A and A2 are separate columns");
  assert.ok(a2 < a, "the exact A2 test must come first, or the A2 column reads zero and A absorbs it");
});

test("routed slabs stay out of the four grade columns, on both sides", () => {
  // The register's shipped bug, in this table's shape: a cut count sitting
  // inside a grade block that already contained the same slabs.
  const block = after(lib, "// ---- One row per design+batch the month claimed", 4000);
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
  const fn = after(lib, "async function claimedByMonth", 3000);
  assert.match(fn, /shiftRange\(anchor, letter\)\.end > now && !scored\.has\(key\)/,
    "a shift must count as ended if it ended by our clock OR scoreRange scored it");
  assert.ok(lib.includes("claimedByMonth(from, data.to, now, new Set(data.shifts.map((s) => `${s.anchor}${s.shift}`)))"),
    "the scored set must be the shifts scoreRange actually returned");
});
