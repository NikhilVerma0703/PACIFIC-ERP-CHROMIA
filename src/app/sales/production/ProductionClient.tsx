"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/* ── helpers ─────────────────────────────────────────────────────────────── */
const STATUS_DOT: Record<string, string> = {
  PENDING_PRODUCTION: "bg-amber-400",
  IN_PRODUCTION:      "bg-blue-400",
  PACKING:            "bg-purple-400",
};
const STATUS_BADGE: Record<string, string> = {
  PENDING_PRODUCTION: "bg-amber-100 text-amber-800 border-amber-300",
  IN_PRODUCTION:      "bg-blue-100 text-blue-800 border-blue-300",
  PACKING:            "bg-purple-100 text-purple-800 border-purple-300",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING_PRODUCTION: "Pending Production",
  IN_PRODUCTION:      "In Production",
  PACKING:            "Packing",
};

/* Job status badge */
const JOB_BADGE: Record<string, string> = {
  PENDING:     "bg-gray-100 text-gray-600",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  COMPLETED:   "bg-green-100 text-green-700",
  ON_HOLD:     "bg-red-100 text-red-700",
};

function fmtDate(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/* ── OrderCard ───────────────────────────────────────────────────────────── */
function OrderCard({ order, canAct, onAction }: { order: any; canAct: boolean; onAction: (orderId: string, jobId: string | null, jobStatus: string, note?: string) => void }) {
  const pi    = order.proformaInvoices?.[0];
  const items = (pi?.items as any[] | null) ?? [];
  const job   = order.productionJob;
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const handleBtn = (jobStatus: string) => {
    if (showNote && !note.trim()) { setShowNote(false); return; }
    onAction(order.id, job?.id ?? null, jobStatus, note.trim() || undefined);
    setNote(""); setShowNote(false);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BADGE[order.status]}`}>
            {STATUS_LABEL[order.status] ?? order.status}
          </span>
          <span className="font-semibold text-slate-800 text-sm">
            {order.orderNumber || order.id.slice(-6)}
          </span>
          {job && (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${JOB_BADGE[job.status]}`}>
              Job: {job.status.replace("_", " ")}
            </span>
          )}
        </div>
        <Link href={`/sales/orders/${order.id}`} className="text-xs font-semibold text-blue-600 hover:underline shrink-0">
          View →
        </Link>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">{order.client?.name}</p>
            <p className="text-xs text-slate-500">{order.client?.country}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-400">SP</p>
            <p className="text-xs font-medium text-slate-700">{order.sp?.name || order.sp?.email}</p>
          </div>
        </div>

        {pi && (
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span>PI: <strong>{pi.piNumber}</strong></span>
            <span>{pi.currency || "USD"} {Number(pi.totalAmount || 0).toFixed(2)}</span>
          </div>
        )}

        {/* Item summary table */}
        {items.length > 0 && (
          <div className="border border-slate-100 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1.5 text-left">Colour</th>
                  <th className="px-2 py-1.5 text-center">Thick</th>
                  <th className="px-2 py-1.5 text-center">Slabs</th>
                  <th className="px-2 py-1.5 text-right">SQFT</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 5).map((it: any, i: number) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="px-2 py-1 font-medium text-slate-800 truncate max-w-[110px]">{it.colour || it.color || it.description || "—"}</td>
                    <td className="px-2 py-1 text-center text-slate-600">{it.thickness ? `${it.thickness}mm` : "—"}</td>
                    <td className="px-2 py-1 text-center text-slate-600">{it.noOfSlabs ?? "—"}</td>
                    <td className="px-2 py-1 text-right text-slate-600">{it.sqft ? Number(it.sqft).toFixed(1) : "—"}</td>
                  </tr>
                ))}
                {items.length > 5 && (
                  <tr><td colSpan={4} className="px-2 py-1 text-center text-slate-400 text-[10px] italic">+{items.length - 5} more items</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Job notes */}
        {job?.notes && (
          <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded px-2 py-1">
            Note: {job.notes}
          </p>
        )}

        <p className="text-[10px] text-slate-400">Updated {fmtDate(order.updatedAt)}</p>

        {/* Action buttons — only for production managers */}
        {canAct && (
          <div className="pt-2 space-y-2">
            {/* Optional note input */}
            {showNote ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note (optional)..."
                  className="flex-1 text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <button
                  onClick={() => setShowNote(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 px-2"
                >✕</button>
              </div>
            ) : (
              <button
                onClick={() => setShowNote(true)}
                className="text-[10px] text-slate-400 hover:text-slate-600 underline"
              >+ add note</button>
            )}

            <div className="flex flex-wrap gap-2">
              {/* PENDING_PRODUCTION → start production */}
              {order.status === "PENDING_PRODUCTION" && (
                <button
                  onClick={() => handleBtn("IN_PROGRESS")}
                  className="flex-1 rounded-lg bg-brand hover:bg-brand-dark text-white text-xs font-semibold py-2 px-3 transition"
                >
                  ▶ Start Production
                </button>
              )}

              {/* IN_PRODUCTION → mark complete / packing */}
              {order.status === "IN_PRODUCTION" && (
                <>
                  <button
                    onClick={() => handleBtn("COMPLETED")}
                    className="flex-1 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold py-2 px-3 transition"
                  >
                    ✓ Production Complete
                  </button>
                  <button
                    onClick={() => handleBtn("ON_HOLD")}
                    className="rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold py-2 px-3 transition"
                  >
                    Hold
                  </button>
                </>
              )}

              {/* ON_HOLD → resume */}
              {job?.status === "ON_HOLD" && (
                <button
                  onClick={() => handleBtn("IN_PROGRESS")}
                  className="flex-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold py-2 px-3 transition"
                >
                  ↻ Resume Production
                </button>
              )}

              {/* PACKING — no further job actions; SP handles dispatch */}
              {order.status === "PACKING" && (
                <span className="text-xs text-purple-600 font-medium py-1">Ready for packing & dispatch</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main client component ───────────────────────────────────────────────── */
export default function ProductionClient({ initialOrders, isProductionManager }: { initialOrders: any[]; isProductionManager: boolean }) {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>(initialOrders);
  const [busy, startT] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  const pending      = orders.filter((o) => o.status === "PENDING_PRODUCTION");
  const inProduction = orders.filter((o) => o.status === "IN_PRODUCTION");
  const packing      = orders.filter((o) => o.status === "PACKING");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function handleAction(orderId: string, jobId: string | null, jobStatus: string, note?: string) {
    startT(async () => {
      try {
        if (jobId) {
          // Update existing job
          await fetch(`/api/sales/production-jobs/${jobId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: jobStatus, notes: note }),
          });
        } else {
          // No job yet — create one via the stock-check → status update path
          await fetch(`/api/sales/orders/${orderId}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: jobStatus === "IN_PROGRESS" ? "IN_PRODUCTION" : "PACKING", note }),
          });
        }
        showToast("Updated successfully");
        router.refresh();
      } catch {
        showToast("Update failed — try again");
      }
    });
  }

  function Section({ label, dot, items }: { label: string; dot: string; items: any[] }) {
    if (items.length === 0 && label !== "Pending Production") return null;
    return (
      <section>
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-2.5 h-2.5 rounded-full inline-block ${dot}`} />
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
            {label} ({items.length})
          </h2>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No orders here.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((o) => (
              <OrderCard key={o.id} order={o} canAct={isProductionManager} onAction={handleAction} />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-10">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {busy && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-brand text-white text-sm px-4 py-2 rounded-lg shadow">
          Updating…
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Production Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {orders.length} active orders · {pending.length} waiting to start
          </p>
        </div>
        <Link href="/sales" className="text-sm text-slate-500 hover:text-slate-700">← Sales</Link>
      </div>

      <Section label="Pending Production" dot={STATUS_DOT.PENDING_PRODUCTION} items={pending} />
      <Section label="In Production"      dot={STATUS_DOT.IN_PRODUCTION}      items={inProduction} />
      <Section label="Packing"            dot={STATUS_DOT.PACKING}            items={packing} />
    </div>
  );
}
