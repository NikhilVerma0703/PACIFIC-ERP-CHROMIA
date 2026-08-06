"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { postJson, getJson } from "@/lib/fab/postJson";
import { FabAlerts } from "@/components/fab/FabAlerts";

interface Piece {
  id: string; pieceCode: string; hasSink: boolean;
  project: { projectCode: string };
  drawing: { drawingNumber: string } | null;
  requirement: { pieceLabel: string | null; length: number | null; width: number | null } | null;
  slab: { slabCode: string; colour: string | null } | null;
}
interface CompletedPiece {
  opId: string; pieceId: string; pieceCode: string; projectCode: string;
  drawingNumber: string | null; pieceLabel: string | null;
  length: number | null; width: number | null;
  slabCode: string | null; slabColour: string | null; completedAt: string;
  operatorName?: string | null;
}

function useElapsed(startMs: number | null) {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!startMs) { setElapsed(""); return; }
    const tick = () => {
      const secs = Math.floor((Date.now() - startMs) / 1000);
      setElapsed(`${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startMs]);
  return elapsed;
}

function PieceRow({ p, startMs, onStart, onComplete, completing }: {
  p: Piece; startMs: number | null;
  onStart: () => void; onComplete: () => void; completing: boolean;
}) {
  const elapsed = useElapsed(startMs);
  const isStarted = startMs !== null;
  return (
    <tr className={`hover:bg-gray-50 transition ${isStarted ? "bg-violet-50" : ""}`}>
      <td className="px-5 py-3 font-mono text-xs text-gray-700">{p.pieceCode}</td>
      <td className="px-5 py-3 text-gray-500">{p.requirement?.pieceLabel ?? "—"}</td>
      <td className="px-5 py-3 text-gray-500">{p.drawing?.drawingNumber ?? "—"}</td>
      <td className="px-5 py-3 text-gray-500">
        {p.requirement?.length && p.requirement?.width ? `${p.requirement.length} × ${p.requirement.width}` : "—"}
      </td>
      <td className="px-5 py-3 text-gray-500">{p.slab?.slabCode ?? "—"}{p.slab?.colour ? ` · ${p.slab.colour}` : ""}</td>
      <td className="px-5 py-3 text-gray-500">{p.project.projectCode}</td>
      <td className="px-5 py-3 text-center">{p.hasSink ? <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">Yes</span> : <span className="text-gray-300">—</span>}</td>
      <td className="px-5 py-3 text-right">
        {!isStarted ? (
          <button onClick={onStart}
            className="bg-violet-100 hover:bg-violet-200 text-violet-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition">
            Start
          </button>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs font-mono text-violet-600 animate-pulse">{elapsed}</span>
            <button onClick={onComplete} disabled={completing}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition">
              {completing ? "…" : "Complete"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function FabPolishingPage() {
  const [tab, setTab]               = useState<"open"|"done">("open");
  const [pieces, setPieces]         = useState<Piece[]>([]);
  const [completed, setCompleted]   = useState<CompletedPiece[]>([]);
  const [loading, setLoading]       = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError,   setLoadError]   = useState<string | null>(null);
  const [completing, setCompleting] = useState<Record<string, boolean>>({});
  const [undoing, setUndoing]       = useState<Record<string, boolean>>({});
  const [started, setStarted]       = useState<Record<string, number>>({}); // pieceId → startTimestamp
  const [doneDate, setDoneDate]     = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });

  const loadOpen = useCallback(async () => {
    const r = await getJson<Piece>("/api/fab/queues/polishing");
    if (r.ok) { setPieces(r.data); setLoadError(null); } else setLoadError(r.error);
  }, []);
  const loadDone = useCallback(async (date: string) => {
    const r = await getJson<CompletedPiece>(`/api/fab/queues/completed?type=POLISHING&date=${date}`);
    if (r.ok) setCompleted(r.data); else setLoadError(r.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadOpen(), loadDone(doneDate)]).finally(() => setLoading(false));
    const t = setInterval(loadOpen, 20000);
    return () => clearInterval(t);
  }, [loadOpen, loadDone, doneDate]);

  async function startPiece(pieceId: string) {
    setStarted(s => ({ ...s, [pieceId]: Date.now() }));
    const r = await postJson("/api/fab/queues/start-op", { pieceId, operationType: "POLISHING" });
    if (!r.ok) setActionError(r.error);
  }

  async function complete(pieceId: string) {
    setCompleting(p => ({ ...p, [pieceId]: true }));
    const r = await postJson("/api/fab/queues/polishing/complete", { pieceId });
    if (!r.ok) setActionError(r.error);
    setStarted(s => { const n = { ...s }; delete n[pieceId]; return n; });
    await Promise.all([loadOpen(), loadDone(doneDate)]);
    setCompleting(p => ({ ...p, [pieceId]: false }));
  }

  async function undo(pieceId: string, opId: string) {
    setUndoing(p => ({ ...p, [opId]: true }));
    const r = await postJson("/api/fab/queues/undo", { pieceId, operationType: "POLISHING" });
    if (!r.ok) setActionError(r.error);
    await Promise.all([loadOpen(), loadDone(doneDate)]);
    setUndoing(p => ({ ...p, [opId]: false }));
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Polishing Queue</h1>
          <p className="text-sm text-gray-400 mt-0.5">{pieces.length} piece{pieces.length !== 1 ? "s" : ""} pending</p>
        </div>
        <div className="flex items-center gap-3">
          {tab === "done" && (
            <input type="date" value={doneDate} onChange={e => { setDoneDate(e.target.value); loadDone(e.target.value); }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-violet-200" />
          )}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setTab("open")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === "open" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              Open <span className="ml-1.5 text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">{pieces.length}</span>
            </button>
            <button onClick={() => setTab("done")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === "done" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              Completed <span className="ml-1.5 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">{completed.length}</span>
            </button>
          </div>
        </div>
      </div>

      <FabAlerts loadError={loadError} actionError={actionError}
        onDismiss={() => setActionError(null)} noun="list" />

      {tab === "open" ? (
        pieces.length === 0 ? (
          <div className="text-center py-20 text-gray-400">No pieces pending polishing.</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-5 py-3">Piece</th>
                  <th className="text-left px-5 py-3">Label</th>
                  <th className="text-left px-5 py-3">Drawing</th>
                  <th className="text-left px-5 py-3">Size</th>
                  <th className="text-left px-5 py-3">Slab</th>
                  <th className="text-left px-5 py-3">Project</th>
                  <th className="text-center px-5 py-3">Sink?</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pieces.map(p => (
                  <PieceRow key={p.id} p={p}
                    startMs={started[p.id] ?? null}
                    onStart={() => startPiece(p.id)}
                    onComplete={() => complete(p.id)}
                    completing={!!completing[p.id]} />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {completed.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">No pieces completed on {doneDate}.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-5 py-3">Piece</th>
                  <th className="text-left px-5 py-3">Drawing</th>
                  <th className="text-left px-5 py-3">Size</th>
                  <th className="text-left px-5 py-3">Slab</th>
                  <th className="text-left px-5 py-3">Project</th>
                  <th className="text-left px-5 py-3">Operator</th>
                  <th className="text-left px-5 py-3">Time</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {completed.map(c => (
                  <tr key={c.opId} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-mono text-xs text-gray-700">{c.pieceCode}</td>
                    <td className="px-5 py-3 text-gray-500">{c.drawingNumber ?? "—"}</td>
                    <td className="px-5 py-3 text-gray-500">{c.length && c.width ? `${c.length}×${c.width}` : "—"}</td>
                    <td className="px-5 py-3 text-gray-500">{c.slabCode ?? "—"}{c.slabColour ? ` · ${c.slabColour}` : ""}</td>
                    <td className="px-5 py-3 text-gray-500">{c.projectCode}</td>
                    <td className="px-5 py-3 text-xs font-medium text-indigo-500">{c.operatorName ?? "—"}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{new Date(c.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => undo(c.pieceId, c.opId)} disabled={undoing[c.opId]}
                        className="border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-50 transition">
                        {undoing[c.opId] ? "…" : "↩ Revert"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
