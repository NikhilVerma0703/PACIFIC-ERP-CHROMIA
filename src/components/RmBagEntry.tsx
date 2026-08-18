"use client";

import { useState } from "react";
import { useActionState } from "react";
import { createAssignedBag, type BagEntryResult, type BagFormOptions } from "@/app/store/actions";

const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const label = "mb-1 block text-xs font-medium text-gray-600";
const OTHER = "__other__";

function Field({ name, title, required = false, type = "text", placeholder }: { name: string; title: string; required?: boolean; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className={label}>{title}{required && <span className="text-red-500"> *</span>}</span>
      <input name={name} type={type} step={type === "number" ? "any" : undefined} required={required} placeholder={placeholder} className={input} />
    </label>
  );
}

/** Strict dropdown from master/in-use values, with an "Other…" escape hatch
 * that reveals a text input — prevents the typos that break stock grouping
 * and silo material matching. */
function PickField({ name, title, options, required = false, allowOther = true }: { name: string; title: string; options: string[]; required?: boolean; allowOther?: boolean }) {
  const [other, setOther] = useState(false);
  return (
    <label className="block">
      <span className={label}>{title}{required && <span className="text-red-500"> *</span>}</span>
      {other ? (
        <div className="flex gap-1.5">
          <input name={name} required={required} autoFocus placeholder="type new value…" className={input} />
          <button type="button" onClick={() => setOther(false)} className="shrink-0 rounded-lg border border-gray-300 px-2 text-xs text-gray-500 hover:bg-gray-50">list</button>
        </div>
      ) : (
        <select name={name} required={required} defaultValue="" onChange={(e) => { if (e.target.value === OTHER) setOther(true); }} className={input}>
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          {allowOther && <option value={OTHER}>Other — type manually…</option>}
        </select>
      )}
    </label>
  );
}

export function RmBagEntry({ options }: { options: BagFormOptions }) {
  const [res, action, pending] = useActionState<BagEntryResult | null, FormData>(createAssignedBag, null);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <form key={res?.ok ? res.stamp : "form"} action={action}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field name="invNo" title="Invoice no" required placeholder="595251" />
          <Field name="bagNo" title="Bag no" required type="number" placeholder="1" />
          <Field name="weight" title="Bag weight (kg)" required type="number" placeholder="1250" />
          <label className="block">
            <span className={label}>Type<span className="text-red-500"> *</span></span>
            <select name="type" required className={input} defaultValue="Grit">
              <option value="Grit">Grit</option>
              <option value="Filler">Filler</option>
              <option value="Mirror Grit">Mirror Grit</option>
              <option value="Glass Grit">Glass Grit</option>
              <option value="Cristobalite Grit">Cristobalite Grit</option>
            </select>
          </label>
          <PickField name="size" title="Size" required options={options.sizes} />
          <PickField name="grade" title="Grade" required options={options.grades} />
          <PickField name="supplier" title="Supplier" options={options.suppliers} allowOther={false} />
          <PickField name="shade" title="Shade (filler/grit)" options={options.shades} />
          <Field name="date" title="Received date" type="date" />
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Supplier list comes from the Supplier Master table — a new supplier must be added there first (Tables → Supplier Master).</p>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-brand">Colour values (optional)</summary>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field name="colourL" title="Colour L" type="number" />
            <Field name="colourA" title="Colour A" type="number" />
            <Field name="colourB" title="Colour B" type="number" />
          </div>
        </details>

        <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-3">
          <button disabled={pending} className="min-h-[44px] rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">{pending ? "Saving…" : "Add bag to Assigned RM"}</button>
          <span className="text-xs text-gray-400">Goes straight into store stock — no pool, no assignment step.</span>
        </div>
      </form>

      {res && (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${res.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {res.ok ? "✓ " : ""}{res.message}
        </div>
      )}
    </div>
  );
}
