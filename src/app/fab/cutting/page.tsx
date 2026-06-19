"use client";
import { useEffect, useState, useCallback } from "react";

interface Piece {
  id: string; pieceCode: string;
  project: { projectCode: string; customerName: string };
  drawing: { drawingNumber: string } | null;
  requirement: { pieceLabel: string | null; description: string | null; length: number | null; width: number | null } | null;
  hasSink: boolean; polishRequired: boolean; fabricationRequired: boolean;
}
interface SlabGroup { slab: { id: string; slabCode: string; colour: string | null }; pieces: Piece[] }

export default function FabCuttingPage() {
  const [groups, setGroups] = useState<SlabGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/fab/queues/cutting");
    const data = await res.json();
    setGroups(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function completeSlab(slabId: string, pieceIds: string[]) {
    setCompleting(p => ({ ...p, [slabId]: true }));
    await fetch("/api/fab/queues/cutting/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slabId, pieceIds }),
    });
    await load();
    setCompleting(p => ({ ...p, [slabId]: false }));
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Cutting Queue</h1>
      {groups.length === 0 ? (
        <div className="text-center py-20 text-gray-400">No slabs pending cutting.</div>
      ) : (
        <div className="space-y-6">
          {groups.map(({ slab, pieces }) => (
            <div key={slab.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div>
                  <span className="font-semibold text-gray-900">Slab {slab.slabCode}</span>
                  {slab.colour && <span className="text-sm text-gray-500 ml-2">· {slab.colour}</span>}
                  <span className="text-xs text-gray-400 ml-3">{pieces.length} piece{pieces.length !== 1 ? "s" : ""}</span>
                </div>
                <button
                  onClick={() => completeSlab(slab.id, pieces.map(p => p.id))}
                  disabled={completing[slab.id]}
                  className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {completing[slab.id] ? "Saving…" : "✓ Mark Slab Cut"}
                </button>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-5 py-2">Piece</th>
                    <th className="text-left px-5 py-2">Drawing</th>
                    <th className="text-left px-5 py-2">Size (mm)</th>
                    <th className="text-center px-5 py-2">Project</th>
                    <th className="text-center px-5 py-2">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pieces.map(p => (
                    <tr key={p.id}>
                      <td className="px-5 py-2 font-mono text-xs text-gray-700">{p.pieceCode}</td>
                      <td className="px-5 py-2 text-gray-500">{p.drawing?.drawingNumber ?? "—"}</td>
                      <td className="px-5 py-2 text-gray-500">
                        {p.requirement?.length && p.requirement?.width
                          ? `${p.requirement.length} × ${p.requirement.width}`
                          : "—"}
                      </td>
                      <td className="px-5 py-2 text-center text-gray-500">{p.project.projectCode}</td>
                      <td className="px-5 py-2 text-center space-x-1">
                        {p.polishRequired && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Polish</span>}
                        {p.hasSink && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Sink</span>}
                        {p.fabricationRequired && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Fab</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
