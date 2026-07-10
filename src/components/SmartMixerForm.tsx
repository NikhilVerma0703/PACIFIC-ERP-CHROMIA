"use client";

import { useState } from "react";
import { RecordEditor } from "@/components/RecordEditor";
import type { SiloFormInfo } from "@/lib/silo";
import { getMixerDefaults } from "@/app/entry/mixer/actions";
import type { FieldMeta } from "@/lib/tables";

const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function SmartMixerForm({ fields, options, hideFields = ["batch"], operatorName, silos, canEditBags }: { fields: FieldMeta[]; options: Record<string, string[]>; hideFields?: string[]; operatorName?: string | null; silos?: SiloFormInfo[]; canEditBags?: boolean }) {
  const [batch, setBatch] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);

  async function load() {
    if (!batch.trim()) { setNote("Saved ✓ — enter a batch to start the next cycle."); setLoaded(false); setVersion((v) => v + 1); return; }
    setLoading(true);
    const r = await getMixerDefaults(batch);
    if (!r) { setLoading(false); return; } // no access to this form
    setValues(r.values || { batch });
    setNote(r.found ? "Cloned previous cycle · Cycle advanced by 1 · mixers pre-selected" : "No previous cycle for this batch — starting at Cycle 1");
    setLoaded(true);
    setVersion((v) => v + 1);
    setLoading(false);
  }

  function clearForm() {
    setBatch(""); setValues({}); setNote(""); setLoaded(false); setVersion((v) => v + 1);
  }

  return (
    <>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="max-w-sm flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">Batch</label>
          <input value={batch} onChange={(e) => setBatch(e.target.value)} onBlur={load} placeholder="e.g. D1310" className={inputCls} />
          <span className="mt-1 block text-[11px] text-gray-400">{loading ? "Loading previous cycle…" : note || "Enter batch, then Tab — the last cycle is cloned"}</span>
        </div>
        <button type="button" onClick={clearForm} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 mt-5">Clear form</button>
      </div>
      {loaded ? (
        <RecordEditor key={version} model="MixerCycle" fields={fields} values={values} mode="new" options={options} hideFields={hideFields} operatorName={operatorName} silos={silos} canEditBags={canEditBags} onSaved={load} />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white/50 p-8 text-center text-sm text-gray-500">Enter a batch above to begin.</div>
      )}
    </>
  );
}
