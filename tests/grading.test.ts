import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canonicalGrade, gradeBlocksDispatch, markBlocksDispatch, slabBlocksDispatch, dispatchCut,
  CUT_GRADES, CUT_MARKS, TRANSITIONS, DEFAULT_RESERVATION_DAYS,
} from "../src/lib/inventory/grading.ts";

test("canonicalGrade normalizes QC grades", () => {
  assert.equal(canonicalGrade("A"), "A");
  assert.equal(canonicalGrade("A2"), "A2");
  assert.equal(canonicalGrade("C (Reject)"), "C");
  assert.equal(canonicalGrade("c (reject)"), "c");
  assert.equal(canonicalGrade("  B  "), "B");
  assert.equal(canonicalGrade("Not graded yet"), null);
  assert.equal(canonicalGrade("not graded"), null);
  assert.equal(canonicalGrade(""), null);
  assert.equal(canonicalGrade(null), null);
  assert.equal(canonicalGrade(undefined), null);
  assert.equal(canonicalGrade(42), null);
  assert.equal(canonicalGrade("CTS"), "CTS");
  assert.equal(canonicalGrade("Printing"), "Printing");
});

test("status transitions: every action lands where the lifecycle says", () => {
  assert.equal(TRANSITIONS.reserve.to, "RESERVED");
  assert.equal(TRANSITIONS.release.to, "AVAILABLE");
  assert.equal(TRANSITIONS.pack.to, "PACKED");
  assert.equal(TRANSITIONS.dispatch.to, "DISPATCHED");
  assert.equal(TRANSITIONS.return.to, "RETURNED");
});

test("status transitions: forbidden moves stay forbidden", () => {
  assert.ok(!TRANSITIONS.dispatch.from.includes("DISPATCHED"), "no double dispatch");
  assert.ok(!TRANSITIONS.reserve.from.includes("DISPATCHED"), "can't reserve dispatched stock");
  assert.ok(!TRANSITIONS.reserve.from.includes("PACKED"), "packed stock is spoken for");
  assert.ok(!TRANSITIONS.return.from.includes("AVAILABLE"), "only dispatched slabs return");
  assert.deepEqual(TRANSITIONS.return.from, ["DISPATCHED"]);
});

test("returned slabs can re-enter the cycle", () => {
  for (const a of ["reserve", "release", "pack"] as const)
    assert.ok(TRANSITIONS[a].from.includes("RETURNED"), `${a} accepts RETURNED`);
});

test("default reservation hold is 7 days", () => {
  assert.equal(DEFAULT_RESERVATION_DAYS, 7);
});

test("CTS is a dead end with exactly one way out", () => {
  // The invariant the whole design rests on. CTS is deliberately NOT dispatchable -- a
  // slab being cut does not ship as a full slab -- which makes the exit load-bearing.
  // Commercial can apply cts but is refused `release`, so if uncts ever disappears they
  // could strand stock in a state only Finance can clear.
  assert.equal(TRANSITIONS.cts.to, "CTS");
  assert.ok(!TRANSITIONS.dispatch.from.includes("CTS"), "a slab being cut is not shipped whole");
  assert.deepEqual(TRANSITIONS.uncts.from, ["CTS"], "uncts applies to CTS and nothing else");
  assert.equal(TRANSITIONS.uncts.to, "AVAILABLE");
  assert.ok(TRANSITIONS.release.from.includes("CTS"), "Finance/Admin can release it too");
});

test("CTS cannot be reached from a shipped or returned slab", () => {
  assert.ok(!TRANSITIONS.cts.from.includes("DISPATCHED"), "a dispatched slab is gone; CTS would put it back on the books");
  assert.ok(!TRANSITIONS.cts.from.includes("RETURNED"), "a returned slab is released first");
  assert.deepEqual(TRANSITIONS.cts.from, TRANSITIONS.dispatch.from, "cts mirrors dispatch's entry points");
});

