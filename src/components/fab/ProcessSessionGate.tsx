"use client";

import { useEffect, useState } from "react";
import { postJson, getJson } from "@/lib/fab/postJson";
import {
  FAB_PROCESS_LABEL,
  FAB_SHIFTS,
  type FabProcessType,
} from "@/lib/fab/processSession";
import { DowntimeBar } from "@/components/fab/DowntimeBar";

interface Worker { id: string; name: string }
interface Session {
  workerName: string;
  shift: string;
  machineName: string;
}

export function ProcessSessionGate({
  type,
  children,
}: {
  type: FabProcessType;
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workerId, setWorkerId] = useState("");
  const [shift, setShift] = useState("Morning");
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cur, roster] = await Promise.all([
        fetch(`/api/fab/session/current?type=${type}`).then(r => r.json()).catch(() => ({})),
        getJson<Worker>("/api/fab/workers"),
      ]);
      if (cancelled) return;
      if (cur?.session) setSession(cur.session);
      if (roster.ok) setWorkers(roster.data);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [type]);

  async function start() {
    setStarting(true); setError(null);
    const r = await postJson("/api/fab/session/start", { processType: type, workerId, shift });
    setStarting(false);
    if (!r.ok) { setError(r.error); return; }
    setSession(r.data.session);
  }

  async function end() {
    setEnding(true); setError(null);
    const r = await postJson("/api/fab/session/end", { processType: type });
    setEnding(false);
    if (!r.ok) { setError(r.error); return; }
    setSession(null);
    setWorkerId("");
  }

  if (!ready) return <div className="text-center py-20 text-gray-400">Loading…</div>;

  if (!session) {
    const label = FAB_PROCESS_LABEL[type];
    return (
      <div className="max-w-lg mx-auto pt-8">
        <h1 className="text-2xl font-bold text-gray-900">Start {label}</h1>
        <p className="text-sm text-gray-500 mt-1">
          One laptop, this station. Pick who is working and the shift. The session
          stays open until End Session — that is how we know who did this {label.toLowerCase()}.
        </p>

        {error && (
          <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Name</p>
          {workers.length === 0 ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No names on the roster yet. Ask the supervisor to add people under People.
            </p>
          ) : (
            <select
              value={workerId}
              onChange={e => setWorkerId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 bg-white"
            >
              <option value="">Select who is working…</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>

        <div className="mt-3 bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Shift</p>
          <div className="grid grid-cols-3 gap-2">
            {FAB_SHIFTS.map(s => (
              <button key={s.id} type="button" onClick={() => setShift(s.id)}
                className={`py-3 rounded-lg text-sm font-medium border transition ${
                  shift === s.id
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
                }`}>
                <div>{s.label}</div>
                <div className={`text-xs mt-0.5 ${shift === s.id ? "text-slate-300" : "text-gray-400"}`}>{s.time}</div>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={start}
          disabled={!workerId || starting}
          className="mt-4 w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white py-3 rounded-xl text-sm font-semibold"
        >
          {starting ? "Starting…" : `Start ${label}`}
        </button>
        <p className="mt-4 text-center text-sm text-gray-500">
          Power or wifi down?{" "}
          <a href="/fab/downtime" className="font-semibold text-red-700 hover:text-red-900">Log downtime afterwards</a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 bg-white border border-slate-200 rounded-xl px-4 py-2.5">
        <p className="text-sm text-slate-700">
          <span className="font-semibold">{session.workerName}</span>
          <span className="text-slate-400"> · {session.shift}</span>
          <span className="text-slate-400"> · {FAB_PROCESS_LABEL[type]}</span>
        </p>
        <button type="button" onClick={end} disabled={ending}
          className="text-xs font-semibold text-amber-700 hover:text-amber-900 px-3 py-1.5 rounded-lg hover:bg-amber-50">
          {ending ? "Ending…" : "End session"}
        </button>
      </div>
      {error && (
        <p className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      <DowntimeBar type={type} onError={setError} />
      {children}
    </div>
  );
}
