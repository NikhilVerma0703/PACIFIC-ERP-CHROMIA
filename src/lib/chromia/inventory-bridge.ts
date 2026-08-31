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
// the disagreement is on the record instead of silently resolved either way;
// a slab number finished goods has never heard of writes "chromia_unknown",
// because "Chromia has slab 154321 and inventory does not" is exactly the gap
// the intake form exists to close.
//
// chromiaSlab.slabNo is free text — Chromia also prints slabs that never had
// a Pacific number. Only a purely numeric slabNo names a finished-goods slab;
// anything else is Chromia's own coding and is skipped without comment.
import { prisma } from "@/lib/prisma";
import { changeSlabStatus, writeSlabEvent } from "@/lib/inventory/finishedSlab";

export async function markSlabsChromia(slabNos: Array<string | null | undefined>, by: string | null): Promise<void> {
  try {
    const nums = [...new Set(slabNos
      .map((s) => String(s ?? "").trim())
      .filter((s) => /^\d+$/.test(s))
      .map(Number)
      .filter((n) => Number.isSafeInteger(n) && n > 0))];
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

    for (const n of unknown) {
      await writeSlabEvent(n, "chromia_unknown", {
        field: "status",
        newValue: "CHROMIA (no finished-goods row)",
        by: who,
        source: "Chromia intake",
      });
    }

    if (eligible.length) {
      const res = await changeSlabStatus(eligible, "chromia", { by: who, source: "Chromia intake" });
      for (const s of res.skipped) {
        await writeSlabEvent(s.slab, "chromia_conflict", {
          field: "status",
          oldValue: statusOf.get(s.slab) ?? null,
          newValue: "CHROMIA (refused)",
          by: who,
          source: "Chromia intake",
        });
      }
      // Deleted between the read and the write — gone is gone; record it as
      // the unknown it now is.
      for (const n of res.missing) {
        await writeSlabEvent(n, "chromia_unknown", {
          field: "status",
          newValue: "CHROMIA (no finished-goods row)",
          by: who,
          source: "Chromia intake",
        });
      }
    }
  } catch (err) {
    // The operator's save has already landed; this must never surface.
    console.error("[chromia] inventory bridge failed", err);
  }
}
