import { ChromiaDisposition as Disposition, ChromiaMovementReason as MovementReason, ChromiaSlabEventType as SlabEventType, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { MAX_RECALIBRATION_ATTEMPTS } from '@/lib/chromia/constants/process-stages';
import { prisma } from '@/lib/chromia/db';
import { BusinessRuleViolationError, NotFoundError } from '@/lib/chromia/errors';
import { createLogger } from '@/lib/chromia/logger';
import type {
  DispatchInput,
  SampleCuttingInput,
  StockInput,
  WasteInput,
} from '@/lib/chromia/validation/disposition';

const log = createLogger('disposition');

/**
 * Terminal and holding dispositions (CHROMIA_PROCESS.md § 6).
 *
 *   Grade A → Dispatch or Stock
 *   Grade B → Stock or Sample Cutting
 *   Grade C → Recalibration, or Waste once five attempts are used
 *
 * Stock is a *holding* state: a stocked slab can still be dispatched or cut
 * for samples later, which is why both of those accept IN_STOCK as a source.
 */

const TERMINAL_STATUSES: readonly SlabStatus[] = [
  SlabStatus.DISPATCHED,
  SlabStatus.SAMPLE_CUT,
  SlabStatus.WASTE,
];

async function loadSlab(slabId: string) {
  const slab = await prisma.chromiaSlab.findFirst({
    where: { id: slabId, deletedAt: null },
    select: {
      id: true,
      slabNo: true,
      status: true,
      currentDisposition: true,
      currentLocationId: true,
      currentCycleNumber: true,
      recalibrationCount: true,
    },
  });

  if (!slab) throw new NotFoundError('Slab');
  return slab;
}

type Slab = Awaited<ReturnType<typeof loadSlab>>;

function assertNotTerminal(slab: Slab) {
  if (TERMINAL_STATUSES.includes(slab.status)) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is already ${slab.status.replace(/_/g, ' ').toLowerCase()}`,
    );
  }
}

// -------------------------------------------------------------- dispatch ---

/**
 * `note` is written on the slab event. It exists so a caller can say *why* the
 * slab left — the Stockyard passes "Dispatched from stock" — without a second
 * copy of this function drifting away from it. Left out, it reads "Dispatched",
 * exactly as it always has.
 */
export async function recordDispatch(
  input: DispatchInput,
  userId: string,
  options: { note?: string } = {},
) {
  const slab = await loadSlab(input.slabId);
  assertNotTerminal(slab);

  const fromStock = slab.status === SlabStatus.IN_STOCK;

  if (slab.currentDisposition !== Disposition.DISPATCH && !fromStock) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is not marked for dispatch. Grade it A → Dispatch, or dispatch it from stock.`,
    );
  }

  const dispatchDate = input.dispatchDate ?? new Date();

  const dispatchBay = await prisma.chromiaLocation.findFirst({
    where: { type: 'DISPATCH_BAY', isActive: true },
    select: { id: true },
  });
  const locationId = dispatchBay?.id ?? slab.currentLocationId ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.chromiaDispatch.create({
      data: {
        slabId: slab.id,
        dispatchDate,
        dispatchedById: userId,
      },
    });

    // Close any open stock holding.
    await tx.chromiaStockEntry.updateMany({
      where: { slabId: slab.id, releasedAt: null },
      data: { releasedAt: dispatchDate },
    });

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: SlabStatus.DISPATCHED,
        currentDisposition: Disposition.DISPATCH,
        currentLocationId: locationId,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        eventType: SlabEventType.DISPATCHED,
        fromStatus: slab.status,
        toStatus: SlabStatus.DISPATCHED,
        locationId,
        userId,
        occurredAt: dispatchDate,
        note: options.note ?? 'Dispatched',
      },
    });

    if (locationId && locationId !== slab.currentLocationId) {
      await tx.chromiaSlabMovement.create({
        data: {
          slabId: slab.id,
          fromLocationId: slab.currentLocationId,
          toLocationId: locationId,
          reason: MovementReason.DISPATCH,
          movedById: userId,
          movedAt: dispatchDate,
        },
      });
    }
  });

  log.info({ slabNo: slab.slabNo }, 'Dispatched');
}

// ----------------------------------------------------------------- stock ---

