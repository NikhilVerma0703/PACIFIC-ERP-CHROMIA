import { ChromiaDisposition as Disposition, ChromiaSlabStatus as SlabStatus } from '@prisma/client';

/**
 * Production summary — the whole module in one page.
 *
 * Pure shaping functions. The repository fetches thin rows; these turn them
 * into the four things the summary shows: headline figures, a daily trend, the
 * outcome mix, and the recalibration funnel.
 *
 * Every figure is measured on one cohort: **slabs received inside the window**.
 * Mixing cohorts is how summary pages start lying — "received in May" and
 * "dispatched in May" are different sets, and a percentage across the two means
 * nothing. The daily trend is the one exception, and it is explicitly a diary
 * of activity rather than a cohort.
 */

export interface SummarySlab {
  disposition: Disposition | null;
  status: SlabStatus;
  recalibrationCount: number;
  /** True once at least one trip has come back. */
  returnedFromRecalibration: boolean;
  materialName: string;
}

const CLOSED_PASSED: readonly SlabStatus[] = [
  SlabStatus.DISPATCHED,
  SlabStatus.IN_STOCK,
  SlabStatus.SAMPLE_CUT,
];

// ------------------------------------------------------------- headline ---

export interface Headline {
  received: number;
  /** No outcome decided yet — the same rule the pie's "Still in process" uses. */
  inProcess: number;
  /** Never needed recalibration — the number the plant wants to be high. */
  firstPass: number;
  firstPassYield: number;
  dispatched: number;
  dispatchRate: number;
  stocked: number;
  stockRate: number;
  sampleCut: number;
  sampleCutRate: number;
  recalibrated: number;
  recalibrationRate: number;
  savedByRecalibration: number;
  /** Of the slabs that went, the share that came back and passed. */
  recoveryRate: number;
  waste: number;
  wasteRate: number;
}

