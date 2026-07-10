"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createCuttingEntry, resolveBatchFromSlab } from "@/app/cutting/actions";

const PURPOSES = ["Sample", "Display", "QC", "Waste", "Other"];

const initialState = { ok: false, message: "", stamp: 0 };

export function CuttingForm() {
  const [state, action, pending] = useActionState(createCuttingEntry, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [batchHint, setBatchHint] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);

  // Reset form on success
  useEffect(() => {
    if (state.ok && state.stamp) {
      formRef.current?.reset();
      setBatchHint(null);
    }
  }, [state.stamp, state.ok]);

  async function handleSlabBlur(e: React.FocusEvent<HTMLInputElement>) {
    const n = parseFloat(e.target.value);
    if (!Number.isFinite(n)) { setBatchHint(null); return; }
    setBatchLoading(true);
    try {
      const batch = await resolveBatchFromSlab(n);
      setBatchHint(batch);
    } finally {
      setBatchLoading(false);
    }
  }

  return (
    <form ref={formRef} action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Slab number */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Slab Number *</label>
        <input
          name="slabNumber"
          type="number"
          step="any"
          required
          onBlur={handleSlabBlur}
          placeholder="e.g. 1234"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        />
      </div>

      {/* Batch key */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">
          Batch Key
          {batchLoading && <span className="ml-2 text-xs text-gray-400">resolving…</span>}
          {batchHint && !batchLoading && (
            <span className="ml-2 text-xs text-gray-400">auto-filled: {batchHint}</span>
          )}
        </label>
        <input
          name="batchKey"
          type="text"
          placeholder={batchHint ?? "auto from slab"}
          defaultValue={batchHint ?? ""}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        />
      </div>

      {/* Design */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Design</label>
        <input
          name="design"
          type="text"
          placeholder="e.g. Calacatta"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        />
      </div>

      {/* Cut date */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Cut Date *</label>
        <input
          name="cutDate"
          type="date"
          required
          defaultValue={new Date().toISOString().slice(0, 10)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        />
      </div>

      {/* Operator */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Operator *</label>
        <input
          name="operator"
          type="text"
          required
          placeholder="Name of cutter"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        />
      </div>

      {/* Purpose */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Purpose</label>
        <select
          name="purpose"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        >
          <option value="">— select —</option>
          {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Dimensions */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Length (cm)</label>
        <input
          name="lengthCm"
          type="number"
          step="0.1"
          min="0"
          placeholder="cm"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Width (cm)</label>
        <input
          name="widthCm"
          type="number"
          step="0.1"
          min="0"
          placeholder="cm"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Thickness (mm)</label>
        <input
          name="thicknessMm"
          type="number"
          step="0.1"
          min="0"
          placeholder="mm"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        />
      </div>

      {/* Quantity */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Quantity</label>
        <input
          name="quantity"
          type="number"
          min="1"
          defaultValue="1"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        />
      </div>

      {/* Remarks */}
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label className="text-xs font-medium text-gray-600">Remarks</label>
        <input
          name="remarks"
          type="text"
          placeholder="Optional notes"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-pacific-dark focus:ring-1 focus:ring-pacific-dark"
        />
      </div>

      {/* Submit */}
      <div className="flex items-end sm:col-span-2 lg:col-span-3">
        <div className="flex w-full items-center gap-4">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-pacific-dark px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-pacific-dark/90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Log Entry"}
          </button>
          {state.message && (
            <p className={`text-sm ${state.ok ? "text-green-600" : "text-red-600"}`}>
              {state.message}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
