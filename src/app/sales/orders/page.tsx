"use client";
import { Suspense, useEffect, useState } from "react";
import { readJson } from "@/lib/readJson";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type SpTab = { id: string; name: string };

type Order = {
  id: string; orderNumber: string; status: string; createdAt: string; updatedAt: string;
  currency: string | null; totalAmount: number | null;
  client: { name: string; country: string | null };
  sp: { name: string | null };
  proformaInvoices: { piNumber: string; id: string }[];
  productionJob: { type: string; status: string } | null;
};

const STATUS_COLORS: Record<string, string> = {
  PENDING_PAYMENT:    "bg-amber-100 text-amber-700",
  PENDING_STOCK_CHECK:"bg-yellow-100 text-yellow-700",
  STOCK_CONFIRMED:    "bg-lime-100 text-lime-700",
  PENDING_PRODUCTION: "bg-orange-100 text-orange-700",
  IN_PRODUCTION:      "bg-blue-100 text-blue-700",
  PACKING:            "bg-purple-100 text-purple-700",
  DISPATCHED:         "bg-indigo-100 text-indigo-700",
  IN_TRANSIT:         "bg-cyan-100 text-cyan-700",
  PORT_ARRIVED:       "bg-teal-100 text-teal-700",
  DELIVERED:          "bg-green-100 text-green-700",
  CANCELLED:          "bg-red-100 text-red-700",
};

const DELAY_THRESHOLDS: Record<string, number> = {
  PENDING_PAYMENT:     7,
  PENDING_STOCK_CHECK: 3,
  STOCK_CONFIRMED:     3,
  PENDING_PRODUCTION:  5,
  IN_PRODUCTION:       21,
  PACKING:             7,
  DISPATCHED:          35,
  PORT_ARRIVED:        7,
};

function daysInStatus(updatedAt: string) {
  return Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
}

function isDelayed(o: Order) {
  const threshold = DELAY_THRESHOLDS[o.status];
  if (!threshold) return false;
  return daysInStatus(o.updatedAt) >= threshold;
}

const FILTERS = ["ALL","PENDING_PAYMENT","IN_PRODUCTION","PACKING","DISPATCHED","DELIVERED","⚠ DELAYED"];
const FACTORY_TABS = [
  { key: "ALL",     label: "All",     color: "bg-slate-700 text-white", inactive: "bg-white text-slate-600 border border-slate-200 hover:border-slate-400" },
  { key: "QUARTZ",  label: "Quartz",  color: "bg-sky-600 text-white",   inactive: "bg-white text-sky-600 border border-sky-200 hover:border-sky-400" },
  { key: "GRANITE", label: "Granite", color: "bg-stone-600 text-white", inactive: "bg-white text-stone-600 border border-stone-200 hover:border-stone-400" },
];
const PAGE_SIZE = 10;

export default function OrdersPage() {
  // useSearchParams needs a Suspense boundary during prerender (Next 15).
  return (
    <Suspense fallback={<div className="text-sm text-slate-400 py-12 text-center">Loading…</div>}>
      <OrdersPageInner />
    </Suspense>
  );
}

