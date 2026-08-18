// Date-wise, stage-wise completion counts for the fabrication CEO dashboard.
//
// The dashboard has always had a "Today's throughput" strip: five tiles, one
// day. The owner's complaint was that it "is not showing the done things stage
// wise" over time — he wants "things done at each stage date wise, aggregate
// thats it". This module is the bucketing and the totalling for that series.
//
// PURE, AND IT IMPORTS NOTHING — same reason as slabLoss.ts and
// flatSheetParser.ts: `node --test` resolves ESM strictly, so a relative import
// without a .ts extension fails at runtime while adding the extension fights
// the Next build.
//
// ------------------------------------------------------- WHY A DAY KEY -----
// Every date here is a plain 'YYYY-MM-DD' string, never a Date. A Date carries
// an instant and a zone; a row on a report carries neither. The SQL in
// fab/ceo/route.ts already reduces each timestamp to that same string with
// to_char(), so the boundary between the database and this module is a label,
// and no timezone can be lost or re-applied on the way through. Arithmetic on
// the label is done in UTC (see addDays) purely because UTC has no DST, so
// "the day after" never lands on the same day twice or skips one.
//
// ------------------------------ THE RULE THAT IS EASY TO GET WRONG ---------
// CUTTING HAS TWO SOURCES. A cut piece reaches the numbers either as a
// fab_piece_operation row with operation_type = 'CUTTING', or as the
// allocated_quantity carried by a COMPLETED fab_slab_job (the CLO round-trip),
// and the two do not overlap. The existing single-day strip adds them
// (route.ts: dailyCutLegacy + dailyCutClo) and so must every day of this
// series, or the cut column silently under-reports every CLO slab ever cut.
// See addCutFromJobs below and the test named for it.

/** The five stages, in the order the shop floor runs them and the dashboard
 *  prints them. Mirrors the FabOperationType enum in schema.prisma. */
export const STAGE_KEYS = ["CUTTING", "POLISHING", "SINK_CUTTING", "FABRICATION", "PACKAGING"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

/** The camelCase field each stage lands in, matching the existing
 *  dailyThroughput shape so the page can read both with the same keys. */
export const STAGE_FIELD: Record<StageKey, keyof StageCounts> = {
  CUTTING: "cutting",
  POLISHING: "polishing",
  SINK_CUTTING: "sinkCutting",
  FABRICATION: "fabrication",
  PACKAGING: "packaging",
};

export interface StageCounts {
  cutting: number;
  polishing: number;
  sinkCutting: number;
  fabrication: number;
  packaging: number;
  /** Pieces finished at any stage that day. A piece is counted once per stage
   *  it passes, so this is "operations completed", not "distinct pieces". */
  total: number;
}

export interface StageDayRow extends StageCounts {
  /** 'YYYY-MM-DD'. */
  date: string;
}

export interface StageSeries {
  from: string;
  to: string;
  days: number;
  rows: StageDayRow[];
  totals: StageCounts;
}

/** One GROUP BY row from the piece-operation query. */
export interface StageOpBucket {
  day: string;
  stage: string;
  count: number;
}

/** One GROUP BY row from the CLO slab-job query: pieces cut, not slabs. */
export interface StageCutBucket {
  day: string;
  pieces: number;
}

/** Two working weeks. Long enough to read a week-over-week pattern and to make
 *  a bad day obvious next to a normal one, short enough that the table fits on
 *  the dashboard without scrolling and that the 30-second auto-refresh stays
 *  cheap. The range ends on the selected date, so its last row is the same
 *  number as the "Today's throughput" strip beside it — the fastest way for
 *  anyone to satisfy themselves the new panel agrees with the old one. */
export const DEFAULT_RANGE_DAYS = 14;

/** A hand-typed ?from= cannot ask for years of mostly-empty rows. A quarter is
 *  well past any window this dashboard is read at, and it bounds both the SQL
 *  scan and the JSON payload. */
export const MAX_RANGE_DAYS = 92;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86400000;

/** Is this a well-formed, real calendar day label? Rejects '2026-02-30' as
 *  well as garbage, because Date.UTC would roll it over to March. */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

/** The local calendar day a Date falls on, as a key. Uses the local getters
 *  (not toISOString) so it agrees with the local-midnight day boundaries the
 *  ceo route has always used for its ?date= filter. */
export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** n days after a key (negative for before). UTC arithmetic: a day key is a
 *  label, and labels do not have a 23- or 25-hour variant. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayKeyOfUtc(new Date(Date.UTC(y, m - 1, d) + n * MS_PER_DAY));
}

function dayKeyOfUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Whole days from `from` to `to` inclusive; 1 when they are the same day. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY) + 1;
}

/** Every day from `from` to `to` inclusive, oldest first.
 *
 *  THIS IS THE PART THAT MATTERS. The list comes from the calendar, never from
 *  the data, so a day on which nothing was completed still produces a row. A
 *  trend line that omits its empty days is not a sparse trend line, it is a
 *  wrong one: four rows spanning a fortnight read as four consecutive days. */
