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
// THERE IS NO TIMESTAMP FALLBACK. An hour with no slab range claims nothing.
// Press timestamps were tried and are not fit for it: the same 79 slabs are
// stamped ~19 h apart by MIS and press, and the oven stamps them BEFORE the
// press that feeds it. The stations agree on WHAT was made and disagree on
// WHEN, so a declared range is the only trustworthy claim. Scoring an
// undeclared hour off those clocks would credit the wrong shift.
//
// A slab claimed by two shifts is dropped from BOTH. Paying it twice is wrong,
// and picking a winner would be arbitrary — it is surfaced instead so the entry
// gets corrected.
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
// THE TWO AXES SPLIT THE POOL — THEY NO LONGER MULTIPLY.
// They used to. Volume x a quality share measured from 90% multiplies out to
// exactly `A - 4B - 9C`, so one more Grade-A slab was worth +1 and one more C
// was worth -9. The most profitable move available to a shift was to leave its
// bad slabs out of MIS, nine times more profitable than pressing a good one —
// while the notice on the wall told the floor to record everything.
//
// So the pool is split instead: 70% follows GOOD SLABS (A = 1, B = 0.5, C = 0)
// and 30% follows the quality score. A bad slab is now worth exactly zero,
// never less, so there is nothing to gain by hiding it — and quality still
// decides real money rather than being decorative. See POOL_VOLUME.
//
// LAG: a slab pressed near the end of a period may not be graded yet. Such
// slabs are excluded from quality (never counted as bad), and `ungraded` is
// reported so a thin, early-looking score is visibly incomplete rather than
// quietly wrong.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
export * from "@/lib/shiftScoreMath";
import {
  IDEAL_MM, TOLERANCE_MM, MIN_PLAUSIBLE_MM, MAX_PLAUSIBLE_MM, MAX_SLABS_PER_HOUR,
  IST_MIN, NOT_OPERATORS, MIN_ROWS_TO_RANK_STATION, MIN_SHIFTS_TO_RANK,
  POOL_VOLUME, POOL_QUALITY, credibility, shiftWeight,
  shiftRange, shiftKeyOf, canonPerson, gradeCredit, polishCredit,
  stdMultiplier,
  scaleQuality, scalePolish, scaleUptime, plusDay, type ShiftLetter,
  oeeTotal, misDiscipline, type Oee,
} from "@/lib/shiftScoreMath";


/** One MIS row that needs a human to correct it, with everything the banner
 *  needs to name it and link to it. */
export interface FlaggedRow {
  id: string;
  anchor: string;
  shift: ShiftLetter;
  date: string | null;
  hour: string | null;
  incharge: string | null;
  start: number | null;
  end: number | null;
  /** "disputed" — some of its slabs are claimed by another shift too.
   *  "wide" — its range is too wide to be real, so the hour scores nothing. */
  reason: "disputed" | "wide";
  /** How many of this row's slabs are disputed (0 for a wide row). */
  slabs: number;
}

/** One claimed slab the score could not count yet, and why. Exposed so the
 *  month tracker (/scoreboard/incentive) lists EXACTLY the slabs scoreShift
 *  treats as ungraded rather than deriving its own — the two must not drift.
 *
 *  `verdict` separates two very different "not counted" cases: 'none' /
 *  'not-graded' is a slab genuinely waiting for QC and can still earn; 'cts' /
 *  'printing' has BEEN through QC and was routed, so it will never grade and
 *  must not be projected as future points. */
export interface OutstandingSlab {
  slab: number;
  /** 2 when the hour that claimed it ran a slow product, else 1. */
  mult: number;
  design: string | null;
  batch: string | null;
  hour: string | null;
  /** The MIS row that claimed it — /tables/Mis/{rowId} is where a typo'd range is corrected. */
  rowId: string | null;
  verdict: "none" | "not-graded" | "cts" | "printing";
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
  /** GOOD SLABS: A = 1, B = 0.5, C = 0. The volume axis, and 70% of the pool.
   *
   *  Adding a bad slab is worth exactly zero here, never negative, so there is
   *  no reason to leave one out. That is the whole point — the previous
   *  `graded x stretched quality` reduced to A - 4B - 9C and made hiding a
   *  reject nine times more profitable than pressing a good slab.
   *
   *  Only GRADED slabs count. A slab QC has not reached yet earns nothing yet
   *  and is not held against anyone; the figure rises as QC works through. */
  points: number;
  /** The plain good-slab count, BEFORE the slow-product multiplier: A = 1,
   *  B = 0.5, C = 0. This is the physical output of the shift and the figure
   *  OEE and the reports use; `points` above is what the pool pays on. */
  goodSlabs: number;
  /** How many of the graded good slabs came from an hour whose standard was
   *  10/hour or less, and so counted twice. Shown so a shift can see where the
   *  difference between goodSlabs and points came from. */
  slowSlabs: number;
  /** Mean measured thickness at Jot for this shift's slabs. Reported only;
   *  it does not enter the score. */
  avgMm: number | null;
  /** Line stoppage this shift, in minutes. MIS records breakdown as ONE column,
   *  "mechanical OR electrical" — the trades are not split in the data — so both
   *  incharges are measured on the same figure. Powerout is separated because it
   *  is unambiguously electrical. */
  breakdownMin: number;
  poweroutMin: number;
  /** MIS rows (= hours) this shift actually filed. The uptime denominator:
   *  an hour never entered is not an hour the line was running. */
  hoursLogged: number;
  /** What this shift is worth as a per-shift DIVISOR: 1 for a shift that ran
   *  clean, 0 for one the plant spent broken. Breakdown and powerout are taken
   *  out of the shift; process and cleaning delay are not. See shiftWeight. */
  weight: number;
  /** Slabs this shift claimed that ANOTHER shift also claimed. Dropped from
   *  both scores and reported so the entry gets corrected. */
  contested: number;
  /** Hours whose declared range was too wide to be real (see
   *  MAX_SLABS_PER_HOUR) and were therefore ignored. Surfaced so a typo shows
   *  up as a typo instead of as a shift that quietly produced nothing. */
  wideRows: number;
  /** The actual MIS rows behind `contested` and `wideRows`, so the banner can
   *  link straight to the hour that needs correcting instead of leaving an
   *  admin to hunt for it. `/tables/Mis/{id}` is the edit page. */
  flagged: FlaggedRow[];
  /** Claimed slabs with no countable verdict — see OutstandingSlab. */
  outstanding: OutstandingSlab[];
  /** People named on this shift's MIS rows — they share the score. Kept per
   *  ROLE: a production incharge runs the shift, whereas electrical and
   *  mechanical cover the plant and are often named on several shifts at once,
   *  so ranking them in one list compares jobs that are not the same job. */
  people: string[];
  crew: { production: string[]; electrical: string[]; mechanical: string[] };
}


