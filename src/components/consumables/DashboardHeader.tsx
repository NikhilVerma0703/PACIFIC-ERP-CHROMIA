"use client";
// Action bar for the Consumables page — plain ERP styling (the page title
// comes from the Shell page header like every other tab; no banner, no clock).
import { useState, useRef, useEffect } from "react";

import { useCanWrite } from "@/components/consumables/write-access";

interface DashboardHeaderProps {
  onAddInventory?: () => void;
  onAddConsumption?: () => void;
  onExportConsumption?: () => void;
  onExportInventory?: () => void;
}

const btnGhost = "inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50";
const btnBrand = "inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark";

export default function DashboardHeader({ onAddInventory, onAddConsumption, onExportConsumption, onExportInventory }: DashboardHeaderProps) {
  // Export is a read - a view-only login keeps it. Recording is not.
  const canWrite = useCanWrite();
  const [showExportMenu, setShowExportMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowExportMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canWrite && (
        <>
          <button onClick={onAddConsumption} className={btnBrand}>+ Add Consumption</button>
          <button onClick={onAddInventory} className={btnGhost}>+ Add Inventory</button>
        </>
      )}
      <div className="relative" ref={menuRef}>
        <button onClick={() => setShowExportMenu((v) => !v)} className={btnGhost}>
          Export
          <svg className={`h-3.5 w-3.5 transition-transform ${showExportMenu ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
        {showExportMenu && (
          <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
            <button onClick={() => { onExportConsumption?.(); setShowExportMenu(false); }}
              className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50">
              Consumption report <span className="block text-xs text-gray-400">uses the active filters</span>
            </button>
            <div className="border-t border-gray-100" />
            <button onClick={() => { onExportInventory?.(); setShowExportMenu(false); }}
              className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50">
              Inventory stock report <span className="block text-xs text-gray-400">full item list</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
