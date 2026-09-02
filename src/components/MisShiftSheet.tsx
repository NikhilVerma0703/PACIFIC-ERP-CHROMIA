"use client";
// MIS hourly entry — paper layout, ONE hour per save:
// pick the hour from a dropdown (defaults to the running hour), the shift
// comes up automatically from that hour, and who's filling is stamped from
// the login (shown read-only). Slabs/hour Std. and Actual are both WRITTEN
// by the incharge — never auto-calculated.
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRow } from "@/app/tables/actions";
import { lastMisEntryForBatch } from "@/app/entry/mis/actions";
import { SHIFT_HOURS, shiftOfHour } from "@/lib/misShiftHours";
// The delay bounds and the Std rule are the SAME sentences the server enforces
// (createRow / saveRow read them from this module too) — the browser copy just
// says them before the round trip, while the operator is still in the box.
import { misDelayFieldError, misStdRequiredError } from "@/lib/requiredFields";

export interface MisRowLite {
  id: string; hour: string | null; batch: string | null; design: string | null;
  electricalInchargeName?: string | null; mechanicalInchargeName?: string | null;
  productionType: string | null; thkAtPressMm: string | null;
  slabsPerHourStd: number | null; slabsPerHourActual: number | null;
  startingSlabNumber: number | null; endingSlabNumber: number | null; numberOfJumpedSlabs: number | null;
  areaOfProblem: string[]; details: string | null;
  processDelayDurationMinutes: number | null; cleaningDelayDurationMinutes: number | null;
  breakdownDelayDurationMechanicalOrElectricalMinutes: number | null; poweroutDelayDurationMinutes: number | null;
}

const ALL_HOURS = [...SHIFT_HOURS.A, ...SHIFT_HOURS.B, ...SHIFT_HOURS.C];
const AREAS = ["Silos", "Mixer", "Distributor", "Kreos", "Chessboard", "Robot", "Press", "Oven", "Rubber Line", "Cooling Tower", "Jot"];
// Fixed incharge rosters — multi-select (a shift can have more than one person).
const ELEC_INCHARGE = ["Guna", "Sundar", "Kumar", "Ramarasan"];
const MECH_INCHARGE = ["Mohan", "Manikya", "Narayanan", "Joseph", "Arun"];
// Production incharge stays typeable — a new man must be enterable on the night
// he starts — but the roster is offered as suggestions so the usual four land on
// ONE spelling. The scoreboard pays this name, and "SURESH" beside "Suresh" was
// two people with two scores until the scorer started folding case.
const PROD_INCHARGE = ["Suresh", "Pradhap", "Appalaraju", "Sivaiha"];
const DELAYS = [
  ["processDelayDurationMinutes", "Operational"],
  ["cleaningDelayDurationMinutes", "Cleaning"],
  ["breakdownDelayDurationMechanicalOrElectricalMinutes", "Mech/Elec"],
  ["poweroutDelayDurationMinutes", "Power out"],
] as const;

const inp = "w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm";
const lbl = "mb-1 block text-xs font-medium text-gray-600";
const num = (v: unknown) => (v == null || v === "" ? "" : String(v));
const plusDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export interface MisPrefill {
  batch?: string; design?: string; thkPress?: string; productionType?: string;
  prodIncharge?: string; fromPress?: boolean;
  elecIncharge?: string; mechIncharge?: string;
  startSlab?: string; endSlab?: string; actual?: string;
}

