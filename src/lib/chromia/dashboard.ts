import { RECALIBRATION_OVERDUE_DAYS } from '@/lib/chromia/constants/process-stages';
import { daysBetween } from '@/lib/chromia/utils/dates';

/** Ageing buckets for slabs out at the recalibration facility. */
export const AGEING_BUCKETS = [
  { label: '0–3 days', min: 0, max: 3 },
  { label: '4–7 days', min: 4, max: 7 },
  { label: '8–10 days', min: 8, max: RECALIBRATION_OVERDUE_DAYS },
  { label: 'Overdue', min: RECALIBRATION_OVERDUE_DAYS + 1, max: Number.POSITIVE_INFINITY },
] as const;

export interface AgeingBucket {
  label: string;
  count: number;
  overdue: boolean;
}

/** Distribute outstanding recalibrations into the ageing buckets. */
export function bucketAgeing(
  items: readonly { sentAt: Date }[],
  now: Date = new Date(),
): AgeingBucket[] {
  return AGEING_BUCKETS.map((bucket) => ({
    label: bucket.label,
    overdue: bucket.max === Number.POSITIVE_INFINITY,
    count: items.filter((item) => {
      const days = daysBetween(item.sentAt, now);
      return days >= bucket.min && days <= bucket.max;
    }).length,
  }));
}

/** Whole-percent share, guarding against divide-by-zero. */
export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}
