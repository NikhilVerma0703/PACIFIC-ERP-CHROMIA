"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import Link from "next/link";

type Division = {
  id: string;
  type: string;
  percentage: number;
  amount: number;
  deadlineDays: number | null;
  dueDate: string | null;
  paidAt: string | null;
  status: string;
  notes: string | null;
  isOverdue: boolean;
  createdAt: string;
  overriddenAt: string | null;
  overrideNote: string | null;
  order: {
    id: string;
    orderNumber: string;
    currency: string | null;
    invoiceNumber: string | null;
    client: { id: string; name: string; country: string | null };
    sp: { name: string | null; email: string };
    proformaInvoices: { piNumber: string; id: string }[];
  };
};

const TYPE_LABELS: Record<string, string> = {
  ADVANCE:        "Advance",
  CAD:            "CAD",
  INSPECTION:     "Inspection",
  RECEIVE_TO_PAY: "Receive to Pay",
  BL_TO_PAY:      "BL to Pay",
  CREDIT:         "Credit",
};

const TYPE_COLORS: Record<string, string> = {
  ADVANCE:        "bg-blue-100 text-blue-700",
  CAD:            "bg-purple-100 text-purple-700",
  INSPECTION:     "bg-cyan-100 text-cyan-700",
  RECEIVE_TO_PAY: "bg-amber-100 text-amber-700",
  BL_TO_PAY:      "bg-orange-100 text-orange-700",
  CREDIT:         "bg-slate-100 text-slate-600",
};

type FilterTab = "ALL" | "PENDING" | "OVERDUE" | "PAID" | "BY_CUSTOMER";
const PAGE_SIZE = 500;

