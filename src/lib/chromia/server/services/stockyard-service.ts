import { ChromiaDisposition as Disposition, ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import { isWriteOff, MAX_ATTEMPTS } from '@/lib/chromia/recalibration-flow';
import type { StockReleaseInput } from '@/lib/chromia/validation/stockyard';
import { recordDispatch } from '@/lib/chromia/server/services/disposition-service';
import { markAwaitingRecalibration } from '@/lib/chromia/server/services/recalibration-flow-service';

const log = createLogger('stockyard');

/**
 * Stock → Dispatch.
 *
 * A slab that was stocked at QC often leaves the plant days later, and until
 * now there was nowhere to record that. This is that step, and only that step:
 * it refuses anything that is not currently on a rack, then hands over to
 * `recordDispatch`, which already knows how to close the stock holding, write
 * the Dispatch row, move the slab to the dispatch bay and stamp the event.
 *
 * Reusing that function rather than repeating it is the point — a stock release
 * and a QC dispatch land in the database identically, so every report, export
 * and dashboard figure counts them the same way with no changes at all.
 */
export async function releaseFromStock(input: StockReleaseInput, userId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: input.slabId, deletedAt: null },
    select: { id: true, slabNo: true, status: true },
  });

  if (!slab) throw new NotFoundError('Slab');

  if (slab.status !== SlabStatus.IN_STOCK) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is not in stock, so it cannot be dispatched from the stockyard`,
    );
  }

  await recordDispatch({ slabId: slab.id, dispatchDate: input.dispatchDate }, userId, {
    note: 'Dispatched from stock',
  });

  log.info({ slabNo: slab.slabNo, dispatchDate: input.dispatchDate }, 'Released from stock');

  return { id: slab.id, slabNo: slab.slabNo };
}

/**
 * Stock → Recalibration.
 *
 * The other exit from the rack. A stocked slab can be dispatched, or it can be
 * pulled off to go for recalibration — and this is that second path, kept
 * beside `releaseFromStock` and built the same way: refuse anything not on a
 * rack, then hand over to the code that already knows the recalibration
 * journey.
 *
 * `markAwaitingRecalibration` is exactly what QC calls when it condemns a slab,
 * so a stock-sent slab and a QC-condemned one land in the database identically
 * — same waiting record, same attempt bookkeeping, same appearance on the
 * Recalibration page. It opens the waiting record first; only once that exists
 * does the slab actually leave the rack.
 *
 * The order is deliberate for safety: called first, it is idempotent (a second
 * attempt finds the waiting record and just keeps it), and the slab is still
 * IN_STOCK until the flip below, so a retry after any hiccup still passes the
 * "is it on a rack?" check rather than getting stuck half-moved.
 *
 * A slab that has already used all its attempts is refused up front, and this
 * is the one place that matters: `markAwaitingRecalibration` would WRITE SUCH A
 * SLAB OFF as waste — that is QC's call to make when it condemns a slab a sixth
 * time, not something the stockyard should do behind a button that says "send
 * for recalibration". So the check happens here, before that call is reached.
 */
export async function sendStockToRecalibration(input: { slabId: string }, userId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: input.slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      // The whole trip shape the recalibration rules read — isWriteOff counts
      // the sent ones, but its Trip type wants all four fields.
      recalibrations: {
        select: { attemptNumber: true, sentDate: true, receivedDate: true, restartedAt: true },
      },
    },
  });

  if (!slab) throw new NotFoundError('Slab');

  if (slab.status !== SlabStatus.IN_STOCK) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is not in stock, so it cannot be sent for recalibration from the stockyard`,
    );
  }

  if (isWriteOff(slab.recalibrations)) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} has used all ${MAX_ATTEMPTS} recalibration attempts and cannot be sent again`,
    );
  }

  // Opens the waiting recalibration record — the same call QC makes. The guard
  // above guarantees it takes the create path, never the write-off one; the
  // post-check is belt and braces for a concurrent trip that spent the last
  // attempt between the read and here, so a slab that was written off can never
  // be reported back as sent.
  const result = await markAwaitingRecalibration(slab.id, undefined, userId);
  if (result.writtenOff) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} has used all ${MAX_ATTEMPTS} recalibration attempts and cannot be sent again`,
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // The slab has left the rack: close its open stock holding so Days in Stock
    // stops and it drops off the "In stock" list.
    await tx.chromiaStockEntry.updateMany({
      where: { slabId: slab.id, releasedAt: null },
      data: { releasedAt: now },
    });

    // GRADED with a RECALIBRATION outcome is the exact holding state QC leaves a
    // condemned slab in — see applyIntakeGrade — so the Recalibration page reads
    // it as "awaiting send" with no special-casing.
    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: SlabStatus.GRADED,
        currentDisposition: Disposition.RECALIBRATION,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        eventType: SlabEventType.STATUS_CHANGED,
        fromStatus: SlabStatus.IN_STOCK,
        toStatus: SlabStatus.GRADED,
        userId,
        occurredAt: now,
        note: 'Marked for recalibration from stock',
      },
    });
  });

  log.info({ slabNo: slab.slabNo }, 'Sent from stock for recalibration');

  return { id: slab.id, slabNo: slab.slabNo };
}
