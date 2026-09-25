/**
 * Reference Sheet — the pure part.
 *
 * The Downloads "Reference Sheet" section takes ONE Design Name, finds the
 * design's latest production batch and shows a one-page summary to check before
 * running that design again. The decisions in that flow that have to be exactly
 * right are kept here, away from Prisma, so `node --test` can reach them:
 *
 *   1. WHICH designs count as the same design — designMatchKey(). By name only,
 *      NOT thickness, and NOT capitalisation: "calcatta gold", "CALCATTA GOLD"
 *      and "Calcatta Gold 2 cm" are one design.
 *
 *   2. WHICH batch is the latest — latestProduced(): the batch of the most
 *      recently produced slab of that design.
 *
 *   3. The Robot Delays — isRobotDelayCode() picks them out by code (C1…C20),
 *      robotDelaysByDuration() groups them by code and orders them by total
 *      duration, longest first, and robotDelayPie() chooses the pie's slices.
 *
 * WHAT IS NOT HERE, ON PURPOSE: the four production figures (Total Slabs
 * Produced, Total Production Time, Total Delays, Avg Slabs/hour). The sheet takes
 * those straight from the Reports calculation for the batch
 * (lib/robo/reportSummary.ts) — owner's requirement 2026-09-25 — so it has no
 * arithmetic of its own to drift. It used to: an Avg Slabs/hour with delays
 * subtracted, over a narrower set of slabs than Reports counted. That formula is
 * gone rather than kept unused, so nothing can wire it back in by accident.
 */

/**
 * The design's identity for matching: its name with a trailing thickness removed,
 * lower-cased and whitespace-collapsed. So "Costa 2 cm", "Costa 3cm" and "costa"
 * all key as "costa", while "Bellagio Green" and "Bellagio Grey" stay apart
 * (neither ends in a thickness, so nothing is stripped).
 *
 * Only a thickness token is removed, and only at the END: a number followed by
 * cm or mm (with optional space and an optional trailing dot). A name that merely
 * ends in a number ("Statuario 5") keeps it — that is not a thickness and dropping
 * it would merge two real designs. Matching is case- and space-insensitive because
 * a design typed by hand is not a database key: one batch can carry setups typed
 * "calcatta gold" and "CALCATTA GOLD", and they are the same design.
 */
