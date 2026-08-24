"use client";

import { useCallback, useEffect, useState } from "react";
import { postJson } from "@/lib/fab/postJson";
import { DowntimeLogForm } from "@/components/fab/DowntimeLogForm";
import { FAB_PROCESS_LABEL } from "@/lib/fab/processSession";

interface Row {
  id: string;
  processType: string;
  reasonLabel: string;
  notes: string | null;
  startedAt: string;
  endedAt: string | null;
  shift: string | null;
  workerName: string | null;
  machineName: string | null;
  open: boolean;
}

export default function FabDowntimePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/fab/downtime");
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? `Could not load (error ${res.status}).`);
      return;
    }
    setRows(Array.isArray(data) ? data : []);
    setError(null);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function endRow(r: Row) {
    setEnding(r.id);
    const res = await postJson("/api/fab/downtime", {
      action: "end", processType: r.processType, id: r.id,
    });
    setEnding(null);
    if (!res.ok) { setError(res.error); return; }
    await load();
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Machine downtime</h1>
      <p className="text-sm text-gray-500 mt-1">
        Log electricity / breakdown after the fact if wifi was down, or end an open stoppage.
      </p>
      <div className="mt-6">
        <DowntimeLogForm onSaved={() => { void load(); }} />
      </div>
      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      {rows.length === 0 && !error ? (
        <p className="mt-8 text-sm text-gray-400">No downtime logged yet.</p>
      ) : (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">When</th>
                <th className="text-left px-4 py-3">Station</th>
                <th className="text-left px-4 py-3">Reason</th>
                <th className="text-left px-4 py-3">Who</th>
                <th className="text-left px-4 py-3">Machine</th>
                <th className="text-left px-4 py-3">Ended</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id} className={r.open ? "bg-red-50" : ""}>
                  <td className="px-4 py-3 text-gray-700 text-xs">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {FAB_PROCESS_LABEL[r.processType as keyof typeof FAB_PROCESS_LABEL] ?? r.processType}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-800">{r.reasonLabel}</span>
                    {r.notes ? <span className="block text-xs text-gray-400">{r.notes}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {r.workerName ?? "—"}{r.shift ? ` · ${r.shift}` : ""}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{r.machineName ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.open ? (
                      <button type="button" disabled={ending === r.id} onClick={() => endRow(r)}
                        className="font-semibold text-red-700 hover:text-red-900">
                        {ending === r.id ? "…" : "End now"}
                      </button>
                    ) : r.endedAt ? new Date(r.endedAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
