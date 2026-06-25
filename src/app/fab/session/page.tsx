"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface ActiveSession {
  user:          { name: string | null };
  shift:         string;
  loginTime:     string;
  isCurrentUser: boolean;
}
interface Machine { id: string; code: string; name: string; type: string; activeSession: ActiveSession | null; }

const TYPE_META: Record<string, { label: string; color: string }> = {
  CUTTING:      { label: "Cutting",      color: "#3b82f6" },
  POLISHING:    { label: "Polishing",    color: "#8b5cf6" },
  SINK_CUTTING: { label: "Sink Cutting", color: "#f97316" },
  FABRICATION:  { label: "Fabrication",  color: "#f43f5e" },
  PACKAGING:    { label: "Packaging",    color: "#22c55e" },
};
const SHIFTS = [
  { id: "Morning",   label: "Morning",   time: "6:00 – 14:00" },
  { id: "Afternoon", label: "Afternoon", time: "14:00 – 22:00" },
  { id: "Night",     label: "Night",     time: "22:00 – 6:00" },
];

export default function FabSessionPage() {
  const router = useRouter();
  const [machines,  setMachines]  = useState<Machine[]>([]);
  const [selected,  setSelected]  = useState("");
  const [shift,     setShift]     = useState("Morning");
  const [loading,   setLoading]   = useState(true);
  const [starting,  setStarting]  = useState(false);
  const [error,     setError]     = useState("");

  const fetchMachines = useCallback(async () => {
    const res  = await fetch("/api/fab/machines", { cache: "no-store" });
    const data = await res.json();
    setMachines(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMachines();
    // Poll every 10 s so logged-out machines appear available quickly
    const timer = setInterval(fetchMachines, 10_000);
    return () => clearInterval(timer);
  }, [fetchMachines]);

  async function startSession() {
    if (!selected) { setError("Select a machine first"); return; }
    setStarting(true); setError("");
    const res = await fetch("/api/fab/session/start", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ machineId: selected, shift }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed"); setStarting(false); return; }
    window.location.href = data.redirect;
  }

  const groups: Record<string, Machine[]> = {};
  for (const m of machines) { if (!groups[m.type]) groups[m.type] = []; groups[m.type].push(m); }
  const typeOrder = ["CUTTING","POLISHING","SINK_CUTTING","FABRICATION","PACKAGING"];

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="flex gap-2 items-center text-slate-400 text-sm">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/>
        </svg>
        Loading…
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-full px-4 py-1.5 mb-5">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-xs font-medium text-slate-300 tracking-wide">Pacific Fabrication</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Start Your Session</h1>
          <p className="text-slate-400 text-sm mt-1">Select machine and shift to begin</p>
        </div>

        {/* Shift picker */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Shift</p>
          <div className="grid grid-cols-3 gap-2">
            {SHIFTS.map(s => (
              <button key={s.id} onClick={() => setShift(s.id)}
                className={`py-3 rounded-lg text-sm font-medium transition border ${
                  shift === s.id
                    ? "bg-white text-slate-900 border-white"
                    : "bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-500"
                }`}>
                <div>{s.label}</div>
                <div className="text-xs mt-0.5 text-slate-500">{s.time}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Machine picker */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Machine</p>
          <div className="space-y-5">
            {typeOrder.filter(t => groups[t]?.length).map(type => {
              const meta = TYPE_META[type] ?? { label: type, color: "#64748b" };
              return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{meta.label}</span>
                  </div>
                  <div className="space-y-2">
                    {groups[type].map(m => {
                      const s          = m.activeSession;
                      const isMyOld    = s?.isCurrentUser === true;   // my own stale session
                      const lockedByOther = !!s && !isMyOld;          // someone else is on it
                      const isSelected = selected === m.id;

                      return (
                        <button key={m.id}
                          disabled={lockedByOther}
                          onClick={() => !lockedByOther && setSelected(m.id)}
                          className={`w-full text-left rounded-xl border p-3.5 transition flex items-center justify-between ${
                            lockedByOther
                              ? "border-slate-700 bg-slate-800/50 opacity-60 cursor-not-allowed"
                              : isSelected
                                ? "border-white bg-white/10"
                                : "border-slate-700 bg-slate-800 hover:border-slate-500"
                          }`}>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                              style={{ background: meta.color + "20", border: `1px solid ${meta.color}40` }}>
                              <span className="w-2.5 h-2.5 rounded-full"
                                style={{ background: lockedByOther ? "#64748b" : meta.color }} />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-white">{m.name}</p>
                              <p className="text-xs text-slate-500">{m.code}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {lockedByOther && (
                              <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full">
                                {s!.user.name ?? "In use"} · {s!.shift}
                              </span>
                            )}
                            {isMyOld && !isSelected && (
                              <span className="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">
                                Your last session
                              </span>
                            )}
                            {isSelected && <span className="text-white text-sm">✓</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error && <p className="text-red-400 text-sm mb-3 text-center">{error}</p>}

        <button
          onClick={startSession}
          disabled={!selected || starting}
          className="w-full bg-white text-slate-900 py-3 rounded-xl font-semibold text-sm hover:bg-slate-100 disabled:opacity-30 transition">
          {starting ? "Starting…" : "Start Session"}
        </button>

        <div className="mt-4 text-center">
          <form action="/api/auth/signout" method="POST">
            <button type="submit" className="text-xs text-slate-600 hover:text-slate-400 transition">
              Sign out of Pacific ERP
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
