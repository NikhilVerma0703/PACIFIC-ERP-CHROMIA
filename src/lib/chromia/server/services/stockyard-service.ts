import { ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { prisma } from '@/lib/chromia/db';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import type { StockReleaseInput } from '@/lib/chromia/validation/stockyard';
import { recordDispatch } from '@/lib/chromia/server/services/disposition-service';

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
