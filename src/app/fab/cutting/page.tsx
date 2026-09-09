"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { postJson, getJson } from "@/lib/fab/postJson";
import { ProcessSessionGate } from "@/components/fab/ProcessSessionGate";
import { rowLabel } from "@/lib/fab/pieceNaming";
// scripts/0068 — the size AS THE CUSTOMER ORDERED IT. length/width are stored
// in inches because the feet and the square feet are built on inches; this is
// the only thing that turns them back into the centimetres a metric order was
// written in. NULL unit = inches = unchanged.
import { formatDimension, orderedSizeLabel, parseDimUnit } from "@/lib/fab/dimensions";


interface Piece {
  id: string; pieceCode: string;
  project: { projectCode: string; customerName: string };
  drawing: { drawingNumber: string } | null;
  requirement: { pieceLabel: string | null; rowLetter: string | null; description: string | null; length: number | null; width: number | null; dimUnit: string | null } | null;
  hasSink: boolean; polishRequired: boolean; fabricationRequired: boolean;
  /** Hand edge polish. Optional because the column arrives in scripts/0063 and
   *  a queue read against a database without it must still render. */
  hasEdgePolish?: boolean;
}
interface LegacyGroup { type: "legacy"; slab: { id: string; slabCode: string; colour: string | null }; pieces: Piece[] }
/**
 * WHAT UNIT TO PUT IN THE CUT LIST'S COLUMN HEADINGS.
 *
 * The cells now render in each row's own unit, so the heading must agree with
 * them or it lies about a number a saw is set from. One slab job is one
 * project's worth of pieces and they agree in practice; when they do not, the
 * unit is DROPPED rather than asserted — "L" tells the operator to read the
 * value, "L (in)" over a centimetre would tell him to cut the wrong piece.
 */
function cutListUnit(rows: CloReq[]): string {
  if (rows.length === 0) return " (in)";
  const first = parseDimUnit(rows[0].dimUnit);
  return rows.every(r => parseDimUnit(r.dimUnit) === first)
    ? (first === "CM" ? " (cm)" : " (in)")
    : "";
}

interface CloReq { requirementId: string; poNumber: string | null; drawingNumber: string | null; pieceLabel: string; description: string | null; lengthIn: number | null; widthIn: number | null; /** scripts/0068 — 'CM' or NULL/'IN'. Display only; lengthIn/widthIn are always inches. */ dimUnit: string | null; qty: number }
interface CloGroup {
  type: "clo"; slabJobId: string; jobStatus: string; startTime: string | null;
  operatorId: string | null; operatorName: string | null;
  machineId: string | null; machineName: string | null;
  /** This station's machine, answered by the server from the CUTTING process
   *  session. Replaces the `fab_machine_id` cookie, which nothing ever set. */
  viewerMachineId: string | null;
  slab: { id: string; slabCode: string; qcSlabCode: string | null; qcColour: string | null };
  project: { projectCode: string; customerName: string };
  requirements: CloReq[]; totalPcs: number;
}
type QueueEntry = LegacyGroup | CloGroup;

/** A project still being planned — rows ordered, no slab chosen yet. From
 *  /api/fab/supervisor/board?view=projects, which the cutter may now read. */
