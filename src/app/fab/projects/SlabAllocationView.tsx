"use client";
import { useEffect, useState, useCallback } from "react";
import { useQcSlabs } from "@/lib/fab/qcSlabs";

interface SlabPiece {
  requirementId: string;
  drawingNumber: string;
  pieceLabel:    string;
  description:   string | null;
  lengthIn:      number | null;
  widthIn:       number | null;
  thickness:     number | null;
  qty:           number;
}

interface SlabRow {
  slabId:          string;
  slabCode:        string;   // CLO name e.g. "Slab_01"
  slabJobStatus:   string | null;
  slabJobId:       string | null;
  pacificQcId:     string | null;
  qcSlabCode:      string | null;
  qcSlabColour:    string | null;
  thicknessBucket: 2 | 3 | null;
  piecesAreaMm2:   number;
  wastagePct:      number | null;
  pieces:          SlabPiece[];
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return (
    <span className="text-[11px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
      Pending
    </span>
  );
  if (status === "READY") return (
    <span className="text-[11px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
      Sent to cutter
    </span>
  );
  if (status === "IN_PROGRESS") return (
    <span className="text-[11px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
      Cutting
    </span>
  );
  if (status === "COMPLETED") return (
    <span className="text-[11px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
      Cut complete
    </span>
  );
  return <span className="text-[11px] text-gray-400">{status}</span>;
}

function WastageBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const col = pct > 40
    ? "bg-red-50 text-red-700 border-red-200"
    : pct > 20
    ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-green-50 text-green-700 border-green-200";
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${col}`}>
      {pct.toFixed(1)}% waste
    </span>
  );
}

function QcSlabPicker({
  slab,
  onAssign,
}: {
  slab:     SlabRow;
  onAssign: (fabSlabId: string, pacificQcId: string | null) => Promise<void>;
}) {
  const [open,   setOpen]   = useState(false);
  const [saving, setSaving] = useState(false);

  // 3cm pieces -> only 30mm slabs; 2cm or unknown -> all slabs. Filtered and
  // capped in SQL: this list had no search box at all, so once the endpoint
  // started paging there had to be a way to reach a slab past the first page.
  const { search, setSearch, slabs: filtered, loading, error, capped } =
    useQcSlabs(open, slab.thicknessBucket === 3 ? 30 : null);

  async function pick(qcId: string | null) {
    setSaving(true);
    await onAssign(slab.slabId, qcId);
    setSaving(false);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={saving}
        className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition
          ${slab.pacificQcId
            ? "bg-white border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-700"
            : "bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700"}`}>
        {saving ? "Saving..." : slab.pacificQcId ? "Change slab" : "Assign real slab"}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl w-80 max-h-72 overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-100 text-[11px] text-gray-400 font-semibold uppercase tracking-wide">
            {slab.thicknessBucket === 3 ? "3cm slabs only" : "All available slabs"}
            {" "}&mdash; {capped ? `${filtered.length}+` : filtered.length} available
          </div>
          <div className="px-3 py-2 border-b border-gray-100">
            <input
              autoFocus
              type="text"
              placeholder="Search slab number or colour..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100"
            />
          </div>
          {slab.pacificQcId && (
            <button
              onClick={() => pick(null)}
              className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 border-b border-gray-100">
              Clear assignment
            </button>
          )}
          {/* An empty list and a failed lookup must not look the same. */}
          {error && <p className="px-3 py-3 text-xs text-red-600">{error}</p>}
          {loading && !error && (
            <p className="px-3 py-3 text-xs text-gray-400">Searching...</p>
          )}
          {!loading && !error && filtered.length === 0 && (
            <p className="px-3 py-3 text-xs text-gray-400">No matching slabs available</p>
          )}
          {filtered.map(q => (
            <button
              key={q.pacificQcId}
              onClick={() => pick(q.pacificQcId)}
              className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0
                ${slab.pacificQcId === q.pacificQcId ? "bg-indigo-50" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-900">Slab {q.slabCode}</span>
                {slab.pacificQcId === q.pacificQcId && (
                  <span className="text-[10px] text-indigo-600 font-semibold">Current</span>
                )}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">
                {q.colour ?? "Unknown colour"}
                {q.thicknessMm ? ` · ${q.thicknessMm}mm` : ""}
                {q.qualityGrade ? ` · Grade ${q.qualityGrade}` : ""}
                {q.batchKey ? ` · ${q.batchKey}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SlabAllocationView({
  projectId,
  canApprove,
}: {
  projectId:  string;
  canApprove: boolean;
}) {
  const [slabs,     setSlabs]     = useState<SlabRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [approving, setApproving] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    // Only the allocation rows. The available-slab list belongs to each picker
    // now (useQcSlabs, fetched on open) — this call used to drag the entire QC
    // history down before the view could render.
    const slabRes = await fetch(`/api/fab/slab-allocation?projectId=${projectId}`);
    // .catch(() => null): a non-JSON platform error (gateway timeout, HTML 500)
    // rejected here and escaped load(), so setLoading(false) never ran and the
    // view sat on its spinner for good.
    const slabData = await slabRes.json().catch(() => null);
    setSlabs(Array.isArray(slabData) ? slabData : []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function approve(slabId: string) {
    setApproving(p => ({ ...p, [slabId]: true }));
    await fetch("/api/fab/approve-slab", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ slabId }),
    });
    await load();
    setApproving(p => ({ ...p, [slabId]: false }));
  }

  async function assignQcSlab(fabSlabId: string, pacificQcId: string | null) {
    await fetch("/api/fab/assign-qc-slab", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fabSlabId, pacificQcId }),
    });
    await load();
  }

  if (loading) return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs text-gray-400">Loading slab allocations...</p>
    </div>
  );

  if (!slabs.length) return null;

  const assignedCount  = slabs.filter(s => s.pacificQcId).length;
  const wastageSlabs   = slabs.filter(s => s.wastagePct !== null);
  const avgWaste       = wastageSlabs.length
    ? wastageSlabs.reduce((s, r) => s + (r.wastagePct ?? 0), 0) / wastageSlabs.length
    : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-bold text-gray-800">Slab Allocation Plan</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {slabs.length} slab{slabs.length !== 1 ? "s" : ""}
            {" · "}{assignedCount} assigned
            {canApprove ? " — assign a physical slab then send to cutter" : ""}
          </p>
        </div>
        {avgWaste !== null && (
          <div className="text-right">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">Avg wastage</p>
            <p className={`text-lg font-bold ${avgWaste > 30 ? "text-red-600" : avgWaste > 15 ? "text-amber-600" : "text-green-600"}`}>
              {avgWaste.toFixed(1)}%
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {slabs.map(slab => {
          const totalPieces = slab.pieces.reduce((s, p) => s + p.qty, 0);
          const isSent      = slab.slabJobStatus !== null;
          const isAssigned  = !!slab.pacificQcId;

          return (
            <div key={slab.slabId}
              className={`rounded-xl border overflow-hidden transition
                ${isSent
                  ? "border-blue-200 bg-blue-50/20"
                  : isAssigned
                  ? "border-indigo-200 bg-indigo-50/10"
                  : "border-gray-200"}`}>

              {/* Card header */}
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                <div className="flex items-center justify-between gap-3 flex-wrap">

                  {/* Left: physical slab (primary) + CLO name (secondary) */}
                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                    {isAssigned ? (
                      <div>
                        <span className="font-bold text-sm text-gray-900">
                          Slab {slab.qcSlabCode}
                        </span>
                        {slab.qcSlabColour && (
                          <span className="ml-2 text-xs text-gray-500">{slab.qcSlabColour}</span>
                        )}
                        <span className="ml-2 text-[11px] text-gray-400 font-mono">({slab.slabCode})</span>
                      </div>
                    ) : (
                      <div>
                        <span className="font-mono text-sm font-bold text-gray-400">{slab.slabCode}</span>
                        <span className="ml-2 text-[11px] text-amber-600 font-medium">No physical slab assigned</span>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] text-gray-400">
                        {slab.pieces.length} type{slab.pieces.length !== 1 ? "s" : ""} &middot; {totalPieces} pcs
                        {slab.thicknessBucket ? ` · ${slab.thicknessBucket}cm` : ""}
                      </span>
                      <StatusBadge status={slab.slabJobStatus} />
                      <WastageBadge pct={slab.wastagePct} />
                    </div>
                  </div>

                  {/* Right: assign + send buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    {canApprove && (
                      <QcSlabPicker
                        slab={slab}
                        onAssign={assignQcSlab}
                      />
                    )}
                    {canApprove && isAssigned && !isSent && (
                      <button
                        onClick={() => approve(slab.slabId)}
                        disabled={approving[slab.slabId]}
                        className="text-xs font-semibold bg-gray-900 hover:bg-gray-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition">
                        {approving[slab.slabId] ? "Sending..." : "Send to Cutter"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Pieces table */}
              <table className="w-full text-xs">
                <thead className="bg-gray-50/50">
                  <tr>
                    <th className="text-left px-4 py-2 text-gray-400 font-semibold">Dwg</th>
                    <th className="text-left px-4 py-2 text-gray-400 font-semibold">Piece</th>
                    <th className="text-left px-4 py-2 text-gray-400 font-semibold">Description</th>
                    <th className="text-left px-4 py-2 text-gray-400 font-semibold">L (in)</th>
                    <th className="text-left px-4 py-2 text-gray-400 font-semibold">W (in)</th>
                    <th className="text-center px-4 py-2 text-gray-400 font-semibold">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {slab.pieces.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-mono text-gray-500">{p.drawingNumber}</td>
                      <td className="px-4 py-2 font-mono font-bold text-gray-900">{p.pieceLabel}</td>
                      <td className="px-4 py-2 text-gray-500 max-w-xs truncate">{p.description ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-gray-600">{p.lengthIn ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-gray-600">{p.widthIn ?? "—"}</td>
                      <td className="px-4 py-2 text-center font-semibold text-gray-800">{p.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <button onClick={load} className="mt-3 text-xs text-gray-400 hover:text-gray-600 underline">
        Refresh
      </button>
    </div>
  );
}