export function MisShiftSheet({ rows, loggedDay, date, shift, hour: hourParam, operatorName, options, prefill }: {
  rows: MisRowLite[]; loggedDay?: string[]; date: string; shift: "A" | "B" | "C"; hour?: string;
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
  // Multi-select: stored comma-joined in the existing text column, so the DB takes the
  // multi-pick as-is (no schema change) and the shift report / Telegram show it verbatim.
  // Parse the comma-joined prefill AND keep only names in the current roster — a legacy
  // value that isn't a roster option (e.g. an old free-text "Sundar") has no chip to show
  // or clear, so carrying it invisibly would silently pollute the next save.
  const parseNames = (s: string | undefined, roster: string[]) =>
    (s ?? "").split(",").map((x) => x.trim()).filter((x) => roster.includes(x));
  const [elecIncharge, setElecIncharge] = useState<string[]>(parseNames(prefill?.elecIncharge, ELEC_INCHARGE));
  const [mechIncharge, setMechIncharge] = useState<string[]>(parseNames(prefill?.mechIncharge, MECH_INCHARGE));
  const [areas, setAreas] = useState<string[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  // Starting slab is state (not just a defaultValue) so entering the batch can
  // fill it from that batch's last entry. form.reset() cannot clear a controlled
  // input, so save() restores it to the prefill explicitly.
  const [startSlab, setStartSlab] = useState(prefill?.startSlab ?? "");
  // What the last carry actually filled — each hint is shown only for the field
  // that was really set, so "(filled: last entry + 1)" never sits over an untouched box.
  // `kept` names what the carry had to offer but did NOT write because the box
  // already held something: a carry that changes nothing on screen otherwise
  // looks like a carry that failed.
  const [carried, setCarried] = useState<{ batch: string; design: boolean; slab: boolean; kept: string[] } | null>(null);
  const lookedUp = useRef<string>("");
  // Rising id: only the newest lookup may write. Two quick blurs otherwise let a
  // slow first response land last and overwrite the batch actually on screen.
  const carrySeq = useRef(0);

  /** Entering a batch carries its design forward and starts the slab count where
   * the previous hour of that batch ended. Both stay editable.
   *
   * FILLS EMPTY BOXES ONLY. It used to overwrite whatever was on screen, so a
   * design and a starting slab typed for this hour vanished the moment the batch
   * field lost focus — no warning, no undo, and the operator usually noticed
   * after saving. A carry is a convenience; what the person typed outranks it. */
  const carryFromBatch = async () => {
    const b = batch.trim();
    if (!b || b === lookedUp.current) return;
    lookedUp.current = b;
    const seq = ++carrySeq.current;
    try {
      // Same IST-pinned stamp the save uses, so the carry continues from the
      // hour before THIS one rather than from whatever was logged most recently.
      const c = await lastMisEntryForBatch(b, `${hourDate}T${hour.slice(0, 2)}:00:00+05:30`);
      if (seq !== carrySeq.current) return; // a newer batch was entered meanwhile
      if (!c || (!c.design && c.nextStartSlab == null)) { setCarried(null); return; }
      const filledDesign = !!c.design && !design.trim();
      const filledSlab = c.nextStartSlab != null && !startSlab.trim();
      if (filledDesign && c.design) setDesign(c.design);
      if (filledSlab && c.nextStartSlab != null) setStartSlab(String(c.nextStartSlab));
      const kept: string[] = [];
      if (c.design && !filledDesign && c.design.trim() !== design.trim()) kept.push(`design ${c.design}`);
      if (c.nextStartSlab != null && !filledSlab && String(c.nextStartSlab) !== startSlab.trim()) kept.push(`starting slab ${c.nextStartSlab}`);
      setCarried({ batch: b, design: filledDesign, slab: filledSlab, kept });
    } catch {
      // a failed lookup leaves what was typed — and must stay retryable, so the
      // batch is released rather than remembered as "already looked up"
      if (seq === carrySeq.current) { lookedUp.current = ""; setCarried(null); }
    }
  };

  const logged = useMemo(() => new Set(rows.map((r) => r.hour)), [rows]);
  // ✓-logged ticks for the WHOLE day (any shift) — the same-shift `logged` set
  // alone lost the morning's ticks the moment the sheet moved to the next shift.
  const loggedDaySet = useMemo(() => new Set(loggedDay ?? []), [loggedDay]);
  const defaultHour = () => {
    // the just-ENDED hour — MUST mirror the server's initialHourFor rule,
    // else prefill (computed server-side) belongs to a different hour
    const h = (new Date(Date.now() + 330 * 60000).getUTCHours() + 23) % 24;
    const wall = `${String(h).padStart(2, "0")} - ${String((h + 1) % 24).padStart(2, "0")}`;
    // stay inside the shift whose rows are loaded (bookmarked links, old tabs)
    if (shiftOfHour(wall) === shift) return wall;
    return SHIFT_HOURS[shift].find((x) => !logged.has(x)) ?? SHIFT_HOURS[shift][0];
  };
  const [hour, setHour] = useState<string>(hourParam && ALL_HOURS.includes(hourParam) ? hourParam : defaultHour());
  const hShift = shiftOfHour(hour);
  // calendar date OF THE CHOSEN HOUR (C-shift hours past midnight = anchor+1)
  const hourDate = hShift === "C" && Number(hour.slice(0, 2)) < 12 ? plusDay(date, 1) : date;

  /** How many boxes of THIS hour's entry hold something the operator put there.
   *  The three fields the server prefills from press/line data don't count while
   *  they still equal that prefill — a reload brings them straight back, so
   *  warning about them would train the crew to click through the warning. */
  const dirtyEntryCount = (): number => {
    const form = formRef.current;
    let n = areas.length + reasons.length;
    // The header lives in component state rather than in the form, and the
    // reload re-prefills it from the server as well — a batch and a design typed
    // for this hour are just as gone as the figures below them.
    for (const [now, was] of [
      [batch, prefill?.batch ?? ""], [design, prefill?.design ?? ""],
      [productionType, prefill?.productionType ?? ""], [thkPress, prefill?.thkPress ?? ""],
    ]) if (now.trim() && now.trim() !== was.trim()) n++;
    if (!form) return n;
    const prefilled: Record<string, string> = {
      slabsPerHourActual: prefill?.actual ?? "",
      endingSlabNumber: prefill?.endSlab ?? "",
      startingSlabNumber: prefill?.startSlab ?? "",
    };
    for (const [k, v] of new FormData(form).entries()) {
      if (typeof v !== "string") continue;
      const val = v.trim();
      if (!val || val === (prefilled[k] ?? "").trim()) continue;
      n++;
    }
    return n;
  };

  /** Changing the hour or the date RELOADS the sheet — the server recomputes the
   *  prefill for the new slot and the form remounts empty. That used to happen
   *  without a word: an operator half-way through an hour who reached for the
   *  Hour dropdown lost every figure typed, and the only way to notice was that
   *  the boxes were suddenly blank. Both selects are controlled by state, so
   *  declining here leaves them showing the slot still on screen. */
  const confirmDiscard = (change: string): boolean => {
    const n = dirtyEntryCount();
    if (n === 0) return true;
    return window.confirm(`${change} reloads this sheet, and the ${n} entr${n === 1 ? "y" : "ies"} filled in for hour ${hour} will be cleared.\n\nContinue and lose them?`);
  };

  const onHour = (h: string) => {
    if (!confirmDiscard(`Changing the hour to ${h}`)) return;
    setHour(h);
    const s = shiftOfHour(h);
    // ALWAYS reload: the server recomputes the press/line prefill for the newly
    // chosen hour. The sheet is a production day (06:00 date → 06:00 date+1), so a
    // 00–06 (C) hour picked from a day shift is THIS day's COMING night — keep `date`
    // (shiftRows maps the C 00–06 slots to date+1) instead of jumping back a day.
    router.push(`/entry/mis?date=${date}&shift=${s}&hour=${encodeURIComponent(h)}`);
  };

  const save = () => {
    const form = formRef.current;
    if (!form) return;
    if (hShift !== shift) { setErr("Loading that shift\u2026 tap Save again in a moment"); return; }
    const fd = new FormData(form);
    // Each bucket before the sum: the sum below is blind to a negative, which is
    // exactly how a minus figure used to reach the server (min="0" on the input
    // is browser decoration a tablet keyboard can walk past) and cancel a real
    // stoppage logged in another hour. Same rule, same wording, as the server.
    for (const [k] of DELAYS) {
      const fErr = misDelayFieldError(k, fd.get(k));
      if (fErr) { setErr(fErr); return; }
    }
    const delay = DELAYS.reduce((a, [k]) => a + (Number(fd.get(k) || 0) || 0), 0);
    if (delay > 60) { setErr(`${Math.round(delay)} min delay — max 60 in one hour`); return; }
    if (!batch.trim()) { setErr("Batch is required"); return; }
    if (!design.trim()) { setErr("Design / product is required"); return; }
    if (!productionType.trim()) { setErr("Production type is required — pick it before saving"); return; }
    if (!thkPress.trim()) { setErr("Thk at Press (mm) is required"); return; }
    // Std slab/hr is mandatory only when Actual is filled (non-zero): you can't log real
    // output without the standard it's measured against. When Actual is blank/0, Std stays
    // optional. The rule now lives in lib/requiredFields.ts, because for a year it lived
    // ONLY here — and /tables/Mis create and every /tables/Mis/[id] edit walked past it.
    { const sErr = misStdRequiredError(fd.get("slabsPerHourStd"), fd.get("slabsPerHourActual")); if (sErr) { setErr(sErr); return; } }
    // The start can be carried from the batch's last hour while the end still
    // holds an older press prefill, which reads as a backwards range. Caught
    // here rather than saved, because the pair drives the slab count downstream.
    const sSlab = Number(fd.get("startingSlabNumber") ?? 0) || 0;
    const eSlab = Number(fd.get("endingSlabNumber") ?? 0) || 0;
    if (sSlab > 0 && eSlab > 0 && eSlab < sSlab) { setErr(`Ending slab ${eSlab} is before the starting slab ${sSlab} — check the range`); return; }
    // The line's widest real hour is 35 slabs. Above 60 it is a digit slip, and
    // the scoreboard throws the whole hour away rather than let one typo swallow
    // a month — so it is caught here, while the hour is still fresh. The server
    // repeats this check; this copy just saves a round trip.
    if (sSlab > 0 && eSlab > 0 && eSlab - sSlab >= 60) { setErr(`Slabs ${sSlab}-${eSlab} is ${eSlab - sSlab + 1} slabs in one hour — check the range`); return; }
    if (!prodIncharge.trim()) { setErr("Production Incharge is required — the shift score is paid to this name"); return; }
    if (logged.has(hour)) { setErr(`Hour ${hour} is already logged — use its edit link below`); return; }
    fd.set("__model", "Mis");
    fd.set("hour", hour);
    fd.set("date", hourDate);
    fd.set("dateAndTime", `${hourDate}T${hour.slice(0, 2)}:00:00+05:30`); // IST-pinned
    fd.set("batch", batch); fd.set("design", design);
    if (productionType) fd.set("productionType", productionType);
    if (thkPress) fd.set("thkAtPressMm", thkPress);
    if (prodIncharge) fd.set("productionInchargeName", prodIncharge);
    if (elecIncharge.length) fd.set("electricalInchargeName", elecIncharge.join(", "));
    if (mechIncharge.length) fd.set("mechanicalInchargeName", mechIncharge.join(", "));
    for (const a of areas) fd.append("areaOfProblem", a);
    for (const r of reasons) fd.append("reasonForDeviation", r);
    start(async () => {
      // createRow answers every business failure with a string; the CALL itself
      // rejects when the tablet's Wi-Fi drops mid-post or the session has
      // expired. Uncaught, React 19 routes that out of the transition to
      // global-error.tsx and the typed hour is gone with the page — so it is
      // caught here and shown in the sheet, with everything still filled in.
      let r: string | undefined;
      try { r = await createRow(undefined, fd); }
      catch { setOk(null); setErr("Could not reach the server — nothing was saved. Check the connection and tap Save again."); return; }
      if (r && r !== "ok") { setOk(null); setErr(r); }
      else {
        setErr(null); setOk(`Hour ${hour} saved ✓`);
        form.reset(); setAreas([]); setReasons([]);
        setStartSlab(prefill?.startSlab ?? ""); // controlled — reset() cannot clear it
        setCarried(null);                       // its hints no longer describe the reset fields
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
            <input type="date" value={date} onChange={(e) => {
              const d = e.target.value;
              if (!d || !confirmDiscard(`Changing the date to ${d}`)) return;
              router.push(`/entry/mis?date=${d}&shift=${shift}&hour=${encodeURIComponent(hour)}`);
            }} className={inp + " w-auto"} /></label>
          <label className="block"><span className={lbl}>Hour</span>
            <select value={hour} onChange={(e) => onHour(e.target.value)} className={inp + " w-auto font-medium"}>
              {ALL_HOURS.map((h) => <option key={h} value={h}>{h}{loggedDaySet.has(h) || (logged.has(h) && shiftOfHour(h) === shift) ? " ✓ logged" : ""}</option>)}
            </select></label>
          <div className="rounded-lg bg-brand/10 px-3 py-2 text-sm font-semibold text-brand">Shift {hShift} (auto)</div>
          <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">Filled by: <span className="font-semibold">{operatorName}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="block"><span className={lbl}>Batch *{prefill?.fromPress && batch === prefill?.batch && batch ? <span className="ml-1 font-normal text-gray-400">(from press data)</span> : null}</span>
            <input value={batch} onChange={(e) => setBatch(e.target.value)} onBlur={carryFromBatch}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); carryFromBatch(); } }}
              placeholder="e.g. 1375" className={inp} />
            {carried && carried.kept.length > 0 && carried.batch === batch.trim()
              ? <span className="mt-1 block text-xs text-amber-600">Batch {carried.batch} carries {carried.kept.join(" and ")} — kept what you typed instead. Clear the box to take the carried value.</span>
              : null}</label>
          <label className="block"><span className={lbl}>Design / product *{carried?.design && carried.batch === batch.trim() ? <span className="ml-1 font-normal text-gray-400">(filled from batch {carried.batch})</span> : prefill?.fromPress && design === prefill?.design && design ? <span className="ml-1 font-normal text-gray-400">(from press data)</span> : null}</span>
            <input value={design} onChange={(e) => setDesign(e.target.value)} list="mis-designs" className={inp} />
            <datalist id="mis-designs">{(options.design ?? []).map((o) => <option key={o} value={o} />)}</datalist></label>
          <label className="block"><span className={lbl}>Production type *{prefill?.productionType && productionType === prefill?.productionType ? <span className="ml-1 font-normal text-gray-400">(from line data)</span> : null}</span>
            <select value={productionType} onChange={(e) => setProductionType(e.target.value)} className={inp}>
              <option value="">—</option>{(options.productionType ?? []).map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className="block"><span className={lbl}>Thk at Press (mm) *{prefill?.thkPress && thkPress === prefill?.thkPress ? <span className="ml-1 font-normal text-gray-400">(from line data)</span> : null}</span>
            <select value={thkPress} onChange={(e) => setThkPress(e.target.value)} className={inp}>
              <option value="">—</option>
              <option value="12">12 (12 mm / 1.2 cm)</option>
              <option value="20">20 (2 cm)</option>
              <option value="30">30 (3 cm)</option>
              <option value="20 & 30">20 &amp; 30 (both this hour)</option>
              {thkPress && !["", "12", "20", "30", "20 & 30"].includes(thkPress) && <option value={thkPress}>{thkPress}</option>}
            </select></label>
          <label className="block"><span className={lbl}>Production Incharge <span className="font-normal text-red-500">*</span></span>
            <input value={prodIncharge} onChange={(e) => setProdIncharge(e.target.value)} list="mis-prod-incharge" required className={inp} />
            <datalist id="mis-prod-incharge">{PROD_INCHARGE.map((n) => <option key={n} value={n} />)}</datalist></label>
          <label className="block"><span className={lbl}>Electrical Incharge <span className="font-normal text-gray-400">(select one or more)</span></span>
            <div className="flex flex-wrap gap-1.5">
              {ELEC_INCHARGE.map((n) => (
                <button key={n} type="button" onClick={() => setElecIncharge((p) => p.includes(n) ? p.filter((x) => x !== n) : [...p, n])}
                  className={`rounded-full border px-2.5 py-1 text-xs ${elecIncharge.includes(n) ? "border-brand bg-brand/10 font-medium text-brand" : "border-gray-200 text-gray-500"}`}>{n}</button>
              ))}
            </div></label>
          <label className="block"><span className={lbl}>Mechanical Incharge <span className="font-normal text-gray-400">(select one or more)</span></span>
            <div className="flex flex-wrap gap-1.5">
              {MECH_INCHARGE.map((n) => (
                <button key={n} type="button" onClick={() => setMechIncharge((p) => p.includes(n) ? p.filter((x) => x !== n) : [...p, n])}
                  className={`rounded-full border px-2.5 py-1 text-xs ${mechIncharge.includes(n) ? "border-brand bg-brand/10 font-medium text-brand" : "border-gray-200 text-gray-500"}`}>{n}</button>
              ))}
            </div></label>
        </div>
      </div>

      {/* ---- This hour's entry ---- */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-semibold text-gray-800">Hour {hour} — production</div>
        <form ref={formRef}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <label className="block"><span className={lbl}>Slabs/hr — Std. (from cycle time) <span className="font-normal text-gray-400">(required if Actual is filled)</span></span>
              <input name="slabsPerHourStd" type="number" step="any" min="0" className={inp} /></label>
            <label className="block"><span className={lbl}>Slabs/hr — Actual{prefill?.actual ? <span className="ml-1 font-normal text-gray-400">(press: {prefill.actual})</span> : null}</span>
              <input name="slabsPerHourActual" type="number" step="any" min="0" defaultValue={prefill?.actual ?? ""} className={`${inp} font-semibold`} /></label>
            <label className="block"><span className={lbl}>Starting slab no.{carried?.slab && carried.batch === batch.trim() ? <span className="ml-1 font-normal text-gray-400">(last entry + 1)</span> : prefill?.startSlab ? <span className="ml-1 font-normal text-gray-400">(from press)</span> : null}</span>
              <input name="startingSlabNumber" type="number" step="any" min="0" value={startSlab} onChange={(e) => setStartSlab(e.target.value)} className={inp} /></label>
            <label className="block"><span className={lbl}>Ending slab no.{prefill?.endSlab ? <span className="ml-1 font-normal text-gray-400">(from press)</span> : null}</span>
              <input name="endingSlabNumber" type="number" step="any" min="0" defaultValue={prefill?.endSlab ?? ""} className={inp} /></label>
            <label className="block"><span className={lbl}>Jumped slabs</span>
              <input name="numberOfJumpedSlabs" type="number" step="any" min="0" className={inp} /></label>
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
                  <td className="px-3 py-2"><a href={`/tables/Mis/${r.id}`} className="tap-area text-xs text-brand hover:underline">edit</a></td>
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
