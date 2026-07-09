import Link from "next/link";
import { Shell } from "@/components/Shell";
import { NoAccess } from "@/components/NoAccess";
import { canUseEntryModel, entryAccess } from "@/lib/stationAccess";
import { currentUser } from "@/lib/rbac";
import { selectOptions } from "@/lib/tables";
import { prisma } from "@/lib/prisma";
import { MisShiftSheet, type MisRowLite, type MisPrefill } from "@/components/MisShiftSheet";
import { SHIFT_HOURS, shiftOfHour } from "@/lib/misShiftHours";

export const dynamic = "force-dynamic";
const db = prisma as never as {
  mis:   { findMany: (q: unknown) => Promise<MisRowLite[]> };
  press: { findFirst: (q: unknown) => Promise<{ batch: string | null; designName: string | null } | null> };
};

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

const SEL = { id: true, hour: true, batch: true, design: true, productionType: true, thkAtPressMm: true,
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


// ---- Header prefill (login + live press data) -------------------------------
// The client component picks its initial hour with this same rule; computing it
// here too lets us prefill from the press rows of exactly that hour window.
const ALL_HOURS = [...SHIFT_HOURS.A, ...SHIFT_HOURS.B, ...SHIFT_HOURS.C];
function initialHourFor(rows: MisRowLite[], shift: "A" | "B" | "C", hourParam?: string): string {
  if (hourParam && ALL_HOURS.includes(hourParam)) return hourParam;
  const h = new Date(Date.now() + 330 * 60000).getUTCHours(); // IST hour
  const wall = `${String(h).padStart(2, "0")} - ${String((h + 1) % 24).padStart(2, "0")}`;
  if (shiftOfHour(wall) === shift) return wall;
  const logged = new Set(rows.map((r) => r.hour));
  return SHIFT_HOURS[shift].find((x) => !logged.has(x)) ?? SHIFT_HOURS[shift][0];
}

/** Latest Press entry inside the selected date+hour window (IST), else the
 * latest press entry of that day — the batch/design running at the press. */
async function pressPrefill(hourDate: string, hour: string): Promise<{ batch: string | null; designName: string | null } | null> {
  const dayStart = Date.parse(`${hourDate}T00:00:00+05:30`);
  const h = Number(hour.slice(0, 2));
  // ERP-entered press rows have NO createdTime (Airtable-era column) — match on
  // importedAt too, else the prefill finds nothing and the incharge types by hand.
  const sel = { select: { batch: true, designName: true }, orderBy: { importedAt: "desc" } } as const;
  const win = (a: number, z: number) => ({ OR: [
    { createdTime: { gte: new Date(a), lt: new Date(z) } },
    { AND: [{ createdTime: null }, { importedAt: { gte: new Date(a), lt: new Date(z) } }] },
  ] });
  try {
    const inHour = await db.press.findFirst({ where: win(dayStart + h * 3600_000, dayStart + (h + 1) * 3600_000), ...sel });
    if (inHour) return inHour;
    return await db.press.findFirst({ where: win(dayStart, dayStart + 24 * 3600_000), ...sel });
  } catch { return null; }
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

  // Prefill: incharge from the login; batch/design from the press entries of the
  // selected hour (else latest that day); production type + thickness carried
  // from the previous MIS row of this shift. All of it stays editable.
  const initialHour = initialHourFor(rows, shift, hourParam);
  const hourDate = shiftOfHour(initialHour) === "C" && Number(initialHour.slice(0, 2)) < 12 ? plusDay(date, 1) : date;
  const press = await pressPrefill(hourDate, initialHour);
  const prev = rows.length ? rows[rows.length - 1] : undefined;
  const prefill: MisPrefill = {
    batch:  press?.batch ?? "",
    design: press?.designName ?? "",
    fromPress: !!press,
    thkPress: prev?.thkAtPressMm != null ? String(prev.thkAtPressMm) : "",
    productionType: prev?.productionType && (options.productionType ?? []).includes(prev.productionType) ? prev.productionType : "",
    prodIncharge: operatorName,
  };

  return (
    <Shell>
      <Link href="/entry" className="mb-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">← Data entry</Link>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">MIS — Daily Production &amp; Utilization</h1>
      <p className="mb-5 max-w-3xl text-sm text-gray-500">One hour per save: pick the hour (shift comes up on its own), fill what happened, Save. Logged hours appear in the table below. Delay per hour caps at 60 min.</p>
      <MisShiftSheet rows={rows} date={date} shift={shift} hour={hourParam} operatorName={operatorName} options={options} prefill={prefill} />
    </Shell>
  );
}
