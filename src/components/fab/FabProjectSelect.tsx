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
import { isSampleProject } from "@/lib/fab/sampleOrder";

export interface FabBoardProject {
  id: string;
  projectCode: string;
  customerName: string | null;
  status: string;
  /** PO or SAMPLE. A sample order runs this same board with sink and
   *  fabrication switched off — see lib/fab/sampleOrder.ts. "PO" on a database
   *  without scripts/0059, which every project there is. */
  kind?: string | null;
  requirementCount: number;
  poCount: number;
}

/**
 * THE PROJECT THE URL ASKED FOR, if it named one.
 *
 * ?projectId=... — the cutting queue's "waiting for a slab" panel links here
 * with the project already picked, so a cutter who taps a sample order lands on
 * that order instead of on whatever happened to be newest and then has to hunt
 * for the one he tapped.
 *
 * Read off window rather than through useSearchParams deliberately: this hook is
 * used by pages that are already client components, and useSearchParams would
 * force every one of them inside a Suspense boundary to satisfy the Next build —
 * a structural change to three screens to pass one optional default.
 */
function projectIdFromUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    return new URLSearchParams(window.location.search).get("projectId")?.trim() ?? "";
  } catch {
    return "";
  }
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
      // The URL first, then the newest — which is nearly always the one being
      // worked — but never move off one the person has already chosen.
      //
      // CHECKED AGAINST THE LIST BEFORE IT IS USED. A stale link to a project
      // that has since been released would otherwise select an id the dropdown
      // does not contain: the select would show blank and the board would sit
      // empty, which reads as broken software rather than as a finished job.
      const wanted = projectIdFromUrl();
      const asked = wanted && r.data.some(p => p.id === wanted) ? wanted : "";
      setProjectId(prev => prev || asked || r.data[0]?.id || "");
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
            {isSampleProject(p.kind) ? "Sample · " : ""}{p.projectCode}
            {p.customerName ? ` — ${p.customerName}` : ""}
          </option>
        ))}
      </select>
      {current && isSampleProject(current.kind) && (
        // SAID OUT LOUD, not left to be inferred. This board looks identical for
        // a sample order, and the two steps that are missing from it are missing
        // BECAUSE it is one — a supervisor who does not know that reads it as a
        // screen that has failed to load.
        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 whitespace-nowrap">
          Sample order &middot; no sinks, no fabrication
        </span>
      )}
      {current && (
        <span className="text-xs text-slate-400">
          {isSampleProject(current.kind)
            ? null
            : <>{current.poCount} PO{current.poCount === 1 ? "" : "s"} &middot; </>}
          {current.requirementCount} piece row{current.requirementCount === 1 ? "" : "s"} &middot;{" "}
          {current.status.replace(/_/g, " ").toLowerCase()}
        </span>
      )}
    </div>
  );
}