test("CHROMIA's machine inverse does exactly one thing", () => {
  // unchromia exists for the Chromia module's own corrections (a slabNo typo,
  // a deleted record, a removed import) — the mark follows the record. It is
  // machine-only: absent from /api/inventory/status's zod enum, like chromia.
  assert.deepEqual(TRANSITIONS.unchromia.from, ["CHROMIA"], "unchromia applies to CHROMIA and nothing else");
  assert.equal(TRANSITIONS.unchromia.to, "AVAILABLE");
  assert.ok(!TRANSITIONS.dispatch.from.includes("CHROMIA"), "a slab at Chromia does not ship");
});

test("every action lands on a real SlabStatus", () => {
  // The enum in prisma/schema.prisma. A typo here writes a value Postgres rejects at
  // runtime with 22P02, which no typecheck would catch -- TRANSITIONS values are strings.
  // CHROMIA: scripts/0063 — written by the Chromia intake hook, never by hand.
  const STATUSES = ["AVAILABLE", "RESERVED", "PACKED", "DISPATCHED", "RETURNED", "CTS", "CHROMIA"];
  for (const [action, t] of Object.entries(TRANSITIONS)) {
    assert.ok(STATUSES.includes(t.to), `${action} lands on a real status (${t.to})`);
    for (const f of t.from) assert.ok(STATUSES.includes(f), `${action} accepts a real status (${f})`);
  }
});

// --- CTS is not dispatchable, by GRADE as well as by status -----------------
//
// The status has never been dispatchable (it is absent from dispatch.from). The
// grade was the hole: QC writes it on every pass, the status is a separate manual
// action, and nothing read the grade at dispatch time — so a slab the floor had
// already graded cut-to-size shipped as a full slab whenever nobody remembered to
// also apply the status.

test("a slab graded CTS is refused dispatch, whatever its case", () => {
  assert.equal(gradeBlocksDispatch("CTS"), true);
  assert.equal(gradeBlocksDispatch("cts"), true);
  assert.equal(gradeBlocksDispatch("Cts"), true);
  assert.equal(gradeBlocksDispatch("  CTS  "), true);
});

test("A SLAB CUT DOWN FOR SAMPLES IS REFUSED TOO", () => {
  // The owner: "samples are always in cut pieces — so when a slab is ready it's
  // full, it can be sold directly, or cut for fabrication, or cut to samples."
  // Two of those three are CUT, and a cut slab does not go out whole. Before
  // this the sampling intake recorded the PIECES and left the slab graded A and
  // dispatchable.
  assert.equal(gradeBlocksDispatch("SAMPLE"), true);
  assert.equal(gradeBlocksDispatch("sample"), true);
  assert.equal(gradeBlocksDispatch("  Sample  "), true);
  // Both cut states come from ONE list, so a third can never be added to one
  // place and forgotten in the other.
  assert.deepEqual([...CUT_GRADES], ["CTS", "SAMPLE"]);
  for (const g of CUT_GRADES) assert.equal(gradeBlocksDispatch(g), true, g);
});

test("every other grade still dispatches", () => {
  // The change is ADDITIVE — it may refuse MORE, never allow more. This is the
  // half of that promise a test can hold.
  for (const g of ["A", "A2", "B", "C", "C (Reject)", "c (reject)", "Printing"]) {
    assert.equal(gradeBlocksDispatch(g), false, `${g} must remain dispatchable`);
  }
  // Not a cut state merely for starting with the same letters — a slab graded
  // "Sample cutting" by an inspector is not one the system may quietly impound.
  for (const g of ["SAMPLES", "SAMPLED", "CT", "CTSX", "Sample cutting"]) {
    assert.equal(gradeBlocksDispatch(g), false, `${g} must remain dispatchable`);
  }
});

test("an ungraded slab is not blocked — absence of a grade is not a CTS grade", () => {
  for (const g of [null, undefined, "", "   ", "Not graded yet", "not graded", 7, {}]) {
    assert.equal(gradeBlocksDispatch(g), false, `${JSON.stringify(g)} must not block`);
  }
});

test("the CTS status remains a dead end, independently of grade", () => {
  // Belt and braces: the two signals are separate and both must hold.
  assert.equal(TRANSITIONS.dispatch.from.includes("CTS"), false);
  assert.equal(TRANSITIONS.uncts.from.includes("CTS"), true);
  assert.equal(TRANSITIONS.uncts.to, "AVAILABLE");
});