/** The slabs a shift's own MIS rows declare. Cheap enough to run for a whole
 *  range before scoring, which is how double-claims are found. */
export async function claimedSlabs(anchor: string, shift: ShiftLetter): Promise<number[]> {
  const { start, end } = shiftRange(anchor, shift);
  // NO try/catch: this feeds the double-claim guard, and an empty result reads
  // as "this shift claimed nothing". A transient DB error therefore made the
  // guard fail OPEN and paid a contested slab to both shifts.
  const mis: any[] = await (prisma as any).mis.findMany({
    where: {
      OR: [
        { dateAndTime: { gte: start, lt: end } },
        { AND: [{ dateAndTime: null }, { date: { gte: start, lt: end } }] },
      ],
    },
    select: { startingSlabNumber: true, endingSlabNumber: true },
  });
  const out = new Set<number>();
  for (const r of mis) {
    const a = Number(r.startingSlabNumber), b = Number(r.endingSlabNumber);
    // >= not >, matching scoreShift exactly. The two must agree on which rows
    // are typos or the double-claim guard is built from a different set of
    // slabs than the one being scored.
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b < a || b - a >= MAX_SLABS_PER_HOUR) continue;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return [...out];
}

/** Score one shift instance. `exclude` holds slabs another shift also claimed. */
export async function scoreShift(anchor: string, shift: ShiftLetter, exclude?: Set<number>): Promise<ShiftScore> {
  const { start, end } = shiftRange(anchor, shift);
  const empty: ShiftScore = {
    anchor, shift, quantity: 0, quality: null, rawQuality: null, graded: 0, ungraded: 0,
    gradeA: 0, gradeB: 0, gradeC: 0, points: 0, goodSlabs: 0, slowSlabs: 0,
    avgMm: null, breakdownMin: 0, poweroutMin: 0,
    hoursLogged: 0, weight: 0, contested: 0, wideRows: 0, flagged: [], outstanding: [],
    people: [], crew: { production: [], electrical: [], mechanical: [] },
  };
  {
    // What this shift made.
    // 1) What the shift's OWN MIS rows claim, hour by hour.
    //
    // The three incharge columns ride along here so the crew can be derived from
    // THESE rows instead of crewOnShift() re-querying the identical window — that
    // second fetch was one more round-trip per shift instance (~90 extra queries
    // per month scoreboard, measured 2026-08-14). Same where-clause, same rows,
    // same crew; only the duplicate read is gone.
    const mis: any[] = await (prisma as any).mis.findMany({
      where: {
        OR: [
          { dateAndTime: { gte: start, lt: end } },
          { AND: [{ dateAndTime: null }, { date: { gte: start, lt: end } }] },
        ],
      },
      select: {
        id: true, date: true, hour: true, productionInchargeName: true,
        startingSlabNumber: true, endingSlabNumber: true, slabsPerHourStd: true,
        design: true, batch: true,
        breakdownDelayDurationMechanicalOrElectricalMinutes: true,
        poweroutDelayDurationMinutes: true,
        electricalInchargeName: true, mechanicalInchargeName: true,
      },
    });
    const n = (v: unknown) => Number(v ?? 0) || 0;
    const breakdownMin = mis.reduce((a, r) => a + n(r.breakdownDelayDurationMechanicalOrElectricalMinutes), 0);
    const poweroutMin = mis.reduce((a, r) => a + n(r.poweroutDelayDurationMinutes), 0);
    // Hours the shift actually filed. This is the uptime denominator: measuring
    // stoppage against a flat 8 hours paid a shift for the hours it never
    // entered, so skipping the hour the line was dead scored as perfect uptime.
    const hoursLogged = mis.length;
    const declared = new Set<number>();
    // Every flagged row carries its id, so the scoreboard banner links straight
    // to the hour that needs correcting rather than reporting a bare count and
    // leaving someone to find it by hand.
    const flagged: FlaggedRow[] = [];
    const rowOf = (r: any, reason: FlaggedRow["reason"], slabs: number): FlaggedRow => ({
      id: String(r.id), anchor, shift,
      date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
      hour: r.hour ?? null,
      incharge: r.productionInchargeName ?? null,
      start: Number.isFinite(Number(r.startingSlabNumber)) ? Number(r.startingSlabNumber) : null,
      end: Number.isFinite(Number(r.endingSlabNumber)) ? Number(r.endingSlabNumber) : null,
      reason, slabs,
    });
    let wideRows = 0;
    // Count each contested slab ONCE for the shift, not once per row that
    // covers it: two overlapping hours of the same shift used to report the
    // overlap twice and inflated the red banner.
    const contestedSlabs = new Set<number>();
    // What each slab is worth: 2 when the hour that claimed it was running a
    // product with a standard of 10 an hour or less. Kept per slab rather than
    // per row because a shift mixes designs across its eight hours.
    //
    // WHERE TWO ROWS OF ONE SHIFT CLAIM THE SAME SLAB the LOWER multiplier
    // wins. An overlap is a data-entry fault, and a fault must not be a way to
    // earn the double: the multiplier has to be unambiguously the product's.
    const multBySlab = new Map<number, number>();
    // The row whose multiplier was kept for the slab — so an outstanding slab
    // can name its design and batch. Follows the same lower-multiplier rule.
    const rowBySlab = new Map<number, any>();
    for (const r of mis) {
      const a = Number(r.startingSlabNumber), b = Number(r.endingSlabNumber);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b < a) continue;
      // A typo'd range must not swallow the month; see MAX_SLABS_PER_HOUR.
      if (b - a >= MAX_SLABS_PER_HOUR) { wideRows += 1; flagged.push(rowOf(r, "wide", 0)); continue; }
      const mult = stdMultiplier(r.slabsPerHourStd);
      let mine = 0;
      for (let n = a; n <= b; n++) {
        if (exclude?.has(n)) { contestedSlabs.add(n); mine += 1; }
        else {
          declared.add(n);
          const seen = multBySlab.get(n);
          if (seen == null || mult < seen) rowBySlab.set(n, r);
          multBySlab.set(n, seen == null ? mult : Math.min(seen, mult));
        }
      }
      if (mine) flagged.push(rowOf(r, "disputed", mine));
    }
    const contested = contestedSlabs.size;
    const slabs = [...declared];
    // Crew comes straight from the rows already in hand (see the select above) —
    // crewFromRows is the same pure derivation crewOnShift applied to its own
    // identical fetch of this window.
    const crew = crewFromRows(mis);
    if (!slabs.length) {
      return { ...empty, breakdownMin, poweroutMin, hoursLogged,
        weight: shiftWeight(hoursLogged, breakdownMin + poweroutMin, 0),
        contested, wideRows, flagged, crew,
        people: [...new Set([...crew.production, ...crew.electrical, ...crew.mechanical])].sort() };
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

    // TWO ACCUMULATORS, AND THEY MUST NOT BE CONFLATED.
    // `credit` is the plain good-slab count (A=1, B=0.5, C=0) and is what the
    // GRADE SHARE is built from — weighting it would push the share above 1 and
    // break every quality scale that reads it. `weighted` applies the slow-
    // product multiplier and is what the VOLUME pool pays on.
    let credit = 0, weighted = 0, graded = 0, a = 0, b = 0, c = 0, doubled = 0;
    const outstanding: OutstandingSlab[] = [];
    for (const sn of slabs) {
      const g = latest.get(sn)?.qualityGrade;
      const cr = gradeCredit(g);
      if (cr == null) {              // ungraded / CTS / Printing — not a verdict
        const row = rowBySlab.get(sn);
        const u = String(g ?? "").trim().toUpperCase();
        outstanding.push({
          slab: sn, mult: multBySlab.get(sn) ?? 1,
          design: row?.design ?? null, batch: row?.batch ?? null, hour: row?.hour ?? null,
          rowId: row?.id != null ? String(row.id) : null,
          verdict: !latest.has(sn) ? "none" : u === "CTS" ? "cts" : u.startsWith("PRINT") ? "printing" : "not-graded",
        });
        continue;
      }
      const mult = multBySlab.get(sn) ?? 1;
      graded += 1; credit += cr; weighted += cr * mult;
      if (mult > 1 && cr > 0) doubled += 1;
      const u = String(g).trim().toUpperCase();
      if (u.startsWith("A")) a += 1; else if (u.startsWith("B")) b += 1; else c += 1;
    }

    // Raw share kept for the report; the SCORED quality is stretched above the floor.
    const rawQuality = graded ? credit / graded : null;
    const quality = scaleQuality(rawQuality);
    const avgMm = await avgThicknessFor(slabs);
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
      // credit IS the plain good-slab count: A adds 1, B adds 0.5, C adds 0.
      goodSlabs: Math.round(credit),
      slowSlabs: doubled,
      // points is what the volume pool pays on: the same count with each slow-
      // product slab counted twice.
      points: Math.round(weighted),
      breakdownMin, poweroutMin, hoursLogged,
      weight: shiftWeight(hoursLogged, breakdownMin + poweroutMin, slabs.length),
      contested, wideRows, flagged,
      outstanding: outstanding.sort((x, y) => x.slab - y.slab),
      people, crew,
    };
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

/** Who was named on this shift — the closest thing to a roster the ERP holds.
 *  Production / electrical / mechanical incharge on the shift's MIS rows.
 *  A real ShiftTeam roster would replace this; until one exists these are the
 *  only names attributable to a shift.
 *
 *  PURE: derives the crew from MIS rows the caller already fetched for the same
 *  shift window. It used to be its own query (crewOnShift) against the identical
 *  where-clause — one extra round-trip per shift instance, ~90 per month
 *  scoreboard load (measured 2026-08-14). No try/catch anywhere on this path:
 *  a failed read must not return an empty crew — that does not mean "nobody
 *  worked", it silently deletes the shift's points from everyone who did and
 *  raises every other person's share to fill the gap. A scoreboard that pays
 *  money must fail loudly, not quietly redistribute — so the caller's fetch
 *  still throws, and this stays a pure function tests can hit without a DB. */
export function crewFromRows(rows: { productionInchargeName?: unknown; electricalInchargeName?: unknown; mechanicalInchargeName?: unknown }[]): ShiftScore["crew"] {
  const prod = new Set<string>(), elec = new Set<string>(), mech = new Set<string>();
  // multi-select incharges are stored comma-joined in one text column
  const add = (set: Set<string>, v: unknown) => {
    for (const name of String(v ?? "").split(",")) { const n = canonPerson(name); if (n) set.add(n); }
  };
  for (const r of rows) {
    add(prod, r.productionInchargeName);
    add(elec, r.electricalInchargeName);
    add(mech, r.mechanicalInchargeName);
  }
  // submittedBy is NOT a fallback for the production incharge. It holds the
  // login display name — "Incharge - Prathap", "Incharge - MA Raju",
  // "Supervisor - Sivaiah", "Administrator" — so the fallback put a second,
  // differently-spelled row on the paid board for a man already ranked as
  // "pradhap", and ranked the Administrator account alongside him. An hour that
  // names no production incharge names nobody; that gap is reported instead.
  const srt = (x: Set<string>) => [...x].filter(Boolean).sort();
  return { production: srt(prod), electrical: srt(elec), mechanical: srt(mech) };
}


export interface PersonScore {
  person: string;
  /** Shifts ATTENDED. What credibility is measured on, and what the board
   *  shows — he turned up for these however the night went. */
  shifts: number;
  /** Shifts attended, each discounted by the time its line was stopped by
   *  breakdown or powerout. THE DIVISOR behind pointsPerShift: a shift the
   *  plant spent broken counts as ~0 here, so it neither earns nor costs. */
  effectiveShifts: number;
  quantity: number;
  /** Total points across the period — shown, but NOT what decides the ranking. */
  points: number;
  /** Points per RUNNING shift — good slabs over `effectiveShifts`, not over
   *  shifts attended. THE ranking figure: 3 shifts making 300 good slabs beats
   *  10 shifts making 500, because per shift it is 100 against 50. Ranking on
   *  the total would pay for availability rather than performance; dividing by
   *  shifts attended would charge a man for the night his line was dead. */
  pointsPerShift: number;
  /** Points-weighted mean quality across the shifts this person was on. */
  quality: number | null;
  /** Enough shifts to be placed and paid. */
  qualified: boolean;
  /** Line stoppage across this person's shifts. The measure for the electrical
   *  and mechanical incharge: their job is keeping the line running, not making
   *  slabs, so slab count says nothing about how well they did it. */
  downtimeMin: number;
  downtimePerShift: number;
  /** Hours of MIS this person's shifts actually filed — the uptime denominator. */
  hoursLogged: number;
  /** 0–1, share of the LOGGED hours not lost to stoppage. The scored figure. */
  uptime: number | null;
  /** The unstretched figure behind `quality`, so the board can show both. The
   *  two differ by 10x near the floor and the difference is not cosmetic:
   *  a 96.4% grade share scores 64%. */
  rawQuality: number | null;
  /** Share of the qualified field's per-shift points — what a salary-percentage
   *  payout scales to. Unqualified people take no share. */
  share: number;
}

export type CrewRole = "production" | "electrical" | "mechanical";

/** One slab fight, ready for a ruling: the slabs, and every shift that claimed
 *  them. Grouped by the SET of claimants, so an admin decides once for the whole
 *  overlap instead of slab by slab. */
export interface Dispute {
  /** Stable id for the group — the sorted claimant keys. */
  key: string;
  slabs: number[];
  from: number;
  to: number;
  claimants: { anchor: string; shift: ShiftLetter; label: string; incharge: string | null }[];
  /** "<anchor><shift>" of the shift these slabs were awarded to, if ruled on. */
  awardedTo: string | null;
  awardedBy: string | null;
}

export interface ScoreboardData {
  from: string;
  /** The last day actually SCORED. Equals `to` unless the range was longer than
   *  maxDays, in which case it is where scoring stopped — the page must print
   *  this one, not the range that was asked for. */
  to: string;
  /** The `to` originally requested, when it was cut short. */
  requestedTo?: string;
  shifts: ShiftScore[];
  /** Every MIS row that needs correcting, across the whole range, so the page
   *  can link an admin straight to it. */
  flagged: FlaggedRow[];
  /** Contested slabs grouped by who claimed them, for the admin to rule on. */
  disputes: Dispute[];
  /** Ranked separately per role — see ShiftScore.crew for why. */
  byRole: Record<CrewRole, PersonScore[]>;
  people: PersonScore[];
  totals: {
    quantity: number; points: number; graded: number; ungraded: number;
    quality: number | null; rawQuality: number | null;
    /** Contested slabs still waiting on an admin ruling. */
    contested: number;
    /** Contested slabs an admin has already awarded to a shift. */
    resolved: number;
    /** Hours whose slab range was too wide to be real, across the range. */
    wideRows: number;
    /** Shift instances that filed MIS but named no production incharge — their
     *  points belong to nobody and silently lift everyone else's share. */
    unattributed: number;
    unattributedElectrical: number;
    unattributedMechanical: number;
    /** Availability x Performance x Quality across the range. REPORTED ONLY —
     *  it decides no money. See the OEE block in shiftScoreMath.ts for why. */
    oee: Oee;
    /** 0-1: hours filed, ranges typed sanely, slabs not double-claimed.
     *  Reported only, for the same reason. */
    misDiscipline: number | null;
  };
}

/** Every shift instance between two IST dates, scored, plus the per-person roll-up. */
export async function scoreRange(from: string, to: string, maxDays = 31): Promise<ScoreboardData> {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < maxDays; d = plusDay(d, 1)) days.push(d);
  const letters: ShiftLetter[] = ["A", "B", "C"];
  const now = new Date();
  const scoredTo = days.length ? days[days.length - 1] : from;

  // Pass 1 — what each shift CLAIMS, so a slab claimed by two shifts can be
  // dropped from both rather than paid twice.
  //
  // Only shifts that have ENDED. A shift scored while it is still running
  // carries an hour or two of output but counts as a whole shift in the
  // per-shift divisor, so its crew's rate — and the money — depended on what
  // time of day the admin happened to open the page.
  const instances = days.flatMap((d) => letters.map((l) => ({ d, l })))
    .filter(({ d, l }) => shiftRange(d, l).end <= now);
  const claims = await Promise.all(instances.map(async ({ d, l }) => ({ d, l, slabs: await claimedSlabs(d, l) })));
  const claimedBy = new Map<number, string[]>();   // slab -> shift keys that claimed it
  for (const c of claims) {
    const key = `${c.d}${c.l}`;
    for (const n of c.slabs) claimedBy.set(n, [...(claimedBy.get(n) ?? []), key]);
  }
  const contestedSlabs = [...claimedBy.entries()].filter(([, k]) => k.length > 1).map(([n]) => n);

  // An ADMIN'S RULING beats the default. Left alone, a slab two shifts both
  // claimed is dropped from both — right, because paying it twice is wrong and a
  // machine cannot know whose it was. But someone does know, so the admin can
  // award it, and from then on it scores for the winner and only the loser is
  // excluded. Awards outlive the entry: correcting the MIS row later simply
  // stops the slab being contested, and the ruling becomes moot on its own.
  const awards = contestedSlabs.length
    ? await (prisma as any).slabClaimAward.findMany({
        where: { slabNumber: { in: contestedSlabs } },
        select: { slabNumber: true, anchor: true, shift: true, decidedBy: true },
      })
    : [];
  const awardOf = new Map<number, { key: string; by: string | null }>();
  for (const a of awards) awardOf.set(Number(a.slabNumber), { key: `${a.anchor}${a.shift}`, by: a.decidedBy ?? null });

  // Per-shift exclusion: an unruled slab is excluded everywhere, an awarded one
  // only from the shifts that lost it.
  const excludeFor = (d: string, l: ShiftLetter) => {
    const key = `${d}${l}`;
    const ex = new Set<number>();
    for (const n of contestedSlabs) if (awardOf.get(n)?.key !== key) ex.add(n);
    return ex;
  };

  // Pass 2 — score with those slabs excluded.
  const scored = await Promise.all(
    instances.map(({ d, l }) => scoreShift(d, l, excludeFor(d, l))),
  );
  // Keep a shift that recorded a TEAM even if it pressed nothing: dropping it
  // erased those people from the board entirely, which read as "they did not
  // work" rather than "they worked and produced nothing".
  const shifts = scored.filter((s) => s.quantity > 0 || s.people.length > 0);

  // One fight, one ruling. Contested slabs are grouped by the SET of shifts that
  // claimed them, so an overlap of a hundred slabs is one decision rather than a
  // hundred. Contiguous runs inside a group are reported as a range because that
  // is how the MIS row was typed and how the admin will recognise it.
  const inchargeOf = new Map(scored.map((s) => [`${s.anchor}${s.shift}`, s.crew.production.join(", ") || null]));
  const groups = new Map<string, number[]>();
  for (const n of contestedSlabs) {
    const key = [...(claimedBy.get(n) ?? [])].sort().join("|");
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const disputes: Dispute[] = [...groups.entries()].map(([key, slabs]) => {
    slabs.sort((a, b) => a - b);
    const awarded = [...new Set(slabs.map((n) => awardOf.get(n)?.key ?? ""))];
    return {
      key,
      slabs,
      from: slabs[0],
      to: slabs[slabs.length - 1],
      claimants: key.split("|").map((k) => {
        const anchor = k.slice(0, 10), shift = k.slice(10) as ShiftLetter;
        const incharge = inchargeOf.get(k) ?? null;
        return { anchor, shift, label: `${anchor} shift ${shift}`, incharge };
      }),
      // Only a ruling that covers the WHOLE group counts as decided — a partial
      // one would read as settled while some slabs still score for nobody.
      awardedTo: awarded.length === 1 && awarded[0] ? awarded[0] : null,
      awardedBy: awarded.length === 1 && awarded[0] ? (awardOf.get(slabs[0])?.by ?? null) : null,
    };
  }).sort((a, b) => a.from - b.from);
  const unruled = contestedSlabs.filter((n) => !awardOf.has(n)).length;

  // Each person on a shift carries that shift's whole score: production is a
  // team result, so the team shares one number rather than splitting it.
  //
  // THE POOL IS SPLIT, NOT MULTIPLIED. 70% follows good slabs per shift and 30%
  // follows the quality score, each shared across the qualified field. Both are
  // rates, and both are scaled by `credibility` so one lucky shift cannot take
  // the month. See POOL_VOLUME in shiftScoreMath.ts for why this replaced
  // volume x quality.
  const splitPool = (rows: Omit<PersonScore, "share">[]): PersonScore[] => {
    const vol = (r: Omit<PersonScore, "share">) => (r.qualified ? r.pointsPerShift * credibility(r.shifts) : 0);
    const qua = (r: Omit<PersonScore, "share">) => (r.qualified ? (r.quality ?? 0) * credibility(r.shifts) : 0);
    const vTot = rows.reduce((a, r) => a + vol(r), 0);
    const qTot = rows.reduce((a, r) => a + qua(r), 0);
    return rows
      .map((r) => ({
        ...r,
        share: (vTot ? POOL_VOLUME * vol(r) / vTot : 0) + (qTot ? POOL_QUALITY * qua(r) / qTot : 0),
      }))
      // qualified first, then by what they are actually paid
      .sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.share - a.share);
  };

  const roll = (pick: (s: ShiftScore) => string[], withPowerout = false): PersonScore[] => {
    const m = new Map<string, { shifts: number; eff: number; quantity: number; points: number; qNum: number; qDen: number; credit: number; down: number; hours: number }>();
    for (const s of shifts) {
      for (const p of pick(s)) {
        const e = m.get(p) ?? { shifts: 0, eff: 0, quantity: 0, points: 0, qNum: 0, qDen: 0, credit: 0, down: 0, hours: 0 };
        e.shifts += 1; e.eff += s.weight; e.quantity += s.quantity; e.points += s.points;
        e.down += s.breakdownMin + (withPowerout ? s.poweroutMin : 0);
        e.hours += s.hoursLogged;
        if (s.quality != null) { e.qNum += s.quality * s.graded; e.qDen += s.graded; }
        if (s.rawQuality != null) e.credit += s.rawQuality * s.graded;
        m.set(p, e);
      }
    }
    const raw = [...m.entries()].map(([person, e]) => ({
      person, shifts: e.shifts, effectiveShifts: e.eff, quantity: e.quantity, points: e.points,
      // Over RUNNING shifts, not shifts attended: a night the plant spent
      // broken carries no slabs and no divisor either.
      pointsPerShift: e.eff ? e.points / e.eff : 0,
      quality: e.qDen ? e.qNum / e.qDen : null,
      rawQuality: e.qDen ? e.credit / e.qDen : null,
      qualified: e.shifts >= MIN_SHIFTS_TO_RANK,
      downtimeMin: e.down,
      downtimePerShift: e.shifts ? e.down / e.shifts : 0,
      hoursLogged: e.hours,
      // Stoppage is measured against the hours MIS ACTUALLY RECORDS, not a flat
      // 8 hours per shift. Against 480 a minute never logged was a minute the
      // line was assumed to be running, so the cheapest way to a perfect uptime
      // score was to leave out the hour the plant stood still. Now an unlogged
      // hour earns nothing rather than scoring as uptime.
      uptime: e.hours ? Math.max(0, 1 - e.down / (e.hours * 60)) : null,
    }));
    return splitPool(raw);
  };
  /** Electrical / mechanical. Uptime is stretched against a floor for the same
   *  reason grade share is: raw uptime sits between 94% and 99% for everyone, so
   *  splitting the pool on it hands each person roughly 1/n whatever they did,
   *  and the board says nothing. UPTIME_FLOOR turns that 5-point spread into a
   *  real one. Someone below the floor scores zero and takes no share.
   *
   *  It is also weighted by SHIFTS WORKED. Sharing on the rate alone let one
   *  quiet night out-earn a month of cover: uptime is already a rate, so
   *  dividing by shifts a second time paid for scarcity.
   *
   *  There is no 70/30 split here. Uptime IS this role's whole measure — there
   *  is no second axis to weigh it against, because slabs are not their job. */
  const rankByUptime = (rows: PersonScore[]): PersonScore[] => {
    const weight = (r: PersonScore) =>
      r.qualified ? (scaleUptime(r.uptime) ?? 0) * r.shifts : 0;
    const tot = rows.reduce((a, r) => a + weight(r), 0);
    return rows
      .map((r) => ({ ...r, share: tot ? weight(r) / tot : 0 }))
      .sort((a, b) => Number(b.qualified) - Number(a.qualified) || (b.uptime ?? 0) - (a.uptime ?? 0));
  };

  // Electrical and mechanical are ranked on UPTIME, not slabs: their job is
  // keeping the line running. Powerout counts only against electrical.
  const byRole = {
    production: roll((s) => s.crew.production),
    electrical: rankByUptime(roll((s) => s.crew.electrical, true)),
    mechanical: rankByUptime(roll((s) => s.crew.mechanical)),
  };

  const byPerson = new Map<string, { shifts: number; eff: number; quantity: number; points: number; qNum: number; qDen: number; credit: number; down: number; hours: number }>();
  for (const s of shifts) {
    for (const p of s.people) {
      const e = byPerson.get(p) ?? { shifts: 0, eff: 0, quantity: 0, points: 0, qNum: 0, qDen: 0, credit: 0, down: 0, hours: 0 };
      e.shifts += 1;
      e.eff += s.weight;
      e.quantity += s.quantity;
      e.points += s.points;
      e.down += s.breakdownMin;
      e.hours += s.hoursLogged;
      if (s.quality != null) { e.qNum += s.quality * s.graded; e.qDen += s.graded; }
      if (s.rawQuality != null) e.credit += s.rawQuality * s.graded;
      byPerson.set(p, e);
    }
  }
  const rawAll = [...byPerson.entries()].map(([person, e]) => ({
    person, shifts: e.shifts, effectiveShifts: e.eff, quantity: e.quantity, points: e.points,
    pointsPerShift: e.eff ? e.points / e.eff : 0,
    quality: e.qDen ? e.qNum / e.qDen : null,
    rawQuality: e.qDen ? e.credit / e.qDen : null,
    qualified: e.shifts >= MIN_SHIFTS_TO_RANK,
    downtimeMin: e.down,
    downtimePerShift: e.shifts ? e.down / e.shifts : 0,
    hoursLogged: e.hours,
    uptime: e.hours ? Math.max(0, 1 - e.down / (e.hours * 60)) : null,
  }));
  const people: PersonScore[] = splitPool(rawAll);

  const graded = shifts.reduce((a, s) => a + s.graded, 0);
  const qNum = shifts.reduce((a, s) => a + (s.quality ?? 0) * s.graded, 0);
  const rawNum = shifts.reduce((a, s) => a + (s.rawQuality ?? 0) * s.graded, 0);
  return {
    from,
    to: scoredTo,
    requestedTo: scoredTo === to ? undefined : to,
    shifts,
    // newest first — the hour someone still remembers is the one worth fixing
    flagged: shifts.flatMap((s) => s.flagged)
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.hour ?? "").localeCompare(a.hour ?? "")),
    disputes,
    byRole,
    people,
    totals: {
      quantity: shifts.reduce((a, s) => a + s.quantity, 0),
      points: shifts.reduce((a, s) => a + s.points, 0),
      graded,
      ungraded: shifts.reduce((a, s) => a + s.ungraded, 0),
      quality: graded ? qNum / graded : null,
      rawQuality: graded ? rawNum / graded : null,
      // Slabs still waiting on a ruling. An awarded slab is no longer disputed —
      // it scores for the shift the admin gave it to.
      contested: unruled,
      resolved: contestedSlabs.length - unruled,
      wideRows: shifts.reduce((a, s) => a + s.wideRows, 0),
      // A shift that filed MIS but named nobody in a role. Its points are in the
      // plant total and on nobody's row, so every other person's share of that
      // role's pool is quietly larger than the work behind it — and not filing
      // is therefore worth money to everyone who did.
      unattributed: shifts.filter((s) => s.crew.production.length === 0).length,
      unattributedElectrical: shifts.filter((s) => s.crew.electrical.length === 0).length,
      unattributedMechanical: shifts.filter((s) => s.crew.mechanical.length === 0).length,
      // Built from the RAW grade share, not the stretched one: an OEE measured
      // against QUALITY_FLOOR would not be comparable with any other plant's.
      // OEE ON PHYSICAL OUTPUT, not on the paid figure. Performance is
      // actual-against-theoretical output; feeding it the doubled points would
      // report a pace the line never ran and make the number incomparable with
      // anybody else's OEE. The multiplier is a pay rule, not a measurement.
      oee: oeeTotal(shifts.map((s) => ({ ...s, points: s.goodSlabs })), graded ? rawNum / graded : null),
      misDiscipline: misDiscipline(
        shifts.reduce((a, s) => a + s.hoursLogged, 0),
        shifts.reduce((a, s) => a + s.wideRows, 0),
        unruled,
        shifts.reduce((a, s) => a + s.quantity, 0),
      ),
    },
  };
}

