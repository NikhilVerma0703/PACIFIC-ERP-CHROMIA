"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postForm } from "@/lib/fab/postJson";

// Step three: the PO's PDF, in TWO steps.
//
// Parse and PREVIEW first — nothing is written by that call at all. The manager
// sees the rows, how many Qty-0 rows were skipped, and the totals computed from
// the rows against the totals row the PDF itself prints. Only then does Confirm
// send the SAME file back to be parsed again and written. The file is re-sent
// rather than the parsed rows: rows that travel through a browser are rows a
// browser could have edited, and reconciling against the document's own totals
// is worth nothing if the numbers can be changed in between.
//
// Only the piece table is read. Page 1 of the PO — number, buyer, material,
// thickness, dates, terms, destination, prices — is never looked at.

interface PreviewRow {
  rowNumber: number;
  label: string;
  lengthIn: number;
  widthIn: number;
  quantity: number;
  totalSqft: number;
}

interface Preview {
  fileName: string;
  rows: PreviewRow[];
  skipped: { count: number; rowNumbers: number[] };
  computed: { rowCount: number; totalPieces: number; totalSqft: number; totalSqftExact: number };
  stated: { totalPieces: number; totalSqft: number } | null;
  warnings: string[];
}

export function PoPdfUpload({ poId, poNumber }: { poId: string; poNumber: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"" | "parsing" | "importing">("");
  const [errors, setErrors] = useState<string[]>([]);

  function discard() {
    setFile(null); setPreview(null); setErrors([]);
  }

  async function parse(f: File) {
    setBusy("parsing"); setErrors([]); setPreview(null); setFile(f);
    const form = new FormData();
    form.append("file", f);
    const res = await postForm("/api/fab/manager/pos/parse", form);
    setBusy("");
    if (!res.ok) {
      const list: string[] = Array.isArray(res.data?.errors) && res.data.errors.length
        ? res.data.errors
        : [res.error ?? "Could not read that PDF."];
      setErrors(list);
      setFile(null);
      return;
    }
    setPreview(res.data.preview as Preview);
  }

  async function confirm() {
    if (!file) return;
    setBusy("importing"); setErrors([]);
    const form = new FormData();
    form.append("poId", poId);
    form.append("file", file);
    const res = await postForm("/api/fab/manager/pos/import", form);
    setBusy("");
    if (!res.ok) {
      const list: string[] = Array.isArray(res.data?.errors) && res.data.errors.length
        ? res.data.errors
        : [res.error ?? "Could not import that PO."];
      setErrors(list);
      return;
    }
    discard();
    router.refresh();
  }

  const statedMatches =
    preview?.stated != null &&
    preview.stated.totalPieces === preview.computed.totalPieces;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {!preview && (
        <label
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 border-dashed text-xs font-medium transition ${
            busy === "parsing"
              ? "border-blue-300 bg-blue-50 text-blue-400 cursor-wait"
              : "border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600 cursor-pointer"
          }`}
        >
          {busy === "parsing" ? "Reading the PDF…" : `Upload PO ${poNumber} PDF`}
          <input
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            disabled={busy !== ""}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) parse(f); e.target.value = ""; }}
          />
        </label>
      )}

      {errors.length > 0 && (
        <div className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-1">
          <p className="font-semibold">Nothing was imported.</p>
          {errors.map((e, i) => <p key={i} className="text-xs">{e}</p>)}
        </div>
      )}

      {preview && (
        <div className="mt-1 space-y-3">
          <p className="text-xs text-slate-400 truncate">{preview.fileName}</p>

          {/* The reconciliation, side by side. This is the thing being confirmed. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold text-slate-500 mb-1">From the piece rows</p>
              <p className="text-sm text-slate-900">
                {preview.computed.rowCount} row{preview.computed.rowCount === 1 ? "" : "s"} ·{" "}
                <strong>{preview.computed.totalPieces}</strong> pieces ·{" "}
                <strong>{preview.computed.totalSqft.toFixed(2)}</strong> sqft
              </p>
            </div>
            <div className={`rounded-lg border p-3 ${statedMatches ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <p className="text-[11px] font-semibold text-slate-500 mb-1">The PDF&apos;s own totals row</p>
              <p className="text-sm text-slate-900">
                {preview.stated
                  ? <><strong>{preview.stated.totalPieces}</strong> pieces · <strong>{preview.stated.totalSqft.toFixed(2)}</strong> sqft</>
                  : "none"}
              </p>
            </div>
          </div>

          {preview.skipped.count > 0 && (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              {preview.skipped.count} row{preview.skipped.count === 1 ? "" : "s"} had Qty 0 and will not be
              imported: row {preview.skipped.rowNumbers.join(", ")}.
            </p>
          )}

          {preview.warnings.map((wn, i) => (
            <p key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{wn}</p>
          ))}

          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-1.5 text-slate-400 font-semibold">Row</th>
                  <th className="text-right px-3 py-1.5 text-slate-400 font-semibold">Length (in)</th>
                  <th className="text-right px-3 py-1.5 text-slate-400 font-semibold">Width (in)</th>
                  <th className="text-right px-3 py-1.5 text-slate-400 font-semibold">Qty</th>
                  <th className="text-right px-3 py-1.5 text-slate-400 font-semibold">SFT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {preview.rows.map((r) => (
                  <tr key={r.rowNumber} className="hover:bg-slate-50">
                    <td className="px-3 py-1 font-mono font-semibold text-slate-800">{r.label}</td>
                    <td className="px-3 py-1 text-right text-slate-600">{r.lengthIn}</td>
                    <td className="px-3 py-1 text-right text-slate-600">{r.widthIn}</td>
                    <td className="px-3 py-1 text-right text-slate-600">{r.quantity}</td>
                    <td className="px-3 py-1 text-right text-slate-500">{r.totalSqft.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-400">
            Nothing has been saved yet. Confirming creates {preview.computed.rowCount} requirement
            row{preview.computed.rowCount === 1 ? "" : "s"} on PO {poNumber}; sinks are assigned later
            by the supervisor.
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={confirm}
              disabled={busy !== ""}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition"
            >
              {busy === "importing" ? "Importing…" : `Confirm — create ${preview.computed.rowCount} rows`}
            </button>
            <button
              onClick={discard}
              disabled={busy !== ""}
              className="text-sm text-slate-500 hover:text-slate-800 px-3 py-2"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
