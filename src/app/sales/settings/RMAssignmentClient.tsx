"use client";
import { useState } from "react";

export type SpRow = {
  id: string;
  name: string | null;
  email: string | null;
  salesRole: string | null;
};

export type ManagerRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  salesRole: string | null;
};

export type AssignmentRow = {
  id: string;
  spId: string;
  managerId: string;
  isActive: boolean;
  manager: { id: string; name: string | null; email: string | null };
};

type Props = {
  sps: SpRow[];
  managers: ManagerRow[];
  assignments: AssignmentRow[];
};

export default function RMAssignmentClient({ sps, managers, assignments: initialAssignments }: Props) {
  const [assignments, setAssignments] = useState<AssignmentRow[]>(initialAssignments);
  const [pendingSpId, setPendingSpId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function getAssignment(spId: string) {
    return assignments.find((a) => a.spId === spId && a.isActive) ?? null;
  }

  async function handleAssign(spId: string, managerId: string) {
    if (!managerId) return;
    setPendingSpId(spId);
    setError(null);
    try {
      const res = await fetch("/api/sales/manager-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spId, managerId }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? "Failed to assign");
        return;
      }
      const newAssignment: AssignmentRow = await res.json();
      setAssignments((prev) => [
        ...prev.filter((a) => !(a.spId === spId && a.isActive)),
        newAssignment,
      ]);
    } catch {
      setError("Network error");
    } finally {
      setPendingSpId(null);
    }
  }

  async function handleRemove(assignmentId: string, spId: string) {
    setPendingSpId(spId);
    setError(null);
    try {
      const res = await fetch(`/api/sales/manager-assignments/${assignmentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error ?? "Failed to remove");
        return;
      }
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    } catch {
      setError("Network error");
    } finally {
      setPendingSpId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Salesperson</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Current RM</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">Assign RM</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sps.map((sp) => {
              const assignment = getAssignment(sp.id);
              const isPending  = pendingSpId === sp.id;
              return (
                <tr key={sp.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-4 py-3 font-medium text-slate-800">{sp.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{sp.email ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {assignment ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-400 inline-block"></span>
                        {assignment.manager.name ?? assignment.manager.email ?? "—"}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic text-xs">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      disabled={isPending}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) handleAssign(sp.id, e.target.value);
                        e.target.value = "";
                      }}
                      className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-50"
                    >
                      <option value="" disabled>Select RM…</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name ?? m.email} ({m.salesRole ?? m.role})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {assignment && (
                      <button
                        disabled={isPending}
                        onClick={() => handleRemove(assignment.id, sp.id)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-40 transition"
                      >
                        {isPending ? "..." : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sps.length === 0 && (
          <div className="px-4 py-8 text-center text-slate-400 text-sm">
            No salespersons found.
          </div>
        )}
      </div>
    </div>
  );
}
