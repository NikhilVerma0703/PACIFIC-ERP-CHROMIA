// "Last shift report" for the Downtime page: which shift last logged MIS
// entries, who was incharge, output and downtime. Shift is derived from the
// HOUR bucket (A 06-14, B 14-22, C 22-06) — never from the legacy shift
// column, which ERP-created rows don't fill.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { SHIFT_HOURS as HOURS, SHIFT_WINDOW as WINDOW, shiftOfHour } from "@/lib/misShiftHours";
import { classifyBreakdownTrade } from "@/lib/downtimeShared";
import { canonicalGrade } from "@/lib/inventory/grading";

const db = prisma as any;

export interface LastShiftReport {
  shift: "A" | "B" | "C"; date: string; window: string;
  prodIncharge: string | null; elecIncharge: string | null; mechIncharge: string | null; submitters: string[];
  hoursLogged: number; hoursTotal: number; slabs: number; delayMin: number;
  /** delayMin split by the four buckets, keyed by DELAY_FIELDS keys. Kept
   *  beside the total rather than replacing it: every existing consumer reads
   *  the total, and the Telegram /shift report needed the split — "2h 0m" says
   *  the line stopped, the split says whose problem it was. */
  delayByType: Record<string, number>;
  /** The breakdown bucket attributed to a trade from each hour's typed reasons.
   *  NOT a measurement — MIS stores one combined minutes column, so an hour
   *  whose reasons name both trades (or none) sits in `unsplit` rather than
   *  being divided by guesswork. */
  breakdownByTrade: { electrical: number; mechanical: number; unsplit: number };
  batches: string[]; designs: string[]; areas: string[];
  /** QC'd in the same window. Polish is downstream of the press, so these are
   *  not the same slabs that were pressed this shift — they are two separate
   *  throughput numbers for the same eight hours, and usually a different batch
   *  entirely. Hence the separate design/batch here: the card's `batches` and
   *  `designs` above describe what was PRESSED and say nothing about polish. */
  polished: number; gradeA: number; gradeB: number; gradeC: number;
  lastPolishedDesign: string | null; lastPolishedBatch: string | null;
}

const ymd = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const plusDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => String(x ?? "").trim()).filter(Boolean))];

// Shift labels are IST wall-clock (A 06-14, B 14-22, C 22-06) while timestamp
// columns are UTC, so both helpers below convert. The page already uses this
// same +330 convention for its "today" default.
const IST_MIN = 330;

/** UTC span of one shift instance. C starts on the anchor and ends next morning. */
const SHIFT_START: Record<"A" | "B" | "C", number> = { A: 6, B: 14, C: 22 };
function shiftRange(anchor: string, shift: "A" | "B" | "C") {
  const istStart = new Date(`${anchor}T${String(SHIFT_START[shift]).padStart(2, "0")}:00:00.000Z`);
  const start = new Date(istStart.getTime() - IST_MIN * 60_000); // IST wall clock -> UTC
  return { start, end: new Date(start.getTime() + 8 * 3600_000) };
}

/** Which shift instance is running right now, as (anchor date, shift). A C
 *  shift seen after midnight started the previous IST day. */
export function currentShiftAnchor(now: Date = new Date()): { anchor: string; shift: "A" | "B" | "C" } {
  const ist = new Date(now.getTime() + IST_MIN * 60_000);
  const h = ist.getUTCHours();
  const today = ist.toISOString().slice(0, 10);
  if (h >= 6 && h < 14) return { anchor: today, shift: "A" };
  if (h >= 14 && h < 22) return { anchor: today, shift: "B" };
  return { anchor: h >= 22 ? today : plusDay(today, -1), shift: "C" };
}

