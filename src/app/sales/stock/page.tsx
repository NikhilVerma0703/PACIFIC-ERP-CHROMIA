"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import Link from "next/link";

type StockCheck = {
  id: string;
  status: string;
  notes: string | null;
  assignedSlabIds: string[];
  resultCount: number;
  createdAt: string;
  updatedAt: string;
  checkedBy: { name: string | null; email: string } | null;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    client: { name: string; country: string | null };
    sp: { name: string | null; email: string };
    proformaInvoices: { piNumber: string; items: any; currency: string }[];
  };
};

const STATUS_COLORS: Record<string, string> = {
  PENDING:     "bg-amber-100 text-amber-700",
  AVAILABLE:   "bg-green-100 text-green-700",
  UNAVAILABLE: "bg-red-100 text-red-700",
  PARTIAL:     "bg-yellow-100 text-yellow-700",
};

function StatusBadge({ s }: { s: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[s] ?? "bg-slate-100 text-slate-600"}`}>
      {s.replace(/_/g, " ")}
    </span>
  );
}

export default function StockChecksPage() {
  const [checks, setChecks] = useState<StockCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "AVAILABLE" | "UNAVAILABLE" | "PARTIAL">("PENDING");
  const [active, setActive] = useState<StockCheck | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    const r = await fetch("/api/sales/stock-checks");
    if (r.ok) setChecks(await r.json());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function open(c: StockCheck) {
    setActive(c);
    setNotes(c.notes ?? "");
    setMsg("");
  }

  async function update(status: string) {
    if (!active) return;
    setBusy(true);
    const r = await fetch(`/api/sales/stock-checks/${active.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, notes }),
    });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) { setMsg(`Error: ${d.error ?? "Failed"}`); return; }
    setMsg(`Marked ${status}`);
    setActive(null);
    await load();
  }

  const filtered = filter === "ALL" ? checks : checks.filter(c => c.status === filter);
  const pendingCount = checks.filter(c => c.status === "PENDING").length;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stock Checks</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {pendingCount} pending review
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {(["ALL","PENDING","AVAILABLE","PARTIAL","UNAVAILABLE"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${filter === f ? "bg-slate-800 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"}`}>
            {f}{f === "ALL" ? ` (${checks.length})` : ` (${checks.filter(c => c.status === f).length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-16 text-center">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
          <p className="text-slate-400 text-sm">No stock checks {filter !== "ALL" ? `with status ${filter}` : ""}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => {
            const pi = c.order.proformaInvoices[0];
            const items: any[] = pi ? (Array.isArray(pi.items) ? pi.items : []) : [];
            const currency = pi?.currency ?? "USD";
            return (
              <div key={c.id}
                className="bg-white rounded-2xl border border-slate-100 p-5 hover:border-slate-200 transition">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <Link href={`/sales/orders/${c.order.id}`}
                        className="font-semibold text-slate-900 hover:text-blue-600 text-sm">
                        {c.order.orderNumber}
                      </Link>
                      <StatusBadge s={c.status} />
                      {c.order.status === "PENDING_PAYMENT" && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                          Awaiting Payment
                        </span>
                      )}
                      {pi && <span className="text-xs text-slate-400">{pi.piNumber}</span>}
                    </div>
                    <p className="text-sm text-slate-600">{c.order.client.name}
                      {c.order.client.country ? <span className="text-slate-400"> · {c.order.client.country}</span> : ""}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">SP: {c.order.sp.name ?? c.order.sp.email}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</p>
                    {c.checkedBy && (
                      <p className="text-xs text-slate-400 mt-0.5">by {c.checkedBy.name ?? c.checkedBy.email}</p>
                    )}
                  </div>
                </div>

                {/* Items summary */}
                {items.length > 0 && (
                  <div className="mt-3 border-t border-slate-50 pt-3">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Required Stock</p>
                    <div className="overflow-x-auto">
                      <table className="text-xs w-full">
                        <thead>
                          <tr className="text-slate-400">
                            <th className="text-left pr-3 py-1 font-medium">Description</th>
                            <th className="text-left pr-3 py-1 font-medium">Material</th>
                            <th className="text-left pr-3 py-1 font-medium">Finish</th>
                            <th className="text-left pr-3 py-1 font-medium">Thickness</th>
                            <th className="text-right pr-3 py-1 font-medium">Slabs</th>
                            <th className="text-right py-1 font-medium">Sq.Ft</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item: any, i: number) => (
                            <tr key={i} className="border-t border-slate-50">
                              <td className="pr-3 py-1 text-slate-700">{item.description ?? "—"}</td>
                              <td className="pr-3 py-1 text-slate-600">{item.material ?? "—"}</td>
                              <td className="pr-3 py-1 text-slate-600">{item.finish ?? "—"}</td>
                              <td className="pr-3 py-1 text-slate-600">{item.thickness ?? "—"}</td>
                              <td className="pr-3 py-1 text-right text-slate-700 font-medium">{item.noOfSlabs ?? item.no_of_slabs ?? item.slabs ?? "—"}</td>
                              <td className="py-1 text-right text-slate-700 font-medium">
                                {Number(item.sqft ?? item.sqFt ?? item.sq_ft ?? 0).toFixed(0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {c.notes && (
                  <p className="mt-2 text-xs text-slate-500 border-t border-slate-50 pt-2">
                    Note: {c.notes}
                  </p>
                )}

                {c.status === "PENDING" && c.order.status === "PENDING_PAYMENT" && (
                  <div className="mt-3 pt-3 border-t border-amber-100 flex items-center gap-2 bg-amber-50 -mx-5 -mb-5 px-5 py-3 rounded-b-2xl">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 flex-shrink-0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                    <p className="text-xs font-semibold text-amber-700">Awaiting advance payment — stock check locked until Accounts confirms receipt</p>
                  </div>
                )}
                {c.status === "PENDING" && c.order.status === "PENDING_STOCK_CHECK" && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex gap-2">
                    <button onClick={() => open(c)}
                      className="px-3 py-1.5 bg-brand text-white text-xs font-semibold rounded-lg hover:bg-brand-dark transition">
                      Review & Update
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Review modal */}
      {active && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setActive(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900 mb-1">
              Update Stock Check
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Order: {active.order.orderNumber} — {active.order.client.name}
            </p>

            <label className="block mb-4">
              <span className="text-xs font-semibold text-slate-600 block mb-1">Notes</span>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Add notes about availability, alternatives, etc."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </label>

            {msg && <p className="text-xs text-green-600 mb-3">{msg}</p>}

            <div className="flex flex-wrap gap-2">
              <button onClick={() => update("AVAILABLE")} disabled={busy}
                className="flex-1 px-3 py-2 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
                ✓ Available
              </button>
              <button onClick={() => update("PARTIAL")} disabled={busy}
                className="flex-1 px-3 py-2 bg-yellow-500 text-white text-xs font-bold rounded-lg hover:bg-yellow-600 disabled:opacity-50 transition">
                ~ Partial
              </button>
              <button onClick={() => update("UNAVAILABLE")} disabled={busy}
                className="flex-1 px-3 py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 transition">
                ✕ Unavailable
              </button>
            </div>
            <button onClick={() => setActive(null)}
              className="mt-3 w-full px-3 py-1.5 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
