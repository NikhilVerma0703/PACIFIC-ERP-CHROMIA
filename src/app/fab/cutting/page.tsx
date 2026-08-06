"use client";
import { useEffect, useState, useCallback } from "react";
import { postJson, getJson } from "@/lib/fab/postJson";

interface Piece {
  id: string; pieceCode: string;
  project: { projectCode: string; customerName: string };
  drawing: { drawingNumber: string } | null;
  requirement: { pieceLabel: string | null; description: string | null; length: number | null; width: number | null } | null;
  hasSink: boolean; polishRequired: boolean; fabricationRequired: boolean;
}
interface LegacyGroup { type: "legacy"; slab: { id: string; slabCode: string; colour: string | null }; pieces: Piece[] }
interface CloReq { requirementId: string; drawingNumber: string; pieceLabel: string; description: string | null; lengthIn: number | null; widthIn: number | null; qty: number }
interface CloGroup {
  type: "clo"; slabJobId: string; jobStatus: string; startTime: string | null;
  operatorId: string | null; operatorName: string | null;
  slab: { id: string; slabCode: string; qcSlabCode: string | null; qcColour: string | null };
  project: { projectCode: string; customerName: string };
  requirements: CloReq[]; totalPcs: number;
}
type QueueEntry = LegacyGroup | CloGroup;

interface LegacyDone { flowType: "legacy"; opId: string; pieceId: string; pieceCode: string; projectCode: string; drawingNumber: string | null; pieceLabel: string | null; length: number | null; width: number | null; slabCode: string | null; slabColour: string | null; machineName: string | null; operatorName: string | null; completedAt: string }
interface CloDone { flowType: "clo"; slabJobId: string; projectCode: string; slabCode: string; qcSlabCode: string | null; qcColour: string | null; totalPcs: number; reqCount: number; machineName: string | null; operatorName: string | null; completedAt: string }
type DoneEntry = LegacyDone | CloDone;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function useElapsed(startTime: string | null) {
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!startTime) { setElapsed(""); return; }
    const tick = () => {
      const secs = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
      const m = Math.floor(secs / 60), s = secs % 60;
      setElapsed(`${m}m ${String(s).padStart(2,"0")}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startTime]);
  return elapsed;
}

function FlagChip({ label, col }: { label: string; col: string }) {
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${col}`}>{label}</span>;
}