// --- AND NOW BY MARK, WHICH IS THE ONE THAT MEANS IT ------------------------
//
// The owner, 2026-09-03: "grade should be A/B/C like normal, and the MARK is CTS
// or sampling." Until this change fabrication OVERWROTE quality_grade with 'CTS'
// (lib/fab/markQcSlabCts.ts) purely so the dispatch rule would refuse the slab —
// destroying the polishing line's verdict to make a routing decision. The mark
// now carries that job, so the grade can go back to being a grade.
//
// The grade half stays live throughout, and these tests hold that: the rule is
// an OR, it can only ever refuse MORE, and nothing refused today is allowed
// afterwards in EITHER deploy order.

test("a slab MARKED cut is refused dispatch, whatever its case", () => {
  assert.equal(markBlocksDispatch("CTS"), true);
  assert.equal(markBlocksDispatch("cts"), true);
  assert.equal(markBlocksDispatch("Cts"), true);
  assert.equal(markBlocksDispatch("  CTS  "), true);
  assert.equal(markBlocksDispatch("SAMPLE"), true);
  assert.equal(markBlocksDispatch("sample"), true);
  assert.equal(markBlocksDispatch("  Sample  "), true);
  // Both cut marks come from ONE list, so a third can never be added to one
  // place and forgotten in the other.
  assert.deepEqual([...CUT_MARKS], ["CTS", "SAMPLE"]);
  for (const m of CUT_MARKS) assert.equal(markBlocksDispatch(m), true, m);
});

test("a whole slab's mark blocks nothing", () => {
  // FULL_SLAB is the state every slab starts in, and all but 62 of the polish_qc
  // rows on live Neon on 2026-09-03 are in it. If this ever returned true the
  // yard would stop shipping.
  for (const m of ["FULL_SLAB", "full slab", "FULL-SLAB", "  full_slab  "]) {
    assert.equal(markBlocksDispatch(m), false, `${m} must remain dispatchable`);
  }
  // Not a cut mark merely for starting with the same letters — a slab someone
  // marked "Sample cutting" is not one the system may quietly impound.
  for (const m of ["SAMPLES", "SAMPLED", "CT", "CTSX", "Sample cutting"]) {
    assert.equal(markBlocksDispatch(m), false, `${m} must remain dispatchable`);
  }
});

test("NO MARK IS NOT A CUT MARK — the unmigrated database must still dispatch", () => {
  // fg_finished_slab.slab_mark does not exist until scripts/0070 is applied, and
  // the code may deploy first, so `slab.slabMark` arrives as undefined. If a
  // missing mark blocked, that deploy order would refuse EVERY slab in the yard.
  // The grade half is what refuses the cut ones there — see the deploy-order
  // test below.
  for (const m of [null, undefined, "", "   ", 7, {}, ["CTS"]]) {
    assert.equal(markBlocksDispatch(m), false, `${JSON.stringify(m) ?? "undefined"} must not block`);
  }
});

test("THE TRUTH TABLE: either signal saying cut is enough to refuse", () => {
  // mark cut + grade clean -> blocked. The point of the whole change: the slab
  // keeps its real A/B/C verdict AND is still refused dispatch.
  assert.equal(slabBlocksDispatch({ grade: "A", mark: "CTS" }), true);
  assert.equal(slabBlocksDispatch({ grade: "C (Reject)", mark: "SAMPLE" }), true);

  // grade cut + mark clean -> blocked. THE LEGACY 62: the rows measured on live
  // Neon on 2026-09-03 reading grade 'CTS' (60 in stock, 2 already dispatched),
  // whose real verdicts are unrecoverable and are being collected by hand. They
  // must stay refused whether or not their mark has been backfilled yet.
  assert.equal(slabBlocksDispatch({ grade: "CTS", mark: "FULL_SLAB" }), true);
  assert.equal(slabBlocksDispatch({ grade: "SAMPLE", mark: "FULL_SLAB" }), true);
  assert.equal(slabBlocksDispatch({ grade: "CTS", mark: undefined }), true);

  // both cut -> blocked. Every one of the 62 is this row today: polish_qc says
  // grade 'CTS' AND slab_mark 'CTS' on all 62, which is what made moving the
  // rule safe in the first place.
  assert.equal(slabBlocksDispatch({ grade: "CTS", mark: "CTS" }), true);

  // both clean -> allowed. The ordinary slab, and the other half of the promise:
  // this change refuses more, never less, but it must not refuse this.
  assert.equal(slabBlocksDispatch({ grade: "A", mark: "FULL_SLAB" }), false);
  assert.equal(slabBlocksDispatch({ grade: null, mark: "FULL_SLAB" }), false);
  assert.equal(slabBlocksDispatch({}), false);
});

