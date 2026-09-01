"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { Toast } from "./Toast";
import { createRow } from "@/app/tables/actions";
import { guardAction, SERVER_UNREACHABLE } from "@/lib/guardAction";
import { getSmartDefaults, getBatchForSlab } from "@/app/entry/slab/actions";
import type { FieldMeta } from "@/lib/tables";
import { OPERATOR_FIELDS } from "@/lib/operatorFields";
import { isCurated, OTHER_SENTINEL } from "@/lib/categoricalFields";
import { secondsToHHMM } from "@/lib/time";
import type { SlabMode } from "@/lib/smartEntry";
import { isRequiredField } from "@/lib/requiredFields";
import { PhotoField } from "./PhotoField";
import { PHOTO_SLOTS, hasPhotoPair, PAIR_TARGET, PAIR_HARD_MAX } from "@/lib/photoSlots";

const guardedCreateRow = guardAction(createRow, SERVER_UNREACHABLE);

// Current local date+time as a datetime-local value ("YYYY-MM-DDTHH:mm"), used to
// pre-fill empty Date fields so an entry always carries a date even if the
// operator doesn't touch it (it stays editable — they can still change it).
function nowLocalDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

/** The photo inputs for a slab entry. Polish QC gets the far/near pair the slab
 *  -intake form uses — the same two views of the same defect, so a grade can be
 *  looked at again later — but OPTIONAL here (owner, 2026-09-01): QC entry runs
 *  slab after slab and must never be stopped by a camera. Every other station
 *  keeps the single generic photo it has always had. Both post through
 *  createRow → savePhotoFromForm, which stores whichever slots arrive. */
function PhotoFields({ model }: { model: string }) {
  if (!hasPhotoPair(model)) return <PhotoField />;
  return (
    <>
      {PHOTO_SLOTS.map((p) => (
        <PhotoField key={p.slot} field={p.field} label={p.title} hint={p.hint} target={PAIR_TARGET} hardMax={PAIR_HARD_MAX} />
      ))}
    </>
  );
}

