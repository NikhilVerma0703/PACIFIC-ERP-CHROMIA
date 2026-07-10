"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type PI = {
  id: string; piNumber: string; status: string; currency: string;
  totalAmount: number; createdAt: string; sentAt: string | null;
  rejectionCount: number; productType?: string;
  client: { name: string; country: string | null };
  sp: { name: string | null };
};

type SpTab = { id: string; name: string };

const STATUS_COLORS: Record<string, string> = {
  DRAFT:          "bg-slate-100 text-slate-600",
  SENT:           "bg-blue-100 text-blue-700",
  ACCEPTED:       "bg-green-100 text-green-700",
  REJECTED:       "bg-red-100 text-red-700",
  UNDER_REVISION: "bg-amber-100 text-amber-700",
};

const FILTERS = ["ALL","DRAFT","SENT","UNDER_REVISION","ACCEPTED","REJECTED"];
const FACTORY_TABS = [
  { key: "ALL",     label: "All",     color: "bg-slate-700 text-white", inactive: "bg-white text-slate-600 border border-slate-200 hover:border-slate-400" },
  { key: "QUARTZ",  label: "Quartz",  color: "bg-sky-600 text-white",   inactive: "bg-white text-sky-600 border border-sky-200 hover:border-sky-400" },
  { key: "GRANITE", label: "Granite", color: "bg-stone-600 text-white", inactive: "bg-white text-stone-600 border border-stone-200 hover:border-stone-400" },
];
const PAGE_SIZE = 10;

export default function PIListPage() {
  // useSearchParams needs a Suspense boundary during prerender (Next 15).
  return (
    <Suspense fallback={<div className="text-sm text-slate-400 py-12 text-center">Loading\u2026</div>}>
      <PIListPageInner />
    </Suspense>
  );
}

function PIListPageInner() {
  // Dashboard KPI cards deep-link here as /sales/pi?status=… — start on that
  // tab when the value is one of the known filter tabs.
  const searchParams = useSearchParams();
  const statusParam  = searchParams.get("status");
  const [pis, setPis]               = useState<PI[]>([]);
  const [loading, setLoading]       = useState(true);
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
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "ALL") params.set("status", filter);
    if (factory !== "ALL") params.set("productType", factory);
    if (selectedSp !== "ALL") params.set("sp", selectedSp);
    params.set("limit", String(PAGE_SIZE));
    params.set("page", String(p));
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo)   params.set("to", dateTo);
    const r = await fetch(`/api/sales/pi?${params}`);
    const data = await r.json();
    const list = Array.isArray(data) ? data : [];
    if (append) {
      setPis(prev => [...prev, ...list]);
    } else {
      setPis(list);
    }
    setHasMore(list.length === PAGE_SIZE);
    setLoading(false);
  }

  function loadMore() {
    const nextPage = page + 1;
    setPage(nextPage);
    load(nextPage, true);
  }

  useEffect(() => { setPage(1); load(1, false); }, [filter, factory, selectedSp, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = pis.filter(pi => {
    if (!searchQ) return true;
    const q = searchQ.toLowerCase();
    return (
      pi.piNumber.toLowerCase().includes(q) ||
      pi.client.name.toLowerCase().includes(q) ||
      (pi.sp.name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Proforma Invoices</h1>
          <p className="text-sm text-slate-500 mt-0.5">{visible.length} PI{visible.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="Search PI, client, SP&#x2026;"
            className="w-48 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          <Link href="/sales/pi/new"
            className="flex items-center gap-2 px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg hover:bg-brand-dark transition">
            <span className="text-lg leading-none">+</span> New PI
          </Link>
        </div>
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
            }`}>
            {f}
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

      {loading ? (
        <div className="text-sm text-slate-400 py-12 text-center">Loading&#x2026;</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-slate-400 py-12 text-center">No PIs found.</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-3 font-semibold text-slate-600">PI No.</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Client</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">SP</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Amount</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-slate-600">Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visible.map(pi => (
                <tr key={pi.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {pi.piNumber}
                    {pi.productType === "GRANITE" && (
                      <span className="ml-1.5 px-1 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded">PGI</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {pi.client.name}
                    {pi.client.country && <span className="text-slate-400 font-normal"> &middot; {pi.client.country}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{pi.sp.name ?? "&#x2014;"}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {pi.currency} {pi.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[pi.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {pi.status}
                    </span>
                    {pi.rejectionCount > 0 && (
                      <span className="ml-1.5 text-xs text-amber-500">&#x21A9;&#xD7;{pi.rejectionCount}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(pi.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/sales/pi/${pi.id}`}
                      className="text-teal-600 hover:text-teal-800 text-xs font-medium">Open &#x2192;</Link>
                  </td>
                </tr>
              ))}
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
