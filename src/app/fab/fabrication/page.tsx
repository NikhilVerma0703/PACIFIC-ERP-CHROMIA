"use client";
import { useEffect, useState, useCallback } from "react";

interface Piece {
  id: string; pieceCode: string;
  project: { projectCode: string };
  drawing: { drawingNumber: string } | null;
  requirement: { pieceLabel: string | null; length: number | null; width: number | null; sinkModel: string | null } | null;
  slab: { slabCode: string; colour: string | null } | null;
}

export default function FabFabricationPage() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/fab/queues/fabrication");
    const data = await res.json();
    setPieces(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function complete(pieceId: string) {
    setCompleting(p => ({ ...p, [pieceId]: true }));
    await fetch("/api/fab/queues/fabrication/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pieceId }),
    });
    await load();
    setCompleting(p => ({ ...p, [pieceId]: false }));
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Fabrication Queue</h1>
      <p className="text-sm text-gray-400 mb-6">{pieces.length} piece{pieces.length !== 1 ? "s" : ""} pending — sink cut complete, awaiting hand polish / fitting</p>
      {pieces.length === 0 ? (
        <div className="text-center py-20 text-gray-400">No pieces pending fabrication.</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-5 py-3">Piece</th>
                <th className="text-left px-5 py-3">Drawing</th>
                <th className="text-left px-5 py-3">Size (mm)</th>
                <th className="text-left px-5 py-3">Sink Model</th>
                <th className="text-left px-5 py-3">Slab</th>
                <th className="text-center px-5 py-3">Project</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pieces.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-xs text-gray-700">{p.pieceCode}</td>
                  <td className="px-5 py-3 text-gray-500">{p.drawing?.drawingNumber ?? "—"}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {p.requirement?.length && p.requirement?.width ? `${p.requirement.length} × ${p.requirement.width}` : "—"}
                  </td>
                  <td className="px-5 py-3 text-gray-700 font-medium">{p.requirement?.sinkModel ?? "—"}</td>
                  <td className="px-5 py-3 text-gray-500">{p.slab?.slabCode ?? "—"}{p.slab?.colour ? ` · ${p.slab.colour}` : ""}</td>
                  <td className="px-5 py-3 text-center text-gray-500">{p.project.projectCode}</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => complete(p.id)} disabled={completing[p.id]}
                      className="bg-purple-600 text-white px-3 py-1 rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-50">
                      {completing[p.id] ? "…" : "✓ Done"}
                    </button>
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
