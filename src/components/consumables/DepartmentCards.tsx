"use client";

import { useState, useEffect } from "react";
import { jsonOrThrow } from "@/lib/jsonOrThrow";

interface DeptMapping {
  department: string;
  items: string[];
}

const DEPT_CONFIG: Record<string, { bg: string; text: string; border: string; accent: string; dot: string }> = {
  Mixer:         { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200",   accent: "#3b82f6", dot: "bg-blue-500"   },
  Distributor:   { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200",  accent: "#10b981", dot: "bg-emerald-500"},
  Press:         { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", accent: "#8b5cf6", dot: "bg-purple-500" },
  "LB Line":     { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", accent: "#f97316", dot: "bg-orange-500" },
  "Raw Material":{ bg: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-200", accent: "#eab308", dot: "bg-yellow-500" },
  Silos:         { bg: "bg-teal-50",   text: "text-teal-700",   border: "border-teal-200",   accent: "#14b8a6", dot: "bg-teal-500"   },
  Production:    { bg: "bg-pink-50",   text: "text-pink-700",   border: "border-pink-200",   accent: "#ec4899", dot: "bg-pink-500"   },
  Polishing:     { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200", accent: "#6366f1", dot: "bg-indigo-500" },
};

const DEFAULT_CONFIG = {
  bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200", accent: "#6b7280", dot: "bg-gray-500",
};

function SkeletonCard() {
  return (
    <div className="border border-gray-100 rounded-xl p-4 bg-white animate-pulse">
      <div className="flex justify-between mb-4">
        <div className="h-5 bg-gray-200 rounded w-24" />
        <div className="h-4 bg-gray-100 rounded w-12" />
      </div>
      <div className="flex flex-wrap gap-2">
        {[60, 80, 55, 70, 65, 50].map((w, i) => (
          <div key={i} className="h-6 bg-gray-100 rounded-md" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

export default function DepartmentCards() {
  const [mappings, setMappings]   = useState<DeptMapping[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/consumables/departments/mapping")
      .then(jsonOrThrow)
      .then((d) => { setMappings(d); setLoading(false); })
      .catch((e) => { console.error(e); setLoadError(e instanceof Error && e.message ? e.message : "Could not load."); setLoading(false); });
  }, []);

  const toggleExpand = (dept: string) =>
    setExpanded((prev) => ({ ...prev, [dept]: !prev[dept] }));

  const PREVIEW_COUNT = 6;
  const totalItems = mappings.reduce((s, d) => s + d.items.length, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {loadError && <p className="px-5 pt-3 text-xs text-red-600">{loadError}</p>}
      {/* Accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />

      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Overview</p>
          <h2 className="text-xl font-bold text-gray-800 mt-0.5">Department Consumables Mapping</h2>
          {!loading && (
            <p className="text-sm text-gray-400 mt-1">
              {mappings.length} departments · {totalItems} total items tracked
            </p>
          )}
        </div>
        {!loading && (
          <div className="flex flex-wrap gap-1.5 justify-end max-w-xs">
            {mappings.map((d) => {
              const cfg = DEPT_CONFIG[d.department] ?? DEFAULT_CONFIG;
              return (
                <span key={d.department}
                  className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {d.department}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="p-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mappings.map((dept) => {
              const cfg        = DEPT_CONFIG[dept.department] ?? DEFAULT_CONFIG;
              const isExpanded = expanded[dept.department];
              const visible    = isExpanded ? dept.items : dept.items.slice(0, PREVIEW_COUNT);
              const hiddenCount = dept.items.length - PREVIEW_COUNT;

              return (
                <div key={dept.department}
                  className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-200">
                  {/* Card accent strip */}
                  <div className="h-1 w-full" style={{ background: cfg.accent }} />

                  <div className="p-4">
                    {/* Card header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                        <h3 className="font-bold text-gray-900">{dept.department}</h3>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                        {dept.items.length} items
                      </span>
                    </div>

                    {/* Item pills — consistent rounded-md, no more circle/pill inconsistency */}
                    <div className="flex flex-wrap gap-1.5 min-h-[48px]">
                      {visible.map((item) => (
                        <span key={item}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                          {item}
                        </span>
                      ))}
                    </div>

                    {/* Show more / less */}
                    {dept.items.length > PREVIEW_COUNT && (
                      <button
                        onClick={() => toggleExpand(dept.department)}
                        className={`mt-3 text-xs font-semibold flex items-center gap-1 ${cfg.text} hover:opacity-80 transition-opacity`}
                      >
                        <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        {isExpanded ? "Show less" : `+${hiddenCount} more items`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
