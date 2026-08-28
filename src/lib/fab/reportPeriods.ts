// DAY, WEEK, MONTH — the three groupings the fabrication report offers.
//
// PURE, AND IT IMPORTS NOTHING (the rule from slabLoss.ts and pricing.ts), and
// it takes DATES ALREADY IN THE SHOP'S LOCAL DAY rather than doing timezone
// arithmetic of its own. See below.
//
// ────────────────────────────────────────────── WHY IT TAKES A KEY, NOT A DATE
// A completion at 23:40 on the 25th in Chennai is 18:10 on the 25th UTC — same
// day. At 00:30 on the 26th it is 19:00 on the 25th UTC — a DIFFERENT day. So
// bucketing UTC timestamps silently moves the night shift's work into the
// previous day, and the shift that runs 22:00–06:00 is exactly the one this
// shop runs.
//
// The existing stage series (lib/fab/stageSeries.ts) already resolves a local
// day key server-side. This module works on those keys — "2026-08-25" — and
// never parses a timestamp itself, so there is one place where a day is
// decided and it is not here.
//
// ─────────────────────────────────────────────────────────── WEEKS RUN MON–SUN
// ISO weeks, because that is what a production week is here and because a week
// that starts on Sunday splits every Saturday shift across two rows. The label
// names both ends ("18–24 Aug") rather than a week number nobody counts in.

export type PeriodGrain = "day" | "week" | "month";
export const PERIOD_GRAINS: PeriodGrain[] = ["day", "week", "month"];

export const GRAIN_LABEL: Record<PeriodGrain, string> = {
  day: "Day-wise",
  week: "Week-wise",
  month: "Month-wise",
};

// Short for a day or a week label, where the row is one of fourteen and space
// is tight; full for a month heading, which is read on its own.
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

/** A "YYYY-MM-DD" key split into numbers, or null if it is not one. Strict:
 *  a key this cannot read is dropped rather than bucketed into "now". */
function parseKey(dayKey: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** Days since 1970-01-01 for a calendar date. Pure arithmetic — no Date, so
 *  no local-timezone surprise and nothing this module cannot be tested on. */
function toEpochDay(y: number, m: number, d: number): number {
  // Howard Hinnant's civil_from_days, inverted. Exact for all Gregorian dates.
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromEpochDay(z: number): { y: number; m: number; d: number } {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: m <= 2 ? y + 1 : y, m, d };
}

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** 0 = Monday … 6 = Sunday. 1970-01-01 was a Thursday. */
function weekdayMon0(epochDay: number): number {
  return ((epochDay + 3) % 7 + 7) % 7;
}

export interface Period {
  /** Sorts and identifies the bucket: "2026-08-25", "2026-W35", "2026-08". */
  key: string;
  /** What a person reads: "Tue 25 Aug", "18–24 Aug", "August 2026". */
  label: string;
  /** First and last day the bucket covers, inclusive, as day keys. */
  startDayKey: string;
  endDayKey: string;
}

/** Which bucket a day belongs to. Null for a key this cannot read. */
export function periodOf(dayKey: string, grain: PeriodGrain): Period | null {
  const p = parseKey(dayKey);
  if (!p) return null;
  const epoch = toEpochDay(p.y, p.m, p.d);

  if (grain === "day") {
    const k = keyOf(p.y, p.m, p.d);
    const wd = weekdayMon0(epoch);
    const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    return { key: k, label: `${DAYS[wd]} ${p.d} ${MONTHS[p.m - 1]}`, startDayKey: k, endDayKey: k };
  }

  if (grain === "week") {
    const monday = epoch - weekdayMon0(epoch);
    const a = fromEpochDay(monday);
    const b = fromEpochDay(monday + 6);
    // The ISO week number, so the key sorts and is unambiguous across years.
    const thursday = monday + 3;
    const t = fromEpochDay(thursday);
    const jan1 = toEpochDay(t.y, 1, 1);
    const week = Math.floor((thursday - jan1) / 7) + 1;
    const label = a.m === b.m
      ? `${a.d}–${b.d} ${MONTHS[a.m - 1]}`
      : `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]}`;
    return {
      key: `${t.y}-W${pad(week)}`,
      label,
      startDayKey: keyOf(a.y, a.m, a.d),
      endDayKey: keyOf(b.y, b.m, b.d),
    };
  }

  // month
  const lastDay = fromEpochDay(toEpochDay(p.m === 12 ? p.y + 1 : p.y, p.m === 12 ? 1 : p.m + 1, 1) - 1);
  return {
    key: `${p.y}-${pad(p.m)}`,
    label: `${MONTHS_FULL[p.m - 1]} ${p.y}`,
    startDayKey: keyOf(p.y, p.m, 1),
    endDayKey: keyOf(lastDay.y, lastDay.m, lastDay.d),
  };
}

/** One row of whatever is being reported, tagged with the local day it fell on. */
export interface DatedRow {
  dayKey: string;
  [k: string]: unknown;
}

export interface PeriodBucket<T> {
  period: Period;
  rows: T[];
}

/**
 * Group dated rows into periods, oldest first.
 *
 * ROWS WITH AN UNREADABLE DAY ARE DROPPED, not bucketed into today. A silent
 * reassignment would put yesterday's output on today's report and nobody would
 * ever find it; the count of what was dropped is returned so a caller can say.
 */
export function bucketByPeriod<T extends DatedRow>(
  rows: T[],
  grain: PeriodGrain,
): { buckets: PeriodBucket<T>[]; dropped: number } {
  const byKey = new Map<string, PeriodBucket<T>>();
  let dropped = 0;

  for (const r of rows ?? []) {
    const period = periodOf(String(r?.dayKey ?? ""), grain);
    if (!period) { dropped++; continue; }
    const b = byKey.get(period.key) ?? { period, rows: [] };
    b.rows.push(r);
    byKey.set(period.key, b);
  }

  const buckets = [...byKey.values()].sort((a, b) =>
    a.period.startDayKey.localeCompare(b.period.startDayKey));
  return { buckets, dropped };
}

/** Every day key between two, inclusive — so a report shows the empty days
 *  rather than skipping them. A shop that cut nothing on Thursday needs to see
 *  Thursday. */
export function dayKeysBetween(startDayKey: string, endDayKey: string, max = 400): string[] {
  const a = parseKey(startDayKey), b = parseKey(endDayKey);
  if (!a || !b) return [];
  let start = toEpochDay(a.y, a.m, a.d);
  const end = toEpochDay(b.y, b.m, b.d);
  if (end < start) return [];
  const out: string[] = [];
  while (start <= end && out.length < max) {
    const d = fromEpochDay(start);
    out.push(keyOf(d.y, d.m, d.d));
    start++;
  }
  return out;
}
