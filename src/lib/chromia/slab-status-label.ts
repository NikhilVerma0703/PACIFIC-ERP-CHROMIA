import { SLAB_STATUS_LABELS } from '@/lib/chromia/constants/process-stages';
import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import type { ChromiaDisposition as DispositionType, ChromiaSlabStatus as SlabStatusType } from '@prisma/client';
import type { Tone } from '@/components/chromia/ui';

/**
 * What the Status column says about a slab in the recalibration loop.
 *
 * `SlabStatus` is a lifecycle field, and its names were written for the
 * lifecycle: a slab QC has just condemned is "Graded", because a grade is the
 * last thing that happened to it. On screen that is useless — every slab QC has
 * ever touched is graded — and it reads as though nothing came of the decision.
 *
 * So the label is decided from the status **and** the outcome together. While a
 * slab's outcome is Recalibration it is waiting to go out, whether that is the
 * first time or the fourth, and the column says exactly that. The one exception
 * is a slab that is physically away, which keeps its own name because "pending"
 * would be a lie about where it is.
 *
 * Nothing here writes anything. The stored status is untouched; this is the
 * sentence put in front of a person.
 */

const STATUS_TONE: Record<SlabStatusType, Tone> = {
  RECEIVED: 'neutral',
  IN_PROCESS: 'active',
  UNDER_INSPECTION: 'hold',
  GRADED: 'neutral',
  OUT_FOR_RECALIBRATION: 'recalibration',
  RECEIVED_FROM_RECALIBRATION: 'hold',
  IN_STOCK: 'neutral',
  SAMPLE_CUT: 'neutral',
  DISPATCHED: 'done',
  WASTE: 'waste',
  ON_HOLD: 'hold',
};

export interface StatusView {
  label: string;
  tone: Tone;
}

export function slabStatusView(
  status: SlabStatusType,
  disposition?: DispositionType | null,
): StatusView {
  // Written off at the fifth attempt: the outcome still reads Recalibration,
  // but the slab's life is over and the status has to say so first.
  if (status === SlabStatus.WASTE) {
    return { label: 'Written Off / Waste', tone: 'waste' };
  }

  if (disposition === Disposition.RECALIBRATION && status !== SlabStatus.OUT_FOR_RECALIBRATION) {
    return { label: 'Pending Recalibration', tone: 'recalibration' };
  }

  return { label: SLAB_STATUS_LABELS[status], tone: STATUS_TONE[status] };
}
