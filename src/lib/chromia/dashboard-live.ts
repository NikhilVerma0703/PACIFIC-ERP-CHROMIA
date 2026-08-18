import { ChromiaDisposition as Disposition } from '@prisma/client';
import type { ChromiaDisposition as DispositionType } from '@prisma/client';

/**
 * Where the plant's slabs are, right now.
 *
 * Pure, so it can be unit-tested without a database: the repository fetches
 * rows, this file decides what they mean. The dashboard answers four questions
 * and nothing else — how the plant stands overall, where its slabs are, what
 * happened today, and what QC just said. Anything that needs filtering,
 * ranking or a date range belongs in its own section, not on a screen meant to
 * be read in ten seconds.
 */

// ---------------------------------------------------------- where they went ---

/**
 * The five places a slab ends up, plus the ones still deciding.
 *
 * Grouped by the outcome the in-charge recorded rather than by lifecycle
 * status: "dispatched" is a decision, and it stays true whether the slab left
 * this morning or last month. A slab with no decision yet is still in
 * processing — that is the honest name for it, not a missing value.
 *
 * Waste keeps a slot even though the Chromia line rarely uses it; an empty
 * group is dropped from the bar, so it only ever appears if it happened.
 */
export const OUTCOME_GROUPS = [
  { key: Disposition.DISPATCH, label: 'Dispatched', color: '#16a34a' },
  { key: Disposition.STOCK, label: 'Stock', color: '#327dff' },
  { key: Disposition.SAMPLE_CUTTING, label: 'Sample cutting', color: '#d97706' },
  { key: Disposition.RECALIBRATION, label: 'Recalibration', color: '#9333ea' },
  { key: 'IN_PROCESSING' as const, label: 'In processing', color: '#94a3b8' },
  { key: Disposition.WASTE, label: 'Waste', color: '#dc2626' },
] as const;

export type OutcomeKey = DispositionType | 'IN_PROCESSING';

export interface OutcomeSlice {
  key: OutcomeKey;
  label: string;
  count: number;
  percent: number;
  color: string;
}

/**
 * Build the outcome bar.
 *
 * `counts` is keyed by the slab's current disposition, with `IN_PROCESSING`
 * holding everything not yet decided.
 */
export function buildOutcomeSplit(counts: Partial<Record<OutcomeKey, number>>): OutcomeSlice[] {
  const total = OUTCOME_GROUPS.reduce((sum, group) => sum + (counts[group.key] ?? 0), 0);

  return OUTCOME_GROUPS.map((group) => ({
    key: group.key as OutcomeKey,
    label: group.label,
    count: counts[group.key] ?? 0,
    percent: total === 0 ? 0 : Math.round(((counts[group.key] ?? 0) / total) * 100),
    color: group.color,
  })).filter((slice) => slice.count > 0);
}

