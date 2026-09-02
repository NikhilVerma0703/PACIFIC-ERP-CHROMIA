// One month of the shift incentive, as the page that tracks it needs it: the
// three letters' scores and shares, the pool the plant has reached, and —
// the part that changes hour by hour once the month has ended — every claimed
// slab QC has not yet graded, with where it physically is.
//
// Nothing here re-scores anything. The scores come from scoreRange(), the same
// call /scoreboard makes; the grouping by letter is incentiveMath's; the ladder
// is incentiveLadder's. This file only adds the two questions the payout still
// needs answered after the month closes: how many counted slabs are still to
// come, and are they real.
//
// WHY "ARE THEY REAL" IS A QUESTION. A shift claims slabs by typing a range.
// The score treats every number in the range as a slab, so a range typed one
// digit wide claims fifty slabs that were never pressed — and every one of them
// sits in "awaiting QC" forever, quietly promising points that will never
// arrive. Checking each outstanding number against the press, jot, oven and
// polish tables sorts the waiting from the phantom, and a projection that
// counts only the real ones is the one to plan a payroll on.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { scoreRange, type OutstandingSlab } from "@/lib/shiftScore";
import { shiftRange, plusDay, type ShiftLetter } from "@/lib/shiftScoreMath";
import {
  rollUpByLetter, splitPoolByLetter, plantTotals, projectOutstanding,
  type LetterTotals, type LetterShare,
} from "@/lib/incentiveMath";
import { poolFor, nextTier, FLOOR_SLABS, TIERS, pctOfSalary, bandAmounts, ROLES } from "@/lib/incentiveLadder";

const db = prisma as any;

/** How far a claimed-but-uncounted slab has actually got.
 *  routed    — QC saw it and sent it to CTS / Printing: it will never grade.
 *  at-qc     — a QC row exists, still "Not graded yet".
 *  at-polish — on the polish line (polish_entry), no QC row yet.
 *  pressed   — seen at press / jot / oven, nothing downstream yet.
 *  nowhere   — no row in any table: the number was claimed and never made. */
export type Stage = "at-qc" | "at-polish" | "pressed" | "nowhere" | "routed";
export const STAGES: readonly Stage[] = ["at-qc", "at-polish", "pressed", "nowhere", "routed"];
/** Stages that can still turn into points. */
export const REAL_STAGES: readonly Stage[] = ["at-qc", "at-polish", "pressed"];

export interface TrackedSlab extends OutstandingSlab {
  anchor: string;
  shift: ShiftLetter;
  stage: Stage;
}

export interface OutstandingGroup {
  design: string;
  batch: string;
  count: number;
  /** How many of these count double. */
  slow: number;
  stages: Record<Stage, number>;
  /** Grade share this design has achieved so far this month, when it has
   *  graded enough to say (>= 30), else null. */
  designShare: number | null;
  designGraded: number;
}

export interface LetterMoney {
  shift: ShiftLetter;
  share: number;
  pctSalary: number;
  bands: Record<string, number>;
}

