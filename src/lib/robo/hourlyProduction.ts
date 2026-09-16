/**
 * "Production Rate per Hour" — slabs completed each hour across ONE batch's own
 * run, for the Reports line chart.
 *
 * Pure and alias-free so `node --test` can reach it.
 *
 * ── HOW EACH SLAB IS PLACED — from its OWN stored production date ───────────
 * Every slab carries the production date the operator entered (productionDateOf,
 * resolved by the caller: the slab's own date, else the batch setup's, else the
 * shift's). THAT date is trusted — it is the actual day the slab was produced.
 * In/Out are bare HH:MM, so each is combined with the slab's date:
 *
 *   • In  → date + In time.
 *   • Out → date + Out time, EXCEPT when Out < In: the slab crossed midnight, so
 *           its Out is on the NEXT day (In 23:55, Out 00:09 → 00:09 the following
 *           day). That is the only date arithmetic done.
 *
 * A slab is counted in the hour its Out Time falls in. The timeline runs from the
 * earliest In to the latest Out, one bucket per hour (every hour shown, even the
 * empty ones), each bucket carrying the calendar date its hour belongs to — so a
 * run that crosses midnight flows 23:00–00:00 straight into 00:00–01:00 of the
 * next date, with both dates marked on the axis.
 *
 * ── WHY THE STORED DATE, NOT A RECONSTRUCTED SEQUENCE ──────────────────────
 * An earlier version ignored the stored date and rebuilt the day from the
 * production SEQUENCE — serialNumber order plus time-wrap detection. That was
 * fragile in exactly the way the register is unreliable: serialNumber is mistyped
 * on old runs (it can restart or duplicate — see slabSequence.ts), so the walk
 * ran out of order, every out-of-order step looked like a midnight crossing and
 * advanced the day cursor, and batches drifted forward by 1, 2, even 15 days; the
 * length cap then showed a window on the WRONG dates and dropped the real ones.
 * The cure is to stop reconstructing and read the production date the operator
 * actually recorded. If a stored date is itself wrong, it is corrected on the
 * slab (Slab Records → Edit), not papered over here — so the chart is a faithful,
 * deterministic view of the records and never invents a date. No serial number,
 * no wall clock: the same records always produce the same chart.
 */

export interface HourlySlab {
  /** yyyy-mm-dd — the slab's effective production date (productionDateOf). */
  productionDate: string | null;
  inTime: string | null; // HH:MM
  outTime: string | null; // HH:MM
}

export interface HourBucket {
  /** "11:00–12:00", "23:00–00:00" — the interval, 24-hour. */
  label: string;
  /** Hour of day 0-23, for anyone who needs the number rather than the label. */
  hour: number;
  /** Slabs whose Out Time fell in this hour. */
  slabs: number;
  /** The calendar date (yyyy-mm-dd) this hour belongs to — the X-axis date
   *  marker. null only when no slab carried a resolvable production date. */
  date: string | null;
}

/** Minutes since midnight for an HH:MM string, or null if unusable. */
function toMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Whole days since the epoch for a yyyy-mm-dd string, or null. UTC, so no
 *  timezone shifts the day. */
