"use client";
// Date-range download of the full polishing report, at the top of Finished
// Goods. The file is built server-side by /api/inventory/polishing-report,
// which applies the same gate as the rest of the module.
import { useState } from "react";

const ymdIST = (ms = Date.now()) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);

const inp = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function PolishingReport() {
  const today = ymdIST();
  const [from, setFrom] = useState(ymdIST(Date.now() - 29 * 86400_000));
  const [to, setTo] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    if (from > to) { setErr("The start date is after the end date."); return; }
    setErr(null); setBusy(true);
    try {
      const res = await fetch(`/api/inventory/polishing-report?from=${from}&to=${to}`, { cache: "no-store" });
      if (!res.ok) {
        // The route answers with JSON on every failure, so the message is the
        // real reason rather than a browser download of an error page.
        const d = await res.json().catch(() => ({}));
        setErr(d.error ?? `Download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `polishing-report-${from}_to_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr("Could not reach the server — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Polishing report</h2>
          <p className="mt-0.5 text-xs text-gray-500">Every polish entry in the range, with its QC grade and outcome.</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Start date</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inp} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">End date</span>
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={inp} />
        </label>
        <button type="button" onClick={download} disabled={busy}
          className="min-h-[42px] rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60">
          {busy ? "Preparing…" : "↓ Download (Excel)"}
        </button>
        {err && <span className="text-sm text-red-600">{err}</span>}
      </div>
    </div>
  );
}
