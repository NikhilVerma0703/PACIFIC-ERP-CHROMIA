// Shift scoring — production up to Jot, on the only two axes that describe how
// good a shift was: QUANTITY (how many slabs) and QUALITY (how close to the
// ideal thickness they came).
//
// WHY THESE TWO AND NOTHING ELSE
// Downtime, OEE and uptime are not separate measures of goodness — they are
// explanations of why quantity was what it was. Scoring them alongside quantity
// pays twice for one thing. Quality is judged at JOT because that is the first
// measurement after the line: it is production's own work, before polishing can
// improve or spoil it, and it is a MEASURED number rather than a judged one.
//
// THE TWO FACTORS MULTIPLY, THEY DO NOT ADD.
// 10,000 bad slabs is worth nothing and 100 perfect slabs is a hobby. Adding
// lets a shift buy a bad axis with a good one; multiplying does not.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { canonThickness } from "@/lib/thickness";

/** Ideal MEASURED thickness at Jot, per nominal slab class.
 *  A slab leaves the line thicker than nominal and is ground down in polishing,
 *  so 3 cm is not 30 mm here — it is 34. Confirmed for 3 cm; the others follow
 *  the same +4 mm allowance and should be confirmed before anyone is paid. */
export const IDEAL_MM: Record<string, number> = {
  "3 cm": 34,
  "2 cm": 24,
  "1.2 cm": 16,
};

/** Deviation (mm) at which the quality score reaches zero; inside the band the
 *  score falls off linearly (34.0 -> 100%, 36.0 -> 50%, 38.0 -> 0% at tol 4).
 *
 *  CALIBRATION, NOT A GUESS. The line currently averages 36.9 mm on 3 cm. At a
 *  ±2 mm band that is already zero, so every shift scored nothing and the whole
 *  scoreboard read 1% — an incentive nobody can earn is one nobody plays. 4 mm
 *  puts today's output around 27% and makes each millimetre of improvement
 *  visibly worth money, which is the behaviour this is meant to buy. Tighten it
 *  as the line gets closer to target. */
export const TOLERANCE_MM = 4;

/** Readings outside this are physically impossible and are data-entry errors
 *  (the live data holds a 3.3 mm and a 267 mm on slabs declared 3 cm / 2 cm).
 *  Scoring them would let one typo wipe out a shift, so they are dropped and
 *  counted separately instead. */
const MIN_PLAUSIBLE_MM = 5;
const MAX_PLAUSIBLE_MM = 60;

const IST_MIN = 330;
const SHIFT_START: Record<ShiftLetter, number> = { A: 6, B: 14, C: 22 };
export type ShiftLetter = "A" | "B" | "C";

export const plusDay = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** UTC span of one shift instance (anchor = the IST date the shift STARTED). */
export function shiftRange(anchor: string, shift: ShiftLetter) {
  const istStart = new Date(`${anchor}T${String(SHIFT_START[shift]).padStart(2, "0")}:00:00.000Z`);
  const start = new Date(istStart.getTime() - IST_MIN * 60_000);
  return { start, end: new Date(start.getTime() + 8 * 3600_000) };
}

export interface ShiftScore {
  anchor: string;
  shift: ShiftLetter;
  /** Slabs measured at Jot in this shift's window — the quantity axis. */
  quantity: number;
  /** 0–1. Mean per-slab closeness to the ideal thickness — the quality axis. */
  quality: number | null;
  /** Slabs that carried BOTH a class and a usable reading, i.e. the ones the
   *  quality number is actually built from. */
  measured: number;
  /** Readings thrown out as impossible. Surfaced so a shift can see WHY its
   *  measured count is lower than its quantity. */
  discarded: number;
  /** quantity x quality. Null quality (nothing measured) scores 0, not the
   *  quantity — an unmeasured shift must never outrank a measured one. */
  points: number;
  /** Mean measured thickness, for the report. */
  avgMm: number | null;
  /** People named on this shift's MIS rows — they share the score. */
  people: string[];
}

/** Per-slab closeness to ideal: 1.0 exactly on target, 0 at the tolerance edge. */
export function slabQuality(measuredMm: number, ideal: number, tol = TOLERANCE_MM): number {
  const dev = Math.abs(measuredMm - ideal);
  return Math.max(0, 1 - dev / tol);
}