function share(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export function buildHeadline(slabs: readonly SummarySlab[]): Headline {
  const received = slabs.length;
  const recalibrated = slabs.filter((slab) => slab.recalibrationCount > 0).length;
  const firstPass = received - recalibrated;

  const savedByRecalibration = slabs.filter(
    (slab) => slab.recalibrationCount > 0 && CLOSED_PASSED.includes(slab.status),
  ).length;

  const waste = slabs.filter((slab) => slab.status === SlabStatus.WASTE).length;

  // Counted off the disposition, not the status, so this tile and the pie's
  // "Still in process" slice can never disagree.
  const inProcess = slabs.filter((slab) => slab.disposition === null).length;

  // Outcome rates read off the slab's terminal status, so they agree with the
  // per-material table rather than being computed a second, different way.
  const count = (status: SlabStatus) => slabs.filter((slab) => slab.status === status).length;
  const dispatched = count(SlabStatus.DISPATCHED);
  const stocked = count(SlabStatus.IN_STOCK);
  const sampleCut = count(SlabStatus.SAMPLE_CUT);

  return {
    received,
    inProcess,
    firstPass,
    firstPassYield: share(firstPass, received),
    dispatched,
    dispatchRate: share(dispatched, received),
    stocked,
    stockRate: share(stocked, received),
    sampleCut,
    sampleCutRate: share(sampleCut, received),
    recalibrated,
    recalibrationRate: share(recalibrated, received),
    savedByRecalibration,
    recoveryRate: share(savedByRecalibration, recalibrated),
    waste,
    wasteRate: share(waste, received),
  };
}

// -------------------------------------------------------- outcome mix ---

export interface OutcomeSlice {
  key: Disposition | 'UNDECIDED';
  label: string;
  count: number;
  percent: number;
  /** Hex, from the module's reserved outcome palette. */
  color: string;
}

/**
 * Outcome colours are the same ones the badges use across the app, so a chart
 * and a table row can never disagree about what green means. Slabs with no
 * outcome yet are deliberately grey and last — an absence, not a category.
 */
const OUTCOME_ORDER: { key: Disposition; label: string; color: string }[] = [
  { key: Disposition.DISPATCH, label: 'Dispatched', color: '#16a34a' },
  { key: Disposition.STOCK, label: 'Stock', color: '#327dff' },
  { key: Disposition.SAMPLE_CUTTING, label: 'Sample cutting', color: '#d97706' },
  { key: Disposition.RECALIBRATION, label: 'Recalibration', color: '#9333ea' },
  { key: Disposition.WASTE, label: 'Waste', color: '#dc2626' },
];

export const UNDECIDED_COLOR = '#94a3b8';

export function buildOutcomeMix(slabs: readonly SummarySlab[]): OutcomeSlice[] {
  const total = slabs.length;

  const decided = OUTCOME_ORDER.map((outcome) => {
    const count = slabs.filter((slab) => slab.disposition === outcome.key).length;
    return { ...outcome, count, percent: share(count, total) };
  });

  const undecided = slabs.filter((slab) => slab.disposition === null).length;

  return [
    ...decided,
    {
      key: 'UNDECIDED' as const,
      label: 'Still in process',
      count: undecided,
      percent: share(undecided, total),
      color: UNDECIDED_COLOR,
    },
  ].filter((slice) => slice.count > 0);
}

// ---------------------------------------------------- recalibration funnel ---

export interface FunnelStep {
  label: string;
  count: number;
  /** Share of the slabs received — every step is measured against the same base. */
  percent: number;
  hint: string;
}

/**
 * The recalibration story, narrowing step by step.
 *
 * Each step is a share of the *received* cohort, not of the step above, so the
 * bars are directly comparable. A funnel drawn as "% of previous" makes a tiny
 * tail look enormous.
 */
export function buildRecalibrationFunnel(slabs: readonly SummarySlab[]): FunnelStep[] {
  const received = slabs.length;
  const sent = slabs.filter((slab) => slab.recalibrationCount > 0);
  const returned = sent.filter((slab) => slab.returnedFromRecalibration);

  return [
    {
      label: 'Slabs received',
      count: received,
      percent: 100,
      hint: 'Entered the line',
    },
    {
      label: 'Sent for recalibration',
      count: sent.length,
      percent: share(sent.length, received),
      hint: 'Failed QC at least once',
    },
    {
      label: 'Came back',
      count: returned.length,
      percent: share(returned.length, received),
      hint: 'Back from the facility',
    },
  ];
}

// ------------------------------------------------------- material table ---

export interface MaterialRow {
  name: string;
  received: number;
  dispatched: number;
  stocked: number;
  sampleCut: number;
  recalibrated: number;
  waste: number;
  inProcess: number;
  recalibrationRate: number;
}

export function buildMaterialSummary(slabs: readonly SummarySlab[]): MaterialRow[] {
  const byName = new Map<string, SummarySlab[]>();

  for (const slab of slabs) {
    const list = byName.get(slab.materialName);
    if (list) list.push(slab);
    else byName.set(slab.materialName, [slab]);
  }

  const rows = [...byName.entries()].map(([name, group]) => {
    const count = (predicate: (slab: SummarySlab) => boolean) => group.filter(predicate).length;
    const recalibrated = count((slab) => slab.recalibrationCount > 0);

    return {
      name,
      received: group.length,
      dispatched: count((slab) => slab.status === SlabStatus.DISPATCHED),
      stocked: count((slab) => slab.status === SlabStatus.IN_STOCK),
      sampleCut: count((slab) => slab.status === SlabStatus.SAMPLE_CUT),
      recalibrated,
      waste: count((slab) => slab.status === SlabStatus.WASTE),
      inProcess: count((slab) => slab.disposition === null),
      recalibrationRate: share(recalibrated, group.length),
    };
  });

  // Busiest material first — that is the one worth acting on.
  return rows.sort((a, b) => b.received - a.received || a.name.localeCompare(b.name));
}

/** Column totals, so the table can foot itself honestly. */
export function totalMaterialRow(rows: readonly MaterialRow[]): MaterialRow {
  const sum = (pick: (row: MaterialRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const received = sum((row) => row.received);
  const recalibrated = sum((row) => row.recalibrated);

  return {
    name: 'All materials',
    received,
    dispatched: sum((row) => row.dispatched),
    stocked: sum((row) => row.stocked),
    sampleCut: sum((row) => row.sampleCut),
    recalibrated,
    waste: sum((row) => row.waste),
    inProcess: sum((row) => row.inProcess),
    recalibrationRate: share(recalibrated, received),
  };
}

// -------------------------------------------------------- daily activity ---

export interface DailyActivityRow {
  /** Local calendar day, "2026-05-03". */
  day: string;
  received: number;
  processingDone: number;
  dispatched: number;
  stocked: number;
  sampleCut: number;
  recalibration: number;
}

export interface DailyActivityInput {
  received: readonly Date[];
  processingDone: readonly Date[];
  dispatched: readonly Date[];
  stocked: readonly Date[];
  sampleCut: readonly Date[];
  recalibration: readonly Date[];
}

/** Local calendar day key — `toISOString` would shift dates across midnight. */
function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tally(dates: readonly Date[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = dayKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The day-by-day diary.
 *
 * Unlike everything else on the summary page this is NOT a cohort: each column
 * counts its own kind of event on the date that event happened. A slab received
 * on the 3rd and dispatched on the 20th is counted once in each row, which is
 * exactly what "what happened on the 20th?" should answer.
 *
 * Only days with activity appear — a quiet plant should not produce a page of
 * zeroes. Newest first, because the recent days are the ones people check.
 */
export function buildDailyActivity(input: DailyActivityInput): DailyActivityRow[] {
  const received = tally(input.received);
  const processingDone = tally(input.processingDone);
  const dispatched = tally(input.dispatched);
  const stocked = tally(input.stocked);
  const sampleCut = tally(input.sampleCut);
  const recalibration = tally(input.recalibration);

  const days = new Set([
    ...received.keys(),
    ...processingDone.keys(),
    ...dispatched.keys(),
    ...stocked.keys(),
    ...sampleCut.keys(),
    ...recalibration.keys(),
  ]);

  return [...days]
    .sort((a, b) => b.localeCompare(a))
    .map((day) => ({
      day,
      received: received.get(day) ?? 0,
      processingDone: processingDone.get(day) ?? 0,
      dispatched: dispatched.get(day) ?? 0,
      stocked: stocked.get(day) ?? 0,
      sampleCut: sampleCut.get(day) ?? 0,
      recalibration: recalibration.get(day) ?? 0,
    }));
}

/** Column totals for the diary's footer. */
export function totalDailyRow(rows: readonly DailyActivityRow[]): DailyActivityRow {
  return rows.reduce<DailyActivityRow>(
    (total, row) => ({
      day: 'Total',
      received: total.received + row.received,
      processingDone: total.processingDone + row.processingDone,
      dispatched: total.dispatched + row.dispatched,
      stocked: total.stocked + row.stocked,
      sampleCut: total.sampleCut + row.sampleCut,
      recalibration: total.recalibration + row.recalibration,
    }),
    {
      day: 'Total',
      received: 0,
      processingDone: 0,
      dispatched: 0,
      stocked: 0,
      sampleCut: 0,
      recalibration: 0,
    },
  );
}