export default function PaymentsPage() {
  // No SessionProvider in this app: the effective salesRole comes from
  // /api/sales/me (salesGate-backed) instead of a client session.
  const [salesRole, setSalesRole] = useState<string | null>(null);
  const isAdmin   = salesRole === "SALES_ADMIN";
  useEffect(() => {
    fetch("/api/sales/me").then((r) => (r.ok ? r.json() : null))
      .then((me) => setSalesRole(me?.salesRole ?? null)).catch(() => {});
  }, []);

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<FilterTab>("PENDING");
  const [busy, setBusy]           = useState<string | null>(null);
  const [msg, setMsg]             = useState("");
  const [searchQ, setSearchQ]     = useState("");
  const [page, setPage]           = useState(1);
  const [dateFrom, setDateFrom]   = useState("");
  const [dateTo, setDateTo]       = useState("");
  const [hasMore, setHasMore]     = useState(false);
  const [overrideModal, setOverrideModal] = useState<{ id: string; orderNum: string } | null>(null);
  const [overrideNote, setOverrideNote]   = useState("");

  async function load(p = 1, append = false) {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("page", String(p));
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo)   params.set("to", dateTo);
    const r = await fetch(`/api/sales/payments?${params}`);
    if (r.ok) {
      const data = await r.json();
      const list = Array.isArray(data) ? data : [];
      if (append) {
        setDivisions(prev => {
          const seen = new Set(prev.map((d: any) => d.id));
          return [...prev, ...list.filter((d: any) => !seen.has(d.id))];
        });
      } else {
        setDivisions(list);
      }
      setHasMore(list.length === PAGE_SIZE);
    }
    setLoading(false);
  }

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    load(nextPage, true);
  }

  useEffect(() => { setPage(1); load(1, false); }, [dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendReminder(id: string) {
    setBusy(`remind-${id}`);
    const r = await fetch(`/api/sales/payments/${id}/send-reminder`, { method: "POST" });
    const d = await r.json();
    setBusy(null);
    if (!r.ok) { setMsg(`Error: ${d.error}`); return; }
    setMsg(`Reminder sent to client.`);
    setTimeout(() => setMsg(""), 4000);
  }

  async function setOverride(id: string, note: string) {
    setBusy(`override-${id}`);
    const r = await fetch(`/api/sales/payments/${id}/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    const d = await r.json();
    setBusy(null);
    setOverrideModal(null);
    setOverrideNote("");
    if (!r.ok) { setMsg(`Error: ${d.error}`); return; }
    setMsg("Override set — reminders paused for this division.");
    await load(1, false); setPage(1);
    setTimeout(() => setMsg(""), 4000);
  }

  async function clearOverride(id: string) {
    setBusy(`override-${id}`);
    const r = await fetch(`/api/sales/payments/${id}/override`, { method: "DELETE" });
    const d = await r.json();
    setBusy(null);
    if (!r.ok) { setMsg(`Error: ${d.error}`); return; }
    setMsg("Override cleared — reminders resumed.");
    await load(1, false); setPage(1);
    setTimeout(() => setMsg(""), 4000);
  }

  async function markPaid(id: string, paidAt: string | null) {
    setBusy(id);
    const r = await fetch(`/api/sales/payments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paidAt }),
    });
    const d = await r.json();
    setBusy(null);
    if (!r.ok) { setMsg(`Error: ${d.error}`); return; }
    setMsg(paidAt ? "Marked as paid." : "Marked as unpaid.");
    await load(1, false); setPage(1);
    setTimeout(() => setMsg(""), 3000);
  }

  // Apply search + status filter
  const filtered = divisions.filter(d => {
    if (filter === "PAID")    return !!d.paidAt;
    if (filter === "OVERDUE") return d.isOverdue && !d.paidAt;
    if (filter === "PENDING") return !d.paidAt;
    if (filter === "BY_CUSTOMER") return !d.paidAt; // customer view shows pending only
    return true; // ALL
  }).filter(d => {
    if (!searchQ) return true;
    const q = searchQ.toLowerCase();
    const pi = d.order.proformaInvoices[0]?.piNumber ?? "";
    return (
      d.order.client.name.toLowerCase().includes(q) ||
      (d.order.orderNumber ?? "").toLowerCase().includes(q) ||
      pi.toLowerCase().includes(q) ||
      (d.order.sp.name ?? d.order.sp.email).toLowerCase().includes(q)
    );
  });

  const totalPending  = divisions.filter(d => !d.paidAt).reduce((s, d) => s + d.amount, 0);
  const totalOverdue  = divisions.filter(d => d.isOverdue && !d.paidAt).reduce((s, d) => s + d.amount, 0);
  const totalReceived = divisions.filter(d => !!d.paidAt).reduce((s, d) => s + d.amount, 0);
  const overdueCount  = divisions.filter(d => d.isOverdue && !d.paidAt).length;

  // Customer grouping for BY_CUSTOMER tab
  const byCustomer = (() => {
    const pending = divisions.filter(d => !d.paidAt);
    const map = new Map<string, { clientId: string; clientName: string; country: string | null; total: number; overdueTotal: number; count: number; overdueCount: number; orders: Set<string> }>();
    for (const d of pending) {
      const cid = d.order.client.id;
      if (!map.has(cid)) map.set(cid, { clientId: cid, clientName: d.order.client.name, country: d.order.client.country, total: 0, overdueTotal: 0, count: 0, overdueCount: 0, orders: new Set() });
      const g = map.get(cid)!;
      g.total += d.amount;
      g.count++;
      g.orders.add(d.order.id);
      if (d.isOverdue) { g.overdueTotal += d.amount; g.overdueCount++; }
    }
    return Array.from(map.values()).sort((a, b) => b.overdueTotal - a.overdueTotal || b.total - a.total);
  })();

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Payments</h1>
          <p className="text-sm text-slate-500 mt-0.5">All payment divisions across orders</p>
        </div>
        {/* Search */}
        <input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Search client, order, PI&#x2026;"
          className="w-56 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Pending</p>
          <p className="text-2xl font-bold text-slate-900">${totalPending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className="text-xs text-slate-400 mt-0.5">{divisions.filter(d => !d.paidAt).length} installments</p>
        </div>
        <div className={`rounded-2xl border p-4 ${overdueCount > 0 ? "bg-red-50 border-red-200" : "bg-white border-slate-100"}`}>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Overdue</p>
          <p className={`text-2xl font-bold ${overdueCount > 0 ? "text-red-600" : "text-slate-900"}`}>
            ${totalOverdue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{overdueCount} installments</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Received</p>
          <p className="text-2xl font-bold text-green-600">
            ${totalReceived.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{divisions.filter(d => !!d.paidAt).length} installments</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(["ALL","PENDING","OVERDUE","PAID","BY_CUSTOMER"] as FilterTab[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${filter === f ? "bg-slate-800 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"}`}>
            {f === "BY_CUSTOMER" ? "By Customer" : f}
            {f === "OVERDUE" && overdueCount > 0 ? ` (${overdueCount})` : ""}
          </button>
        ))}
      </div>

      {/* Date filter */}
      <div className="flex gap-2 items-center mb-5 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
          className="border rounded px-2 py-1 text-sm" placeholder="From" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
          className="border rounded px-2 py-1 text-sm" placeholder="To" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
            className="text-sm text-slate-400 hover:text-slate-600">Clear</button>
        )}
      </div>

      {msg && <p className="text-sm text-green-600 mb-4">{msg}</p>}

      {loading ? (
        <div className="text-sm text-slate-400 py-16 text-center">Loading&#x2026;</div>
      ) : filter === "BY_CUSTOMER" ? (
        /* ── Customer grouping view ── */
        byCustomer.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
            <p className="text-slate-400 text-sm">No pending payments.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {byCustomer.map(g => (
              <div key={g.clientId} className={`bg-white rounded-2xl border p-5 ${g.overdueCount > 0 ? "border-red-200" : "border-slate-100"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900 text-sm">{g.clientName}</p>
                    {g.country && <p className="text-xs text-slate-400">{g.country}</p>}
                    <p className="text-xs text-slate-500 mt-1">
                      {g.orders.size} order{g.orders.size !== 1 ? "s" : ""} &middot; {g.count} installment{g.count !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-slate-900">${g.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    {g.overdueCount > 0 && (
                      <p className="text-xs text-red-600 font-semibold mt-0.5">
                        &#x26A0; ${g.overdueTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} overdue
                      </p>
                    )}
                  </div>
                </div>
                {/* Breakdown rows */}
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                  {divisions
                    .filter(d => !d.paidAt && d.order.client.id === g.clientId)
                    .map(d => {
                      const pi = d.order.proformaInvoices[0];
                      return (
                        <div key={d.id} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <Link href={`/sales/orders/${d.order.id}`} className="font-medium text-blue-600 hover:underline">
                              {d.order.orderNumber}
                            </Link>
                            {pi && (
                              <Link href={`/sales/pi/${pi.id}`} className="text-slate-400 hover:text-slate-600">
                                {pi.piNumber}
                              </Link>
                            )}
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${TYPE_COLORS[d.type] ?? "bg-slate-100 text-slate-600"}`}>
                              {TYPE_LABELS[d.type] ?? d.type}
                            </span>
                            {d.isOverdue && <span className="text-red-500 font-semibold">Overdue</span>}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-semibold text-slate-700">
                              {d.order.currency ?? "USD"} {d.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                            <button
                              onClick={() => markPaid(d.id, new Date().toISOString())}
                              disabled={busy === d.id}
                              className="px-2 py-1 bg-green-600 text-white text-[10px] font-semibold rounded hover:bg-green-700 disabled:opacity-50 transition">
                              {busy === d.id ? "&#x2026;" : "Pay"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
          <p className="text-slate-400 text-sm">No payments{filter !== "ALL" ? ` in ${filter.toLowerCase()}` : ""}.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Order / PI</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Client</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Type</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Due</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const currency = d.order.currency ?? "USD";
                const isPaid = !!d.paidAt;
                const isOverdue = d.isOverdue && !isPaid;
                const pi = d.order.proformaInvoices[0];
                return (
                  <tr key={d.id}
                    className={`border-b border-slate-50 ${isOverdue ? "bg-red-50/40" : ""}`}>
                    <td className="px-4 py-3">
                      <Link href={`/sales/orders/${d.order.id}`}
                        className="font-semibold text-slate-900 hover:text-blue-600 text-sm">
                        {d.order.orderNumber}
                      </Link>
                      {pi ? (
                        <Link href={`/sales/pi/${pi.id}`} className="block text-xs text-blue-500 hover:underline">
                          {pi.piNumber}
                        </Link>
                      ) : d.order.invoiceNumber ? (
                        <p className="text-xs text-slate-400">{d.order.invoiceNumber}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-700">{d.order.client.name}</p>
                      <p className="text-xs text-slate-400">{d.order.sp.name ?? d.order.sp.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${TYPE_COLORS[d.type] ?? "bg-slate-100 text-slate-600"}`}>
                        {TYPE_LABELS[d.type] ?? d.type}
                      </span>
                      <p className="text-xs text-slate-400 mt-0.5">{d.percentage}%</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-semibold text-slate-900">{currency} {d.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </td>
                    <td className="px-4 py-3">
                      {d.dueDate ? (
                        <p className={`text-xs font-medium ${isOverdue ? "text-red-600" : "text-slate-600"}`}>
                          {isOverdue && "&#x26A0; "}{new Date(d.dueDate).toLocaleDateString()}
                        </p>
                      ) : d.deadlineDays ? (
                        <p className="text-xs text-slate-400">{d.deadlineDays}d from dispatch</p>
                      ) : (
                        <p className="text-xs text-slate-400">&#x2014;</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isPaid ? (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                          Paid {new Date(d.paidAt!).toLocaleDateString()}
                        </span>
                      ) : isOverdue ? (
                        <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-semibold">
                          Overdue
                        </span>
                      ) : d.overriddenAt ? (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold" title={d.overrideNote ?? undefined}>
                          Paused
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {!isPaid ? (
                          <button
                            onClick={() => markPaid(d.id, new Date().toISOString())}
                            disabled={!!busy}
                            className="px-2.5 py-1 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
                            {busy === d.id ? "…" : "Mark Paid"}
                          </button>
                        ) : (
                          <button
                            onClick={() => markPaid(d.id, null)}
                            disabled={!!busy}
                            className="px-2.5 py-1 border border-slate-200 text-slate-500 text-xs font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition">
                            {busy === d.id ? "…" : "Undo"}
                          </button>
                        )}
                        {!isPaid && d.type !== "ADVANCE" && (
                          <button
                            onClick={() => sendReminder(d.id)}
                            disabled={!!busy}
                            title="Send payment reminder email to client"
                            className="px-2.5 py-1 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
                            {busy === `remind-${d.id}` ? "…" : "Send Reminder"}
                          </button>
                        )}
                        {isAdmin && !isPaid && d.type !== "ADVANCE" && (
                          d.overriddenAt ? (
                            <button
                              onClick={() => clearOverride(d.id)}
                              disabled={!!busy}
                              title={`Reminders paused: ${d.overrideNote || "no note"}. Click to resume.`}
                              className="px-2.5 py-1 bg-amber-100 text-amber-700 border border-amber-300 text-xs font-semibold rounded-lg hover:bg-amber-200 disabled:opacity-50 transition">
                              {busy === `override-${d.id}` ? "…" : "Paused ✕"}
                            </button>
                          ) : (
                            <button
                              onClick={() => setOverrideModal({ id: d.id, orderNum: d.order.orderNumber })}
                              disabled={!!busy}
                              title="Pause auto-reminders for this division"
                              className="px-2.5 py-1 border border-slate-300 text-slate-500 text-xs font-medium rounded-lg hover:bg-slate-100 disabled:opacity-50 transition">
                              Pause
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <button onClick={loadMore} className="mt-4 w-full border rounded py-2 text-sm text-slate-600 hover:bg-slate-50">
          Load More
        </button>
      )}

      {/* Override modal */}
      {overrideModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-1">Pause Reminders</h3>
            <p className="text-sm text-slate-500 mb-4">
              Order <strong>{overrideModal.orderNum}</strong> — auto-reminders will be paused for this payment.
              The payment stays pending. Only admin can set or clear this.
            </p>
            <label className="block text-xs font-medium text-slate-600 mb-1">Note (optional)</label>
            <textarea
              value={overrideNote}
              onChange={e => setOverrideNote(e.target.value)}
              placeholder="e.g. Discussed with client, payment expected by end of month"
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setOverrideModal(null); setOverrideNote(""); }}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => setOverride(overrideModal.id, overrideNote)}
                disabled={!!busy}
                className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
                {busy ? "…" : "Pause Reminders"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
