/**
 * THE one rule for putting a slab's bare "HH:MM" In/Out on an absolute timeline.
 *
 * Both the hourly chart (hourlyProduction.ts) and the Total Production Time KPI
 * (productionSpan.ts) need each slab's In and Out as a real instant. They used
 * to place them by two different rules, and the KPI and the chart under it
 * disagreed on the same batch — batch 1432 read "35 hours" over an 11:00–23:00
 * chart. Everything that turns a slab into minutes-on-a-timeline lives here, so
 * the two can only ever agree.
 *
 * Pure and alias-free so `node --test` can reach it.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * Slabs are walked in the order given (register order — see registerOrder). A
 * day cursor tracks which calendar day the run is currently on.
 *
 *   1. The FIRST slab with a date anchors the cursor from its stored date.
 *
 *   2. A later slab's stored date that lies AHEAD of the cursor is TRUSTED when
 *      the slab's same-day placement would land BEFORE the run so far: its clock
 *      went backwards, so it cannot be a same-day continuation. That charts a
 *      batch paused overnight and resumed next morning on the right day.
 *
 *   3. That same forward date is IGNORED when the same-day placement already
 *      sits at or after the run so far. A date that jumps forward while the
 *      clock barely moved is a data-entry slip, and trusting it is what threw
 *      batch 1432's last two 22:4x slabs ~24h ahead. A stored date BEHIND the
 *      cursor is never trusted: a slab cannot be produced before the run it
 *      belongs to.
 *
 *   4. A clock more than 12h behind the run so far, whatever the stored date
 *      says, has wrapped past midnight: the cursor advances a day at a time
 *      until the slab sits after the run so far. A cross-midnight batch whose
 *      later slabs were never re-dated is still placed on the next day.
 *
 *   5. Within one slab, an Out clock earlier than its In clock means the slab
 *      itself crossed midnight: Out is the next day (+1440). The entry form's
 *      duration reads it the same way.
 *
 * No wall clock is ever read, so the same records always place the same way.
 */

export interface PlaceableSlab {
  /** yyyy-mm-dd — the slab's effective production date (productionDateOf). */
  productionDate: string | null | undefined;
  inTime: string | null | undefined; // HH:MM
  outTime: string | null | undefined; // HH:MM
  /** Register order — the production sequence. Optional: with neither hint
   *  present the caller's array order is taken as the sequence. */
  serialNumber?: number | null;
  createdAt?: string | number | Date | null;
}

export interface PlacedSlab<T> {
  slab: T;
  /** Absolute minutes (whole days since the epoch × 1440 + clock), null when
   *  the slab has no such time. */
  inAbs: number | null;
  outAbs: number | null;
}

/** Minutes since midnight for an HH:MM string, or null if unusable. */
export function toMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Whole days since the epoch for a yyyy-mm-dd string, or null. UTC, so no
 *  timezone shifts the day. */
export function dayNum(d: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((d ?? "").trim());
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** The yyyy-mm-dd for a whole-days-since-epoch number — the inverse of dayNum,
 *  in UTC, so the date a bucket is labelled with never drifts with a timezone. */
export function dateFromDayNum(dn: number): string | null {
  if (!Number.isFinite(dn)) return null;
  return new Date(dn * 86_400_000).toISOString().slice(0, 10);
}

/** A comparable number for a createdAt (Date, epoch ms, or ISO string); 0 when
 *  absent or unparseable, so it never reorders ahead of a real timestamp. */
function createdAtValue(v: string | number | Date | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

/** Register order = production order: serialNumber, then createdAt. Stable, so
 *  with no hints the caller's own order stands as the sequence. */
export function registerOrder<T extends PlaceableSlab>(slabs: readonly T[]): T[] {
  return slabs
    .map((slab, i) => ({ slab, i }))
    .sort((a, b) => {
      const sa = a.slab.serialNumber, sb = b.slab.serialNumber;
      if (sa != null && sb != null && sa !== sb) return sa - sb;
      if (sa != null && sb == null) return -1;
      if (sa == null && sb != null) return 1;
      const ca = createdAtValue(a.slab.createdAt), cb = createdAtValue(b.slab.createdAt);
      if (ca !== cb) return ca - cb;
      return a.i - b.i;
    })
    .map((x) => x.slab);
}

/** A time jumping back more than this against the run so far is a midnight
 *  crossing, not a slab logged slightly out of order. */
const WRAP_GUARD_MIN = 12 * 60;

/** A run this long is a data error (a stray date), not a real batch — cap how
 *  far the cursor can chase one row so it can't ask for thousands of hours. */
export const MAX_RUN_HOURS = 48;

/**
 * Place `slabs` — already in register order — on the absolute timeline by the
 * rule above. Slabs with no time at all, or none dated before the first date
 * appears, are left out.
 */
export function placeSlabs<T extends PlaceableSlab>(slabs: readonly T[]): PlacedSlab<T>[] {
  let dayBase: number | null = null; // absolute minute of the cursor day's midnight
  let prevRef = -Infinity;           // the previous slab's last placed minute
  const placed: PlacedSlab<T>[] = [];

  for (const slab of slabs) {
    const inM = toMins(slab.inTime);
    const outM = toMins(slab.outTime);
    const startM = inM ?? outM;
    if (startM === null) continue;

    const day = dayNum(slab.productionDate);
    if (dayBase === null) {
      if (day === null) continue;
      dayBase = day * 1440;
    } else if (day !== null && day * 1440 > dayBase && dayBase + startM < prevRef) {
      // Rule 2: the clock went backwards against the run, so this cannot be a
      // same-day continuation — the forward stored date is the truth. Anywhere
      // else (rule 3) the forward date is a mis-date and the cursor stays put.
      dayBase = day * 1440;
    }

    let inAbs = inM !== null ? dayBase + inM : null;
    let outAbs = outM !== null ? dayBase + outM : null;
    if (inAbs !== null && outAbs !== null && (outM as number) < (inM as number)) outAbs += 1440;

    // Rule 4: a wrap the date never recorded. Push the slab (and the cursor)
    // forward a day at a time until it sits after the run so far.
    let refAbs = inAbs ?? (outAbs as number);
    let guard = 0;
    while (prevRef !== -Infinity && refAbs + WRAP_GUARD_MIN < prevRef && guard < MAX_RUN_HOURS) {
      dayBase += 1440;
      if (inAbs !== null) inAbs += 1440;
      if (outAbs !== null) outAbs += 1440;
      refAbs += 1440;
      guard++;
    }

    placed.push({ slab, inAbs, outAbs });
    prevRef = outAbs ?? (inAbs as number);
  }

  return placed;
}
