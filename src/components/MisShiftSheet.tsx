"use client";
// MIS hourly entry — paper layout, ONE hour per save:
// pick the hour from a dropdown (defaults to the running hour), the shift
// comes up automatically from that hour, and who's filling is stamped from
// the login (shown read-only). Slabs/hour Std. and Actual are both WRITTEN
// by the incharge — never auto-calculated.
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRow } from "@/app/tables/actions";
import { SHIFT_HOURS, shiftOfHour } from "@/lib/misShiftHours";

export interface MisRowLite {
  id: string; hour: string | null; batch: string | null; design: string | null;
  productionType: string | null; thkAtPressMm: number | null;
  slabsPerHourStd: number | null; slabsPerHourActual: number | null;
  startingSlabNumber: number | null; endingSlabNumber: number | null; numberOfJumpedSlabs: number | null;
  areaOfProblem: string[]; details: string | null;
  processDelayDurationMinutes: number | null; cleaningDelayDurationMinutes: number | null;
  breakdownDelayDurationMechanicalOrElectricalMinutes: number | null; poweroutDelayDurationMinutes: number | null;
}

const ALL_HOURS = [...SHIFT_HOURS.A, ...SHIFT_HOURS.B, ...SHIFT_HOURS.C];
const AREAS = ["Silos", "Mixer", "Distributor", "Kreos", "Chessboard", "Robot", "Press", "Oven", "Rubber Line", "Cooling Tower", "Jot"];
const DELAYS = [
  ["processDelayDurationMinutes", "Operational"],
  ["cleaningDelayDurationMinutes", "Cleaning"],
  ["breakdownDelayDurationMechanicalOrElectricalMinutes", "Mech/Elec"],
  ["poweroutDelayDurationMinutes", "Power out"],
] as const;
const CATS = [["aCategory", "A cat."], ["aCategory2", "A- cat."], ["bCategory", "B cat."], ["cCategory", "C cat."]] as const;

const inp = "w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm";
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const num = (v: unknown) => (v == null || v === "" ? "" : String(v));
const plusDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export interface MisPrefill {
  batch?: string; design?: string; thkPress?: string; productionType?: string;
  prodIncharge?: string; fromPress?: boolean;
}

