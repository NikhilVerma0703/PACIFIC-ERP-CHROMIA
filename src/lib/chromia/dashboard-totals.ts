/**
 * Overall Production — the running totals, as arithmetic.
 *
 * Kept apart from the queries so the one rule that is genuinely a business rule
 * can be stated once and tested without a database:
 *
 *   in the plant = received − dispatched − written off
 *
 * That is a subtraction rather than a count of statuses on purpose. Counting
 * "everything that looks like it is still here" drifts the moment a new status
 * is added and nobody remembers to include it; counting what has definitively
 * left cannot, because a slab leaves in exactly two ways — it is dispatched, or
 * it is written off.
 */

export interface OverallCounts {
  /** Every slab the module has ever taken in. */
  received: number;
  /** Current outcome = Dispatch. */
  dispatched: number;
  /** Written off after the final recalibration attempt. */
  writtenOff: number;
  /** No outcome decided yet — still somewhere on the line. */
  inProcessing: number;
  /** A grade has been recorded at least once. */
  qcDone: number;
  /** Current outcome = Stock. */
  stocked: number;
  /** Current outcome = Sample Cutting. */
  sampleCut: number;
  /** Current outcome = Recalibration. */
  recalibration: number;
}

/**
 * Live plant inventory.
 *
 * Never negative: a figure below zero would be a data fault, and showing "−3
 * slabs in the plant" on a shop-floor screen invites somebody to go looking for
 * them.
 */
export function inPlantNow(counts: Pick<OverallCounts, 'received' | 'dispatched' | 'writtenOff'>) {
  return Math.max(0, counts.received - counts.dispatched - counts.writtenOff);
}

export interface OverallTile {
  key: string;
  label: string;
  value: number;
  tone: 'neutral' | 'active' | 'done' | 'hold' | 'recalibration' | 'waste';
  hint?: string;
}

/**
 * The eight figures, in the order an in-charge walks through them: how much
 * came in, how much is still here, what it is doing, and where the rest went.
 */
export function buildOverallTiles(counts: OverallCounts): OverallTile[] {
  return [
    { key: 'received', label: 'Total Produced Slabs', value: counts.received, tone: 'neutral' },
    {
      key: 'inPlant',
      label: 'Total Slabs in the Plant',
      value: inPlantNow(counts),
      tone: 'active',
    },
    {
      key: 'inProcessing',
      label: 'Total In Processing Slabs',
      value: counts.inProcessing,
      tone: 'neutral',
    },
    { key: 'qcDone', label: 'Total Quality Checks Done', value: counts.qcDone, tone: 'hold' },
    {
      key: 'dispatched',
      label: 'Total Dispatched Slabs',
      value: counts.dispatched,
      tone: 'done',
    },
    { key: 'stocked', label: 'Total Stock Slabs', value: counts.stocked, tone: 'active' },
    {
      key: 'sampleCut',
      label: 'Total Sample Cutting Slabs',
      value: counts.sampleCut,
      tone: 'hold',
    },
    {
      key: 'recalibration',
      label: 'Total Recalibration Slabs',
      value: counts.recalibration,
      tone: 'recalibration',
    },
  ];
}
