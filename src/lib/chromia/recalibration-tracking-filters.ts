import { MAX_ATTEMPTS } from '@/lib/chromia/recalibration-flow';

/**
 * Recalibration Tracking — search state.
 *
 * The whole filter lives in the URL, so a search is bookmarkable and can be
 * sent to somebody else. Pure, so the rules are testable without a database.
 */

export interface TrackingFilters {
  batchNo: string;
  slabNo: string;
  baseMaterialId: string | null;
  designId: string | null;
  /** Trips completed *and* started — 0 means "condemned but never sent". */
  attempt: number | null;
  receivedFrom: Date | null;
  receivedTo: Date | null;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Every attempt a slab can be on, including nought. */
export const ATTEMPT_CHOICES: readonly number[] = Array.from(
  { length: MAX_ATTEMPTS + 1 },
  (_, index) => index,
);

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function asDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asAttempt(value: string): number | null {
  if (value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return ATTEMPT_CHOICES.includes(parsed) ? parsed : null;
}

export function parseTrackingFilters(params: RawSearchParams): TrackingFilters {
  return {
    batchNo: first(params.batchNo).trim().slice(0, 80),
    slabNo: first(params.slabNo).trim().slice(0, 80),
    baseMaterialId: first(params.baseMaterialId) || null,
    designId: first(params.designId) || null,
    attempt: asAttempt(first(params.attempt)),
    receivedFrom: asDate(first(params.receivedFrom)),
    receivedTo: asDate(first(params.receivedTo)),
  };
}

/** True when anything is set — drives the "clear" affordance. */
export function hasActiveFilters(filters: TrackingFilters): boolean {
  return Boolean(
    filters.batchNo ||
      filters.slabNo ||
      filters.baseMaterialId ||
      filters.designId ||
      filters.attempt !== null ||
      filters.receivedFrom ||
      filters.receivedTo,
  );
}

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The filters back as a query string — used to key the form so it resets. */
export function buildQuery(filters: TrackingFilters): string {
  const params = new URLSearchParams();

  if (filters.batchNo) params.set('batchNo', filters.batchNo);
  if (filters.slabNo) params.set('slabNo', filters.slabNo);
  if (filters.baseMaterialId) params.set('baseMaterialId', filters.baseMaterialId);
  if (filters.designId) params.set('designId', filters.designId);
  if (filters.attempt !== null) params.set('attempt', String(filters.attempt));
  if (filters.receivedFrom) params.set('receivedFrom', isoDay(filters.receivedFrom));
  if (filters.receivedTo) params.set('receivedTo', isoDay(filters.receivedTo));

  return params.toString();
}

/**
 * The end of a "to" day.
 *
 * A date input gives midnight, so filtering `receivedDate <= 12 Aug` would
 * drop everything received on the 12th. The range runs to the end of that day.
 */
export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/** Text filters are "contains", case-insensitive — nobody types a whole batch. */
export function matchesText(value: string | null | undefined, needle: string): boolean {
  if (!needle) return true;
  return (value ?? '').toLowerCase().includes(needle.toLowerCase());
}