test("the combined rule is case-insensitive on BOTH signals", () => {
  // The existing gradeBlocksDispatch tests already care about this: an exact
  // comparison would let a slab written 'cts' by an import or a hand edit ship
  // as a full slab, which is the precise failure the rule exists to prevent.
  for (const grade of ["cts", "Cts", "  CTS  ", "sample", "Sample"])
    assert.equal(slabBlocksDispatch({ grade, mark: "FULL_SLAB" }), true, `grade ${grade}`);
  for (const mark of ["cts", "Cts", "  CTS  ", "sample", "Sample"])
    assert.equal(slabBlocksDispatch({ grade: "A", mark }), true, `mark ${mark}`);
});

test("EITHER DEPLOY ORDER REFUSES EVERY SLAB REFUSED TODAY", () => {
  // The migration may land before or after the code. Today's rule is the grade
  // alone; tomorrow's is grade OR mark. Additive means: for every slab, if the
  // grade rule refuses it then the combined rule refuses it too — with the mark
  // present, absent, or anything at all.
  const grades = ["A", "A2", "B", "C", "C (Reject)", "c (reject)", "Printing", "CTS", "cts",
                  "SAMPLE", "sample", "Not graded yet", "", null, undefined];
  const marks = [undefined, null, "", "FULL_SLAB", "full slab", "CTS", "cts", "SAMPLE", "nonsense"];
  for (const grade of grades) for (const mark of marks) {
    if (gradeBlocksDispatch(grade)) {
      assert.equal(slabBlocksDispatch({ grade, mark }), true,
        `grade ${JSON.stringify(grade)} is refused today and must stay refused (mark ${JSON.stringify(mark)})`);
    }
  }
  // And with no mark at all — the code-before-migration case — the combined rule
  // is EXACTLY today's rule, slab for slab. Not merely a superset: identical.
  for (const grade of grades) {
    assert.equal(slabBlocksDispatch({ grade }), gradeBlocksDispatch(grade), JSON.stringify(grade));
  }
});

test("dispatchCut says WHICH WAY the slab was cut, for the refusal message", () => {
  // "Cut to size" and "cut down for samples" send an inventory user to two
  // different people to ask why; one wording would send half of them to the
  // wrong one.
  assert.equal(dispatchCut({ grade: "A", mark: "CTS" }), "CTS");
  assert.equal(dispatchCut({ grade: "A", mark: "SAMPLE" }), "SAMPLE");
  assert.equal(dispatchCut({ grade: "cts", mark: "FULL_SLAB" }), "CTS", "legacy grade, normalised");
  assert.equal(dispatchCut({ grade: "sample" }), "SAMPLE");
  // The MARK WINS when the two disagree: it is the fact, the grade is the legacy
  // shadow of it. A slab whose mark says SAMPLE went to the sample shelf,
  // whatever an older fabrication pass left in its grade.
  assert.equal(dispatchCut({ grade: "CTS", mark: "SAMPLE" }), "SAMPLE");
  // Null exactly when nothing blocks, so the message can never claim a slab was
  // cut when the rule in fact let it through.
  for (const s of [{ grade: "A", mark: "FULL_SLAB" }, {}, { grade: null, mark: null }])
    assert.equal(dispatchCut(s), null, JSON.stringify(s));
  for (const grade of ["A", "B", "CTS", "sample", null, "Printing"])
    for (const mark of [undefined, "FULL_SLAB", "CTS", "sample", "nonsense"])
      assert.equal(dispatchCut({ grade, mark }) !== null, slabBlocksDispatch({ grade, mark }),
        `${JSON.stringify(grade)} / ${JSON.stringify(mark)}`);
});