function dayNum(d: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((d ?? "").trim());
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

/** The yyyy-mm-dd for a whole-days-since-epoch number — the inverse of dayNum,
 *  in UTC, so the date a bucket is labelled with never drifts with a timezone. */
function dateFromDayNum(dn: number): string | null {
  if (!Number.isFinite(dn)) return null;
  return new Date(dn * 86_400_000).toISOString().slice(0, 10);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:00–HH:00" for an absolute hour index, wrapping the labels at midnight. */
function hourLabel(absHour: number): string {
  const a = ((absHour % 24) + 24) % 24;
  const b = (a + 1) % 24;
  return `${pad(a)}:00–${pad(b)}:00`;
}

/** A batch running longer than this is a stray-date data error, not a real run —
 *  cap the timeline so one badly-dated row can't ask for weeks of empty hours.
 *  Real batches span a few days, comfortably under four. */
const MAX_HOURS = 4 * 24;

/**
 * WHERE ONE SLAB SITS ON AN ABSOLUTE TIMELINE — the whole rule, in one place.
 *
 * EXPORTED BECAUSE THE KPI MUST USE THE SAME ONE. The Total Production Time
 * KPI and the Reference Sheet (productionSpan.ts) place slabs too, and until
 * 2026-09-16 both they and this chart shared a DIFFERENT rule — slabPlacement
 * .ts, which rebuilt the day from serialNumber order. When that rule was
 * replaced here, leaving the KPI on the old one would have put the headline
 * number and the chart under it back into disagreement about the same batch,
 * which is exactly what sharing a rule was meant to prevent. So the rule moved
 * rather than forked: this function is the single definition, and
 * productionSpan.ts calls it.
 *
 * Returns nulls rather than throwing: a slab with no resolvable date, or no
 * time at all, cannot be placed and is skipped by every caller.
 */
export function placeByStoredDate(slab: HourlySlab): { inAbs: number | null; outAbs: number | null } {
  // The slab's OWN stored production day — trusted, not reconstructed.
  const day = dayNum(slab.productionDate);
  if (day === null) return { inAbs: null, outAbs: null };
  const base = day * 1440;

  const inM = toMins(slab.inTime);
  const outM = toMins(slab.outTime);
  if (inM === null && outM === null) return { inAbs: null, outAbs: null };

  const inAbs = inM !== null ? base + inM : null;
  let outAbs = outM !== null ? base + outM : null;
  // Overnight: a slab whose Out precedes its In finished after midnight, so its
  // Out belongs to the NEXT day. The only date arithmetic anywhere in this rule.
  if (inAbs !== null && outAbs !== null && (outM as number) < (inM as number)) outAbs += 1440;
  return { inAbs, outAbs };
}

export function hourlyProduction(slabs: readonly HourlySlab[]): HourBucket[] {
  let winStart = Infinity; // absolute minute of the earliest In
  let winEnd = -Infinity; // absolute minute of the latest Out
  const completions: number[] = []; // absolute minute of each Out Time

  for (const slab of slabs) {
    const { inAbs, outAbs } = placeByStoredDate(slab);
    if (inAbs === null && outAbs === null) continue; // cannot be placed

    const startAbs = inAbs ?? (outAbs as number);
    winStart = Math.min(winStart, startAbs);
    if (outAbs !== null) {
      winEnd = Math.max(winEnd, outAbs);
      completions.push(outAbs);
    }
  }

  if (!Number.isFinite(winStart) && !Number.isFinite(winEnd)) return [];
  if (!Number.isFinite(winStart)) winStart = winEnd; // nothing started, only completions
  if (!Number.isFinite(winEnd)) winEnd = winStart; // started but nothing completed yet

  const startHour = Math.floor(winStart / 60);
  let endHour = Math.floor(winEnd / 60);
  // Safety cap against a stray far-off date: anchor on the batch START (the
  // earliest In, which a forward-mis-dated slab never precedes) and bound the
  // length, so a lone future-dated row can't drag the timeline across empty days.
  if (endHour - startHour > MAX_HOURS - 1) endHour = startHour + (MAX_HOURS - 1);

  const counts = new Map<number, number>();
  for (const c of completions) {
    const h = Math.floor(c / 60);
    if (h >= startHour && h <= endHour) counts.set(h, (counts.get(h) ?? 0) + 1);
  }

  const out: HourBucket[] = [];
  for (let h = startHour; h <= endHour; h++) {
    out.push({
      label: hourLabel(h),
      hour: ((h % 24) + 24) % 24,
      slabs: counts.get(h) ?? 0,
      // The day-number of an absolute hour is floor(h / 24); its calendar date is
      // the axis marker for this hour.
      date: dateFromDayNum(Math.floor(h / 24)),
    });
  }
  return out;
}
