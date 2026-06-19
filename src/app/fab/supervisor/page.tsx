"use client";
import { useEffect, useState, useCallback } from "react";

interface Slab { id: string; slabCode: string; colour?: string | null; thickness?: number | null; }
interface Allocation { id: string; slabId: string; allocatedQuantity: number; slab: Slab; }
interface Requirement { id: string; pieceLabel?: string | null; description?: string | null; length?: number | null; width?: number | null; quantity: number; sinkRequired: boolean; fabricationRequired: boolean; status: string; allocations: Allocation[]; }
interface Drawing { id: string; drawingNumber: string; defaultSlabId?: string | null; defaultSlab?: Slab | null; requirements: Requirement[]; }
interface Project { id: string; projectCode: string; customerName?: string | null; status: string; drawings: Drawing[]; }

const PILL_COLOURS = ["bg-blue-100 text-blue-800","bg-violet-100 text-violet-800","bg-emerald-100 text-emerald-800","bg-amber-100 text-amber-800","bg-rose-100 text-rose-800"];
const colourCache: Record<string,string> = {}; let colourIdx = 0;
function pillColour(id: string) { if (!colourCache[id]) colourCache[id] = PILL_COLOURS[colourIdx++ % PILL_COLOURS.length]; return colourCache[id]; }
function slabLabel(s: Slab) { return `${s.slabCode}${s.colour ? ` · ${s.colour}` : ""}${s.thickness ? ` · ${s.thickness}mm` : ""}`; }

function SlabSelect({ value, slabs, onChange, placeholder = "Select slab…" }: { value: string; slabs: Slab[]; onChange: (id: string) => void; placeholder?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm min-w-[180px]">
      <option value="">{placeholder}</option>
      {slabs.map(s => <option key={s.id} value={s.id}>{slabLabel(s)}</option>)}
    </select>
  );
}

export default function FabSupervisorPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [releasing, setReleasing] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [pRes, sRes] = await Promise.all([
      fetch("/api/fab/supervisor/projects"),
      fetch("/api/fab/slabs"),
    ]);
    const [pData, sData] = await Promise.all([pRes.json(), sRes.json()]);
    setProjects(Array.isArray(pData) ? pData : []);
    setSlabs(Array.isArray(sData) ? sData : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function assignDrawingSlab(drawingId: string, slabId: string, projectId: string) {
    if (!slabId) return;
    await fetch("/api/fab/supervisor/assign-drawing-slab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drawingId, slabId, projectId }) });
    await load();
  }

  async function saveOverride(reqId: string, slabId: string, projectId: string) {
    if (!slabId) return;
    await fetch("/api/fab/supervisor/allocate-requirement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirementId: reqId, slabId, allocatedQuantity: 1 }) });
    await load();
  }

  async function releaseProject(projectId: string, projectCode: string) {
    if (!confirm(`Release "${projectCode}" to production?`)) return;
    setReleasing(p => ({ ...p, [projectId]: true }));
    const res = await fetch("/api/fab/supervisor/release-project", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
    const data = await res.json();
    if (!res.ok) alert(data.error ?? "Release failed");
    else await load();
    setReleasing(p => ({ ...p, [projectId]: false }));
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading…</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Planning Board</h1>
      {projects.length === 0 ? (
        <div className="text-center py-20 text-gray-400">No projects awaiting allocation.</div>
      ) : (
        <div className="space-y-6">
          {projects.map(project => {
            const allAllocated = project.drawings.every(d =>
              d.requirements.every(r => r.allocations[0]?.slabId || d.defaultSlabId)
            );
            return (
              <div key={project.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <div>
                    <span className="font-semibold text-gray-900">{project.projectCode}</span>
                    <span className="text-sm text-gray-500 ml-2">{project.customerName}</span>
                  </div>
                  <button onClick={() => releaseProject(project.id, project.projectCode)}
                    disabled={!allAllocated || releasing[project.id]}
                    className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-green-700">
                    {releasing[project.id] ? "Releasing…" : "Release"}
                  </button>
                </div>
                <div className="divide-y divide-gray-50">
                  {project.drawings.map(drawing => (
                    <div key={drawing.id} className="px-5 py-4">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="font-medium text-gray-700">Drawing {drawing.drawingNumber}</span>
                        <SlabSelect value={drawing.defaultSlabId ?? ""} slabs={slabs}
                          placeholder="Default slab…"
                          onChange={sid => assignDrawingSlab(drawing.id, sid, project.id)} />
                        {drawing.defaultSlab && (
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${pillColour(drawing.defaultSlab.id)}`}>
                            {drawing.defaultSlab.slabCode}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2 ml-4">
                        {drawing.requirements.map(req => {
                          const override = req.allocations[0];
                          const resolved = override?.slab ?? drawing.defaultSlab;
                          return (
                            <div key={req.id} className="flex items-center gap-3 text-sm">
                              <span className="text-gray-500 w-24">{req.pieceLabel ?? req.description}</span>
                              <span className="text-gray-400">x{req.quantity}</span>
                              {req.sinkRequired && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Sink</span>}
                              {req.fabricationRequired && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Fab</span>}
                              <SlabSelect value={override?.slabId ?? ""} slabs={slabs}
                                placeholder={resolved ? `↳ ${resolved.slabCode}` : "Override slab…"}
                                onChange={sid => saveOverride(req.id, sid, project.id)} />
                              <span className={`text-xs px-2 py-0.5 rounded-full ${req.status === "ALLOCATED" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                {req.status}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
