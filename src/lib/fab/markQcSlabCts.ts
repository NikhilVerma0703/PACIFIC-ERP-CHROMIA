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
// ─────────────────────────────────── AND IT WRITES THE MARK ─────────────────
// "CTS is not a grade, it's a mark" — so the same event now writes BOTH:
//
//   quality_grade = 'CTS'   kept, and load-bearing: lib/inventory/grading.ts
//                           refuses to dispatch on exactly this value, which is
//                           what stops an already-cut slab leaving whole.
//   slab_mark     = 'CTS'   the fact itself, in its own column (scripts/0057),
//                           where it can sit beside the verdict instead of
//                           destroying it.
//
// Both, until dispatch reads the mark instead. Writing only the new column
// would silently un-block dispatch for every slab fabrication cuts.

import { prisma } from "@/lib/prisma";
import { setSlabMark, refreshInventoryMirror } from "@/lib/fab/slabMarkStore";
import { changeSlabStatus, writeSlabEvent } from "@/lib/inventory/finishedSlab";

export async function markQcSlabCts(pacificQcId: string, by?: string | null): Promise<void> {
  if (!pacificQcId) return;
  // The mark FIRST, because its guard is "only a FULL_SLAB moves" and it reads
  // quality_grade to decide. Writing the grade first would make every call look
  // like an already-CTS slab and the mark would never be set on a fresh one.
  //
  // A refusal here is not an error and does not stop the grade write: it means
  // the slab is already marked SAMPLE, and what fabrication does next with the
  // remainder is fabrication's business. The dispatch block still has to land.
  // And a THROW here (scripts/0057 not applied, a dropped connection) must not
  // stop it either — the grade write below is the part dispatch reads.
  try {
    await setSlabMark(pacificQcId, "CTS");
  } catch (err) {
    console.error("[fab] slab mark not set for qc", pacificQcId, err);
  }
  try {
    await prisma.$executeRaw`
      UPDATE polish_qc
      SET    quality_grade_before_cts = COALESCE(
               quality_grade_before_cts,
               -- Only a real verdict is worth keeping. Routing states and
               -- "Not graded yet" are not history, they are noise.
               NULLIF(NULLIF(NULLIF(quality_grade, 'CTS'), 'Printing'), '')
             ),
             quality_grade = 'CTS'
      WHERE  id = ${pacificQcId}
    `;
  } catch {
    // scripts/0056 not applied — still mark it CTS, which is the part that
    // matters for dispatch. The verdict is lost, as it always was.
    await prisma.$executeRaw`
      UPDATE polish_qc SET quality_grade = 'CTS' WHERE id = ${pacificQcId}
    `;
  }

  // AND TELL INVENTORY. finished_slab is what the dispatch rule actually reads,
  // and nothing on this side was refreshing it — so the CTS block has not been
  // firing at all. See refreshInventoryMirror. Best-effort by design.
  await refreshInventoryMirror(pacificQcId);

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
