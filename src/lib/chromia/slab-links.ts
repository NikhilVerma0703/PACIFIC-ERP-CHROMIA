import { ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import type { ChromiaSlabStatus as SlabStatusType } from '@prisma/client';
import { APP_ROUTES } from '@/lib/chromia/constants/app';

/**
 * Where a slab number should take you.
 *
 * A slab that has not been graded yet is unfinished work, and the thing the
 * in-charge wants is the form that finishes it — Slab Intake, with everything
 * already known filled in. A slab that has been graded is a record, and the
 * thing they want is its history. So the same link means "do the work" while
 * there is work and "show me what happened" once there isn't.
 */
const AWAITING_QC: readonly SlabStatusType[] = [
  SlabStatus.RECEIVED,
  SlabStatus.IN_PROCESS,
  SlabStatus.UNDER_INSPECTION,
];

/** True while the slab still needs its grade and outcome recorded. */
export function needsIntakeQc(status: SlabStatusType): boolean {
  return AWAITING_QC.includes(status);
}

/**
 * Link for a slab row, or null when the number should be plain text.
 *
 * There is exactly one screen a slab number can usefully open — the operator
 * screen, which shows the slab's own entry with the QC section under it. A slab
 * that is already graded, or one sitting at the recalibration facility, has
 * nothing to open: its work is done or belongs to the Recalibration section.
 * Returning null rather than a dead link keeps the table honest about that.
 */
export function slabHref(id: string, status: SlabStatusType): string | null {
  return needsIntakeQc(status) ? `${APP_ROUTES.slabIntake}?slab=${id}` : null;
}