// --------------------------------------------------------------------------
// Per-station operators
// --------------------------------------------------------------------------
// The shift tables above score a TEAM. These score the individual at a machine:
// the slabs they personally recorded there, and how QC graded those same slabs.
// Attribution is per record rather than per shift, so it does not depend on the
// MIS slab range at all — it is the operator's own name on their own row.
//
// Ranked by the same per-shift rate as the shift tables, where a "shift" is a
// distinct shift instance that operator appears in. Someone covering three
// machines in one night should not out-rank a steady hand by volume alone.
//
// `basis` is what the QUALITY column means at that station:
//   "grade"  — how QC finally graded the slabs this operator handled.
//   "polish" — the polishing line is not judged on A/B/C. The calliberator does
//              not decide what arrives at his machine; his job is to send it out
//              finished and to RESCUE what comes back. So he is scored on the
//              rework and repolish outcomes of the slabs he polished, and on how
//              many he put through. See polishCredit().
//
// `tsRequired` says whether a row with no real timestamp may be dated by
// imported_at. For the five production tables the real column is present on
// 99.7%+ of rows, so the fallback only ever mis-dated a handful — and it dated
// them by when Airtable was imported, which is not when the work happened.
// polish_entry is the exception: `created` stops at 2026-06-08 and every row
// since is null, so its board would be empty without the fallback. It is dated
// by import there, and the page says so.
export const STATIONS = [
  { key: "press", table: "press", col: "operator", ts: "date", basis: "grade", tsRequired: true, label: "Press" },
  { key: "distributor", table: "distributor", col: "operator", ts: "date", basis: "grade", tsRequired: true, label: "Distributor" },
  { key: "kreos", table: "kreos", col: "operator", ts: "date", basis: "grade", tsRequired: true, label: "Kreos" },
  { key: "oven", table: "oven", col: "operator", ts: "date", basis: "grade", tsRequired: true, label: "Oven" },
  { key: "jot", table: "jot", col: "operator", ts: "date", basis: "grade", tsRequired: true, label: "Jot" },
  { key: "polish", table: "polish_entry", col: "calliberator", ts: "created", basis: "polish", tsRequired: false, label: "Polishing" },
] as const;