/** Score one shift instance. */
export async function scoreShift(anchor: string, shift: ShiftLetter): Promise<ShiftScore> {
  const { start, end } = shiftRange(anchor, shift);
  const empty: ShiftScore = {
    anchor, shift, quantity: 0, quality: null, measured: 0, discarded: 0,
    points: 0, avgMm: null, people: [],
  };
  try {
    const rows: any[] = await (prisma as any).jot.findMany({
      where: {
        OR: [
          { createdTime: { gte: start, lt: end } },
          { AND: [{ createdTime: null }, { date: { gte: start, lt: end } }] },
        ],
      },
      select: {
        thickness: true,
        thicknessAt1: true, thicknessAt2: true, thicknessAt3: true, thicknessAt4: true,
        thicknessAt5: true, thicknessAt6: true, thicknessAt7: true, thicknessAt8: true,
      },
    });

    let qSum = 0, measured = 0, discarded = 0, mmSum = 0;
    for (const r of rows) {
      const ideal = IDEAL_MM[canonThickness(r.thickness) ?? ""];
      if (!ideal) continue; // no declared class -> no ideal to judge against
      const pts = [r.thicknessAt1, r.thicknessAt2, r.thicknessAt3, r.thicknessAt4,
                   r.thicknessAt5, r.thicknessAt6, r.thicknessAt7, r.thicknessAt8]
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      if (!pts.length) continue;
      const good = pts.filter((n) => n >= MIN_PLAUSIBLE_MM && n <= MAX_PLAUSIBLE_MM);
      discarded += pts.length - good.length;
      if (!good.length) continue;
      const mean = good.reduce((a, b) => a + b, 0) / good.length;
      qSum += slabQuality(mean, ideal);
      mmSum += mean;
      measured += 1;
    }

    const quality = measured ? qSum / measured : null;
    const people = await peopleOnShift(anchor, shift);
    return {
      anchor, shift,
      quantity: rows.length,
      quality,
      measured,
      discarded,
      avgMm: measured ? Math.round((mmSum / measured) * 100) / 100 : null,
      points: Math.round(rows.length * (quality ?? 0)),
      people,
    };
  } catch {
    return empty;
  }
}

/** Who was named on this shift — the closest thing to a roster the ERP holds.
 *  Production / electrical / mechanical incharge on the shift's MIS rows.
 *  A real ShiftTeam roster would replace this; until one exists these are the
 *  only names attributable to a shift. */
async function peopleOnShift(anchor: string, shift: ShiftLetter): Promise<string[]> {
  const { start, end } = shiftRange(anchor, shift);
  try {
    const rows: any[] = await (prisma as any).mis.findMany({
      where: {
        OR: [
          { dateAndTime: { gte: start, lt: end } },
          { AND: [{ dateAndTime: null }, { date: { gte: start, lt: end } }] },
        ],
      },
      select: {
        productionInchargeName: true, electricalInchargeName: true,
        mechanicalInchargeName: true, submittedBy: true,
      },
    });
    const set = new Set<string>();
    for (const r of rows) {
      for (const v of [r.productionInchargeName, r.electricalInchargeName, r.mechanicalInchargeName]) {
        // multi-select incharges are stored comma-joined in one text column
        for (const name of String(v ?? "").split(",")) {
          const n = name.trim();
          if (n) set.add(n);
        }
      }
      if (!r.productionInchargeName && r.submittedBy) set.add(String(r.submittedBy).trim());
    }
    return [...set].filter(Boolean).sort();
  } catch {
    return [];
  }
}

export interface PersonScore {
  person: string;
  shifts: number;
  quantity: number;
  points: number;
  /** Points-weighted mean quality across the shifts this person was on. */
  quality: number | null;
  /** Share of the period's total points — what a salary-percentage payout scales to. */
  share: number;
}

export interface ScoreboardData {
  from: string;
  to: string;
  shifts: ShiftScore[];
  people: PersonScore[];
  totals: { quantity: number; points: number; measured: number; discarded: number; quality: number | null };
}

/** Every shift instance between two IST dates, scored, plus the per-person roll-up. */
export async function scoreRange(from: string, to: string, maxDays = 31): Promise<ScoreboardData> {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < maxDays; d = plusDay(d, 1)) days.push(d);
  const letters: ShiftLetter[] = ["A", "B", "C"];
  const now = new Date();

  const scored = await Promise.all(
    days.flatMap((d) => letters.map(async (l) => {
      // skip shifts that have not started yet
      if (shiftRange(d, l).start > now) return null;
      return scoreShift(d, l);
    })),
  );
  const shifts = scored.filter((s): s is ShiftScore => s !== null && s.quantity > 0);

  // Each person on a shift carries that shift's whole score: production is a
  // team result, so the team shares one number rather than splitting it.
  const byPerson = new Map<string, { shifts: number; quantity: number; points: number; qNum: number; qDen: number }>();
  for (const s of shifts) {
    for (const p of s.people) {
      const e = byPerson.get(p) ?? { shifts: 0, quantity: 0, points: 0, qNum: 0, qDen: 0 };
      e.shifts += 1;
      e.quantity += s.quantity;
      e.points += s.points;
      if (s.quality != null) { e.qNum += s.quality * s.measured; e.qDen += s.measured; }
      byPerson.set(p, e);
    }
  }
  const totalPoints = [...byPerson.values()].reduce((a, e) => a + e.points, 0);
  const people: PersonScore[] = [...byPerson.entries()]
    .map(([person, e]) => ({
      person,
      shifts: e.shifts,
      quantity: e.quantity,
      points: e.points,
      quality: e.qDen ? e.qNum / e.qDen : null,
      share: totalPoints ? e.points / totalPoints : 0,
    }))
    .sort((a, b) => b.points - a.points);

  const measured = shifts.reduce((a, s) => a + s.measured, 0);
  const qNum = shifts.reduce((a, s) => a + (s.quality ?? 0) * s.measured, 0);
  return {
    from, to, shifts,
    people,
    totals: {
      quantity: shifts.reduce((a, s) => a + s.quantity, 0),
      points: shifts.reduce((a, s) => a + s.points, 0),
      measured,
      discarded: shifts.reduce((a, s) => a + s.discarded, 0),
      quality: measured ? qNum / measured : null,
    },
  };
}
