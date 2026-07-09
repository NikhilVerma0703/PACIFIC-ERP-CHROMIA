"use client";

import { useState, useRef, useEffect } from "react";

interface DashboardHeaderProps {
  onAddInventory?: () => void;
  onAddConsumption?: () => void;
  onExportConsumption?: () => void;
  onExportInventory?: () => void;
}

export default function DashboardHeader({
  onAddInventory,
  onAddConsumption,
  onExportConsumption,
  onExportInventory,
}: DashboardHeaderProps) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setCurrentDate(
        now.toLocaleDateString("en-IN", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      );
      setCurrentTime(
        now.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="rounded-xl shadow-lg border border-blue-900/20">
      {/* Top accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-400 rounded-t-xl" />

      {/* Main header */}
      <div
        className="px-6 pt-4 pb-0 rounded-b-xl"
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #1e40af 100%)",
        }}
      >
        {/* Top row — company + breadcrumb + datetime */}
        <div className="flex items-center justify-between mb-4">
          {/* Left — company + breadcrumb */}
          <div className="flex items-center gap-3">
            {/* Company Logo */}
            <div className="w-11 h-11 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center shrink-0 p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-white.png" alt="Pacific Group" className="w-full h-full object-contain" />
            </div>
            <div>
              <p className="text-blue-300 text-xs font-semibold tracking-widest uppercase">
                Pacific Group
              </p>
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-blue-400/70 text-xs">ERP</span>
                <svg className="w-3 h-3 text-blue-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-blue-400/70 text-xs">Inventory</span>
                <svg className="w-3 h-3 text-blue-500/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-blue-200 text-xs font-medium">Consumables</span>
              </div>
            </div>
          </div>

          {/* Right — live date + time */}
          <div className="text-right hidden sm:block">
            <p className="text-blue-200 text-xs font-medium">{currentDate}</p>
            <p className="text-blue-300/70 text-xs mt-0.5 font-mono">{currentTime}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 mb-4" />

        {/* Bottom row — title + buttons */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 pb-5">
          {/* Title block */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-xs font-semibold tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
              <span className="text-blue-400/60 text-xs">Module v2.0</span>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              Consumables Dashboard
            </h1>
            <p className="text-blue-300/70 text-sm mt-1">
              Direct Materials · Production Consumables · Polishing · Film Roll Tracking
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Add Inventory */}
            <button
              onClick={onAddInventory}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 shadow-sm"
              style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Inventory
            </button>

            {/* Add Consumption */}
            <button
              onClick={onAddConsumption}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 shadow-sm"
              style={{ background: "#059669", border: "1px solid #10b981", color: "#fff" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#047857")}
              onMouseLeave={e => (e.currentTarget.style.background = "#059669")}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Add Consumption
            </button>

            {/* Export dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowExportMenu((v) => !v)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 shadow-sm"
                style={{ background: "#2563eb", border: "1px solid #3b82f6", color: "#fff" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#1d4ed8")}
                onMouseLeave={e => (e.currentTarget.style.background = "#2563eb")}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export Report
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${showExportMenu ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-60 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 border-b">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Choose Export Type
                    </p>
                  </div>
                  <button
                    onClick={() => { onExportConsumption?.(); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-blue-50 flex items-center gap-3 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                      <span className="text-base">📊</span>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-800">Consumption Report</div>
                      <div className="text-xs text-gray-400 mt-0.5">Exports with active filters</div>
                    </div>
                  </button>
                  <div className="border-t mx-4" />
                  <button
                    onClick={() => { onExportInventory?.(); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-blue-50 flex items-center gap-3 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="text-base">📦</span>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-800">Inventory Stock Report</div>
                      <div className="text-xs text-gray-400 mt-0.5">Full inventory list</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
