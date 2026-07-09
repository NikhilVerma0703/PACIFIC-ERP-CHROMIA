"use client";
import { useState } from "react";

export default function DangerZoneClient() {
  const [busy, setBusy]       = useState(false);
  const [result, setResult]   = useState<Record<string, string> | null>(null);
  const [error, setError]     = useState("");
  const [confirmed, setConfirmed] = useState(false);

  async function wipe() {
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    const r = await fetch("/api/admin/wipe-sales-data", { method: "POST" });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) { setError(d.error ?? "Failed"); return; }
    setResult(d.results);
    setConfirmed(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {!confirmed ? (
          <button
            onClick={wipe}
            disabled={busy}
            className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition"
          >
            {busy ? "Wiping…" : "Wipe All Sales Data"}
          </button>
        ) : (
          <>
            <button
              onClick={wipe}
              disabled={busy}
              className="px-4 py-2 bg-red-700 text-white text-sm font-bold rounded-lg hover:bg-red-800 disabled:opacity-50 transition border-2 border-red-400"
            >
              {busy ? "Wiping…" : "⚠ Confirm — this cannot be undone"}
            </button>
            <button
              onClick={() => setConfirmed(false)}
              className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {confirmed && !busy && (
        <p className="text-xs text-red-600 font-medium">
          Click &quot;Confirm&quot; again to permanently delete all clients, orders, PIs, payments, and shipments.
          Users and config are preserved.
        </p>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {result && (
        <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-0.5 font-mono">
          {Object.entries(result).map(([k, v]) => (
            <div key={k} className={v.startsWith("error") ? "text-red-500" : "text-slate-600"}>
              {v.startsWith("error") ? "✗" : "✓"} {k}: {v}
            </div>
          ))}
          <div className="mt-2 text-teal-700 font-semibold not-italic font-sans">
            ✅ Done. Refresh the page.
          </div>
        </div>
      )}
    </div>
  );
}