export interface StationBoard {
  key: string;
  label: string;
  /** What the quality column measures here — see STATIONS.basis. */
  basis: "grade" | "polish";
  /** True when this board's dates come from import time, not the work time. */
  datedByImport: boolean;
  operators: PersonScore[];
}


/** Names already ranked as an incharge, so they are not ALSO ranked as an
 *  operator at a machine. Two reasons: it double-counts the same shifts across
 *  two boards, and an incharge covering a station for a few hours is not doing
 *  the job the station board is meant to compare. Suresh runs shifts; his name
 *  turning up under Press with 3 shifts was the incharge, not a press operator. */
export async function scoreStations(from: string, to: string, excludeNames: string[] = []): Promise<StationBoard[]> {
  const excluded = new Set(excludeNames.map((n) => canonPerson(n)).filter(Boolean));
  // The production day, 06:00→06:00 IST — the same span the shift tables beside
  // these boards use (shiftRange A start → C end), so a night operator's work
  // sits on one board day instead of being split across two by IST midnight.
  const lo = shiftRange(from, "A").start;
  const hi = shiftRange(to, "C").end;
  const out: StationBoard[] = [];

  // PERFORMANCE RESHAPE, 2026-08-14 — same rows, same math, same boards.
  // The old loop ran the 6 stations one after another and re-fetched polish_qc
  // grades per station; the station slab sets overlap heavily (they are the same
  // month of slabs seen at different machines), so a month of QC rows crossed the
  // wire up to 6 times and the whole function measured 2.4–3.1 s warm. Now:
  //   1) all 6 station window queries run in parallel (independent reads);
  //   2) QC is fetched ONCE for the union of their slabs — the per-slab "latest
  //      verdict" is a property of the slab, not of the station asking, so one
  //      shared map is provably the same input to every board;
  //   3) the per-station roll-up below is pure in-memory work, unchanged.
  // No try/catch anywhere, as before: a station whose query fails must not render
  // as "nobody worked here" — that quietly removes real people from a payout board.
  const stationRows: any[][] = await Promise.all(STATIONS.map((st) => {
    // st.table, st.col and st.ts are INTERPOLATED into the SQL below - Postgres
    // cannot take an identifier as a bound parameter. They are literals from
    // STATIONS, all snake_case, so this never fires today; it is here so that
    // an edit up there which slips a quote or a space into a name fails HERE,
    // loudly, rather than reaching Postgres as SQL. Loud on purpose, for the
    // same reason there is no try/catch around these queries.
    for (const ident of [st.table, st.col, st.ts]) {
      if (!/^[a-z0-9_]+$/.test(ident)) throw new Error(`scoreStations: "${ident}" is not a plain identifier`);
    }
    const when = st.tsRequired ? st.ts : `COALESCE(${st.ts}, imported_at)`;
    // The polishing board's window used to filter on COALESCE(created, imported_at),
    // which no btree can serve — a 24–29 ms seq scan over 44.7k polish_entry rows
    // (measured 2026-08-14). The OR shape below is equivalent by the definition of
    // COALESCE (created NULL -> imported_at decides; imported_at is NOT NULL) and
    // lets the planner BitmapOr polish_entry_created_idx + polish_entry_imported_at_idx.
    // COALESCE stays in the SELECT list — only the WHERE needed to become indexable.
    const windowPred = st.tsRequired
      ? `${st.ts} >= $1 AND ${st.ts} < $2`
      : `((${st.ts} >= $1 AND ${st.ts} < $2) OR (${st.ts} IS NULL AND imported_at >= $1 AND imported_at < $2))`;
    return prisma.$queryRawUnsafe(
      `SELECT ${st.col} op, slab_number sn, ${when} ts
         FROM ${st.table}
        WHERE ${windowPred}
          AND ${st.col} IS NOT NULL AND slab_number IS NOT NULL`, lo, hi) as Promise<any[]>;
  }));

  // One QC fetch for the union of every station's slabs. Chunked: Postgres caps a
  // statement at 32767 bind parameters (same guard as scoreShift).
  const slabUnion = [...new Set(stationRows.flat().map((r) => Number(r.sn)).filter(Number.isFinite))];
  const qc: any[] = [];
  for (let i = 0; i < slabUnion.length; i += 5000) {
    qc.push(...await (prisma as any).polishQc.findMany({
      where: { slabNumber: { in: slabUnion.slice(i, i + 5000) } },
      select: {
        slabNumber: true, qualityGrade: true, createdTime: true, importedAt: true,
        rwStatus: true, repolishStatus: true,
      },
    }));
  }
  // Newest verdict per slab — a re-graded slab reports its latest outcome.
  const stamp = (q: any) => new Date(q.createdTime ?? q.importedAt ?? 0).getTime();
  qc.sort((a, b) => stamp(b) - stamp(a));
  const latest = new Map<number, any>();
  for (const q of qc) if (q.slabNumber != null && !latest.has(Number(q.slabNumber))) latest.set(Number(q.slabNumber), q);

  for (const [sti, st] of STATIONS.entries()) {
    const rows = stationRows[sti];
    const board = { key: st.key, label: st.label, basis: st.basis, datedByImport: !st.tsRequired };
    if (!rows.length) { out.push({ ...board, operators: [] }); continue; }

    // What this station's quality column is built from.
    const creditOf = (q: any): number | null =>
      st.basis === "polish" ? polishCredit(q?.rwStatus, q?.repolishStatus) : gradeCredit(q?.qualityGrade);

    const m = new Map<string, { slabs: Set<number>; days: Set<string>; credit: number; graded: number; rows: number }>();
    for (const r of rows) {
      const who = canonPerson(r.op);
      // Incharges are ranked in their own tables; office and admin logins are
      // not operators at all and must not take a slice of a shop-floor pool.
      if (!who || excluded.has(who) || NOT_OPERATORS.has(who.toLowerCase())) continue;
      const e = m.get(who) ?? { slabs: new Set<number>(), days: new Set<string>(), credit: 0, graded: 0, rows: 0 };
      const sn = Number(r.sn);
      e.rows += 1;
      if (!e.slabs.has(sn)) {
        e.slabs.add(sn);
        const cr = creditOf(latest.get(sn));
        if (cr != null) { e.credit += cr; e.graded += 1; }
      }
      // DAYS PRESENT, not shift instances. Station rows are back-entered in
      // bulk, so a shift instance counted here is not a shift anyone worked:
      // Jot shows one operator in 60 and another in 65 of a month's 93 shifts,
      // which nobody did. Days is the coarser figure the timestamps can carry.
      // The PRODUCTION day key (+05:30 then −06:00), matching the window
      // above: on an IST-midnight key one night counted as two days present,
      // inflating the divisor behind every per-shift figure on these boards.
      if (r.ts) e.days.add(new Date(new Date(r.ts).getTime() + (IST_MIN - 360) * 60_000).toISOString().slice(0, 10));
      m.set(who, e);
    }

    const raw = [...m.entries()].map(([person, e]) => {
      const rawQuality = e.graded ? e.credit / e.graded : null;
      const quality = st.basis === "polish" ? scalePolish(rawQuality) : scaleQuality(rawQuality);
      // Good slabs: A = 1, B = 0.5, C = 0 on the grade boards; finished = 1,
      // lost = 0 on the polishing board. Same rule as the shift tables — a bad
      // slab is worth zero, never less, so nobody profits by leaving it out.
      const points = Math.round(e.credit);
      return {
        person, shifts: e.days.size, quantity: e.slabs.size, points,
        // Downtime is a shift-level figure — a station row does not carry one,
        // so a day here is always a whole day and the two are equal.
        effectiveShifts: e.days.size,
        pointsPerShift: e.days.size ? points / e.days.size : 0,
        quality, rawQuality,
        qualified: e.rows >= MIN_ROWS_TO_RANK_STATION,
        // downtime is a shift-level figure; it has no meaning per station
        downtimeMin: 0, downtimePerShift: 0, hoursLogged: 0, uptime: null,
      };
    });
    // Same 70/30 split as the shift tables, but the VOLUME half is the TOTAL,
    // not a per-day rate.
    //
    // The shift tables divide by shifts because MIS records one row per hour
    // worked and the divisor is real. Here it is not. These rows carry the time
    // they were TYPED: 278 Kreos rows share three timestamps inside 65 minutes,
    // which read as one enormous shift and took 87.7% of that station's pool
    // from a man who worked nine days. A total asks the question the divisor
    // cannot corrupt — who put the most good slabs through this machine.
    const qual = raw.filter((r) => r.qualified);
    const vTot = qual.reduce((a, r) => a + r.points, 0);
    const qTot = qual.reduce((a, r) => a + (r.quality ?? 0), 0);
    out.push({
      ...board,
      operators: raw
        .map((r) => ({
          ...r,
          share: !r.qualified ? 0
            : (vTot ? POOL_VOLUME * r.points / vTot : 0) + (qTot ? POOL_QUALITY * (r.quality ?? 0) / qTot : 0),
        }))
        .sort((a, b) => Number(b.qualified) - Number(a.qualified) || b.share - a.share),
    });
  }
  return out;
}