function CloCard({
  entry, currentUserId, completing, starting,
  onStart, onComplete,
}: {
  entry: CloGroup;
  currentUserId: string | null;
  completing: boolean; starting: boolean;
  onStart: () => void; onComplete: () => void;
}) {
  const elapsed = useElapsed(entry.startTime);
  const slabName = entry.slab.qcSlabCode
    ? `Slab ${entry.slab.qcSlabCode}${entry.slab.qcColour ? " - " + entry.slab.qcColour : ""}`
    : entry.slab.slabCode;
  const inProgress = entry.jobStatus === "IN_PROGRESS";

  // Lock logic: IN_PROGRESS and started by a *different* user
  const lockedByOther = inProgress && entry.operatorId !== null && entry.operatorId !== currentUserId;
  const ownedByMe     = inProgress && entry.operatorId === currentUserId;

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${
      lockedByOther ? "border-gray-300 opacity-80" :
      inProgress    ? "border-amber-300" : "border-indigo-200"
    }`}>
      <div className={`flex items-center justify-between px-5 py-4 border-b flex-wrap gap-3 ${
        lockedByOther ? "bg-gray-50 border-gray-200" :
        inProgress    ? "bg-amber-50 border-amber-200" : "bg-indigo-50 border-indigo-100"
      }`}>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-gray-900">{slabName}</span>
            <span className="text-xs font-mono text-gray-400">({entry.slab.slabCode})</span>
            {lockedByOther ? (
              <span className="text-[11px] font-bold text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                🔒 Being cut by {entry.operatorName ?? "another operator"}
              </span>
            ) : ownedByMe ? (
              <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse inline-block"></span>
                Cutting… {elapsed}
              </span>
            ) : (
              <span className="text-[11px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Ready to cut</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {entry.project.projectCode} &middot; {entry.totalPcs} pcs &middot; {entry.requirements.length} types
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Only show Start if READY */}
          {!inProgress && (
            <button onClick={onStart} disabled={starting}
              className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold transition">
              {starting ? "Starting…" : "Start Cutting"}
            </button>
          )}
          {/* Only show Mark Cut if this user owns the job */}
          {ownedByMe && (
            <button onClick={onComplete} disabled={completing}
              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold transition">
              {completing ? "Saving…" : "Mark Slab Cut ✓"}
            </button>
          )}
          {/* Locked by another: no action buttons */}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="text-left px-5 py-2">Dwg</th>
            <th className="text-left px-5 py-2">Piece</th>
            <th className="text-left px-5 py-2">Description</th>
            <th className="text-left px-5 py-2">L (in)</th>
            <th className="text-left px-5 py-2">W (in)</th>
            <th className="text-center px-5 py-2">Qty</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {entry.requirements.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50/50">
              <td className="px-5 py-2.5 font-mono text-xs text-gray-400">{r.drawingNumber}</td>
              <td className="px-5 py-2.5 font-semibold text-gray-800">{r.pieceLabel}</td>
              <td className="px-5 py-2.5 text-gray-500 max-w-xs truncate">{r.description ?? "-"}</td>
              <td className="px-5 py-2.5 font-mono text-gray-600">{r.lengthIn ?? "-"}</td>
              <td className="px-5 py-2.5 font-mono text-gray-600">{r.widthIn ?? "-"}</td>
              <td className="px-5 py-2.5 text-center font-bold text-gray-800">{r.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FabCuttingPage() {
  const [tab,           setTab]          = useState<"open"|"done">("open");
  const [queue,         setQueue]        = useState<QueueEntry[]>([]);
  const [completed,     setCompleted]    = useState<DoneEntry[]>([]);
  const [loading,       setLoading]      = useState(true);
  const [completing,    setCompleting]   = useState<Record<string, boolean>>({});
  const [starting,      setStarting]     = useState<Record<string, boolean>>({});
  const [undoing,       setUndoing]      = useState<Record<string, boolean>>({});
  const [doneDate,      setDoneDate]     = useState(todayStr());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [actionError,   setActionError]  = useState<string | null>(null);
  const [loadError,     setLoadError]    = useState<string | null>(null);

  // Fetch current user's ID once for lock checks
  useEffect(() => {
    fetch("/api/auth/session")
      .then(r => r.json())
      .then(s => setCurrentUserId((s?.user as any)?.id ?? null))
      .catch(() => {});
  }, []);

  // A failed load must not render as an empty queue. "Nothing to cut" and "the
  // queue did not load" look identical on screen otherwise, and only one of them
  // means the operator can go home.
  const loadOpen = useCallback(async () => {
    const r = await getJson<QueueEntry>("/api/fab/queues/cutting");
    if (r.ok) { setQueue(r.data); setLoadError(null); } else setLoadError(r.error);
  }, []);

  const loadDone = useCallback(async (date: string) => {
    const r = await getJson<DoneEntry>(`/api/fab/queues/completed?type=CUTTING&date=${date}`);
    if (r.ok) { setCompleted(r.data); setLoadError(null); } else setLoadError(r.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadOpen(), loadDone(doneDate)]).finally(() => setLoading(false));
  }, [loadOpen, loadDone, doneDate]);

  // Poll open queue every 15s
  useEffect(() => {
    const t = setInterval(() => loadOpen(), 15000);
    return () => clearInterval(t);
  }, [loadOpen]);

  async function startClo(slabJobId: string) {
    setStarting(p => ({ ...p, [slabJobId]: true }));
    setActionError(null);
    const r = await postJson("/api/fab/queues/cutting/start-job", { slabJobId });
    // The 409 carries who took it, which is more use than the generic message.
    if (!r.ok) setActionError(r.status === 409 && r.data?.lockedBy
      ? `This slab is already being cut by ${r.data.lockedBy}.`
      : r.error);
    await loadOpen();
    setStarting(p => ({ ...p, [slabJobId]: false }));
  }

  async function completeLegacy(slabId: string, pieceIds: string[]) {
    setCompleting(p => ({ ...p, [slabId]: true }));
    setActionError(null);
    const r = await postJson("/api/fab/queues/cutting/complete", { slabId, pieceIds });
    if (!r.ok) setActionError(r.error);
    await Promise.all([loadOpen(), loadDone(doneDate)]);
    setCompleting(p => ({ ...p, [slabId]: false }));
  }

  async function completeClo(slabJobId: string) {
    setCompleting(p => ({ ...p, [slabJobId]: true }));
    setActionError(null);
    const r = await postJson("/api/fab/queues/cutting/complete-job", { slabJobId });
    if (!r.ok) setActionError(r.error);
    await Promise.all([loadOpen(), loadDone(doneDate)]);
    setCompleting(p => ({ ...p, [slabJobId]: false }));
  }

  async function undoLegacy(pieceId: string, opId: string) {
    setUndoing(p => ({ ...p, [opId]: true }));
    setActionError(null);
    const r = await postJson("/api/fab/queues/undo", { pieceId, operationType: "CUTTING" });
    if (!r.ok) setActionError(r.error);
    await Promise.all([loadOpen(), loadDone(doneDate)]);
    setUndoing(p => ({ ...p, [opId]: false }));
  }

  async function revertClo(slabJobId: string) {
    setUndoing(p => ({ ...p, [slabJobId]: true }));
    setActionError(null);
    const r = await postJson("/api/fab/queues/cutting/revert-job", { slabJobId });
    if (!r.ok) setActionError(r.error);
    await Promise.all([loadOpen(), loadDone(doneDate)]);
    setUndoing(p => ({ ...p, [slabJobId]: false }));
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>;

  const totalPending = queue.reduce((n, e) => e.type === "legacy" ? n + e.pieces.length : n + e.totalPcs, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cutting Queue</h1>
          <p className="text-sm text-gray-400 mt-0.5">{queue.length} slab{queue.length !== 1 ? "s" : ""} &middot; {totalPending} pieces pending</p>
        </div>
        <div className="flex items-center gap-3">
          {tab === "done" && (
            <input type="date" value={doneDate} onChange={e => setDoneDate(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
          )}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setTab("open")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === "open" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              Open <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{queue.length}</span>
            </button>
            <button onClick={() => setTab("done")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === "done" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              Completed <span className="ml-1.5 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">{completed.length}</span>
            </button>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>This list may be out of date.</b> {loadError} Nothing below is confirmed — do not
          treat an empty queue as &ldquo;nothing to cut&rdquo;.
        </div>
      )}
      {actionError && (
        <div className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span><b>Not saved.</b> {actionError}</span>
          <button onClick={() => setActionError(null)} className="shrink-0 font-bold text-red-400 hover:text-red-700">✕</button>
        </div>
      )}

      {tab === "open" && (
        queue.length === 0 ? (
          <div className="text-center py-20 text-gray-400">No slabs in the cutting queue.</div>
        ) : (
          <div className="space-y-4">
            {queue.map(entry => {
              if (entry.type === "clo") {
                return (
                  <CloCard key={entry.slabJobId} entry={entry}
                    currentUserId={currentUserId}
                    completing={!!completing[entry.slabJobId]}
                    starting={!!starting[entry.slabJobId]}
                    onStart={() => startClo(entry.slabJobId)}
                    onComplete={() => completeClo(entry.slabJobId)} />
                );
              }
              const { slab, pieces } = entry;
              return (
                <div key={slab.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div>
                      <span className="font-bold text-gray-900">Slab {slab.slabCode}</span>
                      {slab.colour && <span className="text-sm text-gray-500 ml-2">- {slab.colour}</span>}
                      <span className="text-xs text-gray-400 ml-3">{pieces.length} piece{pieces.length !== 1 ? "s" : ""}</span>
                    </div>
                    <button onClick={() => completeLegacy(slab.id, pieces.map(p => p.id))} disabled={completing[slab.id]}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold transition">
                      {completing[slab.id] ? "Saving…" : "Mark Slab Cut"}
                    </button>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500">
                      <tr>
                        <th className="text-left px-5 py-2">Piece</th>
                        <th className="text-left px-5 py-2">Label</th>
                        <th className="text-left px-5 py-2">Size</th>
                        <th className="text-left px-5 py-2">Project</th>
                        <th className="text-left px-5 py-2">Flags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pieces.map(p => (
                        <tr key={p.id} className="hover:bg-gray-50/50">
                          <td className="px-5 py-2.5 font-mono text-xs text-gray-700">{p.pieceCode}</td>
                          <td className="px-5 py-2.5 text-gray-600">{p.requirement?.pieceLabel ?? p.requirement?.description ?? "-"}</td>
                          <td className="px-5 py-2.5 text-gray-500">
                            {p.requirement?.length && p.requirement?.width ? `${p.requirement.length} × ${p.requirement.width}` : "-"}
                          </td>
                          <td className="px-5 py-2.5 text-gray-500">{p.project.projectCode}</td>
                          <td className="px-5 py-2.5">
                            <div className="flex gap-1">
                              {p.polishRequired      && <FlagChip label="Polish" col="bg-violet-100 text-violet-700" />}
                              {p.hasSink             && <FlagChip label="Sink"   col="bg-orange-100 text-orange-700" />}
                              {p.fabricationRequired && <FlagChip label="Fab"    col="bg-rose-100 text-rose-700" />}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )
      )}

      {tab === "done" && (
        <div className="space-y-2">
          {completed.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
              No cuts completed on {doneDate === todayStr() ? "today" : doneDate}.
            </div>
          ) : completed.map(c => {
            if (c.flowType === "clo") {
              const slabName = c.qcSlabCode ? `Slab ${c.qcSlabCode}${c.qcColour ? " - " + c.qcColour : ""}` : c.slabCode;
              return (
                <div key={c.slabJobId} className="bg-white rounded-xl border border-green-200 px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                    <div>
                      <span className="font-semibold text-gray-900 text-sm">{slabName}</span>
                      <span className="text-xs font-mono text-gray-400 ml-2">({c.slabCode})</span>
                    </div>
                    <span className="text-xs text-gray-500">{c.projectCode}</span>
                    <span className="text-xs text-gray-400">{c.totalPcs} pcs &middot; {c.reqCount} types</span>
                    {c.machineName  && <span className="text-xs text-gray-400">&middot; {c.machineName}</span>}
                    {c.operatorName && <span className="text-xs font-medium text-indigo-500">&middot; {c.operatorName}</span>}
                    <span className="text-[11px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Cut complete</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-400">
                      {new Date(c.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <button onClick={() => revertClo(c.slabJobId)} disabled={undoing[c.slabJobId]}
                      className="border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 transition">
                      {undoing[c.slabJobId] ? "…" : "↩ Revert to Queue"}
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div key={c.opId} className="bg-white rounded-xl border border-gray-200 px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
                  <span className="font-mono text-xs text-gray-700">{c.pieceCode}</span>
                  {c.pieceLabel    && <span className="text-sm text-gray-600">{c.pieceLabel}</span>}
                  {c.drawingNumber && <span className="text-xs text-gray-400">Dwg {c.drawingNumber}</span>}
                  <span className="text-xs text-gray-500">{c.projectCode}</span>
                  {c.slabCode     && <span className="text-xs text-gray-400">&middot; {c.slabCode}{c.slabColour ? " " + c.slabColour : ""}</span>}
                  {c.machineName  && <span className="text-xs text-gray-400">&middot; {c.machineName}</span>}
                  {c.operatorName && <span className="text-xs font-medium text-indigo-500">&middot; {c.operatorName}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400">
                    {new Date(c.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <button onClick={() => undoLegacy(c.pieceId, c.opId)} disabled={undoing[c.opId]}
                    className="border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 transition">
                    {undoing[c.opId] ? "…" : "Undo"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