interface AwaitingProject {
  id: string;
  projectCode: string;
  customerName: string | null;
  /** PO or SAMPLE. The owner: "he sees the project CTS or sampling." A sample
   *  order is cut, machine polished and packed with no sink and no hand polish,
   *  so which it is changes what he is walking into. */
  kind: string;
  requirementCount: number;
}

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
  const myMachineId = entry.viewerMachineId;
  const elapsed = useElapsed(entry.startTime);
  const slabName = entry.slab.qcSlabCode
    ? `Slab ${entry.slab.qcSlabCode}${entry.slab.qcColour ? " - " + entry.slab.qcColour : ""}`
    : entry.slab.slabCode;
  const inProgress = entry.jobStatus === "IN_PROGRESS";

  // WHO ELSE IS ON THIS SLAB — decided by machine first, login second.
  //
  // Fabrication signs in on ONE shared operator account, so comparing
  // operatorId to currentUserId returns "mine" for every job on the board no
  // matter who started it. The lock rendered, and could never fire. Two people
  // could cut the same slab with nothing on screen to warn either of them.
  //
  // The machine is the real discriminator: each station opens its own
  // FabMachineSession, so a job stamped with a different machineId is somebody
  // else's work even though the login matches. When either side has no machine
  // recorded we genuinely cannot tell, and the card says nothing rather than
  // claiming an ownership it has not established.
  const otherMachine = inProgress && entry.machineId !== null && myMachineId !== null
    && entry.machineId !== myMachineId;
  const otherLogin   = inProgress && entry.operatorId !== null && currentUserId !== null
    && entry.operatorId !== currentUserId;
  const lockedByOther = otherMachine || otherLogin;
  const ownedByMe     = inProgress && !lockedByOther;
  const heldBy        = entry.machineName ?? entry.operatorName ?? "another operator";

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
                🔒 Being cut on {heldBy}
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
            <th className="text-left px-5 py-2">PO</th>
            <th className="text-left px-5 py-2">Piece</th>
            <th className="text-left px-5 py-2">Description</th>
            {/* scripts/0068 — the header follows the ROWS. One slab job is one
                project's worth of pieces, so they agree in practice; if they ever
                do not, the unit is dropped rather than asserted wrongly over a
                column the saw is about to be set from. */}
            <th className="text-left px-5 py-2">L{cutListUnit(entry.requirements)}</th>
            <th className="text-left px-5 py-2">W{cutListUnit(entry.requirements)}</th>
            <th className="text-center px-5 py-2">Qty</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {entry.requirements.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50/50">
              <td className="px-5 py-2.5 font-mono text-xs text-gray-400">{r.poNumber ?? r.drawingNumber ?? "—"}</td>
              <td className="px-5 py-2.5 font-semibold text-gray-800">{r.pieceLabel}</td>
              <td className="px-5 py-2.5 text-gray-500 max-w-xs truncate">{r.description ?? "-"}</td>
              <td className="px-5 py-2.5 font-mono text-gray-600">{formatDimension(r.lengthIn, r.dimUnit) ?? "-"}</td>
              <td className="px-5 py-2.5 font-mono text-gray-600">{formatDimension(r.widthIn, r.dimUnit) ?? "-"}</td>
              <td className="px-5 py-2.5 text-center font-bold text-gray-800">{r.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// RETIRED 2026-08 — this read a cookie that nothing in the repo ever set.
//
// `fab_machine_id` was a leftover of the session model that the per-process
// `fab_ps_*` sessions replaced. It is deleted on sign-out (fab/sign-out-action)
// and read here, and written NOWHERE, so this hook returned null on every
// render, on every machine, forever. The machine comparison it fed was
// therefore dead: `otherMachine` could never be true, and the card fell back to
// comparing logins — the one comparison its own comments say cannot work.
//
// The station's machine now comes down with the queue as `viewerMachineId`,
// read server-side off the same FabMachineSession the page is gated on.
//
// /** The machine this tablet holds, from the cookie /fab/session sets. */
// function useMachineId(): string | null {
//   const [id, setId] = useState<string | null>(null);
//   useEffect(() => {
//     const m = document.cookie.match(/(?:^|;\s*)fab_machine_id=([^;]*)/);
//     setId(m ? decodeURIComponent(m[1]) : null);
//   }, []);
//   return id;
// }

export default function FabCuttingPage() {
  return (
    <ProcessSessionGate type="CUTTING">
      <CuttingQueue />
    </ProcessSessionGate>
  );
}

function CuttingQueue() {
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
  /** Projects still being planned — work that has no slab on it yet. See the
   *  panel further down for why the cut queue is where this belongs. */
  const [awaiting,      setAwaiting]     = useState<AwaitingProject[]>([]);

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

  /**
   * WORK THAT HAS NO SLAB YET.
   *
   * The owner, on samples: "when it's sample, sampling guy send request to
   * supervisor — hereafter no need of send to cutter. It queued to cutter where
   * he choose a slab and starts working. He sees the project CTS or sampling,
   * then inside he add slab and start working."
   *
   * The send step did not need removing; it needed to stop being a HANDOVER.
   * approve-slab is what puts a slab in this queue, and now that the cutter may
   * call it himself, a sample no longer waits for a supervisor to pass it on —
   * it waits for a cutter to pick up a slab. What was missing was somewhere for
   * him to SEE that it was waiting, and the cut queue is that place: he is
   * already standing here when he runs out of work.
   *
   * DELIBERATELY NOT MERGED INTO THE QUEUE ITSELF. A slab job is stone with rows
   * on it that he can start; this is an order with no stone yet. Putting both in
   * one list would mean two cards that look alike and do entirely different
   * things when pressed.
   *
   * A FAILURE HERE IS SILENT, unlike loadOpen's. The queue below is the thing he
   * must not be lied to about — an empty one means he can go home. This panel is
   * a prompt, and an amber banner about a prompt that failed to load, stacked
   * over a queue full of work, is noise at the top of the screen he actually
   * needs.
   */
  const loadAwaiting = useCallback(async () => {
    const r = await getJson<AwaitingProject>("/api/fab/supervisor/board?view=projects");
    if (r.ok) setAwaiting(r.data.filter(p => (p.requirementCount ?? 0) > 0));
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadOpen(), loadDone(doneDate), loadAwaiting()]).finally(() => setLoading(false));
  }, [loadOpen, loadDone, loadAwaiting, doneDate]);

  // Poll open queue every 15s — but only while the tab is visible (a hidden
  // tab shows nothing, so polling it only burns a function call and a Neon
  // read every 15 s all night), and once immediately when it becomes visible
  // again so a returned-to tab is current. Same pattern as components/AutoRefresh.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") loadOpen(); }, 15000);
    // The awaiting panel is refreshed on RETURN but not on the 15 s timer. A
    // sample request appearing is a thing that happens a few times a day, not a
    // few times a minute, and the queue below is what the poll exists for.
    const onVisible = () => {
      if (document.visibilityState === "visible") { loadOpen(); loadAwaiting(); }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [loadOpen, loadAwaiting]);

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

      {/* ── WAITING FOR A SLAB ──────────────────────────────────────────────
          The owner: "when it's sample, sampling guy send request to supervisor —
          hereafter no need of send to cutter. It queued to cutter where he
          choose a slab and starts working. He sees the project CTS or sampling,
          then inside he add slab and start working."

          So this is the queue BEFORE the queue. Each of these is an order with
          rows on it and no stone under them; opening one takes him to the same
          slab board the supervisor uses, where he adds the slab he is standing
          at, puts rows on it, and the last button drops it into the list below.

          SAMPLES LEAD, and are coloured apart. A sample order is the one this
          panel exists for — it used to sit waiting for a supervisor to pass it
          on — and it behaves differently once he opens it: no sinks, no hand
          polish, cut and polish and pack. */}
      {tab === "open" && awaiting.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-bold text-amber-900">
              Waiting for a slab
              <span className="ml-2 text-xs font-semibold text-amber-700">{awaiting.length}</span>
            </h2>
            {/* "STILL BEING PLANNED", not "has no slab at all". A project drops
                off this list when its LAST slab goes to the floor, so one that
                is half sent is legitimately still here with rows waiting — and
                telling the cutter it has no stone on it when three slabs of it
                are already cut is the kind of small lie that makes a man stop
                believing the screen. */}
            <p className="text-[11px] text-amber-700">
              Rows still waiting for stone — open one, add the slab you are standing at, and it
              drops into the queue below.
            </p>
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {[...awaiting]
              .sort((a, b) => Number(b.kind === "SAMPLE") - Number(a.kind === "SAMPLE"))
              .map(p => {
                const sample = p.kind === "SAMPLE";
                return (
                  <li key={p.id}>
                    <Link
                      href={`/fab/supervisor/slabs?projectId=${encodeURIComponent(p.id)}`}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                        sample
                          ? "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100"
                          : "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"}`}>
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                        sample ? "bg-violet-200 text-violet-800" : "bg-amber-200 text-amber-900"}`}>
                        {sample ? "Sample" : "PO"}
                      </span>
                      <span className="font-mono">{p.projectCode}</span>
                      {p.customerName && (
                        <span className="font-normal opacity-70 truncate max-w-[12rem]">{p.customerName}</span>
                      )}
                      <span className="font-normal opacity-60">
                        {p.requirementCount} row{p.requirementCount === 1 ? "" : "s"}
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {tab === "open" && (
        queue.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            {awaiting.length > 0
              ? "No slabs in the cutting queue — pick one from the list above to start."
              : "No slabs in the cutting queue."}
          </div>
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
                        <th className="text-left px-5 py-2">Row</th>
                        <th className="text-left px-5 py-2">Size</th>
                        <th className="text-left px-5 py-2">Project</th>
                        <th className="text-left px-5 py-2">Flags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pieces.map(p => (
                        <tr key={p.id} className="hover:bg-gray-50/50">
                          <td className="px-5 py-2.5 font-mono text-xs text-gray-700">{p.pieceCode}</td>
                          <td className="px-5 py-2.5 text-gray-600">{rowLabel(p.requirement?.rowLetter, p.requirement?.pieceLabel ?? p.requirement?.description)}</td>
                          <td className="px-5 py-2.5 text-gray-500">
                            {orderedSizeLabel(p.requirement?.length, p.requirement?.width, p.requirement?.dimUnit) ?? "-"}
                          </td>
                          <td className="px-5 py-2.5 text-gray-500">{p.project.projectCode}</td>
                          <td className="px-5 py-2.5">
                            <div className="flex gap-1">
                              {p.polishRequired && <FlagChip label="Polish" col="bg-violet-100 text-violet-700" />}
                              {p.hasSink        && <FlagChip label="Sink"   col="bg-orange-100 text-orange-700" />}
                              {/* EDGE, beside Fab and not instead of it.
                                  Fab means "goes to the hand bench" and has
                                  meant `has_sink OR has_edge_polish` since
                                  scripts/0063 — so Fab with no Sink was the
                                  only clue that a piece was going there for its
                                  edges, and it was a clue by elimination. This
                                  says it. */}
                              {p.hasEdgePolish  && <FlagChip label="Edge"   col="bg-indigo-100 text-indigo-700" />}
                              {p.fabricationRequired && <FlagChip label="Fab" col="bg-rose-100 text-rose-700" />}
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
