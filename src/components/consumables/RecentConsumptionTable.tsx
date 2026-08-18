"use client";

import { useState, useEffect } from "react";
import type { Filters } from "@/components/consumables/ConsumablesDashboard";

interface ConsumptionEntry {
  id: string;
  date: string;
  itemName: string;
  quantity: number;
  unit: string;
  department: { id: string; name: string };
}

interface Props { filters: Filters; }

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const DEPT_STYLE: Record<string, string> = {
  Mixer:          "bg-blue-50 text-blue-700 border-blue-200",
  Distributor:    "bg-green-50 text-green-700 border-green-200",
  Press:          "bg-purple-50 text-purple-700 border-purple-200",
  "LB Line":      "bg-orange-50 text-orange-700 border-orange-200",
  "Raw Material": "bg-yellow-50 text-yellow-700 border-yellow-200",
  Silos:          "bg-teal-50 text-teal-700 border-teal-200",
  Production:     "bg-pink-50 text-pink-700 border-pink-200",
  Polishing:      "bg-indigo-50 text-indigo-700 border-indigo-200",
};

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[90, 100, 150, 70, 60].map((w, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

export default function RecentConsumptionTable({ filters }: Props) {
  const [entries, setEntries]   = useState<ConsumptionEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo)   params.set("dateTo",   filters.dateTo);
    fetch(`/api/consumables/consumption?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => { setEntries(d); setLoading(false); setPage(1); })
      .catch(console.error);
  }, [filters.dateFrom, filters.dateTo]);

  useEffect(() => { setPage(1); }, [filters.search, filters.department]);

  const filtered = entries.filter((entry) => {
    if (filters.search && !entry.itemName.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.department !== "All" && entry.department.name !== filters.department) return false;
    return true;
  });

  const totalPages  = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated   = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const goTo = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));

  const start   = Math.max(1, currentPage - 2);
  const end     = Math.min(totalPages, start + 4);
  const pageButtons: number[] = [];
  for (let i = start; i <= end; i++) pageButtons.push(i);

  const hasDateFilter  = filters.dateFrom || filters.dateTo;
  const isFiltered     = filtered.length !== entries.length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-teal-500 to-cyan-400" />

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Records</p>
          <h2 className="text-xl font-bold text-gray-800 mt-0.5">Consumption Entries</h2>
          {hasDateFilter && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs text-amber-600 font-medium">
                {filters.dateFrom || "start"} → {filters.dateTo || "today"}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {isFiltered && (
            <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full font-medium">
              {filtered.length} filtered
            </span>
          )}
          <span className="text-sm font-medium text-gray-400">
            {loading ? "Loading..." : `${entries.length.toLocaleString("en-IN")} total entries`}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {["Date", "Department", "Item", "Quantity", "Unit"].map((col) => (
                <th key={col} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                    <span className="text-sm">
                      {entries.length === 0 ? "No consumption entries for this period." : "No entries match the current filters."}
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              paginated.map((entry, idx) => {
                const deptStyle = DEPT_STYLE[entry.department.name] ?? "bg-gray-100 text-gray-600 border-gray-200";
                return (
                  <tr key={entry.id}
                    className={`transition-colors duration-100 hover:bg-teal-50/30 ${idx % 2 === 0 ? "" : "bg-gray-50/40"}`}>

                    {/* Date */}
                    <td className="px-4 py-3.5">
                      <span className="font-medium text-gray-700 tabular-nums">{formatDate(entry.date)}</span>
                    </td>

                    {/* Department */}
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-md border ${deptStyle}`}>
                        {entry.department.name}
                      </span>
                    </td>

                    {/* Item */}
                    <td className="px-4 py-3.5">
                      <span className="font-semibold text-gray-900">{entry.itemName}</span>
                    </td>

                    {/* Quantity */}
                    <td className="px-4 py-3.5">
                      <span className="font-bold text-teal-700 tabular-nums">
                        {entry.quantity.toLocaleString("en-IN")}
                      </span>
                    </td>

                    {/* Unit */}
                    <td className="px-4 py-3.5">
                      <span className="text-gray-500 font-medium">{entry.unit}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          {/* Rows per page + range */}
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="font-medium">Rows per page:</span>
            <div className="relative">
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="appearance-none bg-white border border-gray-200 rounded-lg pl-3 pr-8 py-1.5 text-sm
                  focus:outline-none focus:ring-2 focus:ring-teal-400 cursor-pointer font-medium text-gray-700"
              >
                {PAGE_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <svg className="pointer-events-none absolute right-2 top-2.5 w-3.5 h-3.5 text-gray-400"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <span className="text-gray-400 tabular-nums">
              {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length.toLocaleString("en-IN")}
            </span>
          </div>

          {/* Page buttons */}
          <div className="flex items-center gap-1">
            <button onClick={() => goTo(1)} disabled={currentPage === 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 text-sm disabled:opacity-30 hover:border-teal-300 hover:text-teal-600 transition-colors">
              «
            </button>
            <button onClick={() => goTo(currentPage - 1)} disabled={currentPage === 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 text-sm disabled:opacity-30 hover:border-teal-300 hover:text-teal-600 transition-colors">
              ‹
            </button>
            {pageButtons.map((p) => (
              <button key={p} onClick={() => goTo(p)}
                className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm font-semibold transition-all ${
                  p === currentPage
                    ? "bg-teal-600 text-white border border-teal-600 shadow-sm"
                    : "bg-white border border-gray-200 text-gray-600 hover:border-teal-300 hover:text-teal-600"
                }`}>
                {p}
              </button>
            ))}
            <button onClick={() => goTo(currentPage + 1)} disabled={currentPage === totalPages}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 text-sm disabled:opacity-30 hover:border-teal-300 hover:text-teal-600 transition-colors">
              ›
            </button>
            <button onClick={() => goTo(totalPages)} disabled={currentPage === totalPages}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 text-sm disabled:opacity-30 hover:border-teal-300 hover:text-teal-600 transition-colors">
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
