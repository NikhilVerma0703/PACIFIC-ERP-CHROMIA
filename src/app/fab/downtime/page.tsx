"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function OperatorDowntimePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">Downtime</h1>
      <p className="text-sm text-gray-500 mt-1">
        Electricity, breakdown, no material. If wifi was down, log it here afterwards with start and end time.
      </p>
      <div className="mt-6">
        <DowntimeLogForm onSaved={() => { void load(); }} />
      </div>
      {error && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      <div className="mt-6 bg-white rounded-xl border border-gray-200 overflow-hidden">
        <p className="px-4 py-3 text-sm font-semibold text-gray-800 border-b border-gray-100">Recent</p>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-gray-400">Nothing logged yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.slice(0, 20).map(r => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <span className="font-semibold text-gray-900">{r.reasonLabel}</span>
                <span className="text-gray-500"> · {FAB_PROCESS_LABEL[r.processType as keyof typeof FAB_PROCESS_LABEL] ?? r.processType}</span>
                <span className="block text-xs text-gray-400 mt-0.5">
                  {r.workerName ?? "—"} · {new Date(r.startedAt).toLocaleString()}
                  {r.endedAt ? ` → ${new Date(r.endedAt).toLocaleString()}` : " · still open"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
