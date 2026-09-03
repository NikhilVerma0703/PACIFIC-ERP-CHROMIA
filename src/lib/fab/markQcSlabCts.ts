// When a physical QC slab is chosen for fabrication, mark it CTS on polish_qc.
// The row stays in stock and in the picker — CTS is a routing grade (cut-to-
// size / fab), not a delete. Shift scoring already treats CTS as "not a
// reject" (shiftScoreMath.ts). Idempotent: setting CTS on a slab that is
// already CTS is a no-op.
//
// ─────────────────────────────────── IT USED TO DESTROY THE VERDICT ─────────
// quality_grade holds both the polishing line's verdict (A/A2/B/C) and the
// routing states (CTS, Printing) in one column. Overwriting it with 'CTS' is
// right for dispatch — the slab genuinely cannot go out whole, and
// lib/inventory/grading.ts refuses it on exactly that grade — but it threw the
// verdict away. Every slab that had ever reached fabrication read CTS, and
// nothing recorded whether it had been grade A stone or a C reject.
//
// So the outgoing value is copied into quality_grade_before_cts first
// (scripts/0056), and ONLY while that column is still empty: a slab marked CTS
// twice must keep its ORIGINAL verdict rather than record 'CTS' as its own
// history. One statement, so there is no window between the two writes.
//
// COALESCE guards the case the column does not exist yet — the whole UPDATE is
// wrapped so a database without 0056 still gets the CTS mark. See the catch.
//
// ─────────────── WHY THAT COLUMN HAS NEVER HELD A SINGLE VALUE (2026-09-03) ─
// Measured on live Neon today: quality_grade_before_cts is NULL on ALL 48,377
// polish_qc rows, including all 62 that read quality_grade = 'CTS'. The
// statement below has never once produced a value. Three things were true at
// the same time, and each of them alone would have been enough:
//
//  1. THE COLUMN DID NOT EXIST WHEN ANY OF THE 62 WERE WRITTEN — the real
//     cause. The 24 CTS rows fabrication picked (they have a fab_slab row
//     against pacific_qc_id) were picked between 2026-08-21 10:45 and
//     2026-08-24 07:20; the other 38 were written earlier still (37 in a
//     2026-07-30/31
//     batch that fabrication never touched, plus 1 that arrived from Airtable
//     carrying CTS, last_modified_by "Automations"). scripts/0056 landed after
//     all of them. Zero fab_slab rows have been created since. So every
//     execution of this UPDATE hit 42703 undefined_column, and every one of
//     them took the catch.
//  2. AND THE CATCH WAS SILENT. It was a bare `catch {}` running a fallback
//     that writes ONLY the grade — the exact statement whose destructiveness
//     0056 exists to prevent — with no log line anywhere. A fortnight of the
//     preservation feature not existing looked identical to it working. It now
//     logs; a fallback that destroys a verdict is not allowed to be quiet.
//  3. AND IT CANNOT SELF-REPAIR AFTERWARDS. Once the grade already reads 'CTS',
//     the NULLIF chain correctly refuses to record a routing state as history —
//     so a re-pick of one of those 62 stores nothing, forever. This is why the
//     owner is collecting those 62 verdicts by hand: no code path can recover
//     them. Their quality_grade is deliberately left alone here.
//
// The NULLIF chain is now case- and whitespace-folded (it was exact-match, so a
// grade of "cts" or " CTS " from the /tables dropdown or an Airtable sync would
// have been recorded AS the verdict) and it drops "Not graded yet", which the
// comment above it always claimed it did and never did — canonicalGrade in
// lib/inventory/grading.ts treats that value as no grade for the same reason.
// Leaving the slot NULL rather than filling it with noise also keeps it free
// for the grades the owner is collecting by hand.
//
// ─────────────────────────────────── AND IT WRITES THE MARK ─────────────────
// "CTS is not a grade, it's a mark" — so the same event writes the fact into
// its own column, polish_qc.slab_mark (scripts/0057), where it sits beside the
// verdict instead of destroying it.
//
// ═══════════════════════════ WHY THE GRADE WRITE IS STILL HERE, CONDITIONALLY
// The owner, 2026-09-03, in his developer's words: "grade should be A/B/C like
// normal, and the MARK is CTS or sampling." That is what the block below now
// does — but it could not simply be deleted, and the reason is the single worst
// failure available in this change:
//
//   lib/inventory/grading.ts refuses dispatch on a slab that reads cut, and
//   when this was written the 62 slabs it refused were refused on the GRADE.
//   Dropping the grade write before the dispatch side could read the mark would
//   SILENTLY UN-BLOCK DISPATCH for every slab fabrication cuts. Nothing would
//   error; already-cut slabs would simply start leaving on lorries as full
//   slabs.
//
//   THAT ORDER HAS SINCE COMPLETED, AND THE BELT IS THE OTHER ONE NOW.
//   scripts/0070 is applied and so are 0071 and 0072, which regraded all 63 cut
//   slabs to 'B'. Measured on live Neon 2026-09-03: ZERO rows in polish_qc and
//   ZERO in fg_finished_slab carry grade CTS or SAMPLE, so gradeBlocksDispatch
//   refuses nothing at all. The 60 AVAILABLE cut slabs in stock are held by
//   their MARK alone. The branch below is kept for the deploy orders it was
//   written for, but it is no longer a safety net — it is now the thing most
//   likely to do damage, which is why it is narrowed the way it is.
//
// The dispatch side now reads both (slabBlocksDispatch ORs the mark and the
// grade), but it reads the mark out of fg_finished_slab.slab_mark, and THAT
// COLUMN ARRIVES WITH A MIGRATION — scripts/0070 — which the lead applies
// separately. Code and migration can land in either order, so this file may not
// assume the column is there.
//
// So the decision is made PER SLAB, AT RUNTIME, from evidence:
// refreshInventoryMirror pushes the mark into the finished-goods row and then
// READS IT BACK. Only if the mirror demonstrably carries a cut mark for this
// slab is the grade left alone.
//
//   no scripts/0070, no finished-goods row, a non-integer slab number, a bad
//   minute on the database   ->  markInMirror:false  ->  grade = 'CTS', and the
//                                verdict is preserved first
//   the mark is really there  ->  markInMirror:true   ->  the grade is LEFT
//                                ALONE. A stays A. The mark carries the fact.
//   the slab was ALREADY marked cut, whatever the mirror answered
//                             ->  the grade is LEFT ALONE. See below.
//
// Additive in both directions and self-healing: before 0070 every slab refused
// today is refused on the same signal; the hour 0070 is applied, fabrication
// stops destroying verdicts, with no second deploy.
//
// ════════════════ AND THE LEGACY BRANCH NO LONGER FIRES ON A RE-PICK ════════
// The third row above is new, and it is the fix for a regression this change
// created together with its own migrations. scripts/0071 and 0072 moved all 63
// cut slabs from grade 'CTS' to grade 'B' on the owner's decision and are
// applied. This function is re-invoked on EVERY interaction with an
// already-imported slab, and markInMirror is false for every reason it could
// fail — a transient database blip included. So one bad minute during a re-pick
// silently rewrote the owner's decided 'B' back to 'CTS', and
// quality_grade_before_cts already holds 'CTS' from 0071, so COALESCE preserved
// nothing and the B was gone a second time. It also recreated a grade = 'CTS'
// row, which 0072's closing note names as the standing signal that something is
// STILL writing the routing state into the verdict.
//
// So the legacy grade write is now narrowed to slabs that were not already
// marked cut — twice over, in JavaScript from setSlabMark's own answer and
// again in the statement's WHERE.