export interface IncentiveMonth {
  month: string;
  from: string;
  to: string;
  /** The last day actually scored — scoreRange caps a range at 31 days. */
  scoredTo: string;
  asOf: string;
  /** True once the month's last C shift has ended. */
  monthEnded: boolean;
  letters: LetterTotals[];
  /** The 70/30 split under each quality method. `weighted` is what the
   *  per-person scoreboard pays on; `aggregate` is what the August notice
   *  printed. See incentiveMath.ts. */
  shares: { weighted: LetterShare[]; aggregate: LetterShare[] };
  plant: ReturnType<typeof plantTotals>;
  pool: {
    counted: number;
    poolNow: number;
    floor: number;
    next: { slabs: number; pool: number } | null;
    ladder: typeof TIERS;
  };
  outstanding: {
    total: number;
    byStage: Record<Stage, number>;
    real: number;
    byLetter: Record<ShiftLetter, Record<Stage, number>>;
    groups: OutstandingGroup[];
    slabs: TrackedSlab[];
    /** Contiguous runs of `nowhere` slabs with the hour that claimed them —
     *  the MIS rows to go and correct. */
    phantomRuns: { from: number; to: number; count: number; anchor: string; shift: ShiftLetter; hour: string | null; design: string | null }[];
  };
  projection: {
    /** The month's grade share so far — what the outstanding are assumed to grade at. */
    share: number | null;
    addReal: number;
    projectedReal: number;
    poolReal: number;
    /** The same with the `nowhere` slabs included, i.e. the notice's way. */
    addAll: number;
    projectedAll: number;
    poolAll: number;
  };
  money: {
    pool: number;
    weighted: LetterMoney[];
    aggregate: LetterMoney[];
    roles: typeof ROLES;
  };
  qc: {
    perDay: { day: string; graded: number }[];
    avgPerDay7: number;
    daysToClear: number | null;
  };
  flaggedRows: number;
  openDisputes: number;
  unattributed: number;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** First and last IST day of a YYYY-MM month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The IST month running now, as YYYY-MM. */
export function currentMonthIST(now = new Date()): string {
  return ymd(new Date(now.getTime() + 330 * 60_000)).slice(0, 7);
}

/** Slab numbers present in a table, chunked under Postgres's bind limit. */
async function present(model: string, slabs: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  for (let i = 0; i < slabs.length; i += 5000) {
    const rows: any[] = await db[model].findMany({
      where: { slabNumber: { in: slabs.slice(i, i + 5000) } },
      select: { slabNumber: true },
    });
    for (const r of rows) out.add(Number(r.slabNumber));
  }
  return out;
}

const emptyStages = (): Record<Stage, number> => ({ "at-qc": 0, "at-polish": 0, pressed: 0, nowhere: 0, routed: 0 });

export async function incentiveMonth(month: string, now = new Date()): Promise<IncentiveMonth> {
  const { from, to } = monthBounds(month);
  const data = await scoreRange(from, to);
  const letters = rollUpByLetter(data.shifts);
  const plant = plantTotals(letters);
  const shares = {
    weighted: splitPoolByLetter(letters, "weighted"),
    aggregate: splitPoolByLetter(letters, "aggregate"),
  };

  // ---- Where every uncounted slab actually is -----------------------------
  const raw: (OutstandingSlab & { anchor: string; shift: ShiftLetter })[] = data.shifts.flatMap((s) =>
    s.outstanding.map((o) => ({ ...o, anchor: s.anchor, shift: s.shift })),
  );
  const numbers = [...new Set(raw.map((o) => o.slab))];
  const [atPolish, atPress, atJot, atOven] = await Promise.all([
    present("polishEntry", numbers), present("press", numbers), present("jot", numbers), present("oven", numbers),
  ]);
  const slabs: TrackedSlab[] = raw.map((o) => {
    const stage: Stage =
      o.verdict === "cts" || o.verdict === "printing" ? "routed"
      : o.verdict === "not-graded" ? "at-qc"
      : atPolish.has(o.slab) ? "at-polish"
      : atPress.has(o.slab) || atJot.has(o.slab) || atOven.has(o.slab) ? "pressed"
      : "nowhere";
    return { ...o, stage };
  }).sort((x, y) => x.slab - y.slab);

  const byStage = emptyStages();
  const byLetter: Record<ShiftLetter, Record<Stage, number>> = { A: emptyStages(), B: emptyStages(), C: emptyStages() };
  for (const s of slabs) { byStage[s.stage] += 1; byLetter[s.shift][s.stage] += 1; }
  const real = REAL_STAGES.reduce((a, st) => a + byStage[st], 0);

  // Grade share per design so far this month, for the groups table. Built from
  // the same latest-verdict rule the score uses, over the slabs the month
  // claimed; a design with fewer than 30 graded says nothing yet.
  const designShare = new Map<string, { graded: number; credit: number }>();
  {
    // The graded slabs' designs come from QC itself, which is the more reliable
    // spelling; group by the QC design, upper-cased and trimmed.
    const key = (d: unknown) => String(d ?? "").trim().toUpperCase();
    const rows: any[] = await db.$queryRaw`
      SELECT upper(trim(design)) AS design, count(*)::int AS graded,
             sum(CASE WHEN upper(quality_grade) LIKE 'A%' THEN 1 WHEN upper(quality_grade) LIKE 'B%' THEN 0.5 ELSE 0 END)::float AS credit
      FROM polish_qc
      WHERE coalesce(created_time, imported_at) >= ${shiftRange(from, "A").start}
        AND coalesce(created_time, imported_at) < ${new Date(shiftRange(to, "C").end.getTime() + 21 * 86400_000)}
        AND quality_grade IS NOT NULL AND quality_grade NOT ILIKE 'Not graded%'
        AND upper(quality_grade) NOT IN ('CTS') AND upper(quality_grade) NOT LIKE 'PRINT%'
      GROUP BY 1`;
    for (const r of rows) designShare.set(key(r.design), { graded: Number(r.graded), credit: Number(r.credit) });
  }

  const groupMap = new Map<string, OutstandingGroup>();
  for (const s of slabs) {
    const design = String(s.design ?? "(no design)").trim() || "(no design)";
    const batch = String(s.batch ?? "—").trim() || "—";
    const k = `${design}${batch}`;
    let g = groupMap.get(k);
    if (!g) {
      const ds = designShare.get(design.toUpperCase());
      g = { design, batch, count: 0, slow: 0, stages: emptyStages(), designShare: ds && ds.graded >= 30 ? ds.credit / ds.graded : null, designGraded: ds?.graded ?? 0 };
      groupMap.set(k, g);
    }
    g.count += 1; if (s.mult > 1) g.slow += 1; g.stages[s.stage] += 1;
  }
  const groups = [...groupMap.values()].sort((a, b) => b.count - a.count || a.design.localeCompare(b.design));

  // Phantom runs: contiguous `nowhere` numbers claimed by one hour.
  const phantomRuns: IncentiveMonth["outstanding"]["phantomRuns"] = [];
  for (const s of slabs) {
    if (s.stage !== "nowhere") continue;
    const last = phantomRuns[phantomRuns.length - 1];
    if (last && last.to === s.slab - 1 && last.anchor === s.anchor && last.shift === s.shift && last.hour === s.hour) { last.to = s.slab; last.count += 1; }
    else phantomRuns.push({ from: s.slab, to: s.slab, count: 1, anchor: s.anchor, shift: s.shift, hour: s.hour, design: s.design });
  }
  phantomRuns.sort((a, b) => b.count - a.count);

  // ---- The pool, now and if the waiting slabs grade like the month has ------
  const counted = plant.points;
  const share = plant.rawShare;
  const realSlabs = slabs.filter((s) => REAL_STAGES.includes(s.stage));
  const addReal = projectOutstanding(realSlabs, share);
  const addAll = projectOutstanding(slabs.filter((s) => s.stage !== "routed"), share);
  const projectedReal = counted + addReal;
  const projectedAll = counted + addAll;

  const moneyFor = (rows: LetterShare[], pool: number): LetterMoney[] => rows.map((r) => {
    const pct = pctOfSalary(r.share, pool);
    return { shift: r.shift, share: r.share, pctSalary: pct, bands: bandAmounts(pct) };
  });
  // Money is shown on the pool the REAL projection reaches — the notice's
  // planning figure — never on a pool the counted total has not unlocked yet
  // without saying so; the page labels it.
  const planningPool = poolFor(projectedReal);

  // ---- QC throughput, for a days-to-clear -----------------------------------
  const perDayRows: any[] = await db.$queryRaw`
    SELECT ((coalesce(created_time, imported_at) + interval '330 minutes')::date)::text AS day, count(*)::int AS graded
    FROM polish_qc
    WHERE coalesce(created_time, imported_at) >= ${new Date(now.getTime() - 14 * 86400_000)}
      AND quality_grade IS NOT NULL AND quality_grade NOT ILIKE 'Not graded%'
    GROUP BY 1 ORDER BY 1`;
  const perDay = perDayRows.map((r) => ({ day: String(r.day), graded: Number(r.graded) }));
  const today = ymd(new Date(now.getTime() + 330 * 60_000));
  // The seven full days before today, zeros included — a day QC did not run is
  // a day the backlog did not move.
  const last7 = Array.from({ length: 7 }, (_, i) => plusDay(today, -(i + 1)));
  const sum7 = last7.reduce((a, d) => a + (perDay.find((p) => p.day === d)?.graded ?? 0), 0);
  const avgPerDay7 = sum7 / 7;
  const daysToClear = avgPerDay7 > 0 ? Math.ceil(real / avgPerDay7) : null;

  return {
    month, from, to, scoredTo: data.to, asOf: now.toISOString(),
    monthEnded: shiftRange(to, "C").end <= now,
    letters, shares, plant,
    pool: { counted, poolNow: poolFor(counted), floor: FLOOR_SLABS, next: nextTier(counted), ladder: TIERS },
    outstanding: { total: slabs.length, byStage, real, byLetter, groups, slabs, phantomRuns },
    projection: {
      share, addReal, projectedReal, poolReal: poolFor(projectedReal),
      addAll, projectedAll, poolAll: poolFor(projectedAll),
    },
    money: { pool: planningPool, weighted: moneyFor(shares.weighted, planningPool), aggregate: moneyFor(shares.aggregate, planningPool), roles: ROLES },
    qc: { perDay, avgPerDay7, daysToClear },
    flaggedRows: data.flagged.length,
    openDisputes: data.totals.contested,
    unattributed: data.totals.unattributed,
  };
}