export async function getLastShiftReport(): Promise<LastShiftReport | null> {
  try {
    // newest row that has an hour bucket = the shift that last reported
    const latest = await db.mis.findFirst({
      where: { hour: { not: null }, OR: [{ date: { not: null } }, { dateAndTime: { not: null } }] },
      orderBy: [{ dateAndTime: { sort: "desc", nulls: "last" } }, { date: { sort: "desc", nulls: "last" } }],
      select: { hour: true, date: true, dateAndTime: true },
    });
    if (!latest?.hour) return null;
    const shift = shiftOfHour(String(latest.hour));
    const rowDay = ymd(latest.date ?? latest.dateAndTime);
    if (!rowDay) return null;
    // anchor = the date the shift STARTED (C rows after midnight started yesterday)
    const anchor = shift === "C" && Number(String(latest.hour).slice(0, 2)) < 12 ? plusDay(rowDay, -1) : rowDay;
    return await getShiftReport(anchor, shift);
  } catch { return null; }
}

/** Report for ONE specific shift instance (anchor = the date it started). */
export async function getShiftReport(anchor: string, shift: "A" | "B" | "C"): Promise<LastShiftReport | null> {
  try {

    const hours = HOURS[shift];
    const dayWhere = (d: string, hs: string[]) => ({
      AND: [
        { hour: { in: hs } },
        { OR: [
          { date: { gte: new Date(`${d}T00:00:00.000Z`), lt: new Date(`${plusDay(d, 1)}T00:00:00.000Z`) } },
          { AND: [{ date: null }, { dateAndTime: { gte: new Date(`${d}T00:00:00.000Z`), lt: new Date(`${plusDay(d, 1)}T00:00:00.000Z`) } }] },
        ] },
      ],
    });
    const where = shift === "C"
      ? { OR: [dayWhere(anchor, hours.slice(0, 2)), dayWhere(plusDay(anchor, 1), hours.slice(2))] }
      : dayWhere(anchor, hours);
    const rows: any[] = await db.mis.findMany({ where, select: {
      hour: true, batch: true, design: true, submittedBy: true,
      productionInchargeName: true, electricalInchargeName: true, mechanicalInchargeName: true,
      slabsPerHourActual: true, startingSlabNumber: true, endingSlabNumber: true, numberOfJumpedSlabs: true,
      areaOfProblem: true, reasonForDeviation: true, processDelayDurationMinutes: true, cleaningDelayDurationMinutes: true,
      breakdownDelayDurationMechanicalOrElectricalMinutes: true, poweroutDelayDurationMinutes: true,
    } });
    if (rows.length === 0) return null;

    const n = (v: unknown) => Number(v ?? 0) || 0;
    // slabs: prefer the written slabs/hr actual; fall back to slab-number span
    const slabs = rows.reduce((a, r) => {
      if (r.slabsPerHourActual != null) return a + n(r.slabsPerHourActual);
      if (r.startingSlabNumber != null && r.endingSlabNumber != null && r.endingSlabNumber >= r.startingSlabNumber)
        return a + (r.endingSlabNumber - r.startingSlabNumber + 1 - n(r.numberOfJumpedSlabs));
      return a;
    }, 0);
    const delayByType: Record<string, number> = {
      process: rows.reduce((a, r) => a + n(r.processDelayDurationMinutes), 0),
      cleaning: rows.reduce((a, r) => a + n(r.cleaningDelayDurationMinutes), 0),
      breakdown: rows.reduce((a, r) => a + n(r.breakdownDelayDurationMechanicalOrElectricalMinutes), 0),
      powerout: rows.reduce((a, r) => a + n(r.poweroutDelayDurationMinutes), 0),
    };
    const delayMin = Object.values(delayByType).reduce((a, b) => a + b, 0);
    // Breakdown split by trade, attributed hour-by-hour from the typed reasons
    // (see classifyBreakdownTrade). An hour naming both trades, or neither,
    // lands in "unsplit" — one minutes figure cannot be divided honestly.
    const breakdownByTrade = { electrical: 0, mechanical: 0, unsplit: 0 };
    for (const r of rows) {
      const min = n(r.breakdownDelayDurationMechanicalOrElectricalMinutes);
      if (min <= 0) continue;
      const trade = classifyBreakdownTrade(Array.isArray(r.reasonForDeviation) ? r.reasonForDeviation : []);
      if (trade === "electrical") breakdownByTrade.electrical += min;
      else if (trade === "mechanical") breakdownByTrade.mechanical += min;
      else breakdownByTrade.unsplit += min;
    }

    // Polish throughput for the same window, keyed off the QC timestamp. Its own
    // try/catch so a QC-side problem degrades these four numbers to zero rather
    // than losing the whole press report.
    let polished = 0, gradeA = 0, gradeB = 0, gradeC = 0;
    let lastPolishedDesign: string | null = null, lastPolishedBatch: string | null = null;
    try {
      const { start, end } = shiftRange(anchor, shift);
      // createdTime is the Airtable-era field and stopped being filled in June
      // 2026 - rows the ERP creates leave it null and only set importedAt. Same
      // fallback shape the date/dateAndTime filter above uses; without it this
      // count is 0 for every recent shift.
      const qc: any[] = await db.polishQc.findMany({
        where: { OR: [
          { createdTime: { gte: start, lt: end } },
          { AND: [{ createdTime: null }, { importedAt: { gte: start, lt: end } }] },
        ] },
        select: { qualityGrade: true, design: true, batchNumber: true, createdTime: true, importedAt: true },
      });
      polished = qc.length;
      for (const q of qc) {
        const g = canonicalGrade(q.qualityGrade);
        if (g === "A") gradeA++;
        else if (g === "B") gradeB++;
        else if (g === "C") gradeC++;
      }
      // What was on the polish line most recently. Sorted here rather than in the
      // query because the effective timestamp is createdTime-or-importedAt, which
      // Prisma cannot order by; the set is one shift's worth, so this is cheap.
      const stamp = (q: any) => new Date(q.createdTime ?? q.importedAt).getTime();
      const newest = qc.filter((q) => q.createdTime || q.importedAt).sort((a, b) => stamp(b) - stamp(a))[0];
      lastPolishedDesign = String(newest?.design ?? "").trim() || null;
      lastPolishedBatch = String(newest?.batchNumber ?? "").trim() || null;
    } catch { /* leave the counts at zero */ }

    return {
      shift, date: anchor, window: WINDOW[shift],
      prodIncharge: uniq(rows.map((r) => r.productionInchargeName))[0] ?? null,
      elecIncharge: uniq(rows.map((r) => r.electricalInchargeName))[0] ?? null,
      mechIncharge: uniq(rows.map((r) => r.mechanicalInchargeName))[0] ?? null,
      submitters: uniq(rows.map((r) => r.submittedBy)),
      hoursLogged: uniq(rows.map((r) => r.hour)).length, hoursTotal: hours.length,
      slabs: Math.round(slabs), delayMin: Math.round(delayMin),
      delayByType: Object.fromEntries(Object.entries(delayByType).map(([k, v]) => [k, Math.round(v)])),
      breakdownByTrade: {
        electrical: Math.round(breakdownByTrade.electrical),
        mechanical: Math.round(breakdownByTrade.mechanical),
        unsplit: Math.round(breakdownByTrade.unsplit),
      },
      batches: uniq(rows.map((r) => r.batch)), designs: uniq(rows.map((r) => r.design)),
      areas: uniq(rows.flatMap((r) => r.areaOfProblem ?? [])),
      polished, gradeA, gradeB, gradeC, lastPolishedDesign, lastPolishedBatch,
    };
  } catch { return null; }
}

/** The shift currently running. Null until it logs its first MIS row. */
export async function getCurrentShiftReport(): Promise<LastShiftReport | null> {
  const { anchor, shift } = currentShiftAnchor();
  return await getShiftReport(anchor, shift);
}

/** The shift instance immediately before the given one. C rolls back a day. */
export function previousShift(cur: { anchor: string; shift: "A" | "B" | "C" }): { anchor: string; shift: "A" | "B" | "C" } {
  if (cur.shift === "C") return { anchor: cur.anchor, shift: "B" };
  if (cur.shift === "B") return { anchor: cur.anchor, shift: "A" };
  return { anchor: plusDay(cur.anchor, -1), shift: "C" };
}

/** The shift instance before the one running now — the genuinely last COMPLETED
 *  shift. Deliberately not "whichever shift logged most recently": that is the
 *  running shift for most of every shift, which is a different thing. */
export async function getPreviousShiftReport(): Promise<LastShiftReport | null> {
  const { anchor, shift } = previousShift(currentShiftAnchor());
  return await getShiftReport(anchor, shift);
}