function OrdersPageInner() {
  // Dashboard KPI cards deep-link here as /sales/orders?status=… — start on
  // that tab when the value is one of the known filter tabs.
  const searchParams = useSearchParams();
  const statusParam  = searchParams.get("status");
  const [orders, setOrders]         = useState<Order[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState("");
  const [filter, setFilter]         = useState(statusParam && FILTERS.includes(statusParam) ? statusParam : "ALL");
  const [factory, setFactory]       = useState("ALL");
  const [spTabs, setSpTabs]         = useState<SpTab[]>([]);
  const [selectedSp, setSelectedSp] = useState("ALL");
  const [salesRole, setSalesRole]   = useState<string | null>(null);
  const [searchQ, setSearchQ]       = useState("");
  const [page, setPage]             = useState(1);
  const [dateFrom, setDateFrom]     = useState("");
  const [dateTo, setDateTo]         = useState("");
  const [hasMore, setHasMore]       = useState(false);

  useEffect(() => {
    fetch("/api/sales/me").then(r => r.json()).then(d => {
      if (d.salesRole) setSalesRole(d.salesRole);
    }).catch(() => {});
    fetch("/api/sales/rm-sps").then(r => r.json()).then(d => {
      if (Array.isArray(d.sps) && d.sps.length > 1) setSpTabs(d.sps);
    }).catch(() => {});
  }, []);

  async function load(p = 1, append = false) {
    setLoading(true); setLoadError("");
    const params = new URLSearchParams();
    if (filter !== "ALL" && filter !== "⚠ DELAYED") params.set("status", filter);
    if (factory !== "ALL") params.set("productType", factory);
    if (selectedSp !== "ALL") params.set("sp", selectedSp);
    params.set("limit", String(PAGE_SIZE));
    params.set("page", String(p));
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo)   params.set("to", dateTo);
    // readJson + finally: an expired session (the login page's HTML, 200) or a
    // dropped connection used to throw out of r.json() with loading still
    // true, so the spinner never cleared. Now the error is shown and the
    // spinner stops; the list is left as it was.
    try {
      const r = await fetch(`/api/sales/orders?${params}`);
      const res = await readJson<unknown>(r);
      if (!res.ok) { setLoadError(res.error ?? `Could not load orders (HTTP ${res.status}).`); return; }
      const list = Array.isArray(res.data) ? res.data : [];
      if (append) {
        setOrders(prev => {
          const seen = new Set(prev.map((o: any) => o.id));
          return [...prev, ...list.filter((o: any) => !seen.has(o.id))];
        });
      } else {
        setOrders(list);
      }
      setHasMore(list.length === PAGE_SIZE);
    } catch (e) {
      setLoadError(e instanceof Error && e.message ? `Could not reach the server: ${e.message}` : "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    load(nextPage, true);
  }

  useEffect(() => { setPage(1); load(1, false); }, [filter, factory, selectedSp, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = orders
    .filter(o => filter === "⚠ DELAYED" ? isDelayed(o) : true)
    .filter(o => {
      if (!searchQ) return true;
      const q = searchQ.toLowerCase();
      return (
        o.client.name.toLowerCase().includes(q) ||
        (o.orderNumber ?? "").toLowerCase().includes(q) ||
        o.proformaInvoices.some(p => p.piNumber.toLowerCase().includes(q)) ||
        (o.sp.name ?? "").toLowerCase().includes(q)
      );
    });

  const delayedCount = orders.filter(isDelayed).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">{visible.length} order{visible.length !== 1 ? "s" : ""}</p>
        </div>
        <input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Search client, order, PI&#x2026;"
          className="w-56 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
      </div>

      {/* Factory tabs -- only for SP, RM, Admin (not Commercial/Accounts) */}
      {salesRole !== null && salesRole !== "COMMERCIAL" && salesRole !== "ACCOUNTS" && (
        <div className="flex gap-1.5 mb-4">
          {FACTORY_TABS.map(t => (
            <button key={t.key} onClick={() => { setFactory(t.key); setPage(1); }}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition ${factory === t.key ? t.color : t.inactive}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* SP tabs -- only shown for Reporting Managers */}
      {spTabs.length > 0 && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          <button onClick={() => { setSelectedSp("ALL"); setPage(1); }}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition ${selectedSp === "ALL" ? "bg-brand text-white" : "bg-white text-brand border border-gray-300 hover:border-brand"}`}>
            All SPs
          </button>
          {spTabs.map(sp => (
            <button key={sp.id} onClick={() => { setSelectedSp(sp.id); setPage(1); }}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition ${selectedSp === sp.id ? "bg-brand text-white" : "bg-white text-brand border border-gray-300 hover:border-brand"}`}>
              {sp.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-5 flex-wrap">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              filter === f ? "bg-brand text-white" : "bg-white text-slate-600 border border-slate-200 hover:border-brand"
            } ${f === "⚠ DELAYED" && delayedCount > 0 ? "border-red-300 text-red-600" : ""}`}>
            {f.replace(/_/g, " ")}
            {f === "⚠ DELAYED" && delayedCount > 0 ? ` (${delayedCount})` : ""}
          </button>
        ))}
      </div>

      <div className="flex gap-2 items-center mb-4 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
          className="border rounded px-2 py-1 text-sm" placeholder="From" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
          className="border rounded px-2 py-1 text-sm" placeholder="To" />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}
            className="text-sm text-slate-400 hover:text-slate-600">Clear</button>
        )}
      </div>

      {loadError && <div className="text-sm text-red-600 py-3 text-center">{loadError}</div>}
      {loading ? (
        <div className="text-sm text-slate-400 py-12 text-center">Loading&#x2026;</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-slate-400 py-12 text-center">No orders found.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {["Order No.","Client","PI(s)","SP","Amount","Production","Status",""].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-semibold text-slate-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(o => {
                const delayed = isDelayed(o);
                const days = daysInStatus(o.updatedAt);
                return (
                  <tr key={o.id} className={`border-b border-slate-50 hover:bg-slate-50/50 transition ${delayed ? "bg-red-50/30" : ""}`}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {o.orderNumber}
                      {delayed && (
                        <span className="ml-1.5 text-[10px] font-bold text-red-500 bg-red-100 px-1 rounded" title={`${days}d in ${o.status}`}>
                          &#x26A0; {days}d
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {o.client.name}
                      {o.client.country && <span className="text-slate-400 font-normal"> &middot; {o.client.country}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                      {o.proformaInvoices.length > 0
                        ? o.proformaInvoices.map(p => (
                            <Link key={p.id} href={`/sales/pi/${p.id}`} className="hover:text-blue-500 hover:underline mr-1">
                              {p.piNumber}
                            </Link>
                          ))
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{o.sp.name ?? "—"}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">
                      {o.currency ?? "USD"} {(o.totalAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3">
                      {o.productionJob
                        ? <span className="text-xs text-slate-500">{o.productionJob.type} &middot; {o.productionJob.status.replace(/_/g," ")}</span>
                        : <span className="text-xs text-slate-300">&#x2014;</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[o.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {o.status.replace(/_/g," ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/sales/orders/${o.id}`}
                        className="text-teal-600 hover:text-teal-800 text-xs font-medium">Open &#x2192;</Link>
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
    </div>
  );
}
