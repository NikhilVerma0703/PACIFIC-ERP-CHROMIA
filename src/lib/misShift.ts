// "Last shift report" for the Downtime page: which shift last logged MIS
// entries, who was incharge, output and downtime. Shift is derived from the
// HOUR bucket (A 06-14, B 14-22, C 22-06) — never from the legacy shift
// column, which ERP-created rows don't fill.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { SHIFT_HOURS as HOURS, SHIFT_WINDOW as WINDOW, shiftOfHour } from "@/lib/misShiftHours";

const db = prisma as any;

export interface LastShiftReport {
  shift: "A" | "B" | "C"; date: string; window: string;
  prodIncharge: string | null; maintIncharge: string | null; submitters: string[];
  hoursLogged: number; hoursTotal: number; slabs: number; delayMin: number;
  batches: string[]; designs: string[]; areas: string[];
}

const ymd = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const plusDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => String(x ?? "").trim()).filter(Boolean))];

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
      productionInchargeName: true, maintenanceInchargeName: true,
      slabsPerHourActual: true, startingSlabNumber: true, endingSlabNumber: true, numberOfJumpedSlabs: true,
      areaOfProblem: true, processDelayDurationMinutes: true, cleaningDelayDurationMinutes: true,
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
    const delayMin = rows.reduce((a, r) => a + n(r.processDelayDurationMinutes) + n(r.cleaningDelayDurationMinutes)
      + n(r.breakdownDelayDurationMechanicalOrElectricalMinutes) + n(r.poweroutDelayDurationMinutes), 0);
    return {
      shift, date: anchor, window: WINDOW[shift],
      prodIncharge: uniq(rows.map((r) => r.productionInchargeName))[0] ?? null,
      maintIncharge: uniq(rows.map((r) => r.maintenanceInchargeName))[0] ?? null,
      submitters: uniq(rows.map((r) => r.submittedBy)),
      hoursLogged: uniq(rows.map((r) => r.hour)).length, hoursTotal: hours.length,
      slabs: Math.round(slabs), delayMin: Math.round(delayMin),
      batches: uniq(rows.map((r) => r.batch)), designs: uniq(rows.map((r) => r.design)),
      areas: uniq(rows.flatMap((r) => r.areaOfProblem ?? [])),
    };
  } catch { return null; }
}
