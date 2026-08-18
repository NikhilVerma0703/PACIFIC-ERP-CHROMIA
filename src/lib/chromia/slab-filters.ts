import { ChromiaDisposition as Disposition, ChromiaSlabGrade as SlabGrade, ChromiaSlabStatus as SlabStatus } from '@prisma/client';
import { PAGINATION } from '@/lib/chromia/constants/app';

/**
 * Slab search & filter state.
 *
 * Parsing and where-building live here (a pure module) rather than in the
 * repository, so the rules are unit-testable without a database.
 */

export interface SlabFilters {
  slabNo: string;
  batchNo: string;
  status: SlabStatus | null;
  grade: SlabGrade | null;
  disposition: Disposition | null;
  baseMaterialId: string | null;
  designId: string | null;
  outForRecalibration: boolean;
  receivedFrom: Date | null;
  receivedTo: Date | null;
  /** One exact day, narrowing whatever range is already set. */
  receivedOn: Date | null;
  page: number;
  pageSize: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function asEnum<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function asDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseSlabFilters(params: RawSearchParams): SlabFilters {
  const pageRaw = Number.parseInt(first(params.page), 10);
  const sizeRaw = Number.parseInt(first(params.pageSize), 10);

  const pageSize =
    Number.isFinite(sizeRaw) && sizeRaw > 0
      ? Math.min(sizeRaw, PAGINATION.maxPageSize)
      : PAGINATION.defaultPageSize;

  return {
    slabNo: first(params.slabNo).trim().slice(0, 80),
    batchNo: first(params.batchNo).trim().slice(0, 80),
    status: asEnum(first(params.status), Object.values(SlabStatus)),
    grade: asEnum(first(params.grade), Object.values(SlabGrade)),
    disposition: asEnum(first(params.disposition), Object.values(Disposition)),
    baseMaterialId: first(params.baseMaterialId) || null,
    designId: first(params.designId) || null,
    outForRecalibration: first(params.out) === '1',
    receivedFrom: asDate(first(params.receivedFrom)),
    receivedTo: asDate(first(params.receivedTo)),
    receivedOn: asDate(first(params.receivedOn)),
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
    pageSize,
  };
}

/** True when anything beyond paging is set — drives the "clear" affordance. */
export function hasActiveFilters(filters: SlabFilters): boolean {
  return Boolean(
    filters.slabNo ||
    filters.batchNo ||
    filters.status ||
    filters.grade ||
    filters.disposition ||
    filters.baseMaterialId ||
    filters.designId ||
    filters.outForRecalibration ||
    filters.receivedFrom ||
    filters.receivedTo ||
    filters.receivedOn,
  );
}

/**
 * Prisma `where` for the slab list.
 *
 * Slab number and batch number are separate filters, and both match partially
 * and case-insensitively — operators type "8547" and expect 85477 back. Given
 * together they narrow (AND), so "batch 1245, slab ending 20" is one search.
 */
export function buildSlabWhere(filters: SlabFilters) {
  const where: Record<string, unknown> = { deletedAt: null };

  if (filters.slabNo) {
    where.slabNo = { contains: filters.slabNo, mode: 'insensitive' };
  }

  if (filters.batchNo) {
    where.batch = { batchNo: { contains: filters.batchNo, mode: 'insensitive' } };
  }

  if (filters.status) where.status = filters.status;
  if (filters.grade) where.currentGrade = filters.grade;
  if (filters.disposition) where.currentDisposition = filters.disposition;
  if (filters.baseMaterialId) where.baseMaterialId = filters.baseMaterialId;
  if (filters.designId) where.plannedDesignId = filters.designId;
  if (filters.outForRecalibration) where.isRecalibrationOut = true;

  /*
   * All three date filters read the same Received Date column, so they are
   * merged into one bound rather than written three times over — the last one
   * would otherwise silently win. A single day and a range given together
   * narrow each other, which is what someone who sets both means.
   */
  const startOfDay = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };

  const endOfDay = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(23, 59, 59, 999);
    return copy;
  };

  const lowerBounds = [filters.receivedFrom, filters.receivedOn].filter(
    (value): value is Date => value !== null,
  );
  const upperBounds = [filters.receivedTo, filters.receivedOn].filter(
    (value): value is Date => value !== null,
  );

  if (lowerBounds.length > 0 || upperBounds.length > 0) {
    const receivedDate: Record<string, Date> = {};

    if (lowerBounds.length > 0) {
      // The latest lower bound wins: both must hold.
      receivedDate.gte = new Date(
        Math.max(...lowerBounds.map((value) => startOfDay(value).getTime())),
      );
    }

    if (upperBounds.length > 0) {
      // Inclusive of the whole end day.
      receivedDate.lte = new Date(
        Math.min(...upperBounds.map((value) => endOfDay(value).getTime())),
      );
    }

    where.receivedDate = receivedDate;
  }

  return where;
}

/** Rebuild the query string, dropping empties and resetting the page. */
export function buildQuery(
  filters: SlabFilters,
  overrides: Partial<Record<string, string | number>> = {},
): string {
  const params = new URLSearchParams();

  const base: Record<string, string> = {
    slabNo: filters.slabNo,
    batchNo: filters.batchNo,
    status: filters.status ?? '',
    grade: filters.grade ?? '',
    disposition: filters.disposition ?? '',
    baseMaterialId: filters.baseMaterialId ?? '',
    designId: filters.designId ?? '',
    out: filters.outForRecalibration ? '1' : '',
    receivedFrom: filters.receivedFrom ? filters.receivedFrom.toISOString().slice(0, 10) : '',
    receivedTo: filters.receivedTo ? filters.receivedTo.toISOString().slice(0, 10) : '',
    receivedOn: filters.receivedOn ? filters.receivedOn.toISOString().slice(0, 10) : '',
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  };

  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    const asString = String(value ?? '');
    if (asString && asString !== '0') params.set(key, asString);
  }

  return params.toString();
}

export function pageCount(total: number, pageSize: number): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