export function MisShiftSheet({ rows, date, shift, hour: hourParam, operatorName, options, prefill }: {
  rows: MisRowLite[]; date: string; shift: "A" | "B" | "C"; hour?: string;
  operatorName: string; options: Record<string, string[]>; prefill?: MisPrefill;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Header initializes from the server-computed prefill (login + live press
  // data + previous MIS row of this shift) but every field stays editable.
  const [batch, setBatch] = useState(prefill?.batch ?? "");
  const [design, setDesign] = useState(prefill?.design ?? "");
  const [productionType, setProductionType] = useState(prefill?.productionType ?? "");
  const [thkPress, setThkPress] = useState(prefill?.thkPress ?? "");
  const [prodIncharge, setProdIncharge] = useState(prefill?.prodIncharge ?? operatorName);
  const [maintIncharge, setMaintIncharge] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);

  const logged = useMemo(() => new Set(rows.map((r) => r.hour)), [rows]);
  const defaultHour = () => {
    const h = new Date(Date.now() + 330 * 60000).getUTCHours(); // IST hour
    const wall = `${String(h).padStart(2, "0")} - ${String((h + 1) % 24).padStart(2, "0")}`;
    // stay inside the shift whose rows are loaded (bookmarked links, old tabs)
    if (shiftOfHour(wall) === shift) return wall;
    return SHIFT_HOURS[shift].find((x) => !logged.has(x)) ?? SHIFT_HOURS[shift][0];
  };
  const [hour, setHour] = useState<string>(hourParam && ALL_HOURS.includes(hourParam) ? hourParam : defaultHour());
  const hShift = shiftOfHour(hour);
  // calendar date OF THE CHOSEN HOUR (C-shift hours past midnight = anchor+1)
  const hourDate = hShift === "C" && Number(hour.slice(0, 2)) < 12 ? plusDay(date, 1) : date;

  const onHour = (h: string) => {
    setHour(h);
    const s = shiftOfHour(h);
    if (s !== shift) {
      // moving into another shift's window -> reload that shift's rows.
      // Picking an after-midnight hour from a day view means LAST night's C shift.
      const anchor = s === "C" && Number(h.slice(0, 2)) < 6 ? plusDay(date, -1) : date;
      router.push(`/entry/mis?date=${anchor}&shift=${s}&hour=${encodeURIComponent(h)}`);
    }
  };

  const save = () => {
    const form = formRef.current;
    if (!form) return;
    if (hShift !== shift) { setErr("Loading that shift\u2026 tap Save again in a moment"); return; }
    const fd = new FormData(form);
    const delay = DELAYS.reduce((a, [k]) => a + (Number(fd.get(k) || 0) || 0), 0);
    if (delay > 60) { setErr(`${Math.round(delay)} min delay — max 60 in one hour`); return; }
    if (!batch.trim()) { setErr("Batch is required"); return; }
    if (logged.has(hour)) { setErr(`Hour ${hour} is already logged — use its edit link below`); return; }
    fd.set("__model", "Mis");
    fd.set("hour", hour);
    fd.set("date", hourDate);
    fd.set("dateAndTime", `${hourDate}T${hour.slice(0, 2)}:00:00+05:30`); // IST-pinned
    fd.set("batch", batch); fd.set("design", design);
    if (productionType) fd.set("productionType", productionType);
    if (thkPress) fd.set("thkAtPressMm", thkPress);
    if (prodIncharge) fd.set("productionInchargeName", prodIncharge);
    if (maintIncharge) fd.set("maintenanceInchargeName", maintIncharge);
    for (const a of areas) fd.append("areaOfProblem", a);
    for (const r of reasons) fd.append("reasonForDeviation", r);
    start(async () => {
      const r = await createRow(undefined, fd);
      if (r && r !== "ok") { setOk(null); setErr(r); }
      else {
        setErr(null); setOk(`Hour ${hour} saved ✓`);
        form.reset(); setAreas([]); setReasons([]);
        router.refresh();
      }
    });
  };

  const totActual = rows.reduce((a, r) => a + (Number(r.slabsPerHourActual ?? 0) || 0), 0);
  const totDelay = rows.reduce((a, r) => a + DELAYS.reduce((x, [k]) => x + (Number(r[k] ?? 0) || 0), 0), 0);

  return (
    <div className="space-y-4">
      {/* ---- Header: when + who + what's running ---- */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="block"><span className={lbl}>Date</span>
            <input type="date" value={date} onChange={(e) => e.target.value && router.push(`/entry/mis?date=${e.target.value}&shift=${shift}&hour=${encodeURIComponent(hour)}`)} className={inp + " w-auto"} /></label>
          <label className="block"><span className={lbl}>Hour</span>
            <select value={hour} onChange={(e) => onHour(e.target.value)} className={inp + " w-auto font-medium"}>
              {ALL_HOURS.map((h) => <option key={h} value={h}>{h}{logged.has(h) && shiftOfHour(h) === shift ? " ✓ logged" : ""}</option>)}
            </select></label>
          <div className="rounded-lg bg-brand/10 px-3 py-2 text-sm font-semibold text-brand">Shift {hShift} (auto)</div>
          <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">Filled by: <span className="font-semibold">{operatorName}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="block"><span className={lbl}>Batch *{prefill?.fromPress && batch === prefill?.batch && batch ? <span className="ml-1 font-normal text-gray-400">(from press data)</span> : null}</span>
            <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="e.g. 1375" className={inp} /></label>
          <label className="block"><span className={lbl}>Design / product{prefill?.fromPress && design === prefill?.design && design ? <span className="ml-1 font-normal text-gray-400">(from press data)</span> : null}</span>
            <input value={design} onChange={(e) => setDesign(e.target.value)} list="mis-designs" className={inp} />
            <datalist id="mis-designs">{(options.design ?? []).map((o) => <option key={o} value={o} />)}</datalist></label>
          <label className="block"><span className={lbl}>Production type{prefill?.productionType && productionType === prefill?.productionType ? <span className="ml-1 font-normal text-gray-400">(from previous hour)</span> : null}</span>
            <select value={productionType} onChange={(e) => setProductionType(e.target.value)} className={inp}>
              <option value="">—</option>{(options.productionType ?? []).map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className="block"><span className={lbl}>Thk at Press (mm){prefill?.thkPress && thkPress === prefill?.thkPress ? <span className="ml-1 font-normal text-gray-400">(from previous hour)</span> : null}</span>
            <input value={thkPress} onChange={(e) => setThkPress(e.target.value)} type="number" step="any" min="0" className={inp} /></label>
          <label className="block"><span className={lbl}>Production Incharge</span>
            <input value={prodIncharge} onChange={(e) => setProdIncharge(e.target.value)} className={inp} /></label>
          <label className="block"><span className={lbl}>Maintenance Incharge</span>
            <input value={maintIncharge} onChange={(e) => setMaintIncharge(e.target.value)} className={inp} /></label>
        </div>
      </div>

      {/* ---- This hour's entry ---- */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-gray-800">Hour {hour} — production</div>
        <form ref={formRef}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <label className="block"><span className={lbl}>Slabs/hr — Std. (from cycle time)</span>
              <input name="slabsPerHourStd" type="number" step="any" min="0" className={inp} /></label>
            <label className="block"><span className={lbl}>Slabs/hr — Actual</span>
              <input name="slabsPerHourActual" type="number" step="any" min="0" className={`${inp} font-semibold`} /></label>
            <label className="block"><span className={lbl}>Starting slab no.</span>
              <input name="startingSlabNumber" type="number" step="any" min="0" className={inp} /></label>
            <label className="block"><span className={lbl}>Ending slab no.</span>
              <input name="endingSlabNumber" type="number" step="any" min="0" className={inp} /></label>
            <label className="block"><span className={lbl}>Jumped slabs</span>
              <input name="numberOfJumpedSlabs" type="number" step="any" min="0" className={inp} /></label>
            {CATS.map(([k, label]) => (
              <label key={k} className="block"><span className={lbl}>{label}</span>
                <input name={k} type="number" step="any" min="0" className={inp} /></label>
            ))}
          </div>

          <div className="mb-3 mt-5 text-sm font-semibold text-gray-800">Problems &amp; downtime (if any)</div>
          <div className="mb-3">
            <span className={lbl}>Area of problem</span>
            <div className="flex flex-wrap gap-1.5">
              {(options.areaOfProblem?.length ? options.areaOfProblem : AREAS).map((a) => (
                <button key={a} type="button" onClick={() => setAreas((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a])}
                  className={`rounded-full border px-2.5 py-1 text-xs ${areas.includes(a) ? "border-brand bg-brand/10 font-medium text-brand" : "border-gray-200 text-gray-500"}`}>{a}</button>
              ))}
            </div>
          </div>
          {(options.reasonForDeviation ?? []).length > 0 && (
            <div className="mb-3">
              <span className={lbl}>Reason for deviation</span>
              <div className="flex flex-wrap gap-1.5">
                {(options.reasonForDeviation ?? []).map((r) => (
                  <button key={r} type="button" onClick={() => setReasons((p) => p.includes(r) ? p.filter((x) => x !== r) : [...p, r])}
                    className={`rounded-full border px-2.5 py-1 text-xs ${reasons.includes(r) ? "border-amber-500 bg-amber-50 font-medium text-amber-700" : "border-gray-200 text-gray-500"}`}>{r}</button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {DELAYS.map(([k, label]) => (
              <label key={k} className="block"><span className={lbl}>{label} delay (min)</span>
                <input name={k} type="number" min="0" max="60" className={inp} /></label>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className={lbl}>Any breakdown?</span>
              <select name="anyBreakdownYesNo" className={inp}><option value="">—</option><option>Yes</option><option>No</option></select></label>
            <label className="block"><span className={lbl}>Action taken</span>
              {(options.actionTaken ?? []).length > 0
                ? <select name="actionTaken" className={inp}><option value="">—</option>{(options.actionTaken ?? []).map((o) => <option key={o}>{o}</option>)}</select>
                : <input name="actionTaken" className={inp} />}</label>
            <label className="block"><span className={lbl}>Spares used</span>
              <input name="sparesUsed" className={inp} /></label>
            <label className="block"><span className={lbl}>Additional remarks</span>
              <input name="additionalRemarks" className={inp} /></label>
          </div>
          <label className="mt-3 block"><span className={lbl}>Issues (why avg slabs could not be reached)</span>
            <textarea name="details" rows={2} className={inp} /></label>
        </form>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled={pending} onClick={save}
            className="min-h-[44px] rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-60">
            {pending ? "Saving…" : `Save hour ${hour}`}
          </button>
          {err && <span className="text-sm text-red-600">{err}</span>}
          {ok && !err && <span className="text-sm text-emerald-600">{ok}</span>}
        </div>
      </div>

      {/* ---- Already logged this shift ---- */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="px-4 pt-3 text-sm font-semibold text-gray-800">Shift {shift} — logged hours ({rows.length}/8)</div>
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2">Hour</th><th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Std.</th><th className="px-3 py-2">Actual</th>
              <th className="px-3 py-2">Start</th><th className="px-3 py-2">End</th><th className="px-3 py-2">Jumped</th>
              <th className="px-3 py-2">Areas</th><th className="px-3 py-2">Delay</th><th className="px-3 py-2">Issues</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="px-3 py-4 text-center text-gray-400">No hours logged yet in this shift.</td></tr>}
            {rows.map((r) => {
              const delay = DELAYS.reduce((a, [k]) => a + (Number(r[k] ?? 0) || 0), 0);
              return (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{r.hour}</td>
                  <td className="px-3 py-2">{r.batch ?? "—"}</td>
                  <td className="px-3 py-2 text-center">{num(r.slabsPerHourStd) || "—"}</td>
                  <td className="px-3 py-2 text-center font-semibold">{num(r.slabsPerHourActual) || "—"}</td>
                  <td className="px-3 py-2 text-center">{num(r.startingSlabNumber) || "—"}</td>
                  <td className="px-3 py-2 text-center">{num(r.endingSlabNumber) || "—"}</td>
                  <td className="px-3 py-2 text-center">{num(r.numberOfJumpedSlabs) || "—"}</td>
                  <td className="max-w-[160px] truncate px-3 py-2 text-xs" title={r.areaOfProblem.join(", ")}>{r.areaOfProblem.join(", ") || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-center">{delay > 0 ? `${delay} min` : "—"}</td>
                  <td className="max-w-[180px] truncate px-3 py-2 text-xs" title={r.details ?? ""}>{r.details || "—"}</td>
                  <td className="px-3 py-2"><a href={`/tables/Mis/${r.id}`} className="text-xs text-brand hover:underline">edit</a></td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-800">
                <td className="px-3 py-2" colSpan={3}>Shift total</td>
                <td className="px-3 py-2 text-center">{totActual || "—"}</td>
                <td className="px-3 py-2" colSpan={4}>slab(s) this shift</td>
                <td className="px-3 py-2 text-center">{totDelay ? `${totDelay} min` : "—"}</td>
                <td className="px-3 py-2" colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
