"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const MACHINE_LABELS: Record<string, string> = {
  CUTTING:      "Cutting",
  POLISHING:    "Polishing",
  SINK_CUTTING: "Sink Cutting",
  FABRICATION:  "Fabrication",
  PACKAGING:    "Packaging",
};

const MACHINE_COLORS: Record<string, string> = {
  CUTTING:      "blue",
  POLISHING:    "purple",
  SINK_CUTTING: "orange",
  FABRICATION:  "rose",
  PACKAGING:    "green",
};

type MachineStat = {
  machineType:    string;
  machineName:    string | null;
  slabs:          number;
  pieces:         number;
  avgMinutes:     number | null;
  fastestMinutes: number | null;
  slowestMinutes: number | null;
};

type Operator = {
  operatorId:   string;
  operatorName: string;
  totalPieces:  number;
  totalSlabs:   number;
  machineStats: MachineStat[];
};

type Project = {
  projectCode:  string;
  customerName: string;
  status:       string;
};

function fmtTime(mins: number | null) {
  if (mins === null) return "—";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function OperatorCard({ op, onClick }: { op: Operator; onClick: () => void }) {
  const topMachine = op.machineStats.slice().sort((a, b) => b.pieces - a.pieces)[0];
  const color = topMachine ? MACHINE_COLORS[topMachine.machineType] ?? "gray" : "gray";
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-${color}-300 transition-all`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-gray-900">{op.operatorName}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {op.machineStats.map(m => MACHINE_LABELS[m.machineType] ?? m.machineType).join(" · ")}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-bold text-gray-800">{op.totalPieces}</div>
          <div className="text-xs text-gray-400">pieces</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {op.machineStats.map(m => (
          <span
            key={m.machineType}
            className={`text-xs px-2 py-0.5 rounded-full bg-${MACHINE_COLORS[m.machineType] ?? "gray"}-50 text-${MACHINE_COLORS[m.machineType] ?? "gray"}-700 border border-${MACHINE_COLORS[m.machineType] ?? "gray"}-200`}
          >
            {MACHINE_LABELS[m.machineType] ?? m.machineType}: {m.pieces} pcs
          </span>
        ))}
      </div>
    </button>
  );
}

function OperatorModal({ op, onClose }: { op: Operator; onClose: () => void }) {
  const topMachine = op.machineStats.slice().sort((a, b) => b.pieces - a.pieces)[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{op.operatorName}</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {op.totalPieces} pieces · {op.totalSlabs} slabs
              </p>
            </div>
            {topMachine && (
              <span className={`text-xs px-2.5 py-1 rounded-full bg-${MACHINE_COLORS[topMachine.machineType] ?? "gray"}-100 text-${MACHINE_COLORS[topMachine.machineType] ?? "gray"}-700 font-semibold`}>
                Best at {MACHINE_LABELS[topMachine.machineType] ?? topMachine.machineType}
              </span>
            )}
            <button onClick={onClose} className="ml-2 text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          {op.machineStats.map(m => {
            const c = MACHINE_COLORS[m.machineType] ?? "gray";
            return (
              <div key={m.machineType} className={`rounded-xl border border-${c}-200 bg-${c}-50 p-4`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`font-semibold text-${c}-800`}>{MACHINE_LABELS[m.machineType] ?? m.machineType}</span>
                  {m.machineName && <span className="text-xs text-gray-500">{m.machineName}</span>}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-white rounded-lg p-2 text-center">
                    <div className="text-lg font-bold text-gray-800">{m.pieces}</div>
                    <div className="text-xs text-gray-500">Pieces</div>
                  </div>
                  {m.slabs > 0 && (
                    <div className="bg-white rounded-lg p-2 text-center">
                      <div className="text-lg font-bold text-gray-800">{m.slabs}</div>
                      <div className="text-xs text-gray-500">Slabs</div>
                    </div>
                  )}
                  <div className="bg-white rounded-lg p-2 text-center">
                    <div className="text-base font-bold text-gray-800">{fmtTime(m.avgMinutes)}</div>
                    <div className="text-xs text-gray-500">Avg time</div>
                  </div>
                  <div className="bg-white rounded-lg p-2 text-center">
                    <div className="text-base font-bold text-green-700">{fmtTime(m.fastestMinutes)}</div>
                    <div className="text-xs text-gray-500">Fastest</div>
                  </div>
                </div>
              </div>
            );
          })}
          {op.machineStats.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-4">No detailed stats yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProjectOperatorsPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [project,  setProject]  = useState<Project | null>(null);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState<Operator | null>(null);
  const [search,   setSearch]   = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/fab/projects/operators?projectId=${projectId}`);
    if (!res.ok) return;
    const data = await res.json();
    setProject(data.project);
    setOperators(data.operators);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const filtered = operators.filter(op =>
    op.operatorName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link href={`/fab/projects/${projectId}`} className="text-sm text-blue-600 hover:underline">
            ← Back to project
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">
            {project ? `${project.projectCode} — Operators` : "Operators"}
          </h1>
          {project && (
            <p className="text-gray-500 text-sm mt-0.5">{project.customerName}</p>
          )}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search operators…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Summary strip */}
        {!loading && (
          <div className="flex gap-4 mb-5 text-sm text-gray-600">
            <span><strong className="text-gray-900">{operators.length}</strong> operators</span>
            <span><strong className="text-gray-900">
              {operators.reduce((s, o) => s + o.totalPieces, 0)}
            </strong> total pieces</span>
          </div>
        )}

        {/* Cards */}
        {loading ? (
          <div className="text-center text-gray-400 py-16">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-400 py-16">
            {search ? "No operators match your search." : "No work recorded for this project yet."}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map(op => (
              <OperatorCard key={op.operatorId} op={op} onClick={() => setSelected(op)} />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <OperatorModal op={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
