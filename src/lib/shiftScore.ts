// Shift scoring — production, on the only two axes that describe how good a
// shift was: QUANTITY (how many slabs it pressed) and QUALITY (what QC finally
// graded those same slabs).
//
// WHY THESE TWO AND NOTHING ELSE
// Downtime, OEE and uptime are not separate measures of goodness — they are
// explanations of why quantity was what it was. Scoring them alongside quantity
// pays twice for one thing.
//
// WHICH SLABS BELONG TO A SHIFT — THE MIS ENTRY DECIDES, NOT THE CLOCK
// A shift owns the slabs its own MIS rows declare, via the starting/ending slab
// numbers the incharge enters each hour. That is a human statement of "these are
// ours", made by the same person the score is attributed to, and the hours tile
// cleanly: 152207-152211, 152212-152219, 152220-152230 ... with no overlap.
//
// Inferring it from press timestamps instead was wrong twice over. It asked the
// clock a question only the operator can answer, and press.createdTime survives
// on 19 of 6,013 rows so the fallback did the work — importedAt, which lands on
// average 9.4 h after the slab was pressed and therefore inside a later shift.
//
// Press timestamps remain the fallback for hours where no range was entered, so
// a shift that produced but skipped the range boxes is not scored at zero.
//
// WHY QUALITY COMES FROM QC, AND WHY IT FOLLOWS THE SLAB
// Quality is the QC grade of the slabs THIS SHIFT PRESSED, traced by slab
// number — not the grades recorded during the shift's own hours. Polishing runs
// days behind the press, so grading by clock window would score whatever
// polishing happened to finish that night, which is a different shift's work
// entirely. Tracing the slab is the only way the number answers "how good was
// what WE made".
//
// It replaced Jot thickness because coverage decides whether a metric is fair:
// QC grades reach ~89% of pressed slabs, Jot thickness ~20%. A shift measured on
// a fifth of its output is not being judged on the same basis as one measured on
// most of it. Thickness is still reported, as information, but is not scored.
//
// THE TWO FACTORS MULTIPLY, THEY DO NOT ADD.
// 10,000 bad slabs is worth nothing and 100 perfect slabs is a hobby. Adding
// lets a shift buy a bad axis with a good one; multiplying does not.
//
// LAG: a slab pressed near the end of a period may not be graded yet. Such
// slabs are excluded from quality (never counted as bad), and `ungraded` is
// reported so a thin, early-looking score is visibly incomplete rather than
// quietly wrong.
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

/** Grade -> quality credit. A is the saleable target, B is usable but worth
 *  less, C is a reject and earns nothing. Anything else (CTS, Printing,
 *  "Not graded yet") is not a verdict on production and is excluded entirely
 *  rather than scored as zero. */
/** The grade share every shift already clears. Quality is scored on the distance
 *  ABOVE this, not from zero.
 *
 *  WHY. Raw grade share does not discriminate: in July every shift landed
 *  between 93.6% and 98.0%, so the quality factor was ~0.95 for everyone and the
 *  ranking collapsed into pure quantity — the second axis was decorative. C
 *  grades are only ~3% of output, so there is simply not much room below 100%.
 *  Rescaling against a 90% floor turns that 4-point spread into a 44-point one
 *  (93.6% -> 36%, 98.0% -> 80%), so quality decides places again. A shift below
 *  the floor scores zero on quality and therefore zero points, which is the
 *  intended cliff. */
export const QUALITY_FLOOR = 0.9;

/** Raw grade share -> scored quality, stretched against the floor. */
export function scaleQuality(raw: number | null): number | null {
  if (raw == null) return null;
  return Math.max(0, Math.min(1, (raw - QUALITY_FLOOR) / (1 - QUALITY_FLOOR)));
}

export function gradeCredit(grade: string | null | undefined): number | null {
  const g = String(grade ?? "").trim().toUpperCase();
  if (!g || g.startsWith("NOT GRADED")) return null;
  if (g.startsWith("A")) return 1;      // A and A2
  if (g.startsWith("B")) return 0.5;
  if (g.startsWith("C")) return 0;      // "C" / "C (Reject)"
  return null;
}