import { prisma } from "@/lib/prisma";
import { setSlabMark, refreshInventoryMirror } from "@/lib/fab/slabMarkStore";
import { changeSlabStatus, writeSlabEvent } from "@/lib/inventory/finishedSlab";

export async function markQcSlabCts(pacificQcId: string, by?: string | null): Promise<void> {
  if (!pacificQcId) return;
  // The mark FIRST, because its guard is "only a FULL_SLAB moves" and it reads
  // quality_grade to decide. Writing the grade first would make every call look
  // like an already-CTS slab and the mark would never be set on a fresh one.
  //
  // A refusal here is not an error and does not stop what follows: it means the
  // slab is already marked SAMPLE, and what fabrication does next with the
  // remainder is fabrication's business. The dispatch block still has to land.
  // And a THROW here (scripts/0057 not applied, a dropped connection) must not
  // stop it either — with no mark written, refreshInventoryMirror below has
  // nothing to carry across, reports markInMirror:false, and the legacy grade
  // write takes over. Failing to mark must never mean failing to block.
  //
  // ITS ANSWER IS ALSO THE "IS THIS A NEW PICK?" TEST — see the legacy branch.
  //   changed:true                  the mark just moved FULL_SLAB -> CTS. A
  //                                 genuinely new pick.
  //   changed:false && applied:true the row was ALREADY marked cut: the
  //                                 idempotent re-pick.
  //   ok:false                      refused, so it is already marked the other
  //                                 way (SAMPLE), or the QC row is gone.
  //   applied:false                 no scripts/0057 — there is no mark column
  //                                 at all, so there is nothing to be already
  //                                 marked and the legacy grade write is the
  //                                 only signal there has ever been.
  let markSaysAlreadyCut = false;
  try {
    const marked = await setSlabMark(pacificQcId, "CTS");
    markSaysAlreadyCut = !marked.ok || (marked.applied && !marked.changed);
  } catch (err) {
    console.error("[fab] slab mark not set for qc", pacificQcId, err);
  }

  // AND TELL INVENTORY. finished_slab is what the dispatch rule actually reads,
  // and nothing on this side was refreshing it — so the CTS block has not been
  // firing at all. See refreshInventoryMirror. Best-effort by design.
  //
  // THIS RUNS BEFORE THE GRADE WRITE NOW, because its answer is what decides
  // whether the grade write happens at all: it carries the mark across into
  // fg_finished_slab.slab_mark and reads the row back to say whether it landed.
  const mirror = await refreshInventoryMirror(pacificQcId);

  if (!mirror.markInMirror && !markSaysAlreadyCut) {
    // THE LEGACY BRANCH — scripts/0070 is not applied (or this slab has no
    // finished-goods row to mark). The mark cannot block dispatch, so the grade
    // still must. The verdict is copied aside first.
    //
    // ───────────────── AND ONLY FOR A SLAB THAT WAS NOT ALREADY CUT ─────────
    // markInMirror is false for EVERY reason it could fail, including a
    // transient database blip, a caught autolink throw and a missing fg row —
    // and this function is re-invoked on every interaction with an
    // already-imported slab. That made one bad minute on the database enough to
    // rewrite quality_grade = 'CTS' over a slab that already read 'B'.
    //
    // WHICH IS NOW THE OWNER'S DECIDED VERDICT, NOT A STALE VALUE. scripts/0071
    // and 0072 moved all 63 cut slabs from 'CTS' to 'B' by his decision, and
    // quality_grade_before_cts already holds 'CTS' for them — so COALESCE
    // preserves nothing and the B would be unrecoverable a second time. It
    // would also recreate a grade = 'CTS' row, which 0072's closing note defines
    // as the standing signal that something is STILL writing the routing state
    // into the verdict.
    //
    // TWO GUARDS, because the answer above can be unknown. The JS one skips the
    // branch entirely when setSlabMark PROVED the slab was already cut; the
    // WHERE below repeats it in SQL, so even the unknown case (setSlabMark threw)
    // cannot regrade an already-marked row. An idempotent re-pick can no longer
    // touch the grade whatever the mirror answered.
    try {
      await prisma.$executeRaw`
        UPDATE polish_qc
        SET    quality_grade_before_cts = COALESCE(
                 quality_grade_before_cts,
                 -- Only a real verdict is worth keeping. Routing states and
                 -- "Not graded yet" are not history, they are noise. Compared
                 -- case- and whitespace-folded, the way every other guard in
                 -- this codebase compares this column, so a "cts" typed into
                 -- the /tables dropdown is not filed away as a quality grade.
                 CASE
                   WHEN upper(btrim(coalesce(quality_grade, ''))) IN ('CTS', 'SAMPLE', 'PRINTING', '') THEN NULL
                   WHEN upper(btrim(coalesce(quality_grade, ''))) LIKE 'NOT GRADED%' THEN NULL
                   ELSE btrim(quality_grade)
                 END
               ),
               quality_grade = 'CTS'
        WHERE  id = ${pacificQcId}
          -- A slab is cut once. An already-CTS row is the idempotent re-pick,
          -- and an already-SAMPLE one went to the sample shelf first — both are
          -- left as they are, and both still refuse dispatch (CUT_GRADES holds
          -- CTS and SAMPLE), so this narrowing can only ever refuse more.
          AND  upper(btrim(coalesce(quality_grade, ''))) NOT IN ('CTS', 'SAMPLE')
          -- AND THE MARK SAYS THIS SLAB IS STILL WHOLE. After 0071/0072 the
          -- grade test above no longer catches a re-pick: all 63 cut slabs read
          -- 'B'. The mark is what remembers, and it is checked in the statement
          -- rather than in JavaScript so a concurrent pick cannot slip between
          -- the read and the write.
          AND  upper(btrim(coalesce(slab_mark, 'FULL_SLAB'))) = 'FULL_SLAB'
      `;
    } catch (err) {
      // scripts/0056 not applied — still mark it CTS, which is the part that
      // matters for dispatch. The verdict is lost, as it always was.
      //
      // LOUDLY. This catch ran on every one of the 24 fabrication picks between
      // 2026-08-15 and 2026-08-24 and said nothing, which is why nobody noticed
      // quality_grade_before_cts was NULL on all 48,377 rows until it was
      // measured. A fallback that destroys the polishing line's verdict has to
      // announce itself.
      console.error("[fab] verdict NOT preserved for qc", pacificQcId, "— falling back to a grade-only write", err);
      try {
        // STILL NARROWED BY THE MARK. Losing the preservation column is no
        // reason to also lose the re-pick guard — that is the one that stops
        // 'CTS' landing on top of the owner's decided 'B'.
        await prisma.$executeRaw`
          UPDATE polish_qc
          SET    quality_grade = 'CTS'
          WHERE  id = ${pacificQcId}
            AND  upper(btrim(coalesce(quality_grade, ''))) NOT IN ('CTS', 'SAMPLE')
            AND  upper(btrim(coalesce(slab_mark, 'FULL_SLAB'))) = 'FULL_SLAB'
        `;
      } catch (err2) {
        // No slab_mark column either, i.e. scripts/0057 is not applied. On such
        // a database no row can be "already marked cut", so the narrowing was a
        // no-op there and dropping it changes nothing about which rows move —
        // it only lets the statement parse. This is the pre-0057 world, and in
        // it the grade is the only thing that ever blocked dispatch.
        console.error("[fab] mark-narrowed grade write failed for qc", pacificQcId, "— no slab_mark column; writing the grade unnarrowed", err2);
        await prisma.$executeRaw`
          UPDATE polish_qc
          SET    quality_grade = 'CTS'
          WHERE  id = ${pacificQcId}
            AND  upper(btrim(coalesce(quality_grade, ''))) NOT IN ('CTS', 'SAMPLE')
        `;
      }
    }

    // AND MIRROR IT AGAIN. The refresh above ran BEFORE the grade changed, so
    // finished goods is now holding the pre-CTS grade — which is the stale
    // mirror that let already-cut slabs dispatch in the first place. On this
    // branch the grade is the only thing blocking them, so it has to be the
    // grade that reaches fg_finished_slab.
    await refreshInventoryMirror(pacificQcId);
  }

  // AND THE STATUS (owner, 2026-08-29: "whatever is taken into fab/cutting is
  // marked in inventory as CTS"). The mirror refresh above moves the GRADE, but
  // the inventory STATUS never followed — the sheet kept saying AVAILABLE for a
  // slab fabrication had already taken.
  //
  // ONLY FROM STOCK NOBODY HOLDS. The dashboard's own CTS action moves
  // RESERVED and PACKED too, because there a person is looking at the hold and
  // deciding — but this is a hook, and a hook that quietly consumes somebody's
  // PI hold or a packed pallet turns a double-booking into a disappearance.
  // AVAILABLE moves directly; RETURNED — back from a dispatch, in stock, held
  // by nobody — is released first (its own event) because the cts transition
  // moves only from the dispatch set, then marked. Both writes are narrowed to
  // the exact status just read (onlyFrom), so a reserve landing between the
  // read and the write is skipped and reported, never swallowed. A held,
  // dispatched or Chromia slab is left alone and the disagreement is put on
  // the record as a "cts_conflict" SlabEvent — ONE standing event per
  // disagreement, not one per click: the callers re-invoke this on every
  // interaction with an already-imported slab, and duplicates would bury the
  // audit feed. Already-CTS is the idempotent re-pick and is silent,
  // structurally (the status is read first, not parsed out of a refusal
  // string). Best-effort like everything else here: a fab assignment must
  // never fail on inventory.
  try {
    const qc = await prisma.polishQc.findUnique({ where: { id: pacificQcId }, select: { slabNumber: true } });
    const n = qc?.slabNumber;
    if (n != null && Number.isInteger(n)) {
      const who = by ?? "fabrication";
      const row = await prisma.finishedSlab.findUnique({ where: { slabNumber: n }, select: { status: true } });
      const status = row ? String(row.status) : null;
      if (!row) {
        // "Fabrication has slab N and finished goods does not" — the gap the
        // slab-intake form exists to close. Logged, not invented: SlabEvent
        // has an FK to FinishedSlab, so an event for a rowless slab cannot be
        // stored.
        console.warn(`[fab] slab ${n} is not in finished goods — CTS status not recorded`);
      } else if (status === "AVAILABLE" || status === "RETURNED") {
        if (status === "RETURNED") {
          const rel = await changeSlabStatus([n], "release", { by: who, source: "fabrication", onlyFrom: ["RETURNED"] });
          for (const s of rel.skipped) console.warn(`[fab] slab ${s.slab} not released from RETURNED — ${s.reason}`);
        }
        const res = await changeSlabStatus([n], "cts", { by: who, source: "fabrication", onlyFrom: ["AVAILABLE"] });
        for (const s of res.skipped) console.warn(`[fab] slab ${s.slab} not marked CTS in inventory — ${s.reason}`);
      } else if (status !== "CTS") {
        const prev = await prisma.slabEvent.findFirst({
          where: { slabNumber: n, kind: "cts_conflict" },
          orderBy: { at: "desc" },
          select: { oldValue: true },
        });
        if (prev?.oldValue !== status) {
          await writeSlabEvent(n, "cts_conflict", {
            field: "status", oldValue: status, newValue: "CTS (refused)",
            by: who, source: "fabrication",
          });
        }
        console.warn(`[fab] slab ${n} is ${status} — held or gone, left alone; conflict on record`);
      }
    }
  } catch (err) {
    console.error("[fab] inventory CTS status not applied for qc", pacificQcId, err);
  }
}
