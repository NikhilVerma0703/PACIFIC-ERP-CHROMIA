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
  mis:   { findMany: (q: unknown) => Promise<MisRowLite[]>; findFirst: (q: unknown) => Promise<{ electricalInchargeName: string | null; mechanicalInchargeName: string | null; productionType: string | null } | null> };
  press: { findMany: (q: unknown) => Promise<{ batch: string | null; designName: string | null; slabNumber: number | null; importedAt: Date }[]> };
  kreos: { findFirst: (q: unknown) => Promise<{ slabThickness: string | null; importedAt: Date } | null> };
  distributor: { findFirst: (q: unknown) => Promise<{ slabThickness: string | null; importedAt: Date } | null> };
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

const SEL = { id: true, hour: true, batch: true, design: true, electricalInchargeName: true, mechanicalInchargeName: true, productionType: true, thkAtPressMm: true,
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


/** Hours already logged on the sheet's calendar day (any shift) — powers the
 * hour dropdown's ✓-logged ticks across shifts. 00-06 rows of `date` belong
 * to the C shift anchored the previous evening, exactly where the dropdown
 * navigates for those hours; the loaded shift's own rows cover its C spillover. */
async function dayLoggedHours(date: string): Promise<string[]> {
  try {
    const rows = await db.mis.findMany({ where: { OR: [
      { date: { gte: new Date(`${date}T00:00:00.000Z`), lt: new Date(`${plusDay(date, 1)}T00:00:00.000Z`) } },
      { AND: [{ date: null }, { dateAndTime: { gte: new Date(`${date}T00:00:00.000Z`), lt: new Date(`${plusDay(date, 1)}T00:00:00.000Z`) } }] },
    ] }, select: { id: true, hour: true } });
    return [...new Set(rows.map((r) => r.hour).filter((h): h is string => !!h))];
  } catch { return []; }
}

// ---- Header prefill (login + live press data) -------------------------------
// The client component picks its initial hour with this same rule; computing it
// here too lets us prefill from the press rows of exactly that hour window.
const ALL_HOURS = [...SHIFT_HOURS.A, ...SHIFT_HOURS.B, ...SHIFT_HOURS.C];
function initialHourFor(rows: MisRowLite[], shift: "A" | "B" | "C", hourParam?: string): string {
  if (hourParam && ALL_HOURS.includes(hourParam)) return hourParam;
  // default to the hour that JUST ENDED — that's the one being reported
  const h = (new Date(Date.now() + 330 * 60000).getUTCHours() + 23) % 24;
  const wall = `${String(h).padStart(2, "0")} - ${String((h + 1) % 24).padStart(2, "0")}`;
  if (shiftOfHour(wall) === shift) return wall;
  const logged = new Set(rows.map((r) => r.hour));
  return SHIFT_HOURS[shift].find((x) => !logged.has(x)) ?? SHIFT_HOURS[shift][0];
}

/** Latest Press entry inside the selected date+hour window (IST), else the
 * latest press entry of that day — the batch/design running at the press. */
async function pressPrefill(hourDate: string, hour: string): Promise<{ batch: string | null; designName: string | null; startSlab: number | null; endSlab: number | null; count: number | null } | null> {
  const dayStart = Date.parse(`${hourDate}T00:00:00+05:30`);
  const h = Number(hour.slice(0, 2));
  // ERP-entered press rows have NO createdTime (Airtable-era column) — match on
  // importedAt too, else the prefill finds nothing and the incharge types by hand.
  const win = (a: number, z: number) => ({ OR: [
    { createdTime: { gte: new Date(a), lt: new Date(z) } },
    { AND: [{ createdTime: null }, { importedAt: { gte: new Date(a), lt: new Date(z) } }] },
  ] });
  try {
    const rows = await db.press.findMany({
      where: win(dayStart + h * 3600_000, dayStart + (h + 1) * 3600_000),
      select: { batch: true, designName: true, slabNumber: true, importedAt: true },
      orderBy: { importedAt: "desc" }, take: 500,
    });
    if (!rows.length) return null; // hour-only: nothing ran -> fields stay empty (still mandatory)
    const nums = rows.map((r) => Number(r.slabNumber)).filter(Number.isFinite);
    return {
      batch: rows[0].batch, designName: rows[0].designName,
      startSlab: nums.length ? Math.min(...nums) : null,
      endSlab: nums.length ? Math.max(...nums) : null,
      count: new Set(nums).size || null,
    };
  } catch { return null; }
}

// Which line-head form is being filled this hour -> production type + thickness.
const THK_MM: Record<string, string> = { "3cm": "30", "2cm": "20", "12mm": "12", "7mm": "7", "1.2 cm": "12", "2 cm": "20", "3 cm": "30" };
async function lineHeadPrefill(hourDate: string, hour: string): Promise<{ productionType: string; thk: string } | null> {
  const dayStart = Date.parse(`${hourDate}T00:00:00+05:30`);
  const h = Number(hour.slice(0, 2));
  const win = {
    OR: [
      { createdTime: { gte: new Date(dayStart + h * 3600_000), lt: new Date(dayStart + (h + 1) * 3600_000) } },
      { AND: [{ createdTime: null }, { importedAt: { gte: new Date(dayStart + h * 3600_000), lt: new Date(dayStart + (h + 1) * 3600_000) } }] },
    ],
  };
  const sel = { select: { slabThickness: true, importedAt: true }, orderBy: { importedAt: "desc" } } as const;
  try {
    const [k, d] = await Promise.all([
      db.kreos.findFirst({ where: win, ...sel }),
      db.distributor.findFirst({ where: win, ...sel }),
    ]);
    const pick = k && d ? (k.importedAt > d.importedAt ? { m: "Kreos", r: k } : { m: "Distributor", r: d }) : k ? { m: "Kreos", r: k } : d ? { m: "Distributor", r: d } : null;
    if (!pick) return null;
    const t = String(pick.r.slabThickness ?? "").trim();
    return { productionType: pick.m, thk: THK_MM[t] ?? t.replace(/[^0-9.]/g, "") };
  } catch { return null; }
}

export default async function MisSheetPage({ searchParams }: { searchParams: Promise<{ date?: string; shift?: string; hour?: string }> }) {
  if (!(await canUseEntryModel("Mis"))) return <NoAccess station={(await entryAccess()).station} />;
  const sp = await searchParams;
  const cur = currentShift();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? String(sp.date) : cur.date;
  const shift = (["A", "B", "C"].includes(sp.shift ?? "") ? sp.shift : cur.shift) as "A" | "B" | "C";
  const [rows, options, me, loggedDay] = await Promise.all([shiftRows(date, shift), selectOptions("Mis"), currentUser(), dayLoggedHours(date)]);
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
  const [press, line, lastEntry] = await Promise.all([
    pressPrefill(hourDate, initialHour),
    lineHeadPrefill(hourDate, initialHour),
    // the most recent MIS entry ANYWHERE (any shift/day) — incharge names and
    // production type carry over even on the first hour of a fresh shift
    db.mis.findFirst({
      where: { OR: [{ electricalInchargeName: { not: null } }, { mechanicalInchargeName: { not: null } }, { productionType: { not: null } }] },
      select: { electricalInchargeName: true, mechanicalInchargeName: true, productionType: true },
      orderBy: [{ dateAndTime: { sort: "desc", nulls: "last" } }, { importedAt: "desc" }],
    }).catch(() => null),
  ]);
  const prev = rows.length ? rows[rows.length - 1] : undefined;
  const prefill: MisPrefill = {
    batch:  press?.batch ?? "",
    design: press?.designName ?? "",
    fromPress: !!press,
    thkPress: line?.thk ?? "",
    productionType: (line?.productionType && (options.productionType ?? []).includes(line.productionType) ? line.productionType : line?.productionType)
      || prev?.productionType || lastEntry?.productionType || "",
    prodIncharge: operatorName,
    elecIncharge: prev?.electricalInchargeName ?? lastEntry?.electricalInchargeName ?? "",
    mechIncharge: prev?.mechanicalInchargeName ?? lastEntry?.mechanicalInchargeName ?? "",
    startSlab: press?.startSlab != null ? String(press.startSlab) : "",
    endSlab: press?.endSlab != null ? String(press.endSlab) : "",
    actual: press?.count != null ? String(press.count) : "",
  };

  return (
    <Shell>
      <Link href="/entry" className="mb-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">← Data entry</Link>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">MIS — Daily Production &amp; Utilization</h1>
      <p className="mb-5 max-w-3xl text-sm text-gray-500">One hour per save: pick the hour (shift comes up on its own), fill what happened, Save. Logged hours appear in the table below. Delay per hour caps at 60 min.</p>
      <MisShiftSheet key={`${date}|${shift}|${initialHour}`} rows={rows} loggedDay={loggedDay} date={date} shift={shift} hour={hourParam ?? initialHour} operatorName={operatorName} options={options} prefill={prefill} />
    </Shell>
  );
}
