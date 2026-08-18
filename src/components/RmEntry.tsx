"use client";

import { useActionState } from "react";
import { createUnassignedRm, type ManualEntryResult } from "@/app/store/actions";

const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const label = "mb-1 block text-xs font-medium text-gray-600";

function Field({ name, title, required = false, type = "text", step, placeholder }: { name: string; title: string; required?: boolean; type?: string; step?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className={label}>{title}{required && <span className="text-red-500"> *</span>}</span>
      <input name={name} type={type} step={step} required={required} placeholder={placeholder} className={input} />
    </label>
  );
}

export function RmEntry() {
  const [res, action, pending] = useActionState<ManualEntryResult | null, FormData>(createUnassignedRm, null);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {/* key resets the uncontrolled form after a successful save */}
      <form key={res?.ok ? res.stamp : "form"} action={action}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field name="invNo" title="Invoice no" required placeholder="INV-2026-101" />
          <label className="block">
            <span className={label}>Type<span className="text-red-500"> *</span></span>
            <select name="type" required className={input} defaultValue="Grit">
              <option value="Grit">Grit</option>
              <option value="Filler">Filler</option>
            </select>
          </label>
          <Field name="size" title="Size" placeholder="0.1-0.4 / 400#" />
          <Field name="grade" title="Grade" placeholder="Premium" />
          <Field name="supplier" title="Supplier" />
          <Field name="totalKg" title="Total KG" required type="number" step="any" placeholder="24000" />
          <Field name="date" title="Received date" type="date" />
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-brand">QC / lab details (optional)</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field name="status" title="Status" placeholder="Accepted" />
            <Field name="testedBy" title="Tested by" />
            <Field name="availability" title="Availability" />
            <Field name="contamination" title="Contamination" />
            <Field name="gritShade" title="Grit shade" />
            <Field name="fillerShade" title="Filler shade" />
            <Field name="colourL" title="Colour L" type="number" step="any" />
            <Field name="colourA" title="Colour A" type="number" step="any" />
            <Field name="colourB" title="Colour B" type="number" step="any" />
            <Field name="consumablesIssue" title="Consumables issue" />
            <label className="col-span-2 block sm:col-span-3">
              <span className={label}>Remarks</span>
              <textarea name="remarks" rows={2} className={input} />
            </label>
          </div>
        </details>

        <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-3">
          <button disabled={pending} className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">{pending ? "Saving…" : "Add to unassigned pool"}</button>
          <span className="text-xs text-gray-400">One line per invoice + type + size + grade. Bags are assigned later.</span>
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
