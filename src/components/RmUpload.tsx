"use client";

import { useActionState } from "react";
import { uploadUnassignedRm, type UploadResult2 } from "@/app/store/actions";
import { DupeResolver } from "./DupeResolver";

const TEMPLATE = "Invoice No,Type,Size,Grade,Supplier,Total KG\nINV-2026-101,Grit,0.1-0.4,Premium,Sifucel,24000\nINV-2026-101,Filler,400#,Premium,Sifucel,13500\nINV-2026-102,Grit,2.5-4.0,Supreme,,6000\n";

export function RmUpload() {
  const [res, action, pending] = useActionState<UploadResult2 | null, FormData>(uploadUnassignedRm, null);
  const templateHref = "data:text/csv;charset=utf-8," + encodeURIComponent(TEMPLATE);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Excel / CSV file</span>
          <input name="file" type="file" accept=".xlsx,.xls,.csv" required className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-dark" />
        </label>
        <button disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50">{pending ? "Uploading…" : "Upload"}</button>
        <a href={templateHref} download="rm-template.csv" className="text-xs text-brand hover:underline">Download template</a>
      </form>

      <p className="mt-3 text-xs text-gray-400">Columns (any order, case-insensitive): <b>Invoice No</b>, <b>Type</b> (Grit/Filler), <b>Size</b>, <b>Grade</b>, <b>Supplier</b>, <b>Total KG</b>. Matched per invoice + type + size + grade.</p>

      {res && (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${res.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          <div className="font-medium">{res.ok ? "✓ " : ""}{res.message}</div>
          {res.errors.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-gray-600">
              {res.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}
      {res?.dupes && <DupeResolver dupes={res.dupes} />}
    </div>
  );
}
