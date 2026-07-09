"use client";

import type { Filters } from "@/components/consumables/ConsumablesDashboard";

interface Props {
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
}

const DEPARTMENTS = [
  "All", "Mixer", "Distributor", "Press",
  "LB Line", "Raw Material", "Silos", "Production", "Polishing",
];

const toDateStr = (d: Date) => d.toISOString().split("T")[0];

function getQuickRange(key: string): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const todayStr = toDateStr(today);
  switch (key) {
    case "today":
      return { dateFrom: todayStr, dateTo: todayStr };
    case "week": {
      const diff = today.getDay() === 0 ? 6 : today.getDay() - 1;
      const mon = new Date(today);
      mon.setDate(today.getDate() - diff);
      return { dateFrom: toDateStr(mon), dateTo: todayStr };
    }
    case "month": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { dateFrom: toDateStr(first), dateTo: todayStr };
    }
    case "lastmonth": {
      const firstThis = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastPrev = new Date(firstThis); lastPrev.setDate(0);
      const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
      return { dateFrom: toDateStr(firstPrev), dateTo: toDateStr(lastPrev) };
    }
    default:
      return { dateFrom: "", dateTo: "" };
  }
}

const inputBase =
  "w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 " +
  "placeholder:text-gray-400 transition-shadow hover:border-gray-300";

const selectBase =
  "w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 " +
  "appearance-none cursor-pointer transition-shadow hover:border-gray-300";

export default function SearchFilterBar({ filters, onFiltersChange }: Props) {
  const set = (key: keyof Filters, value: string) =>
    onFiltersChange({ ...filters, [key]: value });

  const applyQuick = (key: string) => {
    const { dateFrom, dateTo } = getQuickRange(key);
    onFiltersChange({ ...filters, dateFrom, dateTo });
  };

  const clearAll = () =>
    onFiltersChange({ search: "", category: "All", department: "All", dateFrom: "", dateTo: "" });

  const activeQuick = (() => {
    const today = toDateStr(new Date());
    if (filters.dateFrom === today && filters.dateTo === today) return "today";
    const { dateFrom: wF, dateTo: wT } = getQuickRange("week");
    if (filters.dateFrom === wF && filters.dateTo === wT) return "week";
    const { dateFrom: mF, dateTo: mT } = getQuickRange("month");
    if (filters.dateFrom === mF && filters.dateTo === mT) return "month";
    const { dateFrom: lF, dateTo: lT } = getQuickRange("lastmonth");
    if (filters.dateFrom === lF && filters.dateTo === lT) return "lastmonth";
    return null;
  })();

  const activeChips: { label: string; onRemove: () => void }[] = [];
  if (filters.search)
    activeChips.push({ label: `"${filters.search}"`, onRemove: () => set("search", "") });
  if (filters.category !== "All")
    activeChips.push({ label: filters.category, onRemove: () => set("category", "All") });
  if (filters.department !== "All")
    activeChips.push({ label: filters.department, onRemove: () => set("department", "All") });
  if (filters.dateFrom || filters.dateTo)
    activeChips.push({
      label: `${filters.dateFrom || "—"}  →  ${filters.dateTo || "—"}`,
      onRemove: () => onFiltersChange({ ...filters, dateFrom: "", dateTo: "" }),
    });

  const isActive = activeChips.length > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          {/* Filter icon */}
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
          </svg>
          <span className="text-sm font-semibold text-gray-700 tracking-wide">Search & Filters</span>
          {isActive && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold">
              {activeChips.length}
            </span>
          )}
        </div>
        {isActive && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear All
          </button>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Row 1: Search, Category, Department */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Search Item
            </label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={filters.search}
                onChange={(e) => set("search", e.target.value)}
                placeholder="Search consumables..."
                className={inputBase + " pl-9"}
              />
              {filters.search && (
                <button onClick={() => set("search", "")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Category
            </label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
              </svg>
              <select value={filters.category}
                onChange={(e) => set("category", e.target.value)}
                className={selectBase + " pl-9 pr-9"}>
                <option>All</option>
                <option>Direct Materials</option>
                <option>Production Consumables</option>
                <option>Polishing Consumables</option>
              </select>
              <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          {/* Department */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Department
            </label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <select value={filters.department}
                onChange={(e) => set("department", e.target.value)}
                className={selectBase + " pl-9 pr-9"}>
                {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
              </select>
              <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-100" />

        {/* Row 2: Date range + quick select */}
        <div className="flex flex-wrap items-end gap-4">
          {/* Date From */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Date From
            </label>
            <div className="relative">
              <input type="date" value={filters.dateFrom}
                onChange={(e) => set("dateFrom", e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 hover:border-gray-300 transition-shadow" />
            </div>
          </div>

          {/* Arrow */}
          <div className="pb-2.5 text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>

          {/* Date To */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Date To
            </label>
            <input type="date" value={filters.dateTo}
              onChange={(e) => set("dateTo", e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 hover:border-gray-300 transition-shadow" />
          </div>

          {/* Quick select buttons */}
          <div className="flex items-center gap-2 flex-wrap pb-0.5">
            <span className="text-xs text-gray-400 font-medium mr-1">Quick:</span>
            {[
              { key: "today", label: "Today" },
              { key: "week", label: "This Week" },
              { key: "month", label: "This Month" },
              { key: "lastmonth", label: "Last Month" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => applyQuick(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-all duration-150 ${
                  activeQuick === key
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300"
                }`}>
                {label}
              </button>
            ))}
            {(filters.dateFrom || filters.dateTo) && (
              <button
                onClick={() => onFiltersChange({ ...filters, dateFrom: "", dateTo: "" })}
                className="px-3 py-1.5 text-xs font-medium rounded-md border bg-white text-gray-500 border-gray-200 hover:bg-red-50 hover:text-red-500 hover:border-red-300 transition-all">
                Clear dates
              </button>
            )}
          </div>
        </div>

        {/* Active filter chips */}
        {isActive ? (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span className="text-xs text-gray-400 font-medium">Active:</span>
            {activeChips.map((chip, i) => (
              <span key={i}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs font-medium">
                {chip.label}
                <button onClick={chip.onRemove}
                  className="text-blue-400 hover:text-blue-700 transition-colors ml-0.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 pt-1">
            <svg className="w-3.5 h-3.5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-gray-400">All records shown — no filters active</span>
          </div>
        )}
      </div>
    </div>
  );
}