export interface ShiftScore {
  anchor: string;
  shift: ShiftLetter;
  /** Slabs this shift PRESSED — the quantity axis. */
  quantity: number;
  /** 0–1 SCORED quality: the raw grade share stretched above QUALITY_FLOOR. */
  quality: number | null;
  /** The unstretched grade share (A=1, B=0.5, C=0), for reporting. */
  rawQuality: number | null;
  /** How many of the shift's slabs QC has graded — what quality is built from. */
  graded: number;
  /** Pressed but not yet graded. Excluded from quality, never counted as bad. */
  ungraded: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  /** quantity x quality. No grades yet scores 0, not the quantity — an
   *  unmeasured shift must never outrank a measured one. */
  points: number;
  /** Mean measured thickness at Jot for this shift's slabs. Reported only;
   *  it does not enter the score. */
  avgMm: number | null;
  /** People named on this shift's MIS rows — they share the score. Kept per
   *  ROLE: a production incharge runs the shift, whereas electrical and
   *  mechanical cover the plant and are often named on several shifts at once,
   *  so ranking them in one list compares jobs that are not the same job. */
  people: string[];
  crew: { production: string[]; electrical: string[]; mechanical: string[] };
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
    anchor, shift, quantity: 0, quality: null, rawQuality: null, graded: 0, ungraded: 0,
    gradeA: 0, gradeB: 0, gradeC: 0, points: 0, avgMm: null, people: [],
    crew: { production: [], electrical: [], mechanical: [] },
  };
  try {
    // What this shift made.
    // 1) What the shift's OWN MIS rows claim, hour by hour.
    const mis: any[] = await (prisma as any).mis.findMany({
      where: {
        OR: [
          { dateAndTime: { gte: start, lt: end } },
          { AND: [{ dateAndTime: null }, { date: { gte: start, lt: end } }] },
        ],
      },
      select: { startingSlabNumber: true, endingSlabNumber: true },
    });
    const declared = new Set<number>();
    let declaredHours = 0;
    for (const r of mis) {
      const a = Number(r.startingSlabNumber), b = Number(r.endingSlabNumber);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b < a) continue;
      // A typo'd range must not swallow the month; an hour cannot make 2,000.
      if (b - a > 500) continue;
      declaredHours += 1;
      for (let n = a; n <= b; n++) declared.add(n);
    }

    // 2) Only where nothing was declared, fall back to the press clock, so an
    //    hour logged without the range boxes still counts something.
    let slabs = [...declared];
    if (!declaredHours) {
      const pressed: any[] = await (prisma as any).press.findMany({
        where: {
          slabNumber: { not: null },
          OR: [
            { date: { gte: start, lt: end } },
            { AND: [{ date: null }, { createdTime: { gte: start, lt: end } }] },
          ],
        },
        select: { slabNumber: true },
      });
      slabs = [...new Set(pressed.map((r) => Number(r.slabNumber)).filter(Number.isFinite))];
    }
    if (!slabs.length) {
      const crew0 = await crewOnShift(anchor, shift);
      return { ...empty, crew: crew0, people: [...new Set([...crew0.production, ...crew0.electrical, ...crew0.mechanical])].sort() };
    }

    // How QC finally graded those same slabs. Chunked: Postgres caps a
    // statement at 32767 bind parameters and a busy shift can press hundreds,
    // but a month of shifts scored in one page would exceed it unguarded.
    const CHUNK = 5000;
    const qc: any[] = [];
    for (let i = 0; i < slabs.length; i += CHUNK) {
      qc.push(...await (prisma as any).polishQc.findMany({
        where: { slabNumber: { in: slabs.slice(i, i + CHUNK) } },
        select: { slabNumber: true, qualityGrade: true, createdTime: true, importedAt: true },
      }));
    }
    // Newest verdict per slab — a re-graded slab reports its latest outcome.
    const stamp = (q: any) => new Date(q.createdTime ?? q.importedAt ?? 0).getTime();
    qc.sort((a, b) => stamp(b) - stamp(a));
    const latest = new Map<number, any>();
    for (const q of qc) if (q.slabNumber != null && !latest.has(Number(q.slabNumber))) latest.set(Number(q.slabNumber), q);

    let credit = 0, graded = 0, a = 0, b = 0, c = 0;
    for (const sn of slabs) {
      const g = latest.get(sn)?.qualityGrade;
      const cr = gradeCredit(g);
      if (cr == null) continue;      // ungraded / CTS / Printing — not a verdict
      graded += 1; credit += cr;
      const u = String(g).trim().toUpperCase();
      if (u.startsWith("A")) a += 1; else if (u.startsWith("B")) b += 1; else c += 1;
    }

    // Raw share kept for the report; the SCORED quality is stretched above the floor.
    const rawQuality = graded ? credit / graded : null;
    const quality = scaleQuality(rawQuality);
    const [crew, avgMm] = await Promise.all([
      crewOnShift(anchor, shift),
      avgThicknessFor(slabs),
    ]);
    const people = [...new Set([...crew.production, ...crew.electrical, ...crew.mechanical])].sort();
    return {
      anchor, shift,
      quantity: slabs.length,
      quality,
      rawQuality,
      graded,
      ungraded: slabs.length - graded,
      gradeA: a, gradeB: b, gradeC: c,
      avgMm,
      points: Math.round(slabs.length * (quality ?? 0)),
      people, crew,
    };
  } catch {
    return empty;
  }
}

