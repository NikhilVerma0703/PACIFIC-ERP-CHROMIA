"use client";

// The project chooser both supervisor boards start from.
//
// Both boards work on ONE project at a time — a slab is filled from what is
// outstanding on that job, and sinks are decided per job — so the first thing
// either screen needs is "which one". It is one component rather than two
// copies because the two screens sit side by side in the sidebar and a
// supervisor moving between them should not have to learn the control twice.

import { useEffect, useState } from "react";
import { getJson } from "@/lib/fab/postJson";

export interface FabBoardProject {
  id: string;
  projectCode: string;
  customerName: string | null;
  status: string;
  requirementCount: number;
  poCount: number;
}

/** Loads the projects still being planned, and remembers which one is open. */
export function useFabBoardProjects() {
  const [projects, setProjects] = useState<FabBoardProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const r = await getJson<FabBoardProject>("/api/fab/supervisor/board?view=projects");
      if (cancelled) return;
      setProjects(r.data);
      setError(r.error);
      setLoading(false);
      // Open the newest project by default — it is nearly always the one being
      // worked — but never move off one the supervisor has already chosen.
      setProjectId(prev => prev || r.data[0]?.id || "");
    }

    run();
    return () => { cancelled = true; };
  }, []);

  return { projects, projectId, setProjectId, loading, error };
}

export function FabProjectSelect({
  projects, projectId, onChange, disabled,
}: {
  projects: FabBoardProject[];
  projectId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const current = projects.find(p => p.id === projectId) ?? null;

  return (
    <div className="flex items-center gap-3 flex-wrap mb-5">
      <label htmlFor="fab-project" className="text-xs font-semibold text-slate-600">
        Project
      </label>
      <select
        id="fab-project"
        value={projectId}
        disabled={disabled || projects.length === 0}
        onChange={e => onChange(e.target.value)}
        className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[18rem] disabled:opacity-50"
      >
        {projects.length === 0 && <option value="">No projects waiting to be planned</option>}
        {projects.map(p => (
          <option key={p.id} value={p.id}>
            {p.projectCode}{p.customerName ? ` — ${p.customerName}` : ""}
          </option>
        ))}
      </select>
      {current && (
        <span className="text-xs text-slate-400">
          {current.poCount} PO{current.poCount === 1 ? "" : "s"} &middot;{" "}
          {current.requirementCount} piece row{current.requirementCount === 1 ? "" : "s"} &middot;{" "}
          {current.status.replace(/_/g, " ").toLowerCase()}
        </span>
      )}
    </div>
  );
}
