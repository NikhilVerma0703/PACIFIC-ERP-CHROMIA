"use client";

import { useActionState } from "react";
import { createResinDelivery, uploadResinDeliveries, type ResinEntryResult, type UploadResult2 } from "@/app/store/actions";
import { DupeResolver } from "./DupeResolver";

const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const label = "mb-1 block text-xs font-medium text-gray-600";
const TEMPLATE = "Tank No,Invoice No,Supplier,Quantity KG,Vehicle,Date\nO1,RS-2026-101,Ineos,24000,TN09AB1234,2026-06-11\n";

export function RmResinEntry({ tanks }: { tanks: string[] }) {
  const [res, action, pending] = useActionState<ResinEntryResult | null, FormData>(createResinDelivery, null);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 text-sm font-semibold text-gray-800">Log a tanker delivery</div>
      <form key={res?.ok ? res.stamp : "form"} action={action}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={label}>Tank no<span className="text-red-500"> *</span></span>
            {tanks.length ? (
              <select name="tankNo" required className={input} defaultValue="">
                <option value="">—</option>
                {tanks.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : <input name="tankNo" required placeholder="O1" className={input} />}
          </label>
          <label className="block"><span className={label}>Invoice no<span className="text-red-500"> *</span></span><input name="invoiceNo" required placeholder="RS-2026-101" className={input} /></label>
          <label className="block"><span className={label}>Quantity (kg)<span className="text-red-500"> *</span></span><input name="quantity" type="number" step="any" required placeholder="24000" className={input} /></label>
          <label className="block"><span className={label}>Supplier</span><input name="supplier" placeholder="Ineos" className={input} /></label>
          <label className="block"><span className={label}>Vehicle no</span><input name="vehicle" placeholder="TN09AB1234" className={input} /></label>
          <label className="block"><span className={label}>Date</span><input name="date" type="date" className={input} /></label>
        </div>
        <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-3">
          <button disabled={pending} className="min-h-[44px] rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">{pending ? "Saving…" : "Log delivery"}</button>
          <span className="text-xs text-gray-400">Remaining quantity starts at the delivered amount.</span>
        </div>
      </form>
      {res && <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${res.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>{res.ok ? "✓ " : ""}{res.message}</div>}
    </div>
  );
}

export function RmResinUpload() {
  const [res, action, pending] = useActionState<UploadResult2 | null, FormData>(uploadResinDeliveries, null);
  const templateHref = "data:text/csv;charset=utf-8," + encodeURIComponent(TEMPLATE);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 text-sm font-semibold text-gray-800">Resin deliveries — Excel upload</div>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className={label}>Excel / CSV — one row per delivery</span>
          <input name="file" type="file" accept=".xlsx,.xls,.csv" required className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-dark" />
        </label>
        <button disabled={pending} className="min-h-[44px] rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50">{pending ? "Uploading…" : "Upload"}</button>
        <a href={templateHref} download="resin-template.csv" className="text-xs text-brand hover:underline">Download template</a>
      </form>
      <p className="mt-3 text-xs text-gray-400">Columns: <b>Tank No</b>, <b>Invoice No</b>, <b>Supplier</b>, <b>Quantity KG</b>, <b>Vehicle</b>, <b>Date</b>. Duplicates (same tank + invoice) are held for your decision.</p>
      {res && (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${res.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          <div className="font-medium">{res.ok ? "✓ " : ""}{res.message}</div>
          {res.errors.length > 0 && <ul className="mt-2 list-inside list-disc text-xs text-gray-600">{res.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}
      {res?.dupes && <DupeResolver dupes={res.dupes} />}
    </div>
  );
}
