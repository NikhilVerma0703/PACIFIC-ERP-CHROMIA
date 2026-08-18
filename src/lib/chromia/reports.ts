import { ChromiaSlabGrade as SlabGrade } from '@prisma/client';

/**
 * Report shaping.
 *
 * Pure functions: the repository fetches rows, these turn them into report
 * tables. Keeping the aggregation here means the numbers are unit-testable
 * without a database, and the same shapes feed both the screen and the
 * Excel export.
 */

/** Local calendar day key, e.g. "2026-05-08". */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface DateRange {
  from: Date;
  to: Date;
}

/** Default reporting window: the last 30 days, inclusive of today. */
export function defaultRange(now: Date = new Date()): DateRange {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export function parseRange(fromRaw: string, toRaw: string, now: Date = new Date()): DateRange {
  const fallback = defaultRange(now);

  const from = fromRaw ? new Date(fromRaw) : fallback.from;
  const to = toRaw ? new Date(toRaw) : fallback.to;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return fallback;
  if (from > to) return { from: to, to: from };

  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

// --------------------------------------------------------- daily production ---

export interface DailyProductionRow {
  day: string;
  received: number;
  processingCompleted: number;
  qualityChecks: number;
  dispatched: number;
  sentForRecalibration: number;
}

export interface DailyProductionInput {
  received: readonly { at: Date }[];
  processingCompleted: readonly { at: Date }[];
  qualityChecks: readonly { at: Date }[];
  dispatched: readonly { at: Date }[];
  sentForRecalibration: readonly { at: Date }[];
}

function tally(items: readonly { at: Date }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = dayKey(item.at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** One row per day that saw activity, newest first. */
export function buildDailyProduction(input: DailyProductionInput): DailyProductionRow[] {
  const received = tally(input.received);
  const completed = tally(input.processingCompleted);
  const qc = tally(input.qualityChecks);
  const dispatched = tally(input.dispatched);
  const recal = tally(input.sentForRecalibration);

  const days = new Set([
    ...received.keys(),
    ...completed.keys(),
    ...qc.keys(),
    ...dispatched.keys(),
    ...recal.keys(),
  ]);

  return [...days]
    .sort((a, b) => b.localeCompare(a))
    .map((day) => ({
      day,
      received: received.get(day) ?? 0,
      processingCompleted: completed.get(day) ?? 0,
      qualityChecks: qc.get(day) ?? 0,
      dispatched: dispatched.get(day) ?? 0,
      sentForRecalibration: recal.get(day) ?? 0,
    }));
}

export function totalsOf(rows: readonly DailyProductionRow[]) {
  return rows.reduce(
    (acc, row) => ({
      received: acc.received + row.received,
      processingCompleted: acc.processingCompleted + row.processingCompleted,
      qualityChecks: acc.qualityChecks + row.qualityChecks,
      dispatched: acc.dispatched + row.dispatched,
      sentForRecalibration: acc.sentForRecalibration + row.sentForRecalibration,
    }),
    {
      received: 0,
      processingCompleted: 0,
      qualityChecks: 0,
      dispatched: 0,
      sentForRecalibration: 0,
    },
  );
}

// ------------------------------------------------------------- grade analysis ---

export interface GradeRow {
  name: string;
  a: number;
  b: number;
  c: number;
  total: number;
  aPercent: number;
  cPercent: number;
}

/**
 * Grade split per grouping key (material or design).
 * Sorted by volume — the biggest producers first, which is where a
 * percentage point of Grade C costs the most.
 */
export function buildGradeAnalysis(
  rows: readonly { name: string; grade: SlabGrade | null }[],
): GradeRow[] {
  const groups = new Map<string, { a: number; b: number; c: number }>();

  for (const row of rows) {
    if (!row.grade) continue;
    const bucket = groups.get(row.name) ?? { a: 0, b: 0, c: 0 };
    if (row.grade === SlabGrade.A) bucket.a += 1;
    else if (row.grade === SlabGrade.B) bucket.b += 1;
    else bucket.c += 1;
    groups.set(row.name, bucket);
  }

  return [...groups.entries()]
    .map(([name, bucket]) => {
      const total = bucket.a + bucket.b + bucket.c;
      return {
        name,
        ...bucket,
        total,
        aPercent: total ? Math.round((bucket.a / total) * 100) : 0,
        cPercent: total ? Math.round((bucket.c / total) * 100) : 0,
      };
    })
    .sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));
}

// ---------------------------------------------------- recalibration analysis ---

export interface RecalibrationReasonRow {
  reason: string;
  sent: number;
  returned: number;
  outstanding: number;
  averageTurnaroundDays: number | null;
}

/**
 * Recalibration performance by reason — how often each cause sends a slab out,
 * and how long it takes to come back.
 */
export function buildRecalibrationAnalysis(
  rows: readonly { reason: string | null; turnaroundDays: number | null; returned: boolean }[],
): RecalibrationReasonRow[] {
  const groups = new Map<
    string,
    { sent: number; returned: number; turnaroundTotal: number; turnaroundCount: number }
  >();

  for (const row of rows) {
    const key = row.reason ?? 'Not recorded';
    const bucket =
      groups.get(key) ?? { sent: 0, returned: 0, turnaroundTotal: 0, turnaroundCount: 0 };

    bucket.sent += 1;
    if (row.returned) bucket.returned += 1;
    if (row.turnaroundDays !== null) {
      bucket.turnaroundTotal += row.turnaroundDays;
      bucket.turnaroundCount += 1;
    }
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .map(([reason, bucket]) => ({
      reason,
      sent: bucket.sent,
      returned: bucket.returned,
      outstanding: bucket.sent - bucket.returned,
      averageTurnaroundDays: bucket.turnaroundCount
        ? Math.round((bucket.turnaroundTotal / bucket.turnaroundCount) * 10) / 10
        : null,
    }))
    .sort((x, y) => y.sent - x.sent || x.reason.localeCompare(y.reason));
}

/** How many slabs sit at each attempt count — the ceiling in practice. */
export function buildAttemptDistribution(
  rows: readonly { recalibrationCount: number }[],
  maxAttempts: number,
): { attempts: number; slabs: number }[] {
  return Array.from({ length: maxAttempts + 1 }, (_, attempts) => ({
    attempts,
    slabs: rows.filter((row) => row.recalibrationCount === attempts).length,
  }));
}
