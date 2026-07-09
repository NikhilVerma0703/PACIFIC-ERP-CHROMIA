import Link from "next/link";
import { Shell } from "@/components/Shell";
import { NoAccess } from "@/components/NoAccess";
import { canUseEntryModel, entryAccess } from "@/lib/stationAccess";
import { currentUser } from "@/lib/rbac";
import { selectOptions } from "@/lib/tables";
import { prisma } from "@/lib/prisma";
import { MisShiftSheet, type MisRowLite } from "@/components/MisShiftSheet";
import { SHIFT_HOURS } from "@/lib/misShiftHours";

export const dynamic = "force-dynamic";
const db = prisma as never as { mis: { findMany: (q: unknown) => Promise<MisRowLite[]> } };

const ymdIST = (ms = Date.now()) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const plusDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Which shift is running right now (IST)? A 06-14, B 14-22, C 22-06.
// Before 06:00 the running shift is C and it STARTED YESTERDAY.
function currentShift(): { date: string; shift: "A" | "B" | "C" } {
  const ist = new Date(Date.now() + 330 * 60000);
  const h = ist.getUTCHours();
  if (h >= 6 && h < 14) return { date: ymdIST(), shift: "A" };
  if (h >= 14 && h < 22) return { date: ymdIST(), shift: "B" };
  return { date: h < 6 ? plusDay(ymdIST(), -1) : ymdIST(), shift: "C" };
}

const SEL = { id: true, hour: true, batch: true, design: true,
  slabsPerHourStd: true, slabsPerHourActual: true, startingSlabNumber: true, endingSlabNumber: true,
  numberOfJumpedSlabs: true, areaOfProblem: true, details: true, processDelayDurationMinutes: true,
  cleaningDelayDurationMinutes: true, breakdownDelayDurationMechanicalOrElectricalMinutes: true,
  poweroutDelayDurationMinutes: true };

async function shiftRows(date: string, shift: "A" | "B" | "C"): Promise<MisRowLite[]> {
  const hours = SHIFT_HOURS[shift];
  const day = (d: string, hs: string[]) => ({
    AND: [
      { hour: { in: hs } },
      { OR: [
        { date: { gte: new Date(`${d}T00:00:00.000Z`), lt: new Date(`${plusDay(d, 1)}T00:00:00.000Z`) } },
        { AND: [{ date: null }, { dateAndTime: { gte: new Date(`${d}T00:00:00.000Z`), lt: new Date(`${plusDay(d, 1)}T00:00:00.000Z`) } }] },
      ] },
    ],
  });
  const where = shift === "C"
    ? { OR: [day(date, hours.slice(0, 2)), day(plusDay(date, 1), hours.slice(2))] }
    : day(date, hours);
  try { return await db.mis.findMany({ where, select: SEL, orderBy: { dateAndTime: "asc" } }); }
  catch { return []; }
}

export default async function MisSheetPage({ searchParams }: { searchParams: Promise<{ date?: string; shift?: string; hour?: string }> }) {
  if (!(await canUseEntryModel("Mis"))) return <NoAccess station={(await entryAccess()).station} />;
  const sp = await searchParams;
  const cur = currentShift();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? String(sp.date) : cur.date;
  const shift = (["A", "B", "C"].includes(sp.shift ?? "") ? sp.shift : cur.shift) as "A" | "B" | "C";
  const [rows, options, me] = await Promise.all([shiftRows(date, shift), selectOptions("Mis"), currentUser()]);
  const operatorName = me?.name || me?.email || "operator";
  // design dropdown: collapse every "Trial …" variant into ONE "Trial" entry
  if (options.design?.some((d) => /^trial\b/i.test(String(d).trim()))) {
    options.design = ["Trial", ...options.design.filter((d) => !/^trial\b/i.test(String(d).trim()))];
  }
  const hourParam = /^\d{2} - \d{2}$/.test(sp.hour ?? "") ? sp.hour : undefined;

  return (
    <Shell>
      <Link href="/entry" className="mb-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">← Data entry</Link>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">MIS — Daily Production &amp; Utilization</h1>
      <p className="mb-5 max-w-3xl text-sm text-gray-500">One hour per save: pick the hour (shift comes up on its own), fill what happened, Save. Logged hours appear in the table below. Delay per hour caps at 60 min.</p>
      <MisShiftSheet rows={rows} date={date} shift={shift} hour={hourParam} operatorName={operatorName} options={options} />
    </Shell>
  );
}