export function enumerateDays(from: string, to: string, maxDays: number = MAX_RANGE_DAYS): string[] {
  if (!isDayKey(from) || !isDayKey(to)) return [];
  const cap = Math.max(1, maxDays);
  const ordered = orderPair(from, to);
  const hi = ordered.to;
  const lo = daysBetween(ordered.from, hi) > cap ? addDays(hi, -(cap - 1)) : ordered.from;
  const out: string[] = [];
  // Bounded rather than `while (k !== hi)`: lo <= hi is guaranteed above, but a
  // loop that walks dates should not be one arithmetic slip from hanging a
  // request thread.
  for (let k = lo, i = 0; i < cap; k = addDays(k, 1), i++) {
    out.push(k);
    if (k === hi) break;
  }
  return out;
}

/** The two keys as [older, newer]. A reversed range is a slip, not an error. */
function orderPair(a: string, b: string): { from: string; to: string } {
  return daysBetween(a, b) >= 1 ? { from: a, to: b } : { from: b, to: a };
}

export interface RangeInput {
  from?: string | null;
  to?: string | null;
  /** The ?date= the rest of the dashboard is filtered on, used as the anchor
   *  when the caller gives no range at all. */
  anchor: string;
  defaultDays?: number;
  maxDays?: number;
}

/** Turn whatever the query string carried into a clean, bounded [from, to].
 *
 *  Every branch is total: a missing, malformed or reversed range never throws
 *  and never returns an empty window, because this feeds a dashboard panel and
 *  the alternative to a sane default is a 500 on the whole page. */
export function resolveRange(input: RangeInput): { from: string; to: string } {
  const defaultDays = Math.max(1, Math.min(input.defaultDays ?? DEFAULT_RANGE_DAYS, input.maxDays ?? MAX_RANGE_DAYS));
  const maxDays = Math.max(1, input.maxDays ?? MAX_RANGE_DAYS);
  const anchor = isDayKey(input.anchor) ? input.anchor : dayKeyOf(new Date());

  const from = isDayKey(input.from) ? input.from : null;
  const to = isDayKey(input.to) ? input.to : null;

  const span = (end: string) => ({ from: addDays(end, -(defaultDays - 1)), to: end });
  const window =
    from && to ? orderPair(from, to)
    : to       ? span(to)
    // A start with no end means "from then until the day being looked at".
    : from     ? orderPair(from, anchor)
    :            span(anchor);

  // Clamp from the old end: whoever asks for too much wants the recent part.
  return daysBetween(window.from, window.to) > maxDays
    ? { from: addDays(window.to, -(maxDays - 1)), to: window.to }
    : window;
}

function emptyCounts(): StageCounts {
  return { cutting: 0, polishing: 0, sinkCutting: 0, fabrication: 0, packaging: 0, total: 0 };
}

export interface BuildInput {
  from: string;
  to: string;
  /** fab_piece_operation rows, already grouped by (day, operation_type). */
  ops?: readonly StageOpBucket[] | null;
  /** COMPLETED fab_slab_job pieces, already grouped by day. The CLO half of
   *  cutting — see the header note. */
  cuts?: readonly StageCutBucket[] | null;
  maxDays?: number;
}

/** The series: one row per calendar day, plus the totals for the range.
 *
 *  Buckets outside [from, to] are dropped rather than folded into the nearest
 *  edge, so the totals row is always exactly the sum of the rows printed above
 *  it. A total that does not match the column it sits under is worse than no
 *  total at all. */
export function buildStageSeries(input: BuildInput): StageSeries {
  const days = enumerateDays(input.from, input.to, input.maxDays ?? MAX_RANGE_DAYS);
  const byDay = new Map<string, StageDayRow>();
  for (const d of days) byDay.set(d, { date: d, ...emptyCounts() });

  for (const b of input.ops ?? []) {
    const row = byDay.get(b.day);
    if (!row) continue;
    const field = STAGE_FIELD[b.stage as StageKey];
    if (!field) continue; // an operation_type this dashboard does not print
    const n = safeCount(b.count);
    row[field] += n;
    row.total += n;
  }

  for (const b of input.cuts ?? []) {
    const row = byDay.get(b.day);
    if (!row) continue;
    const n = safeCount(b.pieces);
    row.cutting += n;
    row.total += n;
  }

  const totals = emptyCounts();
  const rows = days.map((d) => byDay.get(d)!);
  for (const r of rows) {
    totals.cutting += r.cutting;
    totals.polishing += r.polishing;
    totals.sinkCutting += r.sinkCutting;
    totals.fabrication += r.fabrication;
    totals.packaging += r.packaging;
    totals.total += r.total;
  }

  return {
    from: days[0] ?? input.from,
    to: days[days.length - 1] ?? input.to,
    days: rows.length,
    rows,
    totals,
  };
}

/** COUNT(*) and SUM() come back from Postgres as bigint unless cast, and a
 *  LEFT JOIN with no match gives null. Neither should become NaN on a screen. */
function safeCount(v: unknown): number {
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}
