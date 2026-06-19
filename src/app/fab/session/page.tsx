"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Machine {
  id: string; code: string; name: string; type: string;
}

const TYPE_COLOUR: Record<string, string> = {
  CUTTING:      "bg-blue-50 border-blue-200 text-blue-800",
  POLISHING:    "bg-purple-50 border-purple-200 text-purple-800",
  SINK_CUTTING: "bg-orange-50 border-orange-200 text-orange-800",
  FABRICATION:  "bg-rose-50 border-rose-200 text-rose-800",
  PACKAGING:    "bg-green-50 border-green-200 text-green-800",
};

const TYPE_LABEL: Record<string, string> = {
  CUTTING:      "Cutting",
  POLISHING:    "Polishing",
  SINK_CUTTING: "Sink Cutting",
  FABRICATION:  "Fabrication",
  PACKAGING:    "Packaging",
};

const SHIFTS = ["Morning", "Afternoon", "Night"];

export default function FabSessionPage() {
  const router = useRouter();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [shift, setShift] = useState("Morning");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/fab/machines")
      .then(r => r.json())
      .then(d => { setMachines(Array.isArray(d) ? d : []); setLoading(false); });
  }, []);

  async function startSession() {
    if (!selected) { setError("Select a machine first"); return; }
    setStarting(true); setError("");
    const res = await fetch("/api/fab/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineId: selected, shift }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to start session"); setStarting(false); return; }
    router.push(data.redirect);
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <p className="text-gray-400">Loading machines…</p>
    </div>
  );

  // Group machines by type
  const groups: Record<string, Machine[]> = {};
  for (const m of machines) {
    if (!groups[m.type]) groups[m.type] = [];
    groups[m.type].push(m);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-1">Pacific ERP · Fabrication</p>
          <h1 className="text-3xl font-bold text-gray-900">Start Your Session</h1>
          <p className="text-gray-500 mt-2">Select your machine and shift to begin</p>
        </div>

        {/* Shift selector */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-3">Shift</p>
          <div className="flex gap-3">
            {SHIFTS.map(s => (
              <button key={s} onClick={() => setShift(s)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${shift === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Machine picker */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-4">Machine</p>
          <div className="space-y-4">
            {Object.entries(groups).map(([type, ms]) => (
              <div key={type}>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">{TYPE_LABEL[type] ?? type}</p>
                <div className="grid grid-cols-2 gap-2">
                  {ms.map(m => (
                    <button key={m.id} onClick={() => setSelected(m.id)}
                      className={`px-4 py-3 rounded-lg border-2 text-left transition ${selected === m.id ? "border-blue-600 bg-blue-50" : `border ${TYPE_COLOUR[m.type] ?? "border-gray-200"} hover:border-blue-300`}`}>
                      <p className="font-semibold text-gray-900 text-sm">{m.name}</p>
                      <p className="text-xs text-gray-400">{m.code}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        <button onClick={startSession} disabled={!selected || starting}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-base hover:bg-blue-700 disabled:opacity-40 transition">
          {starting ? "Starting…" : "▶ Start Session"}
        </button>
      </div>
    </div>
  );
}