export function designMatchKey(name: string | null | undefined): string {
  return (name ?? "")
    // drop a trailing thickness like "2 cm", "3cm", "20 mm", "18mm."
    .replace(/\s*\d+(?:\.\d+)?\s*(?:cm|mm)\.?\s*$/i, "")
    // tidy any separator the strip left dangling ("Costa -" → "Costa")
    .replace(/[\s\-_]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Is this a Robot delay code? Robot delays are the "G — Robot Delays" master
 * section, whose codes all run C1…C20. We identify them by the CODE (starts with
 * C followed by a digit), not by the stored `category`: on old/imported rows the
 * category was left blank or inconsistent, which is why the Reference Sheet's
 * Robot Delays row was coming out empty even when C-code delays had occurred.
 * The code is the reliable signal — every non-robot section uses a different
 * letter (RM/L/D/S/P/M/G/T), so a leading "C<digit>" is unambiguous.
 */
export function isRobotDelayCode(code: string | null | undefined): boolean {
  return /^\s*C\d/i.test(code ?? "");
}

/* ── the latest production ──────────────────────────────────────────────── */

/** When a slab was produced, reduced to what "latest" compares. */
export interface WhenProduced {
  /** yyyy-mm-dd (productionDateOf), or "" when unknown — which sorts first. */
  productionDate: string;
  /** "HH:MM", or null. */
  inTime: string | null;
  /** Insertion time in ms — the last tiebreak, the order the register was typed. */
  createdAtMs: number;
}

/** Orders two slabs by when they were produced: production date, then In
 *  time, then the order they were entered — the precedence the register sorts
 *  by. Negative when `a` came first. */
export function compareProduced(a: WhenProduced, b: WhenProduced): number {
  if (a.productionDate !== b.productionDate) return a.productionDate < b.productionDate ? -1 : 1;
  const ia = a.inTime ?? "";
  const ib = b.inTime ?? "";
  if (ia !== ib) return ia < ib ? -1 : 1;
  return a.createdAtMs - b.createdAtMs;
}

/** The most recently produced slab of a set, or null for an empty set. Its
 *  batch is the design's latest production batch. */
export function latestProduced<T extends WhenProduced>(slabs: readonly T[]): T | null {
  let latest: T | null = null;
  for (const s of slabs) if (latest === null || compareProduced(s, latest) > 0) latest = s;
  return latest;
}

/* ── robot delays ───────────────────────────────────────────────────────── */

/** The trailing number of a delay code ("C13" → 13), for the tiebreak between
 *  two codes of equal duration. */
export function delayCodeNumber(code: string): number {
  const m = /(\d+)\s*$/.exec(code);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** "Robo4" → 4, so the Robos responsible list in machine order. */
function roboNumber(label: string): number {
  const m = /(\d+)/.exec(label);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** One logged delay, reduced to what the Robot Delays table reads. */
export interface RobotDelayInput {
  code: string;
  description: string;
  category: string | null;
  /** The delay's stored duration in minutes. */
  minutes: number;
  /** The Robos it was logged against, already labelled (Robo1…Robo4). */
  robos: readonly string[];
}

export interface RobotDelayRow {
  code: string;
  description: string;
  /** Every Robo responsible across all entries of this code, in machine order. */
  robos: string[];
  /** Combined duration of every entry of this code, in minutes. */
  minutes: number;
  /** How many times the delay was logged. */
  events: number;
}

/**
 * The Robot Delays of a batch, ONE ROW PER CODE: a code logged on several slabs
 * is one row with its durations summed (the same per-code summing Reports'
 * delayTypesByCode does, so these rows add up the same way Total Delays does),
 * its log entries counted and its Robos unioned.
 *
 * Ordered by TOTAL DURATION, LONGEST FIRST (owner's instruction 2026-09-25:
 * C5 30 min, then C1 25 min, then C8 20 min — not C1, C5, C8). Equal durations
 * fall back to code order (C1 before C5) so the table never reshuffles between
 * loads.
 */
export function robotDelaysByDuration(delays: readonly RobotDelayInput[]): RobotDelayRow[] {
  const byCode = new Map<string, { row: RobotDelayRow; robos: Set<string> }>();
  for (const d of delays) {
    if (!isRobotDelayCode(d.code) && d.category !== "ROBOT") continue;
    let entry = byCode.get(d.code);
    if (!entry) {
      entry = { row: { code: d.code, description: d.description, robos: [], minutes: 0, events: 0 }, robos: new Set() };
      byCode.set(d.code, entry);
    }
    entry.row.minutes += Number.isFinite(d.minutes) ? d.minutes : 0;
    entry.row.events += 1;
    for (const r of d.robos) if (r) entry.robos.add(r);
  }
  return [...byCode.values()]
    .map(({ row, robos }) => ({ ...row, robos: [...robos].sort((a, b) => roboNumber(a) - roboNumber(b)) }))
    .sort((a, b) => b.minutes - a.minutes || delayCodeNumber(a.code) - delayCodeNumber(b.code) || a.code.localeCompare(b.code));
}

/* ── the robot delay pie ────────────────────────────────────────────────── */

/** At most this many slices — the owner's "Top 3". */
export const PIE_MAX_SLICES = 3;

export interface PieSlice {
  code: string;
  description: string;
  minutes: number;
  /** Share of the slices shown, one decimal — the pie is always a whole circle. */
  pct: number;
}

export interface RobotDelayPie {
  /** One slice per delay type when there are up to three; the three longest
   *  when there are more. Longest first. */
  slices: PieSlice[];
  /** How many robot delay types occurred (with any duration). */
  totalTypes: number;
  /** The shown slices' share of ALL robot delay time, one decimal — 100 unless
   *  the pie was cut to the top three. Lets the screen say how much the pie
   *  covers without adding an "Other" slice the owner did not ask for. */
  coveragePct: number;
}

/**
 * The pie of a batch's robot delays: 1 type → 1 slice, 2 → 2, 3 → 3, more → the
 * three with the longest total duration (the table still lists every one).
 * A slice's percentage is its share of the SLICES SHOWN, so the circle is whole;
 * `coveragePct` says what share of all robot delay time those slices are.
 * Delay types with no recorded duration cannot be a slice and are left out.
 */
export function robotDelayPie(
  rows: readonly { code: string; description: string; minutes: number }[],
  max: number = PIE_MAX_SLICES,
): RobotDelayPie {
  const withTime = rows
    .filter((r) => Number.isFinite(r.minutes) && r.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || delayCodeNumber(a.code) - delayCodeNumber(b.code) || a.code.localeCompare(b.code));
  const shown = withTime.slice(0, Math.max(0, max));
  const shownTotal = shown.reduce((s, r) => s + r.minutes, 0);
  const allTotal = withTime.reduce((s, r) => s + r.minutes, 0);
  return {
    slices: shown.map((r) => ({
      code: r.code,
      description: r.description,
      minutes: r.minutes,
      pct: shownTotal ? round1((100 * r.minutes) / shownTotal) : 0,
    })),
    totalTypes: withTime.length,
    coveragePct: allTotal ? round1((100 * shownTotal) / allTotal) : 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
