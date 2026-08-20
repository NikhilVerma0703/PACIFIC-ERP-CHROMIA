"use client";

import { useEffect, useState } from "react";
import { postJson, getJson } from "@/lib/fab/postJson";
import { DOWNTIME_REASONS } from "@/lib/fab/downtimeReasons";
import {
  FAB_PROCESS_LABEL,
  FAB_PROCESS_TYPES,
  FAB_SHIFTS,
  type FabProcessType,
} from "@/lib/fab/processSession";

interface Worker { id: string; name: string }

function localInputValue(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DowntimeLogForm({
  defaultProcess,
  onSaved,
}: {
  defaultProcess?: FabProcessType;
  onSaved: () => void;
}) {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [processType, setProcessType] = useState<FabProcessType>(defaultProcess ?? "CUTTING");
  const [reason, setReason] = useState("ELECTRICITY");
  const [workerId, setWorkerId] = useState("");
  const [shift, setShift] = useState("Morning");
  const [startedAt, setStartedAt] = useState(() => localInputValue(new Date()));
  const [endedAt, setEndedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    void getJson<Worker>("/api/fab/workers").then(r => {
      if (r.ok) setWorkers(r.data);
    });
  }, []);

  async function save() {
    setBusy(true); setError(null); setOk(null);
    const r = await postJson("/api/fab/downtime", {
      action: "log",
      processType,
      reason,
      workerId,
      shift,
      startedAt,
      endedAt: endedAt || null,
      notes,
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setOk("Downtime saved.");
    setNotes("");
    onSaved();
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h2 className="text-base font-semibold text-gray-900">Log downtime</h2>
      <p className="text-sm text-gray-500 mt-1">
        Use this when power or wifi was down and the tablet could not record it live.
        Fill start and end after the line is back.
      </p>

      {error && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {ok && <p className="mt-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{ok}</p>}

      <p className="mt-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Reason</p>
      <div className="grid grid-cols-2 gap-2">
        {DOWNTIME_REASONS.map(r => (
          <button key={r.id} type="button" onClick={() => setReason(r.id)}
            className={`py-3 rounded-lg text-sm font-semibold border ${
              reason === r.id
                ? r.id === "ELECTRICITY" || r.id === "BREAKDOWN"
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-slate-900 text-white border-slate-900"
                : "bg-white text-gray-700 border-gray-200"
            }`}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-sm text-gray-600">
          Station
          <select value={processType} onChange={e => setProcessType(e.target.value as FabProcessType)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900">
            {FAB_PROCESS_TYPES.map(t => (
              <option key={t} value={t}>{FAB_PROCESS_LABEL[t]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-gray-600">
          Who was on the machine
          <select value={workerId} onChange={e => setWorkerId(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900">
            <option value="">Select name…</option>
            {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-600">
          Shift
          <select value={shift} onChange={e => setShift(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900">
            {FAB_SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-600">
          Started
          <input type="datetime-local" value={startedAt} onChange={e => setStartedAt(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900" />
        </label>
        <label className="text-sm text-gray-600 sm:col-span-2">
          Ended (leave empty if still down)
          <input type="datetime-local" value={endedAt} onChange={e => setEndedAt(e.target.value)}
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900" />
        </label>
        <label className="text-sm text-gray-600 sm:col-span-2">
          Notes
          <input value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Optional"
            className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-gray-900" />
        </label>
      </div>

      <button type="button" onClick={save} disabled={busy || !workerId || !reason}
        className="mt-4 w-full sm:w-auto bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg text-sm font-semibold">
        {busy ? "Saving…" : "Save downtime"}
      </button>
    </div>
  );
}