// Module-scope field component: keeps a stable component identity across renders
// so uncontrolled inputs are NOT remounted (typed values survive state updates).
function PumpBoxes({ name, def }: { name: string; def: string }) {
  // def is the stored pump list, e.g. "1,3" — which pumps ran this batch
  const initial = new Set(String(def || "").split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => n >= 1 && n <= 4));
  const [on, setOn] = useState<boolean[]>([1, 2, 3, 4].map((n) => initial.has(n)));
  const list = [1, 2, 3, 4].filter((n) => on[n - 1]).join(",");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2">
      {[0, 1, 2, 3].map((i) => (
        <label key={i} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${on[i] ? "border-brand bg-brand/10 text-brand" : "border-gray-200 text-gray-600"}`}>
          <input type="checkbox" checked={on[i]} onChange={() => setOn((s) => s.map((v, j) => (j === i ? !v : v)))} className="h-3.5 w-3.5" />
          Pump {i + 1}
        </label>
      ))}
      <input type="hidden" name={name} value={list} />
    </div>
  );
}

function SlabField({ f, locked, def, opts, operatorName, unlocked, onUnlock, required = false }: { f: FieldMeta; locked: boolean; def: string; opts?: string[]; operatorName?: string | null; unlocked: Set<string>; onUnlock: (field: string) => void; required?: boolean }) {
  const [typeNew, setTypeNew] = useState(false); // curated fields: "+ Add new…" escape
  // Pre-fill an empty Date field with the current date+time once mounted (after
  // SSR, so no hydration mismatch). Remounts per slab via the fields key, so each
  // slab gets the current time; a value the operator already has is left alone.
  const dateRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (f.kind === "date" && dateRef.current && !dateRef.current.value) dateRef.current.value = nowLocalDatetime();
  }, [f.kind]);
  if (f.prismaField === "vacuumPumps") {
    return (
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600">Vacuum pumps</span>
        <PumpBoxes name={f.prismaField} def={def} />
      </label>
    );
  }
  if (OPERATOR_FIELDS.has(f.prismaField) && operatorName) {
    return (
      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">{f.airtableName}<span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">you</span></span>
        <input name={f.prismaField} defaultValue={operatorName} readOnly className={inputCls + " bg-brand/[0.04] text-gray-700"} />
      </label>
    );
  }
  const isLocked = locked && !unlocked.has(f.prismaField);
  const tint = isLocked ? " border-brand/30 bg-brand/[0.04] text-gray-700" : "";
  let input;
  const selectable = (f.airtableType === "singleSelect" || isCurated(f.prismaField)) && opts?.length;
  if (selectable && typeNew) {
    input = (
      <div className="flex gap-1.5">
        <input name={f.prismaField} autoFocus placeholder="type the new value…" className={inputCls} />
        <button type="button" onClick={() => setTypeNew(false)} className="shrink-0 rounded-lg border border-gray-300 px-2 text-xs text-gray-500 hover:bg-gray-50">list</button>
      </div>
    );
  } else if (selectable) {
    const extra = def && !opts!.includes(def) ? [def] : [];
    input = (
      <select name={f.prismaField} defaultValue={def} required={required} onChange={(e) => { if (e.target.value === OTHER_SENTINEL) setTypeNew(true); }} className={inputCls + tint}>
        <option value="">—</option>
        {[...extra, ...opts!].map((o) => <option key={o} value={o}>{o}</option>)}
        {isCurated(f.prismaField) && <option value={OTHER_SENTINEL}>+ Add new…</option>}
      </select>
    );
  } else if (f.airtableType === "multipleSelects" && opts?.length) {
    const arr = def ? def.split(",").map((x) => x.trim()) : [];
    input = <div className={`flex flex-wrap gap-1.5 rounded-lg border border-gray-200 p-2${isLocked ? " bg-brand/[0.04]" : ""}`}>{opts.map((o) => <label key={o} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs"><input type="checkbox" name={f.prismaField} value={o} defaultChecked={arr.includes(o)} className="h-3.5 w-3.5" />{o}</label>)}</div>;
  } else if (f.airtableType === "duration") {
    // time-of-day picker (same UX as the Date field) — stored as duration
    input = <input name={f.prismaField} type="time" defaultValue={def ? secondsToHHMM(Number(def)) : ""} readOnly={isLocked} className={inputCls + tint} />;
  } else if (isLocked) {
    input = <input name={f.prismaField} defaultValue={def} readOnly className={inputCls + tint} />;
  } else if (f.kind === "bool") {
    input = <input name={f.prismaField} type="checkbox" defaultChecked={def === "true"} className="h-4 w-4 rounded border-gray-300 text-brand" />;
  } else {
    const type = f.kind === "number" || f.kind === "int" ? "number" : f.kind === "date" ? "datetime-local" : "text";
    input = <input ref={f.kind === "date" ? dateRef : undefined} name={f.prismaField} type={type} step={type === "number" ? "any" : undefined} inputMode={f.kind === "int" ? "numeric" : f.kind === "number" ? "decimal" : undefined} required={required} defaultValue={def} className={inputCls} />;
  }
  const isReadonlyText = isLocked && !(opts?.length && (f.airtableType === "singleSelect" || f.airtableType === "multipleSelects"));
  return (
    <label className="block" onDoubleClick={() => isReadonlyText && onUnlock(f.prismaField)}>
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">{f.airtableName}{required && <span className="text-red-500" title="Required">*</span>}{isLocked && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">from batch{isReadonlyText ? " · dbl-click" : ""}</span>}</span>
      {input}
    </label>
  );
}

export function SmartSlabForm({ model, tableName, fields, paramFieldSet, options = {}, operatorName, batchField = "batch", slabMode = "increment", slabOptions = [], slabFirst = false }: { model: string; tableName: string; fields: FieldMeta[]; paramFieldSet: string[]; options?: Record<string, string[]>; operatorName?: string | null; batchField?: string; slabMode?: SlabMode; slabOptions?: number[]; slabFirst?: boolean; }) {
  // guardAction: a dropped connection mid-save shows in the bar instead of
  // throwing the page to global-error with the slab half typed (lib/guardAction).
  const [msg, action, pending] = useActionState(guardedCreateRow, undefined);
  const [batch, setBatch] = useState("");
  const [defaults, setDefaults] = useState<{ values: Record<string, unknown>; slabAutofill?: number | null; lineThickness?: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [batchLocked, setBatchLocked] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  // After every successful save: toast, then RELOAD the batch defaults so the
  // slab number auto-advances (+1) and parameters re-fill for the next slab.
  useEffect(() => {
    if (pending || msg !== "ok") return;
    setSavedCount((c) => c + 1);
    if (batch.trim()) void loadDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, msg]);

  const paramSet = new Set(paramFieldSet);
  const editable = fields.filter((f) => f.editable && f.prismaField !== batchField);
  const paramF = editable.filter((f) => paramSet.has(f.prismaField) && f.prismaField !== "remarks");
  const slabF0 = editable.filter((f) => (!paramSet.has(f.prismaField) || f.prismaField === "remarks") && f.prismaField !== "slabNumber");
  // remarks always last, under Slab details
  const slabF = [...slabF0.filter((f) => f.prismaField !== "remarks"), ...slabF0.filter((f) => f.prismaField === "remarks")];
  const slabNumberField = editable.find((f) => f.prismaField === "slabNumber");

  async function loadDefaults() {
    if (!batch.trim()) return;
    setLoading(true);
    const r = await getSmartDefaults(model, batch);
    if (!r) { setLoading(false); return; } // no access to this form
    setDefaults(r); setUnlocked(new Set()); setVersion((v) => v + 1); setLoading(false);
  }

  // Polish stations: slab number drives the batch (looked up from Press).
  async function resolveFromSlab(slabVal: string) {
    if (!slabVal.trim()) return;
    setLoading(true);
    const r = await getBatchForSlab(model, slabVal.trim());
    setLoading(false);
    if (!r) return;
    if (r.batch) {
      setBatch(r.batch); setBatchLocked(true);
      setDefaults(r.defaults ?? null); setUnlocked(new Set()); setVersion((v) => v + 1);
    } else {
      setBatchLocked(false); // not in Press — operator enters the batch
    }
  }

  function dv(f: string): string {
    const v = defaults?.values?.[f];
    if (v == null) return "";
    return Array.isArray(v) ? v.join(", ") : String(v);
  }

  const grid = "grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3";

  function clearForm() {
    setBatch(""); setDefaults(null); setUnlocked(new Set()); setBatchLocked(false); setVersion((v) => v + 1);
  }

  return (
    <form action={action} autoComplete="off">
      <Toast trigger={savedCount} text="Saved — enter the next slab" />
      {batch.trim() && defaults && (
        <div className="sticky top-0 z-10 -mx-5 mb-4 border-b border-brand/20 bg-brand/[0.06] px-5 py-2 backdrop-blur">
          <span className="text-sm font-semibold text-brand">Batch {batch.trim().toUpperCase()}</span>
          {defaults?.lineThickness && <span className="ml-2 rounded bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">Thickness {defaults.lineThickness} <span className="font-normal text-gray-500">(from line head)</span></span>}
          <span className="ml-2 text-xs text-gray-500">{tableName} — every save goes to this batch</span>
        </div>
      )}
      <input type="hidden" name="__model" value={model} />
      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Batch &amp; slab</div>
          <button type="button" onClick={clearForm} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50">Clear form</button>
        </div>
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
          <label className={`block ${slabFirst ? "sm:order-2" : ""}`}>
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">Batch{slabFirst && batchLocked && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">from Press</span>}</span>
            <input name={batchField} value={batch} onChange={(e) => setBatch(e.target.value)} onBlur={batchLocked ? undefined : loadDefaults} readOnly={batchLocked} required placeholder="e.g. D1310" className={inputCls + (batchLocked ? " border-brand/30 bg-brand/[0.04] text-gray-700" : "")} />
            <span className="mt-1 block text-[11px] text-gray-400">{loading ? "Loading…" : slabFirst ? (batchLocked ? "auto-filled from Press for this slab" : "not in Press — enter the batch") : "Enter batch, then Tab — parameters auto-fill"}</span>
          </label>
          {slabNumberField && (
            <label className={`block ${slabFirst ? "sm:order-1" : ""}`} key={slabFirst ? "slab" : `slab-${version}`}>
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">Slab Number
                {slabMode === "increment" && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">+1 in batch</span>}
                {slabMode === "dropdown" && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">awaiting QC</span>}
                {slabMode === "manual" && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">manual</span>}
              </span>
              {slabMode === "dropdown" ? (
                <>
                  <input name="slabNumber" type="text" required list="slab-options" defaultValue="" placeholder="type to search…" onBlur={slabFirst ? (e) => resolveFromSlab(e.target.value) : undefined} className={`${inputCls} font-medium`} />
                  <datalist id="slab-options">{slabOptions.map((n) => <option key={n} value={n} />)}</datalist>
                  <span className="mt-1 block text-[11px] text-gray-400">{slabOptions.length.toLocaleString("en-IN")} polish-entry slab(s) awaiting QC · type to search &amp; pick</span>
                </>
              ) : slabMode === "manual" ? (
                <>
                  <input name="slabNumber" type="text" required defaultValue="" onBlur={slabFirst ? (e) => resolveFromSlab(e.target.value) : undefined} className={`${inputCls} font-medium`} />
                  <span className="mt-1 block text-[11px] text-gray-400">manual — enter the slab number (e.g. 84, or 84a for an in-between slab)</span>
                </>
              ) : (
                <>
                  <input name="slabNumber" type="text" required defaultValue={defaults?.slabAutofill ?? ""} className={`${inputCls} font-medium`} />
                  <span className="mt-1 block text-[11px] text-gray-400">{defaults ? (defaults.slabAutofill != null ? "auto: last in batch + 1 · editable · extra in-between slab? type e.g. 84a" : "first slab of this batch — enter it manually") : "enter batch — autofills last + 1"}</span>
                </>
              )}
            </label>
          )}
        </div>
      </div>

      <div key={`fields-${version}`}>
        {paramF.length > 0 && (
          <div className="mb-5 rounded-2xl border border-brand/15 bg-brand/[0.02] p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-brand/80">Batch parameters {defaults ? "· auto-filled" : ""}</div>
            <div className={grid}>{paramF.map((f) => <SlabField key={f.prismaField} f={f} locked={defaults?.values?.[f.prismaField] != null} def={dv(f.prismaField)} opts={options[f.prismaField]} operatorName={operatorName} unlocked={unlocked} onUnlock={(fld) => setUnlocked((s) => new Set(s).add(fld))} required={isRequiredField(model, f.prismaField)} />)}</div>
          </div>
        )}
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Slab details</div>
          <div className={grid}>{slabF.map((f) => <SlabField key={f.prismaField} f={f} locked={false} def={f.prismaField === "qualityGrade" ? "Not graded yet" : ""} opts={options[f.prismaField]} operatorName={operatorName} unlocked={unlocked} onUnlock={(fld) => setUnlocked((s) => new Set(s).add(fld))} required={isRequiredField(model, f.prismaField)} />)}<PhotoFields model={model} /></div>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-5 mt-6 flex items-center justify-between gap-3 border-t border-gray-200 bg-white/85 px-5 py-3 backdrop-blur safe-bottom">
        <div className="text-sm">{msg === "ok" ? <span className="text-green-600">Saved &#10003; — enter the next slab</span> : msg ? <span className="text-red-600">{msg}</span> : <span className="text-gray-400">{tableName} · smart entry</span>}</div>
        <button disabled={pending} className="min-h-[44px] rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-60">{pending ? "Saving…" : "Save slab"}</button>
      </div>
    </form>
  );
}