export async function recordStock(input: StockInput, userId: string) {
  const slab = await loadSlab(input.slabId);
  assertNotTerminal(slab);

  if (slab.currentDisposition !== Disposition.STOCK) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is not marked for stock. Grade it A or B → Stock first.`,
    );
  }

  if (slab.status === SlabStatus.IN_STOCK) {
    throw new BusinessRuleViolationError(`Slab ${slab.slabNo} is already in stock`);
  }

  const stockDate = input.stockDate ?? new Date();

  const stockRack = input.locationId
    ? { id: input.locationId }
    : await prisma.chromiaLocation.findFirst({
        where: { type: 'STOCK_RACK', isActive: true },
        select: { id: true },
      });
  const locationId = stockRack?.id ?? slab.currentLocationId ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.chromiaStockEntry.create({
      data: {
        slabId: slab.id,
        stockDate,
        locationId,
        notes: input.notes ?? null,
        createdById: userId,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: SlabStatus.IN_STOCK,
        currentLocationId: locationId,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        eventType: SlabEventType.STOCKED,
        fromStatus: slab.status,
        toStatus: SlabStatus.IN_STOCK,
        locationId,
        userId,
        occurredAt: stockDate,
        note: 'Placed in finished stock',
      },
    });

    if (locationId && locationId !== slab.currentLocationId) {
      await tx.chromiaSlabMovement.create({
        data: {
          slabId: slab.id,
          fromLocationId: slab.currentLocationId,
          toLocationId: locationId,
          reason: MovementReason.STOCK_PUTAWAY,
          movedById: userId,
          movedAt: stockDate,
        },
      });
    }
  });

  log.info({ slabNo: slab.slabNo }, 'Stocked');
}

// -------------------------------------------------------- sample cutting ---

export async function recordSampleCutting(input: SampleCuttingInput, userId: string) {
  const slab = await loadSlab(input.slabId);
  assertNotTerminal(slab);

  const fromStock = slab.status === SlabStatus.IN_STOCK;

  if (slab.currentDisposition !== Disposition.SAMPLE_CUTTING && !fromStock) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} is not marked for sample cutting. Grade it B → Sample Cutting, or cut it from stock.`,
    );
  }

  const cutDate = input.cutDate ?? new Date();

  const sampleArea = await prisma.chromiaLocation.findFirst({
    where: { type: 'SAMPLE_AREA', isActive: true },
    select: { id: true },
  });
  const locationId = sampleArea?.id ?? slab.currentLocationId ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.chromiaSampleCutting.create({
      data: {
        slabId: slab.id,
        cutDate,
        piecesProduced: input.piecesProduced ?? null,
        purpose: input.purpose ?? null,
        destination: input.destination ?? null,
        notes: input.notes ?? null,
        doneById: userId,
      },
    });

    await tx.chromiaStockEntry.updateMany({
      where: { slabId: slab.id, releasedAt: null },
      data: { releasedAt: cutDate },
    });

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: SlabStatus.SAMPLE_CUT,
        currentDisposition: Disposition.SAMPLE_CUTTING,
        currentLocationId: locationId,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        eventType: SlabEventType.SAMPLE_CUT,
        fromStatus: slab.status,
        toStatus: SlabStatus.SAMPLE_CUT,
        locationId,
        userId,
        occurredAt: cutDate,
        note: `Cut for samples${input.piecesProduced ? ` — ${input.piecesProduced} pieces` : ''}`,
      },
    });

    if (locationId && locationId !== slab.currentLocationId) {
      await tx.chromiaSlabMovement.create({
        data: {
          slabId: slab.id,
          fromLocationId: slab.currentLocationId,
          toLocationId: locationId,
          reason: MovementReason.SAMPLE_CUTTING,
          movedById: userId,
          movedAt: cutDate,
        },
      });
    }
  });

  log.info({ slabNo: slab.slabNo }, 'Sample cut');
}

// ----------------------------------------------------------------- waste ---

export async function declareWaste(input: WasteInput, userId: string) {
  const slab = await loadSlab(input.slabId);
  assertNotTerminal(slab);

  const exhausted = slab.recalibrationCount >= MAX_RECALIBRATION_ATTEMPTS;

  if (slab.currentDisposition !== Disposition.WASTE && !exhausted) {
    throw new BusinessRuleViolationError(
      `Slab ${slab.slabNo} can only be declared waste after a Grade C decision, or once all ${MAX_RECALIBRATION_ATTEMPTS} recalibration attempts are used`,
    );
  }

  const declaredAt = new Date();

  const wasteArea = await prisma.chromiaLocation.findFirst({
    where: { type: 'WASTE_AREA', isActive: true },
    select: { id: true },
  });
  const locationId = wasteArea?.id ?? slab.currentLocationId ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.chromiaWasteRecord.create({
      data: {
        slabId: slab.id,
        declaredAt,
        cyclesConsumed: slab.currentCycleNumber,
        recalibrationsAttempted: slab.recalibrationCount,
        finalDefectTypeId: input.finalDefectTypeId ?? null,
        rootCause: input.rootCause ?? null,
        disposalRef: input.disposalRef ?? null,
        notes: input.notes ?? null,
        authorisedById: userId,
      },
    });

    await tx.chromiaSlab.update({
      where: { id: slab.id },
      data: {
        status: SlabStatus.WASTE,
        currentDisposition: Disposition.WASTE,
        isRecalibrationOut: false,
        currentLocationId: locationId,
        updatedById: userId,
      },
    });

    await tx.chromiaSlabEvent.create({
      data: {
        slabId: slab.id,
        eventType: SlabEventType.DECLARED_WASTE,
        fromStatus: slab.status,
        toStatus: SlabStatus.WASTE,
        locationId,
        userId,
        occurredAt: declaredAt,
        note: `Declared waste after ${slab.recalibrationCount} recalibration attempt${
          slab.recalibrationCount === 1 ? '' : 's'
        }`,
      },
    });

    if (locationId && locationId !== slab.currentLocationId) {
      await tx.chromiaSlabMovement.create({
        data: {
          slabId: slab.id,
          fromLocationId: slab.currentLocationId,
          toLocationId: locationId,
          reason: MovementReason.WASTE_DISPOSAL,
          movedById: userId,
          movedAt: declaredAt,
        },
      });
    }
  });

  log.info({ slabNo: slab.slabNo, attempts: slab.recalibrationCount }, 'Declared waste');
}