/** Mean measured thickness at Jot for a set of slabs — reported, not scored.
 *  Impossible readings (the data holds a 3.3 mm and a 267 mm) are dropped so a
 *  single typo cannot move a shift's headline number. */
async function avgThicknessFor(slabs: number[]): Promise<number | null> {
  if (!slabs.length) return null;
  try {
    const rows: any[] = [];
    for (let i = 0; i < slabs.length; i += 5000) {
      rows.push(...await (prisma as any).jot.findMany({
        where: { slabNumber: { in: slabs.slice(i, i + 5000) }, thicknessAt1: { not: null } },
        select: {
          thicknessAt1: true, thicknessAt2: true, thicknessAt3: true, thicknessAt4: true,
          thicknessAt5: true, thicknessAt6: true, thicknessAt7: true, thicknessAt8: true,
        },
      }));
    }
    let sum = 0, n = 0;
    for (const r of rows) {
      const pts = [r.thicknessAt1, r.thicknessAt2, r.thicknessAt3, r.thicknessAt4,
                   r.thicknessAt5, r.thicknessAt6, r.thicknessAt7, r.thicknessAt8]
        .map(Number)
        .filter((x) => Number.isFinite(x) && x >= MIN_PLAUSIBLE_MM && x <= MAX_PLAUSIBLE_MM);
      if (!pts.length) continue;
      sum += pts.reduce((x, y) => x + y, 0) / pts.length;
      n += 1;
    }
    return n ? Math.round((sum / n) * 100) / 100 : null;
  } catch { return null; }
}

/** One spelling per person.
 *
 *  Names are free text on the MIS form, so the same person arrives in several
 *  forms and the board showed them as separate people with separate scores —
 *  "SURESH" appeared beside "Suresh" with 1 shift against his 187 rows. Case and
 *  spacing are folded here; genuine misspellings (Sundhar for Sundar, Josep for
 *  Joseph) still need the alias map below, because no rule can safely guess
 *  that two different spellings are the same human. */
const PERSON_ALIAS: Record<string, string> = {
  // lower-cased variant -> canonical spelling
  sundhar: "Sundar",
  josep: "Joseph",
};

