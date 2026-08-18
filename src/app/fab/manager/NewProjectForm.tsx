"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/fab/postJson";

// Step one: the manager types the project in. NOTHING here is read off a
// document — the PO PDF is asked for the piece table and nothing else, so the
// project code and the customer are his to decide and his to spell.

export function NewProjectForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectCode, setProjectCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setProjectCode(""); setCustomerName(""); setRemarks(""); setError("");
  }

  async function submit() {
    if (!projectCode.trim() || !customerName.trim()) {
      setError("A project code and a customer name are both required.");
      return;
    }
    setSaving(true); setError("");
    const res = await postJson("/api/fab/manager/projects", { projectCode, customerName, remarks });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "Could not create the project."); return; }
    reset();
    setOpen(false);
    router.push(`/fab/manager/${res.data.projectId}`);
  }

  if (!open) {
    return (
      <div className="mb-6">
        <button
          onClick={() => { reset(); setOpen(true); }}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 transition"
        >
          + New Project
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <h2 className="text-sm font-bold text-slate-800 mb-3">New Project</h2>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Project Code</label>
          <input
            value={projectCode}
            onChange={(e) => setProjectCode(e.target.value)}
            placeholder="e.g. PRJ-001"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Customer Name</label>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="e.g. Surfaces by Pacific"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">Remarks</label>
        <input
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Optional"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition"
        >
          {saving ? "Creating…" : "Create Project"}
        </button>
        <button
          onClick={() => { setOpen(false); reset(); }}
          disabled={saving}
          className="text-sm text-slate-500 hover:text-slate-800 px-3 py-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
