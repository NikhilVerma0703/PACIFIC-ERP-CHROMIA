"use client";
import { useState } from "react";

interface MappingRow {
  label: string;
  drawingNumber: string;
  pieceLabel: string;
  length: number;
  width: number;
  thickness: number;
  quantity: number;
  bucket: 2 | 3 | null;
}

interface Counts { total: number; cm2: number; cm3: number; other: number; }

function downloadXlsx(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function ExcelToCsvExport({ projectCode, projectId }: { projectCode: string; projectId: string }) {
  const [loading,  setLoading]  = useState(false);
  const [xlsx2cm,  setXlsx2cm]  = useState<string | null>(null);
  const [xlsx3cm,  setXlsx3cm]  = useState<string | null>(null);
  const [mapping,  setMapping]  = useState<MappingRow[] | null>(null);
  const [counts,   setCounts]   = useState<Counts | null>(null);
  const [error,    setError]    = useState("");
  const [showMap,  setShowMap]  = useState(false);

  async function generate() {
    setLoading(true); setError(""); setXlsx2cm(null); setXlsx3cm(null);
    setMapping(null); setCounts(null); setShowMap(false);

    const res  = await fetch(`/api/fab/excel-to-clo-csv?projectId=${projectId}`);
    const data = await res.json();
    setLoading(false);

    if (!res.ok) { setError(data.error ?? "Failed to generate"); return; }
    setXlsx2cm(data.xlsx2cm);
    setXlsx3cm(data.xlsx3cm);
    setMapping(data.mapping);
    setCounts(data.counts);
  }

  const base = projectCode.replace(/\s+/g, "_");

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-gray-800">Generate CLO Optimizer Files</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Generates 2 cm and 3 cm Excel files ready to import into CLO Optimizer
          </p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition
            ${loading
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-gray-900 text-white hover:bg-gray-700"}`}>
          {loading ? "Generating..." : counts ? "Regenerate" : "Generate"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4">{error}</p>
      )}

      {counts && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { label: "Total pieces", val: counts.total, col: "bg-gray-100 text-gray-700" },
              { label: "2 cm",         val: counts.cm2,   col: "bg-blue-50 text-blue-700 border border-blue-200" },
              { label: "3 cm",         val: counts.cm3,   col: "bg-purple-50 text-purple-700 border border-purple-200" },
              ...(counts.other > 0
                ? [{ label: "Other", val: counts.other, col: "bg-yellow-50 text-yellow-700 border border-yellow-200" }]
                : []),
            ].map((c) => (
              <span key={c.label} className={`text-xs px-3 py-1 rounded-full font-medium ${c.col}`}>
                {c.label}: {c.val}
              </span>
            ))}
          </div>

          <div className="flex gap-3 mb-4">
            <button
              disabled={!xlsx2cm || counts.cm2 === 0}
              onClick={() => xlsx2cm && downloadXlsx(xlsx2cm, `${base}_CLO_2cm.xlsx`)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700
                         disabled:bg-gray-200 disabled:text-gray-400
                         text-white rounded-lg text-sm font-medium transition">
              Download 2 cm Excel
              {counts.cm2 > 0 && (
                <span className="bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded-full">{counts.cm2}</span>
              )}
            </button>
            <button
              disabled={!xlsx3cm || counts.cm3 === 0}
              onClick={() => xlsx3cm && downloadXlsx(xlsx3cm, `${base}_CLO_3cm.xlsx`)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700
                         disabled:bg-gray-200 disabled:text-gray-400
                         text-white rounded-lg text-sm font-medium transition">
              Download 3 cm Excel
              {counts.cm3 > 0 && (
                <span className="bg-purple-500 text-white text-xs px-1.5 py-0.5 rounded-full">{counts.cm3}</span>
              )}
            </button>
          </div>

          <button
            onClick={() => setShowMap((v) => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 underline mb-2">
            {showMap ? "Hide" : "Show"} label mapping ({counts.total} rows)
          </button>

          {showMap && mapping && (
            <div className="overflow-auto max-h-72 border border-gray-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {["Label", "Drawing", "Piece", "Length", "Width", "Thick", "Qty"].map((h) => (
                      <th key={h} className="text-left px-3 py-2 text-gray-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {mapping.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-mono font-bold text-gray-800">{r.label}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.drawingNumber}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.pieceLabel || "-"}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.length}</td>
                      <td className="px-3 py-1.5 text-gray-700">{r.width}</td>
                      <td className="px-3 py-1.5 text-gray-500">{r.thickness}</td>
                      <td className="px-3 py-1.5 text-center text-gray-700">{r.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