export function canonPerson(raw: unknown): string {
  const t = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const key = t.toLowerCase();
  if (PERSON_ALIAS[key]) return PERSON_ALIAS[key];
  // Title Case so "SURESH" and "suresh" land on the same display name.
  return t.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** Who was named on this shift — the closest thing to a roster the ERP holds.
 *  Production / electrical / mechanical incharge on the shift's MIS rows.
 *  A real ShiftTeam roster would replace this; until one exists these are the
 *  only names attributable to a shift. */
async function crewOnShift(anchor: string, shift: ShiftLetter): Promise<ShiftScore["crew"]> {
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
    const prod = new Set<string>(), elec = new Set<string>(), mech = new Set<string>();
    // multi-select incharges are stored comma-joined in one text column
    const add = (set: Set<string>, v: unknown) => {
      for (const name of String(v ?? "").split(",")) { const n = canonPerson(name); if (n) set.add(n); }
    };
    for (const r of rows) {
      add(prod, r.productionInchargeName);
      add(elec, r.electricalInchargeName);
      add(mech, r.mechanicalInchargeName);
      if (!r.productionInchargeName) add(prod, r.submittedBy);
    }
    const srt = (x: Set<string>) => [...x].filter(Boolean).sort();
    return { production: srt(prod), electrical: srt(elec), mechanical: srt(mech) };
  } catch {
    return { production: [], electrical: [], mechanical: [] };
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

export type CrewRole = "production" | "electrical" | "mechanical";

export interface ScoreboardData {
  from: string;
  to: string;
  shifts: ShiftScore[];
  /** Ranked separately per role — see ShiftScore.crew for why. */
  byRole: Record<CrewRole, PersonScore[]>;
  people: PersonScore[];
  totals: { quantity: number; points: number; graded: number; ungraded: number; quality: number | null };
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
  // Keep a shift that recorded a TEAM even if it pressed nothing: dropping it
  // erased those people from the board entirely, which read as "they did not
  // work" rather than "they worked and produced nothing".
  const shifts = scored.filter((s): s is ShiftScore => s !== null && (s.quantity > 0 || s.people.length > 0));

  // Each person on a shift carries that shift's whole score: production is a
  // team result, so the team shares one number rather than splitting it.
  const roll = (pick: (s: ShiftScore) => string[]): PersonScore[] => {
    const m = new Map<string, { shifts: number; quantity: number; points: number; qNum: number; qDen: number }>();
    for (const s of shifts) {
      for (const p of pick(s)) {
        const e = m.get(p) ?? { shifts: 0, quantity: 0, points: 0, qNum: 0, qDen: 0 };
        e.shifts += 1; e.quantity += s.quantity; e.points += s.points;
        if (s.quality != null) { e.qNum += s.quality * s.graded; e.qDen += s.graded; }
        m.set(p, e);
      }
    }
    const tot = [...m.values()].reduce((a, e) => a + e.points, 0);
    return [...m.entries()]
      .map(([person, e]) => ({ person, shifts: e.shifts, quantity: e.quantity, points: e.points,
        quality: e.qDen ? e.qNum / e.qDen : null, share: tot ? e.points / tot : 0 }))
      .sort((a, b) => b.points - a.points);
  };
  const byRole = {
    production: roll((s) => s.crew.production),
    electrical: roll((s) => s.crew.electrical),
    mechanical: roll((s) => s.crew.mechanical),
  };

  const byPerson = new Map<string, { shifts: number; quantity: number; points: number; qNum: number; qDen: number }>();
  for (const s of shifts) {
    for (const p of s.people) {
      const e = byPerson.get(p) ?? { shifts: 0, quantity: 0, points: 0, qNum: 0, qDen: 0 };
      e.shifts += 1;
      e.quantity += s.quantity;
      e.points += s.points;
      if (s.quality != null) { e.qNum += s.quality * s.graded; e.qDen += s.graded; }
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

  const graded = shifts.reduce((a, s) => a + s.graded, 0);
  const qNum = shifts.reduce((a, s) => a + (s.quality ?? 0) * s.graded, 0);
  return {
    from, to, shifts,
    byRole,
    people,
    totals: {
      quantity: shifts.reduce((a, s) => a + s.quantity, 0),
      points: shifts.reduce((a, s) => a + s.points, 0),
      graded,
      ungraded: shifts.reduce((a, s) => a + s.ungraded, 0),
      quality: graded ? qNum / graded : null,
    },
  };
}
