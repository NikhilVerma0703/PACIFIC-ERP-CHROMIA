"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { PlanningBoard } from "./PlanningBoard";
import { FabAlerts } from "@/components/fab/FabAlerts";

/* -- Types ----------------------------------------------------------------- */
interface QcSlab {
  pacificQcId:  string;
  slabCode:     string;
  colour:       string | null;
  thicknessMm:  number | null;
  qualityGrade: string | null;
  batchKey:     string | null;
}
interface SlabPiece {
  requirementId: string;
  drawingNumber: string;
  pieceLabel:    string;
  description:   string | null;
  lengthIn:      number | null;
  widthIn:       number | null;
  qty:           number;
}
interface FabSlabRow {
  slabId:          string;
  slabCode:        string;
  slabJobStatus:   string | null;
  pacificQcId:     string | null;
  qcSlabCode:      string | null;
  qcSlabColour:    string | null;
  thicknessBucket: 2 | 3 | null;
  wastagePct:      number | null;
  pieces:          SlabPiece[];
  projectId:       string;
  projectCode:     string;
  customerName:    string | null;
}
interface Project {
  id: string; projectCode: string; customerName: string | null; status: string;
}

/* -- Small UI -------------------------------------------------------------- */
function StatusChip({ status }: { status: string | null }) {
  if (!status)                  return <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Pending</span>;
  if (status === "READY")       return <span className="text-[10px] font-bold uppercase tracking-wide text-blue-600">Sent to cutter</span>;
  if (status === "IN_PROGRESS") return <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Cutting</span>;
  if (status === "COMPLETED")   return <span className="text-[10px] font-bold uppercase tracking-wide text-green-600">Cut complete</span>;
  return <span className="text-[10px] text-gray-400">{status}</span>;
}
function WastePill({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const [bg, txt] = pct > 40 ? ["bg-red-100","text-red-700"] : pct > 20 ? ["bg-amber-100","text-amber-700"] : ["bg-green-100","text-green-700"];
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${bg} ${txt}`}>{pct.toFixed(1)}% waste</span>;
}
function ThickChip({ bucket }: { bucket: 2 | 3 | null }) {
  if (!bucket) return null;
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${bucket === 3 ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{bucket}cm</span>;
}

/* -- Slab picker (portal-based) -------------------------------------------- */
function SlabPicker({ slab, qcSlabs, onAssign }: {
  slab:     FabSlabRow;
  qcSlabs:  QcSlab[];
  onAssign: (fabSlabId: string, qcId: string | null) => Promise<void>;
}) {
  const [open,   setOpen]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [rect,   setRect]   = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function openPicker() {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  }
  function close() { setOpen(false); setSearch(""); }

  async function pick(qcId: string | null) {
    setSaving(true);
    await onAssign(slab.slabId, qcId);
    setSaving(false);
    close();
  }

  const filtered = qcSlabs.filter(q => {
    const matchThick  = slab.thicknessBucket === 3 ? q.thicknessMm === 30 : true;
    const matchSearch = !search || [q.slabCode, q.colour ?? "", q.batchKey ?? ""]
      .some(v => v.toLowerCase().includes(search.toLowerCase()));
    return matchThick && matchSearch;
  });

  const panelStyle: React.CSSProperties = rect ? {
    position: "fixed",
    top:      rect.bottom + 6,
    left:     Math.max(8, rect.right - 320),
    width:    320,
    zIndex:   9999,
  } : {};

  return (
    <>
      <button
        ref={btnRef}
        onClick={openPicker}
        disabled={saving}
        className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition whitespace-nowrap
          ${slab.pacificQcId
            ? "bg-white border border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-700"
            : "bg-indigo-600 text-white hover:bg-indigo-700"}`}>
        {saving ? "Saving..." : slab.pacificQcId ? "Change slab" : "Assign slab"}
      </button>

      {open && typeof window !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={close} />
          <div style={panelStyle} className="bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
              <span className="text-xs font-bold text-gray-700">
                {slab.thicknessBucket === 3 ? "3cm slabs only" : "All slabs"}
                <span className="ml-1 text-gray-400 font-normal">({filtered.length} available)</span>
              </span>
              <button onClick={close} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
            </div>
            <div className="px-3 py-2 border-b border-gray-100">
              <input
                autoFocus
                type="text"
                placeholder="Search slab code or colour..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100"
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {slab.pacificQcId && (
                <button onClick={() => pick(null)}
                  className="w-full text-left px-4 py-2.5 text-xs text-red-600 hover:bg-red-50 border-b border-gray-100">
                  Clear assignment
                </button>
              )}
              {filtered.length === 0 && (
                <p className="px-4 py-4 text-xs text-gray-400 italic">No matching slabs</p>
              )}
              {filtered.map(q => (
                <button key={q.pacificQcId} onClick={() => pick(q.pacificQcId)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 transition
                    ${slab.pacificQcId === q.pacificQcId ? "bg-indigo-50" : "hover:bg-gray-50"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-900">Slab {q.slabCode}</span>
                    {slab.pacificQcId === q.pacificQcId && (
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Current</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-400">
                    {q.colour      && <span>{q.colour}</span>}
                    {q.thicknessMm && <span>&middot; {q.thicknessMm}mm</span>}
                    {q.qualityGrade && <span>&middot; Grade {q.qualityGrade}</span>}
                    {q.batchKey    && <span>&middot; {q.batchKey}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

/* -- Slab card ------------------------------------------------------------- */
function SlabCard({ slab, qcSlabs, onAssign, onSend, printerEmail }: {
  slab:         FabSlabRow;
  qcSlabs:      QcSlab[];
  onAssign:     (fabSlabId: string, qcId: string | null) => Promise<void>;
  onSend:       (slabId: string) => Promise<void>;
  printerEmail: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sending,  setSending]  = useState(false);
  const isAssigned = !!slab.pacificQcId;
  const isSent     = !!slab.slabJobStatus;
  const totalPcs   = slab.pieces.reduce((s, p) => s + p.qty, 0);

  async function handleSend() {
    setSending(true);
    await onSend(slab.slabId);
    setSending(false);
  }

  function handleMailLabels() {
    const subject = `Print Labels - ${slab.projectCode} / Slab ${slab.slabCode}`;
    const bodyLines = [
      `LABEL PRINT REQUEST`,
      `------------------------------`,
      `Project : ${slab.projectCode}${slab.customerName ? ` (${slab.customerName})` : ""}`,
      `Slab    : ${slab.qcSlabCode ?? slab.slabCode}`,
      `Date    : ${new Date().toLocaleDateString()}`,
      ``,
      `LABELS TO PRINT:`,
      `------------------------------`,
      ...slab.pieces.map(p => `${p.drawingNumber}-${p.pieceLabel}  x  ${p.qty}`),
      `------------------------------`,
      `Total labels: ${totalPcs}`,
      ``,
      `-- Pacific ERP`,
    ];
    const mailto =
      `mailto:${encodeURIComponent(printerEmail)}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(bodyLines.join("\n"))}`;
    window.open(mailto);
  }

  return (
    <div className={`rounded-2xl border transition-colors
      ${isSent     ? "border-blue-200 bg-blue-50/20"
      : isAssigned ? "border-indigo-200 bg-white"
                   : "border-gray-200 bg-white"}`}>

      <div className="px-5 py-4 flex items-center gap-4 flex-wrap">
        {/* Left: identity */}
        <div className="flex-1 min-w-0">
          {isAssigned ? (
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-base font-bold text-gray-900">Slab {slab.qcSlabCode}</span>
              {slab.qcSlabColour && <span className="text-sm text-gray-500">{slab.qcSlabColour}</span>}
              <span className="text-xs font-mono text-gray-400">({slab.slabCode})</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-base font-mono font-bold text-gray-400">{slab.slabCode}</span>
              <span className="text-xs text-amber-600 font-semibold">Needs a slab</span>
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
              {slab.projectCode}
            </span>
            <ThickChip bucket={slab.thicknessBucket} />
            <span className="text-[11px] text-gray-400">{totalPcs} pcs &middot; {slab.pieces.length} types</span>
            <WastePill pct={slab.wastagePct} />
            <StatusChip status={slab.slabJobStatus} />
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2">
            {expanded ? "Hide" : "Pieces"}
          </button>
          <button
            onClick={handleMailLabels}
            title="Open email client pre-filled with labels for the printer"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100 transition whitespace-nowrap">
            Mail Labels
          </button>
          {!isSent && (
            <SlabPicker slab={slab} qcSlabs={qcSlabs} onAssign={onAssign} />
          )}
          {isAssigned && !isSent && (
            <button
              onClick={handleSend}
              disabled={sending}
              className="text-xs font-bold bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition">
              {sending ? "Sending..." : "Send to Cutter"}
            </button>
          )}
        </div>
      </div>

      {/* Pieces table */}
      {expanded && (
        <div className="border-t border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                {["Dwg","Piece","Description","L (in)","W (in)","Qty"].map(h => (
                  <th key={h} className={`px-5 py-2 text-gray-400 font-semibold ${h === "Qty" ? "text-center" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {slab.pieces.map((p, i) => (
                <tr key={i} className="hover:bg-gray-50/60">
                  <td className="px-5 py-2 font-mono text-gray-400 text-[11px]">{p.drawingNumber}</td>
                  <td className="px-5 py-2 font-mono font-bold text-gray-800">{p.pieceLabel}</td>
                  <td className="px-5 py-2 text-gray-500 max-w-xs truncate">{p.description ?? "-"}</td>
                  <td className="px-5 py-2 font-mono text-gray-600">{p.lengthIn ?? "-"}</td>
                  <td className="px-5 py-2 font-mono text-gray-600">{p.widthIn ?? "-"}</td>
                  <td className="px-5 py-2 text-center font-bold text-gray-800">{p.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -- Cut queue ------------------------------------------------------------- */
function CutQueue() {
  const [allSlabs,     setAllSlabs]     = useState<FabSlabRow[]>([]);
  const [qcSlabs,      setQcSlabs]      = useState<QcSlab[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [loadError,    setLoadError]    = useState<string | null>(null);
  const [filter,       setFilter]       = useState<"all"|"unassigned"|"ready"|"sent">("all");
  const [printerEmail, setPrinterEmail] = useState<string>(() =>
    typeof window !== "undefined" ? (localStorage.getItem("fab_printer_email") ?? "") : ""
  );
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft,   setEmailDraft]   = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // Released projects are asked for explicitly. Releasing sets
    // RELEASED_TO_PRODUCTION, and the endpoint's default filter is planning-only
    // — so without this the slabs of a released project dropped out of the very
    // queue that is meant to send them to the cutter.
    const [pRes, qRes] = await Promise.all([
      fetch("/api/fab/supervisor/projects?statuses=PLANNING,ALLOCATED,RELEASED_TO_PRODUCTION"),
      fetch("/api/fab/slabs"),
    ]);
    const [projects, qData] = await Promise.all([pRes.json(), qRes.json()]);

    // Both endpoints return a plain { error } object (not an array) on
    // 401/403 — checking res.ok explicitly, instead of just "is this an
    // array", is what tells a genuinely empty queue apart from a
    // permissions problem that would otherwise render identically as
    // "Nothing to cut yet."
    if (!pRes.ok) {
      setLoadError(
        pRes.status === 401
          ? "Your session has expired — sign in again."
          : typeof projects?.error === "string"
          ? `${projects.error} (HTTP ${pRes.status}) — this account may not be set up as a Fabrication Supervisor/Manager.`
          : `Could not load projects (HTTP ${pRes.status}).`
      );
      setAllSlabs([]); setQcSlabs([]); setLoading(false); return;
    }
    if (!qRes.ok) {
      setLoadError(typeof qData?.error === "string" ? `${qData.error} (HTTP ${qRes.status}) loading available slabs.` : `Could not load available slabs (HTTP ${qRes.status}).`);
    }

    setQcSlabs(Array.isArray(qData) ? qData : []);

    if (!Array.isArray(projects) || !projects.length) {
      setAllSlabs([]); setLoading(false); return;
    }

    const results = await Promise.all(
      projects.map(async (p: Project) => {
        const res  = await fetch(`/api/fab/slab-allocation?projectId=${p.id}`);
        const data = await res.json();
        return (Array.isArray(data) ? data : []).map((s: any) => ({
          ...s, projectId: p.id, projectCode: p.projectCode, customerName: p.customerName,
        }));
      })
    );

    const flat = (results.flat() as FabSlabRow[]).sort((a, b) => {
      const rank = (s: FabSlabRow) =>
        !s.pacificQcId ? 0 : !s.slabJobStatus ? 1 : s.slabJobStatus === "COMPLETED" ? 3 : 2;
      return rank(a) - rank(b);
    });

    setAllSlabs(flat);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function assignQcSlab(fabSlabId: string, qcId: string | null) {
    await fetch("/api/fab/assign-qc-slab", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fabSlabId, pacificQcId: qcId }),
    });
    await load();
  }

  async function sendToCutter(slabId: string) {
    await fetch("/api/fab/approve-slab", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slabId }),
    });
    await load();
  }

  const [fixingCascade,  setFixingCascade]  = useState(false);
  const [endingSessions, setEndingSessions] = useState(false);
  const [fixResult,     setFixResult]     = useState<string | null>(null);
  async function runCascadeFix() {
    setFixingCascade(true);
    setFixResult(null);
    try {
      const res  = await fetch("/api/fab/admin/fix-cascade", { method: "POST" });
      const data = await res.json();
      setFixResult(data.message ?? (data.error ? `Error: ${data.error}` : "Done"));
    } catch {
      setFixResult("Request failed");
    }
    setFixingCascade(false);
  }

  async function endAllSessions() {
    if (!confirm("Force-logout all machine operators? (Use at shift end or if operators forgot to log out)")) return;
    setEndingSessions(true);
    setFixResult(null);
    try {
      const res  = await fetch("/api/fab/admin/end-all-sessions", { method: "POST" });
      const data = await res.json();
      setFixResult(data.error ? `Error: ${data.error}` : `Done -- ${data.closed} session(s) closed`);
    } catch {
      setFixResult("Request failed");
    }
    setEndingSessions(false);
  }

  const counts = {
    all:        allSlabs.length,
    unassigned: allSlabs.filter(s => !s.pacificQcId).length,
    ready:      allSlabs.filter(s =>  s.pacificQcId && !s.slabJobStatus).length,
    sent:       allSlabs.filter(s => !!s.slabJobStatus).length,
  };

  const filtered = allSlabs.filter(s =>
    filter === "unassigned" ? !s.pacificQcId
    : filter === "ready"    ?  s.pacificQcId && !s.slabJobStatus
    : filter === "sent"     ? !!s.slabJobStatus
    : true
  );

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm gap-2">
      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12"/>
      </svg>
      Loading...
    </div>
  );

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Slab Cut Queue</h1>
          <p className="text-sm text-gray-400 mt-0.5">Assign a physical slab, then send to cutter</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load}
            className="text-xs text-gray-500 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition">
            Refresh
          </button>
          <button onClick={runCascadeFix} disabled={fixingCascade}
            title="Fix pieces stuck in Pending after slabs were marked Cut"
            className="text-xs text-orange-600 border border-orange-200 hover:bg-orange-50 disabled:opacity-50 px-3 py-1.5 rounded-lg transition font-medium">
            {fixingCascade ? "Fixing..." : "Fix Pending Queues"}
          </button>
          <button onClick={endAllSessions} disabled={endingSessions}
            title="Force-logout all machine operators (use at shift end)"
            className="text-xs text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 px-3 py-1.5 rounded-lg transition font-medium">
            {endingSessions ? "Ending..." : "End All Sessions"}
          </button>
        </div>
        {fixResult && (
          <div className="w-full mt-2 text-xs px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-800">
            {fixResult}
          </div>
        )}
      </div>

      <FabAlerts loadError={loadError} noun="cut queue" />

      {/* Printer email settings */}
      <div className="mb-5 flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5 flex-wrap">
        <span className="text-xs font-semibold text-teal-700">Label printer email:</span>
        {editingEmail ? (
          <>
            <input
              autoFocus
              type="email"
              value={emailDraft}
              onChange={e => setEmailDraft(e.target.value)}
              placeholder="printer@company.com"
              className="text-xs border border-teal-300 rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-teal-400 w-64"
            />
            <button
              onClick={() => {
                const trimmed = emailDraft.trim();
                setPrinterEmail(trimmed);
                if (typeof window !== "undefined") localStorage.setItem("fab_printer_email", trimmed);
                setEditingEmail(false);
              }}
              className="text-xs font-bold bg-teal-600 text-white px-3 py-1.5 rounded-lg hover:bg-teal-700 transition">
              Save
            </button>
            <button onClick={() => setEditingEmail(false)}
              className="text-xs text-teal-500 hover:text-teal-700 underline">
              Cancel
            </button>
          </>
        ) : (
          <>
            {printerEmail
              ? <span className="text-xs font-mono text-teal-900 bg-white border border-teal-200 rounded-lg px-3 py-1.5">{printerEmail}</span>
              : <span className="text-xs text-teal-400 italic">Not set - Mail Labels will open with blank To field</span>
            }
            <button
              onClick={() => { setEmailDraft(printerEmail); setEditingEmail(true); }}
              className="text-xs text-teal-600 hover:text-teal-800 underline underline-offset-2">
              {printerEmail ? "Change" : "Set email"}
            </button>
          </>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {(["all","unassigned","ready","sent"] as const).map(key => {
          const labels = { all:"All", unassigned:"Needs slab", ready:"Ready to cut", sent:"Sent" };
          const dotCol = { all:"bg-gray-400", unassigned:"bg-amber-400", ready:"bg-indigo-500", sent:"bg-blue-500" };
          return (
            <button key={key} onClick={() => setFilter(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition border
                ${filter === key
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
              <span className={`w-2 h-2 rounded-full ${filter === key ? "bg-white/60" : dotCol[key]}`} />
              {labels[key]}
              <span className={`text-xs ${filter === key ? "text-white/60" : "text-gray-400"}`}>{counts[key]}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-2xl border border-gray-200">
          {filter === "all"
            ? "Nothing to cut yet. Slabs land here once a project is planned on the Planning Board (or a CLO allocation Excel is applied)."
            : "No slabs in this state."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(slab => (
            <SlabCard
              key={slab.slabId}
              slab={slab}
              qcSlabs={qcSlabs}
              onAssign={assignQcSlab}
              onSend={sendToCutter}
              printerEmail={printerEmail}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* -- Main page ------------------------------------------------------------- */
// Two tabs, because the supervisor has two distinct jobs and only the second one
// had a screen. PLANNING is where a project lands the moment the manager creates
// it — pieces get slabs and the project is released. CUT QUEUE is what comes
// after: a physical QC slab per cut sheet, then send to the cutter.
export default function FabSupervisorPage() {
  const [tab, setTab] = useState<"planning" | "queue">("planning");

  return (
    // The planning tables carry seven columns; the cut queue is a card list.
    <div className={tab === "planning" ? "max-w-6xl" : "max-w-4xl"}>
      <div className="flex items-center gap-1 mb-6 bg-slate-100 rounded-xl p-1 w-fit">
        {([["planning", "Planning"], ["queue", "Cut Queue"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
              tab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "planning" ? <PlanningBoard /> : <CutQueue />}
    </div>
  );
}
