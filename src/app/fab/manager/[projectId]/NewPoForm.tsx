"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/fab/postJson";

// Step two: a purchase order under this project. The number is the customer's,
// so it only has to be unique on this project — two projects may legitimately
// quote the same one, and the server enforces exactly that.

export function NewPoForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [poNumber, setPoNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!poNumber.trim()) { setError("A PO number is required."); return; }
    setSaving(true); setError("");
    const res = await postJson("/api/fab/manager/pos", { projectId, poNumber });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "Could not create the purchase order."); return; }
    setPoNumber("");
    router.refresh();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <h2 className="text-sm font-bold text-slate-800 mb-1">Add a Purchase Order</h2>
      <p className="text-xs text-slate-400 mb-3">
        The customer&apos;s own PO number. Its PDF is uploaded afterwards, against the PO.
      </p>
      <div className="flex items-start gap-2">
        <input
          value={poNumber}
          onChange={(e) => setPoNumber(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !saving) submit(); }}
          placeholder="e.g. 10026"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={submit}
          disabled={saving}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition"
        >
          {saving ? "Adding…" : "Add PO"}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{error}</p>
      )}
    </div>
  );
}
