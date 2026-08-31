// The one place the Chromia module touches finished-goods inventory.
//
// When a slab enters Chromia printing — the operator register, or the
// historical import — the finished-goods sheet should say so: status CHROMIA
// (scripts/0063). This bridge is the ONLY writer of that status. The
// slab-intake form deliberately refuses it as a hand target; its status
// override is the way OUT of a wrong mark, never the way in.
//
// AFTER THE TRANSACTION, NEVER ABLE TO FAIL THE SAVE. Chromia's own write has
// already committed when this runs; everything here is try/caught and a
// failure costs only the inventory annotation, which the next entry retries.
//
// PROTECTED SLABS ARE NEVER PULLED. The chromia transition
// (lib/inventory/grading.ts) runs only from AVAILABLE or RETURNED — a
// RESERVED slab is somebody's PI hold, a PACKED one is on a pallet, a
// DISPATCHED one is gone. A refusal writes a "chromia_conflict" SlabEvent so
// the disagreement is on the record instead of silently resolved either way —
// ONE standing event per disagreement, deduped against the latest, because a
// re-import or repeated correction must not bury the audit feed. A slab
// number finished goods has never heard of is LOGGED, not evented: SlabEvent
// carries a real FK to FinishedSlab, so an event for a rowless slab can never
// be stored (the write would fail silently) — the log line is the record
// "Chromia has slab 154321 and inventory does not", the gap the intake form
// exists to close.
//
// AND THE MARK FOLLOWS THE RECORD. unmarkSlabsChromia is the inverse, for the
// module's own correction flows — a slab-number typo fixed, a record deleted,
// a mistaken import removed. Guarded like everything else: it moves only
// CHROMIA → AVAILABLE, so a slab in any other state is untouched.
//
// chromiaSlab.slabNo is free text — Chromia also prints slabs that never had
// a Pacific number. Only a purely numeric slabNo names a finished-goods slab;
// anything else is Chromia's own coding and is skipped without comment.
import { prisma } from "@/lib/prisma";
import { changeSlabStatus, writeSlabEvent } from "@/lib/inventory/finishedSlab";

/** The purely-numeric slab numbers in a list of Chromia slabNos. */
const numsOf = (slabNos: Array<string | null | undefined>): number[] =>
  [...new Set(slabNos
    .map((s) => String(s ?? "").trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0))];

export async function markSlabsChromia(slabNos: Array<string | null | undefined>, by: string | null): Promise<void> {
  try {
    const nums = numsOf(slabNos);
    if (!nums.length) return;
    const who = by ?? "chromia intake";

    // Statuses first, structurally — the outcomes are decided by what the
    // sheet SAYS, not parsed back out of a refusal string. Already CHROMIA is
    // the idempotent re-entry (a re-import, a corrected register row) and is
    // silent; everything else divides into unknown, movable, and held.
    const rows = await prisma.finishedSlab.findMany({
      where: { slabNumber: { in: nums } },
      select: { slabNumber: true, status: true },
    });
    const statusOf = new Map(rows.map((r) => [r.slabNumber, String(r.status)]));

    const unknown = nums.filter((n) => !statusOf.has(n));
    const eligible = nums.filter((n) => statusOf.has(n) && statusOf.get(n) !== "CHROMIA");

    // No SlabEvent for a slab with no row — the FK forbids it (the write
    // would fail silently). One log line carries the whole gap.
    if (unknown.length) {
      console.warn(`[chromia] ${unknown.length} slab(s) at Chromia are not in finished goods — not marked: ${unknown.slice(0, 20).join(", ")}${unknown.length > 20 ? "…" : ""}`);
    }

    if (eligible.length) {
      const res = await changeSlabStatus(eligible, "chromia", { by: who, source: "Chromia intake" });
      for (const s of res.skipped) {
        // One standing conflict per disagreement — a re-import of the same
        // held slab must not append an identical row to the audit feed.
        const oldValue = statusOf.get(s.slab) ?? null;
        const prev = await prisma.slabEvent.findFirst({
          where: { slabNumber: s.slab, kind: "chromia_conflict" },
          orderBy: { at: "desc" },
          select: { oldValue: true },
        });
        if (prev?.oldValue === oldValue) continue;
        await writeSlabEvent(s.slab, "chromia_conflict", {
          field: "status",
          oldValue,
          newValue: "CHROMIA (refused)",
          by: who,
          source: "Chromia intake",
        });
      }
      // Deleted between the read and the write — gone is gone; same FK, same
      // log-not-event answer.
      if (res.missing.length) {
        console.warn(`[chromia] ${res.missing.length} slab(s) vanished from finished goods mid-mark: ${res.missing.join(", ")}`);
      }
    }
  } catch (err) {
    // The operator's save has already landed; this must never surface.
    console.error("[chromia] inventory bridge failed", err);
  }
}

/**
 * The inverse, for the module's own CORRECTION flows: a slab-number typo
 * fixed (unmark the old number, mark the new), a record deleted, a mistaken
 * import removed. Moves only CHROMIA → AVAILABLE (the unchromia transition),
 * so a slab in any other state — including one a person already hand-fixed —
 * is left exactly where it is. Never throws into the correction it rides on.
 */
export async function unmarkSlabsChromia(slabNos: Array<string | null | undefined>, by: string | null): Promise<void> {
  try {
    const nums = numsOf(slabNos);
    if (!nums.length) return;
    await changeSlabStatus(nums, "unchromia", { by: by ?? "chromia correction", source: "Chromia intake" });
  } catch (err) {
    console.error("[chromia] inventory unmark failed", err);
  }
}