test("gradeBlocksDispatch is untouched — other callers still depend on it", () => {
  // It is deliberately NOT rewritten to delegate: it is the half of the rule
  // that covers the legacy 62, it has callers of its own, and the tests above it
  // in this file are the record of what it must keep doing.
  assert.equal(gradeBlocksDispatch("CTS"), true);
  assert.equal(gradeBlocksDispatch("A"), false);
  assert.deepEqual([...CUT_GRADES], ["CTS", "SAMPLE"]);
});

/* ------------------------------------- the detector both paths must share */

// The CTS fix nearly survived into production doing nothing. slabMarkReadable()
// gates whether markQcSlabCts may stop overwriting quality_grade, but only a
// DISPATCH read could earn "readable" — and the process that asks is the
// FABRICATION one, which may never dispatch anything. It would have been told
// "not readable" for ever, taken the legacy branch, and destroyed the verdict
// again. noteSlabMarkProven() is what lets the mirror read prove the same fact.
//
// Structural, because these live in a module that imports the Prisma client and
// cannot be loaded under node --test. What is asserted is the wiring: that the
// proof exists, is exported, and is actually called from the fabrication side.

test("THE FAB PATH CAN PROVE THE MARK COLUMN, NOT ONLY THE DISPATCH PATH", () => {
  const fs = readFileSync(new URL("../src/lib/inventory/finishedSlab.ts", import.meta.url), "utf8");
  assert.match(fs, /export async function noteSlabMarkProven\(\)/,
    "finishedSlab must export a way for another path to report the column exists");
  assert.match(fs, /export function slabMarkReadable\(\)/);

  const store = readFileSync(new URL("../src/lib/fab/slabMarkStore.ts", import.meta.url), "utf8");
  assert.match(store, /noteSlabMarkProven\(\)/,
    "the mirror read-back must report its proof, or a fabrication-only process never learns it");
  assert.ok(store.includes("noteSlabMarkProven") && store.includes("slabMarkReadable"),
    "both halves of the one detector are used here");

  // The proof must be taken BEFORE the answer is computed, or the very call that
  // proves the column still answers false and the grade write runs once more.
  // Match the RETURN, not the interface field of the same name declared far
  // above it — the first version of this test found `markInMirror:` at the type
  // declaration on line 147 and failed on correct code.
  const proveAt = store.indexOf("noteSlabMarkProven()");
  const answerAt = store.search(/return \{ markInMirror:/);
  assert.ok(proveAt !== -1, "the mirror read must report its proof");
  assert.ok(answerAt !== -1, "expected a `return { markInMirror: ... }` in the read-back");
  assert.ok(proveAt < answerAt,
    "prove the column before deciding markInMirror, not after — otherwise the very call that proves it still answers false and the grade write runs once more");
});

test("there is ONE state, so the two paths cannot disagree", () => {
  const fs = readFileSync(new URL("../src/lib/inventory/finishedSlab.ts", import.meta.url), "utf8");
  // Exactly one declaration of the state, and both accessors read that one.
  assert.equal((fs.match(/let slabMarkColumn\b/g) ?? []).length, 1,
    "one detector or none — a second copy is the bug three reviewers found");
  const store = readFileSync(new URL("../src/lib/fab/slabMarkStore.ts", import.meta.url), "utf8");
  assert.ok(!/let\s+\w*[Ss]labMarkColumn/.test(store),
    "the fab side must not keep its own idea of whether the column exists");
});

/* ═══════════════════════ THE GRADE BELT IS GONE (0071 + 0072) ══════════════
 *
 * scripts/0071 and 0072 moved all 63 cut slabs from grade 'CTS' to grade 'B' on
 * the owner's decision, and both are applied. Measured on live Neon 2026-09-03:
 * ZERO rows in polish_qc and ZERO in fg_finished_slab carry grade CTS or SAMPLE;
 * 63 fg rows carry slab_mark 'CTS' (60 AVAILABLE, 2 DISPATCHED, 1 at status
 * CTS), and the 60 in stock are 42 QC_AUTOLINK + 18 BULK_UPLOAD, every one of
 * them grade 'B'.
 *
 * So slabBlocksDispatch is a ONE-LEGGED OR against real data. These tests hold
 * the consequence: a row shaped like one of the 60 is refused ONLY by its mark,
 * and the same row with no mark is refused by nothing at all — which is why the
 * caller must fail closed rather than trust the rule with a missing mark.
 */

test("THE 60 IN-STOCK CUT SLABS ARE HELD BY THE MARK AND BY NOTHING ELSE", () => {
  // The live row, exactly: grade B (0071/0072's decision), mark CTS, AVAILABLE.
  assert.equal(slabBlocksDispatch({ grade: "B", mark: "CTS" }), true,
    "an already-cut slab regraded B must still be refused");
  assert.equal(dispatchCut({ grade: "B", mark: "CTS" }), "CTS",
    "and the refusal message must still say which way it was cut");

  // The grade half now carries NONE of them. If this ever starts passing as
  // `true`, a routing state has found its way back into quality_grade — which
  // scripts/0072's closing note defines as the regression signal for this
  // incident, not as protection returning.
  assert.equal(gradeBlocksDispatch("B"), false,
    "grade B is a verdict, not a routing state — the grade rule refuses nothing on live data");

  // AND THE SAME ROW WITHOUT ITS MARK IS DISPATCHABLE. This is the whole reason
  // a read that cannot confirm the mark must refuse instead of degrading: there
  // is no second signal left to degrade TO.
  for (const mark of [undefined, null, "", "FULL_SLAB"]) {
    assert.equal(slabBlocksDispatch({ grade: "B", mark }), false,
      `grade B with mark ${JSON.stringify(mark) ?? "undefined"} is refused by nothing`);
  }
});

test("EVERY LIVE CUT SLAB'S GRADE IS NOW ONE THE GRADE RULE LETS THROUGH", () => {
  // polish_qc holds 63 rows marked CTS and 0 rows graded CTS/SAMPLE. Their
  // grades are the ordinary verdicts, so the combined rule and the mark rule
  // must agree slab for slab: the OR contributes nothing on this data.
  for (const grade of ["A", "A2", "B", "C", "C (Reject)", null, "Not graded yet"]) {
    for (const mark of ["FULL_SLAB", "CTS", "SAMPLE", undefined]) {
      assert.equal(slabBlocksDispatch({ grade, mark }), markBlocksDispatch(mark),
        `${JSON.stringify(grade)} / ${JSON.stringify(mark)} — the grade leg must be adding nothing`);
    }
  }
});

/* ───────────────────── the two blockers, structurally ──────────────────────
 *
 * Both end with an already-cut slab reading AVAILABLE that nothing refuses, and
 * both live in modules that import the Prisma client and cannot be loaded under
 * `node --test`. What is asserted is the wiring — that the mark is WRITTEN on
 * every path that mints a finished-goods row, and that it is REQUIRED on the
 * path that dispatches one.
 */

test("THE AUTOLINK CARRIES THE MARK, ONE WAY", () => {
  const fs = readFileSync(new URL("../src/lib/inventory/finishedSlab.ts", import.meta.url), "utf8");
  const autolink = fs.slice(
    fs.indexOf("export async function autolinkFinishedSlabFromQc"),
    fs.indexOf("export async function relinkFinishedSlabAfterNumberChange"));
  assert.ok(autolink.length > 0, "autolinkFinishedSlabFromQc must still be there");

  // It projects the QC row's mark. Without this the create: branch mints a
  // FULL_SLAB row for a slab polish_qc says is cut — and editing a PolishQc slab
  // number does exactly that, then deletes the old row.
  assert.match(autolink, /dispatchCut\(\{\s*mark:\s*qc\.slabMark\s*\}\)/,
    "autolink must read the QC row's slab_mark, normalised the way dispatch reads it");
  assert.match(autolink, /createFields\.slabMark = qcMark/,
    "the mark must go into create: itself — a row that reads FULL_SLAB for even an instant is dispatchable");

  // ONE WAY. FULL_SLAB is never written over a stored cut mark: the only write
  // to an existing row is guarded on the mirror still reading FULL_SLAB.
  assert.match(autolink, /slabMark:\s*"FULL_SLAB"/,
    "the update path must be guarded on the row still reading FULL_SLAB");
  assert.ok(!/data:\s*\{[^}]*slabMark:\s*"FULL_SLAB"/.test(autolink),
    "FULL_SLAB must never be WRITTEN — only required in a where clause");
  assert.ok(!/qcFields\.slabMark/.test(autolink),
    "the mark is not an ordinary qcField: it is one-way, so it must not ride the plain update payload");
});

test("A DISPATCH THAT CANNOT CONFIRM THE MARK IS REFUSED, NOT ALLOWED", () => {
  const fs = readFileSync(new URL("../src/lib/inventory/finishedSlab.ts", import.meta.url), "utf8");

  // Fail closed, per slab, on direct evidence: slab_mark is NOT NULL DEFAULT
  // 'FULL_SLAB' (scripts/0070), so a string means the mark was really read and
  // anything else means readSlabForStatusChange fell back to the mark-less
  // select. A global flag would not do — another caller can flip it.
  assert.match(fs, /action === "dispatch" && typeof \(slab as \{ slabMark\?: unknown \}\)\.slabMark !== "string"/,
    "changeSlabStatus must refuse a dispatch whose mark it could not read");
  assert.match(fs, /cannot verify slab mark/,
    "and say so, in the skipped reason the caller shows the user");

  // The updateMany guard must carry the mark clause unconditionally for a
  // dispatch. It used to be gated on the process-wide slabMarkReadable(), which
  // another caller's failed read could switch off between the read and the
  // write — and with the grade leg gone, a guard without it guards nothing.
  assert.ok(!/if \(slabMarkReadable\(\)\) \{/.test(fs),
    "the mark clause must not be gated on a process-wide flag");
  assert.match(fs, /guard\.AND = CUT_MARKS\.map/,
    "the dispatch guard must always filter on the mark");

  // And the silent fallback must not be silent.
  const catchAt = fs.indexOf("slabMarkColumn = \"missing\"");
  assert.ok(catchAt !== -1, "the missing-column latch must still be there");
  assert.ok(fs.slice(0, catchAt).lastIndexOf("console.error") > fs.slice(0, catchAt).lastIndexOf("catch ("),
    "the catch that drops to mark-less reads must log — a silent fallback is how this stayed invisible");
});

test("AN ALREADY-MARKED SLAB CAN NEVER BE REGRADED BY A RE-PICK", () => {
  // markInMirror is false for every reason it could fail, a transient database
  // blip included, and these run on every interaction with an already-imported
  // slab. After 0071/0072 the grade they would overwrite is the owner's decided
  // 'B', and quality_grade_before_cts already holds 'CTS', so COALESCE preserves
  // nothing. Two guards: JS from setSlabMark's answer, SQL in every WHERE.
  for (const f of ["markQcSlabCts", "markQcSlabSample"]) {
    const src = readFileSync(new URL(`../src/lib/fab/${f}.ts`, import.meta.url), "utf8");
    // The SQL only, never the prose around it — the comments in these files
    // quote the very statements they are explaining.
    const statements = src.split("$executeRaw`").slice(1).map((s) => s.slice(0, s.indexOf("`")));
    const gradeWrites = statements.filter((s) => /quality_grade\s*=\s*'(CTS|SAMPLE)'/.test(s));
    assert.ok(gradeWrites.length >= 2, `${f} should still have its grade writes`);
    // Every grade write but ONE is narrowed by the mark. The exception is the
    // last-resort statement reached only when polish_qc has no slab_mark column
    // at all (pre-0057) — where no row can be already marked, so the narrowing
    // would change nothing except whether the statement parses.
    const narrowed = gradeWrites.filter((s) => /coalesce\(slab_mark, 'FULL_SLAB'\)\)\) = 'FULL_SLAB'/.test(s));
    assert.equal(narrowed.length, gradeWrites.length - 1,
      `${f}: every grade write except the pre-0057 fallback must be narrowed by the mark`);
    assert.match(src, /marked\.applied && !marked\.changed|marked\.applied \&\& !marked\.changed/,
      `${f} must skip the legacy branch when setSlabMark says the slab was already marked cut`);
  }
});
