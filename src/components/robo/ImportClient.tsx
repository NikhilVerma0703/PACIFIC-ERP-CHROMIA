"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui";

interface ImportLogRow {
  id: string;
  fileName: string;
  period: string | null;
  status: string;
  totalRows: number;
  imported: number;
  skipped: number;
  failed: number;
  message: string | null;
  user: string;
  createdAt: string;
}

interface PreviewResult {
  fileName: string;
  fatal: string | null;
  sheetName: string;
  detectedColumns: string[];
  hasSetupSheet?: boolean;
  totalRows: number;
  willImport: number;
  willSkip: number;
  failed: number;
  issues: string[];
  sample: { date: string; shiftNumber: number; slabNumber: string; designName: string; inTime: string; outTime: string }[];
}

interface ImportResult {
  status: string;
  totalRows: number;
  imported: number;
  skipped: number;
  failed: number;
  message: string;
  historyReady: boolean;
  issues?: string[];
}

function statusClass(status: string) {
  if (status === "success") return "text-green-600";
  if (status === "partial") return "text-amber-600";
  return "text-red-600";
}

function fmtWhen(iso: string, user: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return user;
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleDateString("en-GB", { month: "short" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon}. ${hh}:${mm} · ${user}`;
}

export function ImportClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState<"" | "preview" | "import">("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [logs, setLogs] = useState<ImportLogRow[]>([]);
  const [historyReady, setHistoryReady] = useState(true);

  const loadLogs = useCallback(async () => {
    const res = await fetch("/api/robo/imports");
    if (!res.ok) return;
    const data: { logs?: ImportLogRow[]; ready?: boolean } = await res.json();
    setLogs(data.logs ?? []);
    setHistoryReady(data.ready !== false);
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const currentFile = () => fileRef.current?.files?.[0] ?? null;

  const send = async (kind: "preview" | "import") => {
    const file = currentFile();
    setError(""); setResult(null);
    if (kind === "import") setPreview(null);
    if (!file) { setError("Choose a register workbook (.xlsx) first."); return; }

    setBusy(kind);
    const body = new FormData();
    body.append("file", file);
    if (kind === "import") body.append("period", period);

    const res = await fetch(kind === "preview" ? "/api/robo/imports/preview" : "/api/robo/imports", { method: "POST", body });
    setBusy("");

    if (!res.ok) {
      const data: { error?: string } = await res.json().catch(() => ({}));
      setError(data.error || "The workbook could not be processed.");
      return;
    }
    if (kind === "preview") {
      const data: PreviewResult = await res.json();
      setPreview(data);
      if (data.fatal) setError(data.fatal);
    } else {
      const data: ImportResult = await res.json();
      setResult(data);
      setHistoryReady(data.historyReady !== false);
      loadLogs();
    }
  };

  const inp = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <div className="max-w-4xl space-y-6">
      {/* ── Upload card ── */}
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">Register workbook (.xlsx)</label>
            <input ref={fileRef} type="file" accept=".xlsx,.xls"
              onChange={() => { setPreview(null); setResult(null); setError(""); }}
              className={`${inp} file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-200`} />
          </div>
          <div className="w-44">
            <label className="mb-1 block text-xs font-medium text-gray-600">Period label</label>
            <input value={period} onChange={e => setPeriod(e.target.value)} placeholder="May 2026" className={inp} />
          </div>
          <button type="button" onClick={() => send("preview")} disabled={busy !== ""}
            className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">
            {busy === "preview" ? "Checking..." : "Preview"}
          </button>
          <button type="button" onClick={() => send("import")} disabled={busy !== ""}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-50">
            {busy === "import" ? "Importing..." : "Import"}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Expects a “Complete Production” workbook from Download Records. Slabs that already exist on the same
          production date are skipped, so re-importing the same file is safe.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Preview outcome */}
        {preview && !preview.fatal && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-slate-50 p-4">
            <div className="flex flex-wrap gap-6">
              {[
                { label: "Rows found", value: preview.totalRows },
                { label: "Will import", value: preview.willImport },
                { label: "Will skip", value: preview.willSkip },
                { label: "Unreadable", value: preview.failed },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-xs uppercase tracking-wide text-gray-500">{s.label}</p>
                  <p className="text-lg font-bold text-gray-800">{s.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Sheet “{preview.sheetName}” · {preview.detectedColumns.length} columns recognised
              {preview.hasSetupSheet ? " · machine configuration sheet found" : ""}
            </p>
            {preview.sample.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500">
                    <tr>{["Date", "Shift", "Slab", "Design", "In", "Out"].map(h => (
                      <th key={h} className="py-1 text-left font-medium">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((s, i) => (
                      <tr key={i} className="border-t border-gray-200 text-gray-700">
                        <td className="py-1">{s.date}</td>
                        <td className="py-1">{s.shiftNumber}</td>
                        <td className="py-1">{s.slabNumber}</td>
                        <td className="py-1">{s.designName}</td>
                        <td className="py-1">{s.inTime}</td>
                        <td className="py-1">{s.outTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.issues.length > 0 && (
              <ul className="mt-3 space-y-0.5">
                {preview.issues.map((m, i) => <li key={i} className="text-xs text-amber-700">• {m}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* Import outcome */}
        {result && (
          <div className={`mt-4 rounded-lg border p-4 ${
            result.status === "success" ? "border-green-200 bg-green-50"
            : result.status === "partial" ? "border-amber-200 bg-amber-50"
            : "border-red-200 bg-red-50"}`}>
            <p className={`text-sm font-semibold ${statusClass(result.status)}`}>
              {result.status === "success" ? "Import complete" : result.status === "partial" ? "Imported with skips" : "Import failed"}
            </p>
            <p className="mt-1 text-sm text-gray-700">{result.message}</p>
            {result.issues && result.issues.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {result.issues.map((m, i) => <li key={i} className="text-xs text-gray-600">• {m}</li>)}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* ── Previous imports ── */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-gray-800">Previous imports</h2>

        {!historyReady && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Import history needs one database update. Run <code className="font-mono text-xs">npx prisma db push</code> in
            the project folder, then reload this page.
          </div>
        )}

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200">
                <tr>
                  {["FILE", "PERIOD", "STATUS", "ROWS", "IMPORTED", "SKIPPED", "FAILED", "WHEN"].map(h => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold tracking-wide text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No imports yet.</td></tr>
                )}
                {logs.map(l => (
                  <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-800">{l.fileName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{l.period || "—"}</td>
                    <td className={`px-4 py-3 font-medium ${statusClass(l.status)}`}>{l.status}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">{l.totalRows}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">{l.imported}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">{l.skipped}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-600">{l.failed}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">{fmtWhen(l.createdAt, l.user)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
