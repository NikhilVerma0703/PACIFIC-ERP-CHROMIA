"use client";
// MIS shift sheet — mirrors the paper "Daily Production & Utilization Report":
// one screen per shift, one row per hour. Each hour row saves as its own MIS
// record via the generic createRow action. Slabs/hour are ENTERED by the
// incharge (std = from cycle time, actual = counted) — never auto-calculated.
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRow } from "@/app/tables/actions";
import { SHIFT_HOURS } from "@/lib/misShiftHours";

export interface MisRowLite {
  id: string; hour: string | null; batch: string | null; design: string | null;
  cyclesUnloaded: number | null; cyclesMixed: number | null;
  slabsPerHourStd: number | null; slabsPerHourActual: number | null;
  startingSlabNumber: number | null; endingSlabNumber: number | null; numberOfJumpedSlabs: number | null;
  areaOfProblem: string[]; details: string | null;
  processDelayDurationMinutes: number | null; cleaningDelayDurationMinutes: number | null;
  breakdownDelayDurationMechanicalOrElectricalMinutes: number | null; poweroutDelayDurationMinutes: number | null;
}

const AREAS = ["Silos", "Mixer", "Distributor", "Kreos", "Chessboard", "Robot", "Press", "Oven", "Rubber Line", "Cooling Tower", "Jot"];
const DELAYS = [
  ["processDelayDurationMinutes", "Operational"],
  ["cleaningDelayDurationMinutes", "Cleaning"],
  ["breakdownDelayDurationMechanicalOrElectricalMinutes", "Mech/Elec"],
  ["poweroutDelayDurationMinutes", "Power out"],
] as const;

const inp = "w-full rounded border border-gray-300 px-1.5 py-1.5 text-sm";
const num = (v: unknown) => (v == null || v === "" ? "" : String(v));

