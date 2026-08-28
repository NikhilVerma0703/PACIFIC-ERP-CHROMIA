/**
 * The small three-field filter shared by Stockyard and Recalibration.
 *
 * Production Date, Batch Number, Slab Number — nothing else. Both pages list
 * ChromiaSlab rows and the in-charge reaches for the same three keys on each,
 * so the parsing, the where fragment and the query builder live here once
 * rather than being written twice and drifting apart. It is the cut-down
 * sibling of slab-filters.ts, and it is a pure module for the same reason: the
 * rules are worth testing without a database.
 *
 * Kept deliberately separate from the full Slab Records filter set — these two
 * screens were asked for exactly these three, and no more.
 */

export interface SimpleFilters {
  /** A single production day (the slab's received date). */
  productionDate: Date | null;
  batchNo: string;
  slabNo: string;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function asDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseSimpleFilters(params: RawSearchParams): SimpleFilters {
  return {
    productionDate: asDate(first(params.productionDate)),
    batchNo: first(params.batchNo).trim().slice(0, 80),
    slabNo: first(params.slabNo).trim().slice(0, 80),
  };
}

/** True when any of the three is set — drives the "clear" affordance. */
export function hasSimpleFilters(filters: SimpleFilters): boolean {
  return Boolean(filters.productionDate || filters.batchNo || filters.slabNo);
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

/**
 * The production date as an inclusive day range, or nulls when unset.
 *
 * Exposed for callers that already take a `receivedFrom`/`receivedTo` pair —
 * the Recalibration page reuses `searchRecalibrationRecords`, whose date filter
 * is a range — so the single day is expressed as the whole of that day.
 */
export function productionDateRange(filters: SimpleFilters): {
  from: Date | null;
  to: Date | null;
} {
  if (!filters.productionDate) return { from: null, to: null };
  return { from: startOfDay(filters.productionDate), to: endOfDay(filters.productionDate) };
}

/**
 * A Prisma `where` fragment for a ChromiaSlab query.
 *
 * Batch and slab match partially and case-insensitively, the same way Slab
 * Records does — operators type "8547" and expect 85477 back. Returned as a
 * fragment so each caller can AND it into whatever base condition its page
 * already has (Stockyard's "in stock", Recalibration's "condemned or ever
 * sent") without this module needing to know about either.
 */
export function simpleSlabWhere(filters: SimpleFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (filters.slabNo) {
    where.slabNo = { contains: filters.slabNo, mode: 'insensitive' };
  }

  if (filters.batchNo) {
    where.batch = { batchNo: { contains: filters.batchNo, mode: 'insensitive' } };
  }

  const { from, to } = productionDateRange(filters);
  if (from || to) {
    const receivedDate: Record<string, Date> = {};
    if (from) receivedDate.gte = from;
    if (to) receivedDate.lte = to;
    where.receivedDate = receivedDate;
  }

  return where;
}

/** Rebuild the query string, dropping empties — for the form key and links. */
export function buildSimpleQuery(filters: SimpleFilters): string {
  const params = new URLSearchParams();
  const base: Record<string, string> = {
    productionDate: filters.productionDate ? filters.productionDate.toISOString().slice(0, 10) : '',
    batchNo: filters.batchNo,
    slabNo: filters.slabNo,
  };
  for (const [key, value] of Object.entries(base)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}
