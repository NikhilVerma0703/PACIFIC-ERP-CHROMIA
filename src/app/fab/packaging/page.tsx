"use client";
import { useEffect, useState, useCallback } from "react";

interface Piece {
  id: string; pieceCode: string; polishRequired: boolean; hasSink: boolean; fabricationRequired: boolean;
  project: { projectCode: string; customerName: string };
  drawing: { drawingNumber: string } | null;
  requirement: { pieceLabel: string | null; length: number | null; width: number | null } | null;
  slab: { slabCode: string; colour: string | null } | null;
}

export default function FabPackagingPage() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [packaging, setPackaging] = useState(false);
  const [lastPkg, setLastPkg] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/fab/queues/packaging");
    const data = await res.json();
    setPieces(Array.isArray(data) ? data : []);
    setSelected(new Set());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(id: string) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(s => s.size === pieces.length ? new Set() : new Set(pieces.map(p => p.id)));
  }

  async function packageSelected() {
    if (!selected.size) return;
    setPackaging(true);
    const res = await fetch("/api/fab/queues/packaging/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pieceIds: Array.from(selected) }),
    });
    const data = await res.json();
    setLastPkg(data.packageCode ?? "");
    await load();
    setPackaging(false);
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Packaging Queue</h1>
          <p className="text-sm text-gray-400">{pieces.length} piece{pieces.length !== 1 ? "s" : ""} ready · {selected.size} selected</p>
        </div>
        <div className="flex items-center gap-3">
          {lastPkg && <span className="text-xs text-green-700 bg-green-50 px-3 py-1.5 rounded-full border border-green-200">✓ {lastPkg} created</span>}
          <button onClick={packageSelected} disabled={!selected.size || packaging}
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-40">
            {packaging ? "Packaging…" : `📦 Package ${selected.size > 0 ? `(${selected.size})` : ""}`}
          </button>
        </div>
      </div>

      {pieces.length === 0 ? (
        <div className="text-center py-20 text-gray-400">No pieces ready for packaging yet.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-5 py-3 text-left">
                  <input type="checkbox" checked={selected.size === pieces.length && pieces.length > 0}
                    onChange={toggleAll} className="rounded" />
                </th>
                <th className="text-left px-5 py-3">Piece</th>
                <th className="text-left px-5 py-3">Drawing</th>
                <th className="text-left px-5 py-3">Size (mm)</th>
                <th className="text-left px-5 py-3">Slab</th>
                <th className="text-center px-5 py-3">Project</th>
                <th className="text-center px-5 py-3">Operations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pieces.map(p => (
                <tr key={p.id} className={`hover:bg-gray-50 ${selected.has(p.id) ? "bg-blue-50" : ""}`}
                  onClick={() => toggle(p.id)} style={{ cursor: "pointer" }}>
                  <td className="px-5 py-3">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="rounded" onClick={e => e.stopPropagation()} />
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-700">{p.pieceCode}</td>
                  <td className="px-5 py-3 text-gray-500">{p.drawing?.drawingNumber ?? "—"}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {p.requirement?.length && p.requirement?.width ? `${p.requirement.length} × ${p.requirement.width}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-500">{p.slab?.slabCode ?? "—"}{p.slab?.colour ? ` · ${p.slab.colour}` : ""}</td>
                  <td className="px-5 py-3 text-center text-gray-500">{p.project.projectCode}</td>
                  <td className="px-5 py-3 text-center space-x-1">
                    {p.polishRequired && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">✓ Polish</span>}
                    {p.hasSink && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">✓ Sink</span>}
                    {p.fabricationRequired && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">✓ Fab</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
