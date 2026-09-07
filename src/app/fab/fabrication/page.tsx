"use client";
import { useEffect, useState, useCallback } from "react";
import { postJson, getJson } from "@/lib/fab/postJson";
import { FabAlerts } from "@/components/fab/FabAlerts";
import { ProcessSessionGate } from "@/components/fab/ProcessSessionGate";
import { OtherStageChips, activityRowClass } from "@/components/fab/OtherStageChips";
import { RejectPieceButton } from "@/components/fab/RejectPieceButton";
import { rowLabel } from "@/lib/fab/pieceNaming";

interface Piece {
  id: string; pieceCode: string;
  project: { projectCode: string };
  drawing: { drawingNumber: string } | null;
  requirement: { pieceLabel: string | null; rowLetter: string | null; po: { poNumber: string } | null; length: number | null; width: number | null; sinkModel: string | null } | null;
  slab: { slabCode: string; colour: string | null } | null;
  /** WHY THIS PIECE IS HERE. Two jobs land at this bench and, since
   *  scripts/0063, neither implies the other — a piece can be here for a sink
   *  cutout, for hand edge polish, or for both. */
  hasSink?: boolean;
  edgeWork?: boolean;
  /** Which edges, in the picker's own words: "All four" · "Front + Left" ·
   *  "All round" · "None" · "not marked". */
  edgeLabel?: string;
  otherDone?: string[];
  recent?: boolean;
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

function PieceRow({ p, startMs, onStart, onComplete, completing, onRejected, onError, compact = false }: {
  p: Piece; startMs: number | null;
  onStart: () => void; onComplete: () => void; completing: boolean;
  onRejected: () => void; onError: (msg: string) => void;
  /** Inside one of the two bench columns, where there is half the width. The PO
   *  and project columns go — they are on the slab card and the docket, and at
   *  this width they push the Job cell off the screen, which is the one thing
   *  the man is here to read. */
  compact?: boolean;
}) {
  const elapsed = useElapsed(startMs);
  const isStarted = startMs !== null;
  return (
    <tr className={`hover:bg-gray-50 transition ${activityRowClass(p.recent, isStarted, "bg-rose-50")}`}>
      <td className="px-5 py-3">
        <span className="font-mono text-xs text-gray-700">{p.pieceCode}</span>
        <OtherStageChips otherDone={p.otherDone} recent={p.recent} />
      </td>
      <td className="px-5 py-3 text-gray-500">{rowLabel(p.requirement?.rowLetter, p.requirement?.pieceLabel)}</td>
      {!compact && (
        <td className="px-5 py-3 text-gray-500">{p.requirement?.po?.poNumber ?? p.drawing?.drawingNumber ?? "—"}</td>
      )}
      <td className={`${compact ? "px-4 py-2.5" : "px-5 py-3"} text-gray-500 whitespace-nowrap`}>
        {p.requirement?.length && p.requirement?.width ? `${p.requirement.length} × ${p.requirement.width}` : "—"}
      </td>
      <td className={`${compact ? "px-4 py-2.5" : "px-5 py-3"} text-gray-500`}>{p.slab?.slabCode ?? "—"}{p.slab?.colour ? ` · ${p.slab.colour}` : ""}</td>
      {!compact && <td className="px-5 py-3 text-gray-500">{p.project.projectCode}</td>}
      {/* THE JOB — what he is actually meant to do to this piece.
          This cell used to be the sink model alone, and read "—" for a piece
          that came here for its EDGES: he was told to go to the bench and not
          what to do when he got there. Both jobs are named now, and both can
          appear on one piece. */}
      <td className="px-5 py-3 text-xs">
        <div className="flex flex-col gap-1 items-start">
          {p.hasSink && (
            <span className="inline-flex items-center gap-1.5 rounded bg-orange-100 px-1.5 py-0.5 font-semibold text-orange-800">
              Sink
              {p.requirement?.sinkModel && (
                <span className="font-normal text-orange-700">{p.requirement.sinkModel}</span>
              )}
            </span>
          )}
          {p.edgeWork && (
            <span className="inline-flex items-center gap-1.5 rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-800">
              Edges
              <span className="font-normal text-indigo-700">{p.edgeLabel ?? "—"}</span>
            </span>
          )}
          {/* NEITHER — and that is a real state, not a rendering gap. The row's
              edges were cleared after the piece was released, or the piece was
              stamped before scripts/0063. He should not guess; the amber says
              ask rather than showing him an empty cell he will read as "just
              the sink". */}
          {!p.hasSink && !p.edgeWork && (
            <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800"
              title="No sink and no edges marked on this row — check with the supervisor before working on it">
              ask supervisor
            </span>
          )}
        </div>
      </td>
      <td className="px-5 py-3 text-right">
        {!isStarted ? (
          <div className="flex items-center justify-end gap-1">
            <button onClick={onStart}
              className="bg-rose-100 hover:bg-rose-200 text-rose-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition">
              Start
            </button>
            <RejectPieceButton pieceId={p.id} processType="FABRICATION" onDone={onRejected} onError={onError} />
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs font-mono text-rose-600 animate-pulse">{elapsed}</span>
            <button onClick={onComplete} disabled={completing}
              className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition">
              {completing ? "…" : "Complete"}
            </button>
            <RejectPieceButton pieceId={p.id} processType="FABRICATION" onDone={onRejected} onError={onError} />
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * ONE OF THE TWO WORK LISTS ON THE BENCH.
 *
 * Edge polish on the left, sink polish on the right, and a piece carrying both
 * appears in both — the owner's ask, and right, because they are two separate
 * jobs priced two different ways. Narrower than the old single table: at this
 * width the man needs the piece code, its size and what to do, and the PO and
 * project belong on the slab card rather than in his way.
 */
function BenchColumn({
  title, subtitle, tone, pieces, empty,
  started, completing, onStart, onComplete, onRejected, onError,
}: {
  title: string;
  subtitle: string;
  tone: "indigo" | "orange" | "amber";
  pieces: Piece[];
  empty: string;
  started: Record<string, number>;
  completing: Record<string, boolean>;
  onStart: (pieceId: string) => void;
  onComplete: (pieceId: string) => void;
  onRejected: () => void;
  onError: (message: string) => void;
}) {
  const skin = {
    indigo: { head: "bg-indigo-50 border-indigo-200", text: "text-indigo-900", sub: "text-indigo-600", pill: "bg-indigo-100 text-indigo-700" },
    orange: { head: "bg-orange-50 border-orange-200", text: "text-orange-900", sub: "text-orange-600", pill: "bg-orange-100 text-orange-700" },
    amber:  { head: "bg-amber-50 border-amber-300",  text: "text-amber-900",  sub: "text-amber-700",  pill: "bg-amber-100 text-amber-800" },
  }[tone];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
      <div className={`px-4 py-3 border-b ${skin.head}`}>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className={`text-sm font-bold ${skin.text}`}>{title}</h2>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${skin.pill}`}>{pieces.length}</span>
        </div>
        <p className={`text-[11px] mt-0.5 ${skin.sub}`}>{subtitle}</p>
      </div>

      {pieces.length === 0 ? (
        <div className="text-center py-12 text-gray-300 text-sm">{empty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2.5">Piece</th>
                <th className="text-left px-4 py-2.5">Row</th>
                <th className="text-left px-4 py-2.5">Size</th>
                <th className="text-left px-4 py-2.5">Slab</th>
                {/* BOTH JOBS ARE NAMED IN EVERY COLUMN, not just the one this
                    list is for. A piece in the Edge list that also carries a
                    sink has to say so, or he polishes the edges, ticks it, and
                    the sink cutout is never hand finished — the piece is gone
                    from both lists the moment either Complete is pressed. */}
                <th className="text-left px-4 py-2.5" title="Everything this piece needs at the bench — not only the column it is listed under">Job</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pieces.map(p => (
                <PieceRow key={p.id} p={p}
                  compact
                  startMs={started[p.id] ?? null}
                  onStart={() => onStart(p.id)}
                  onComplete={() => onComplete(p.id)}
                  completing={!!completing[p.id]}
                  onRejected={onRejected}
                  onError={onError} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function FabFabricationPage() {
  return (
    <ProcessSessionGate type="FABRICATION">
      <FabricationQueue />
    </ProcessSessionGate>
  );
}

function FabricationQueue() {
  const [tab, setTab]               = useState<"open"|"done">("open");
  const [pieces, setPieces]         = useState<Piece[]>([]);
  const [completed, setCompleted]   = useState<CompletedPiece[]>([]);
  const [loading, setLoading]       = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError,   setLoadError]   = useState<string | null>(null);
  const [completing, setCompleting] = useState<Record<string, boolean>>({});
  const [undoing, setUndoing]       = useState<Record<string, boolean>>({});
  const [started, setStarted]       = useState<Record<string, number>>({});
  const [doneDate, setDoneDate]     = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });

  const loadOpen = useCallback(async () => {
    const r = await getJson<Piece>("/api/fab/queues/fabrication");
    if (r.ok) { setPieces(r.data); setLoadError(null); } else setLoadError(r.error);
  }, []);
  const loadDone = useCallback(async (date: string) => {
    const r = await getJson<CompletedPiece>(`/api/fab/queues/completed?type=FABRICATION&date=${date}`);
    if (r.ok) { setCompleted(r.data); setLoadError(null); } else setLoadError(r.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadOpen(), loadDone(doneDate)]).finally(() => setLoading(false));
    // Poll the open queue every 20 s — but only while the tab is visible (a
    // hidden tab shows nothing, so polling it only burns a function call and a
    // Neon read all night), and once immediately when it becomes visible again
    // so a returned-to tab is current. Same pattern as components/AutoRefresh.
    const t = setInterval(() => { if (document.visibilityState === "visible") loadOpen(); }, 20000);
    const onVisible = () => { if (document.visibilityState === "visible") loadOpen(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [loadOpen, loadDone, doneDate]);

  /** Lifted out of the row so both bench columns call the same one — a piece in
   *  both lists is one piece, and starting it on either side is the same start. */
  const startPiece = useCallback(async (pieceId: string) => {
    setStarted(s => ({ ...s, [pieceId]: Date.now() }));
    const r = await postJson("/api/fab/queues/start-op", { pieceId, operationType: "FABRICATION" });
    if (!r.ok) setActionError(r.error);
  }, []);

  async function complete(pieceId: string) {
    setCompleting(p => ({ ...p, [pieceId]: true }));
    const r = await postJson("/api/fab/queues/fabrication/complete", { pieceId });
    if (!r.ok) setActionError(r.error);
    setStarted(s => { const n = { ...s }; delete n[pieceId]; return n; });
    await Promise.all([loadOpen(), loadDone(doneDate)]);
    setCompleting(p => ({ ...p, [pieceId]: false }));
  }

  async function undo(pieceId: string, opId: string) {
    setUndoing(p => ({ ...p, [opId]: true }));
    const r = await postJson("/api/fab/queues/undo", { pieceId, operationType: "FABRICATION" });
    if (!r.ok) setActionError(r.error);
    await Promise.all([loadOpen(), loadDone(doneDate)]);
    setUndoing(p => ({ ...p, [opId]: false }));
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fabrication Queue</h1>
          <p className="text-sm text-gray-400 mt-0.5">{pieces.length} piece{pieces.length !== 1 ? "s" : ""} pending</p>
        </div>
        <div className="flex items-center gap-3">
          {tab === "done" && (
            <input type="date" value={doneDate} onChange={e => { setDoneDate(e.target.value); loadDone(e.target.value); }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-rose-200" />
          )}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setTab("open")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${tab === "open" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              Open <span className="ml-1.5 text-xs bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full">{pieces.length}</span>
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
          <div className="text-center py-20 text-gray-400">No pieces pending fabrication.</div>
        ) : (
          /* ── TWO COLUMNS, ONE BENCH ─────────────────────────────────────
             The owner: "fab stage need two column in one page on pending —
             edge polish, sink polish. So they can see same piece on both based
             on the manager if selected and allocated both."

             THE SAME PIECE APPEARS IN BOTH when it carries both jobs, and that
             is the point rather than a duplicate. They are two separate pieces
             of hand work, priced two different ways — the sink at a flat ₹230
             or ₹300 whatever its size, the edges by the running foot — and a
             man who sees the piece once does one of them and moves on.

             ONE COMPLETE BUTTON, THOUGH, on both copies. fab_piece has a single
             fabrication_completed flag: the bench finishes the piece, not the
             job. Splitting that would need a column per job and a rule for what
             "done" means when only one is — which is more machinery than the
             floor asked for. So the two columns are a WORK LIST, and pressing
             Complete on either clears the piece from both. */
          <div className="grid gap-5 lg:grid-cols-2">
            <BenchColumn
              title="Edge polish"
              subtitle="by the running foot"
              tone="indigo"
              pieces={pieces.filter(p => p.edgeWork)}
              empty="No edge polish on the bench."
              started={started} completing={completing}
              onStart={startPiece} onComplete={complete}
              onRejected={() => { void loadOpen(); }} onError={setActionError}
            />
            <BenchColumn
              title="Sink polish"
              subtitle="₹230 at 2 cm · ₹300 at 3 cm, whatever the size"
              tone="orange"
              pieces={pieces.filter(p => p.hasSink)}
              empty="No sink cutouts on the bench."
              started={started} completing={completing}
              onStart={startPiece} onComplete={complete}
              onRejected={() => { void loadOpen(); }} onError={setActionError}
            />
            {/* NEITHER FLAG — a piece that reached this bench and cannot say
                why. It would be invisible if the two columns were the whole
                page, and invisible is how a piece sits at a station for a week.
                See the Job cell for what puts one here. */}
            {pieces.some(p => !p.edgeWork && !p.hasSink) && (
              <div className="lg:col-span-2">
                <BenchColumn
                  title="Needs checking"
                  subtitle="on the bench with no sink and no edges marked — ask the supervisor"
                  tone="amber"
                  pieces={pieces.filter(p => !p.edgeWork && !p.hasSink)}
                  empty=""
                  started={started} completing={completing}
                  onStart={startPiece} onComplete={complete}
                  onRejected={() => { void loadOpen(); }} onError={setActionError}
                />
              </div>
            )}
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
                  <th className="text-left px-5 py-3">PO</th>
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