function HourRow({ hour, date, header, existing }: {
  hour: string; date: string;
  header: { batch: string; design: string; productionType: string; thkMixer: string; thkPress: string; std: string; prodIncharge: string; maintIncharge: string };
  existing: MisRowLite | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  if (existing) {
    const delay = DELAYS.reduce((a, [k]) => a + (Number(existing[k] ?? 0) || 0), 0);
    return (
      <tr className="border-t border-gray-100 bg-emerald-50/40 text-sm">
        <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-700">{hour}</td>
        <td className="px-2 py-2 text-center">{num(existing.cyclesUnloaded) || "—"}</td>
        <td className="px-2 py-2 text-center">{num(existing.cyclesMixed) || "—"}</td>
        <td className="px-2 py-2 text-center font-medium">{num(existing.slabsPerHourStd) || "—"}</td>
        <td className="px-2 py-2 text-center font-semibold text-gray-900">{num(existing.slabsPerHourActual) || "—"}</td>
        <td className="px-2 py-2 text-center">{num(existing.startingSlabNumber) || "—"}</td>
        <td className="px-2 py-2 text-center">{num(existing.endingSlabNumber) || "—"}</td>
        <td className="px-2 py-2 text-center">{num(existing.numberOfJumpedSlabs) || "—"}</td>
        <td className="px-2 py-2 text-xs">{existing.areaOfProblem.join(", ") || "—"}</td>
        <td className="px-2 py-2 text-center text-xs">{delay > 0 ? `${delay} min` : "—"}</td>
        <td className="max-w-[200px] truncate px-2 py-2 text-xs" title={existing.details ?? ""}>{existing.details || "—"}</td>
        <td className="px-2 py-2"><a href={`/tables/Mis/${existing.id}`} className="text-xs text-brand hover:underline">edit</a></td>
      </tr>
    );
  }

  const save = () => {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const delay = DELAYS.reduce((a, [k]) => a + (Number(fd.get(k) || 0) || 0), 0);
    if (delay > 60) { setErr(`${Math.round(delay)} min delay — max 60/hour`); return; }
    if (!header.batch.trim()) { setErr("Fill Batch in the sheet header first"); return; }
    fd.set("__model", "Mis");
    fd.set("hour", hour);
    fd.set("date", date);
    fd.set("dateAndTime", `${date}T${hour.slice(0, 2)}:00:00+05:30`); // pin IST — server TZ must not shift it
    fd.set("batch", header.batch); fd.set("design", header.design);
    if (header.productionType) fd.set("productionType", header.productionType);
    if (header.thkMixer) fd.set("thkAtMixerMm", header.thkMixer);
    if (header.thkPress) fd.set("thkAtPressMm", header.thkPress);
    if (header.std) fd.set("slabsPerHourStd", header.std);
    if (header.prodIncharge) fd.set("productionInchargeName", header.prodIncharge);
    if (header.maintIncharge) fd.set("maintenanceInchargeName", header.maintIncharge);
    for (const a of areas) fd.append("areaOfProblem", a);
    start(async () => {
      const r = await createRow(undefined, fd);
      if (r && r !== "ok") setErr(r); else { setErr(null); router.refresh(); }
    });
  };

  return (
    <tr className="border-t border-gray-100 align-top text-sm">
      <td className="whitespace-nowrap px-2 py-2 font-medium text-gray-700">{hour}</td>
      {/* the row's own fields live in a form via the form= attribute trick:
          a <form> can't wrap <td>s, so inputs reference an off-table form */}
      <td className="px-1 py-1.5"><input form={`f-${hour.slice(0, 2)}`} name="cyclesUnloaded" type="number" step="any" min="0" className={inp} /></td>
      <td className="px-1 py-1.5"><input form={`f-${hour.slice(0, 2)}`} name="cyclesMixed" type="number" step="any" min="0" className={inp} /></td>
      <td className="px-1 py-1.5 text-center text-xs text-gray-500">{header.std || "—"}</td>
      <td className="px-1 py-1.5"><input form={`f-${hour.slice(0, 2)}`} name="slabsPerHourActual" type="number" step="any" min="0" className={`${inp} font-semibold`} /></td>
      <td className="px-1 py-1.5"><input form={`f-${hour.slice(0, 2)}`} name="startingSlabNumber" type="number" step="any" min="0" className={inp} /></td>
      <td className="px-1 py-1.5"><input form={`f-${hour.slice(0, 2)}`} name="endingSlabNumber" type="number" step="any" min="0" className={inp} /></td>
      <td className="px-1 py-1.5"><input form={`f-${hour.slice(0, 2)}`} name="numberOfJumpedSlabs" type="number" step="any" min="0" className={inp} /></td>
      <td className="px-1 py-1.5">
        <div className="flex max-w-[190px] flex-wrap gap-1">
          {AREAS.map((a) => (
            <button key={a} type="button" onClick={() => setAreas((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a])}
              className={`rounded-full border px-1.5 py-0.5 text-[10px] ${areas.includes(a) ? "border-brand bg-brand/10 font-medium text-brand" : "border-gray-200 text-gray-500"}`}>
              {a}
            </button>
          ))}
        </div>
      </td>
      <td className="px-1 py-1.5">
        <div className="grid w-[170px] grid-cols-2 gap-1">
          {DELAYS.map(([k, label]) => (
            <label key={k} className="block">
              <span className="block text-[9px] uppercase tracking-wide text-gray-400">{label}</span>
              <input form={`f-${hour.slice(0, 2)}`} name={k} type="number" min="0" max="60" className={inp} />
            </label>
          ))}
        </div>
      </td>
      <td className="px-1 py-1.5">
        <textarea form={`f-${hour.slice(0, 2)}`} name="details" rows={2} placeholder="Issues (why avg slabs not reached)" className={`${inp} min-w-[160px] text-xs`} />
      </td>
      <td className="px-1 py-1.5">
        <form id={`f-${hour.slice(0, 2)}`} ref={formRef} />
        <button type="button" disabled={pending} onClick={save}
          className="min-h-[38px] rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
          {pending ? "…" : "Save"}
        </button>
        {err && <div className="mt-1 max-w-[130px] text-[10px] leading-tight text-red-600">{err}</div>}
      </td>
    </tr>
  );
}

export function MisShiftSheet({ rows, date, shift, options }: {
  rows: MisRowLite[]; date: string; shift: "A" | "B" | "C";
  options: Record<string, string[]>;
}) {
  const router = useRouter();
  const [batch, setBatch] = useState("");
  const [design, setDesign] = useState("");
  const [productionType, setProductionType] = useState("");
  const [thkMixer, setThkMixer] = useState("");
  const [thkPress, setThkPress] = useState("");
  const [std, setStd] = useState("");
  const [prodIncharge, setProdIncharge] = useState("");
  const [maintIncharge, setMaintIncharge] = useState("");

  const hours = SHIFT_HOURS[shift];
  const byHour = useMemo(() => {
    const m = new Map<string, MisRowLite>();
    for (const r of rows) if (r.hour) m.set(r.hour, r);
    return m;
  }, [rows]);
  // C shift crosses midnight: 00-06 rows belong to the NEXT calendar date
  const nextDay = useMemo(() => {
    const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [date]);
  const rowDate = (hour: string) => (shift === "C" && Number(hour.slice(0, 2)) < 12 ? nextDay : date);

  const header = { batch, design, productionType, thkMixer, thkPress, std, prodIncharge, maintIncharge };
  const saved = rows;
  const tot = (f: (r: MisRowLite) => number) => saved.reduce((a, r) => a + f(r), 0);
  const totActual = tot((r) => Number(r.slabsPerHourActual ?? 0) || 0);
  const totCycU = tot((r) => Number(r.cyclesUnloaded ?? 0) || 0);
  const totCycM = tot((r) => Number(r.cyclesMixed ?? 0) || 0);
  const totDelay = tot((r) => DELAYS.reduce((a, [k]) => a + (Number(r[k] ?? 0) || 0), 0));

  const hInp = "rounded-md border border-gray-300 px-2.5 py-2 text-sm";
  const nav = (d: string, s: string) => router.push(`/entry/mis?date=${d}&shift=${s}`);
  return (
    <div className="space-y-4">
      {/* ---- Sheet header (applies to every hour row saved) ---- */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Date (shift start)</span>
            <input type="date" value={date} onChange={(e) => e.target.value && nav(e.target.value, shift)} className={hInp} /></label>
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-600">Shift</span>
            <div className="flex gap-1">
              {(["A", "B", "C"] as const).map((s) => (
                <button key={s} type="button" onClick={() => nav(date, s)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${s === shift ? "bg-brand text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-gray-500">A 06–14 · B 14–22 · C 22–06</div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Batch *</span>
            <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="e.g. 1375" className={`${hInp} w-full`} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Design / product</span>
            <input value={design} onChange={(e) => setDesign(e.target.value)} list="mis-designs" className={`${hInp} w-full`} />
            <datalist id="mis-designs">{(options.design ?? []).map((o) => <option key={o} value={o} />)}</datalist></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Production type</span>
            <select value={productionType} onChange={(e) => setProductionType(e.target.value)} className={`${hInp} w-full`}>
              <option value="">—</option>{(options.productionType ?? []).map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Slabs/hr from cycle time (Std.)</span>
            <input value={std} onChange={(e) => setStd(e.target.value)} type="number" step="any" min="0" placeholder="write, not auto" className={`${hInp} w-full`} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Thk at Mixer (mm)</span>
            <input value={thkMixer} onChange={(e) => setThkMixer(e.target.value)} type="number" step="any" min="0" className={`${hInp} w-full`} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Thk at Press (mm)</span>
            <input value={thkPress} onChange={(e) => setThkPress(e.target.value)} type="number" step="any" min="0" className={`${hInp} w-full`} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Shift Production Incharge</span>
            <input value={prodIncharge} onChange={(e) => setProdIncharge(e.target.value)} className={`${hInp} w-full`} /></label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Shift Maintenance Incharge</span>
            <input value={maintIncharge} onChange={(e) => setMaintIncharge(e.target.value)} className={`${hInp} w-full`} /></label>
        </div>
      </div>

      {/* ---- Hour rows, like the paper ---- */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full min-w-[1050px]">
          <thead>
            <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
              <th className="px-2 py-2">Hour</th>
              <th className="px-2 py-2">Cycles unloaded (Silos)</th>
              <th className="px-2 py-2">Cycles mixed (Mixer)</th>
              <th className="px-2 py-2">Slabs/hr Std.</th>
              <th className="px-2 py-2">Slabs/hr Actual</th>
              <th className="px-2 py-2">Start slab</th>
              <th className="px-2 py-2">End slab</th>
              <th className="px-2 py-2">Jumped</th>
              <th className="px-2 py-2">Area of problem</th>
              <th className="px-2 py-2">Delay (min)</th>
              <th className="px-2 py-2">Issues</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => <HourRow key={h} hour={h} date={rowDate(h)} header={header} existing={byHour.get(h) ?? null} />)}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 text-sm font-semibold text-gray-800">
              <td className="px-2 py-2">Total</td>
              <td className="px-2 py-2 text-center">{totCycU || "—"}</td>
              <td className="px-2 py-2 text-center">{totCycM || "—"}</td>
              <td className="px-2 py-2"></td>
              <td className="px-2 py-2 text-center">{totActual || "—"}</td>
              <td className="px-2 py-2" colSpan={4}>Shift output: {totActual || 0} slab(s) · {saved.length}/{hours.length} hour(s) logged</td>
              <td className="px-2 py-2 text-center">{totDelay ? `${totDelay} min` : "—"}</td>
              <td className="px-2 py-2" colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-gray-500">Each hour saves as its own MIS record (audited, editable from the row's “edit” link). Slabs/hour are written by the incharge — Std. from cycle time, Actual counted at the press — not auto-calculated.</p>
    </div>
  );
}
