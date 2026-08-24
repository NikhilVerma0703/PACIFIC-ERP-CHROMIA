"use client";

import { useState, useEffect } from "react";
import { jsonOrThrow } from "@/lib/jsonOrThrow";

interface KPIData {
  totalItems: number;
  directMaterials: number;
  productionConsumables: number;
  polishingConsumables: number;
  activeFilmRolls: number;
  lowStockItems: number;
  todayConsumptions: number;
  todayTotal: number;
  countTrend: number | null;
  totalTrend: number | null;
}

// ── SVG icon paths ────────────────────────────────────────────────────────────
const ICONS = {
  box: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  flask:
    "M9 3h6M9 3v6l-4.5 7.5A1 1 0 005.4 18h13.2a1 1 0 00.9-1.5L15 9V3M9 3H7m8 0h2",
  cog: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  film: "M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z",
  warning:
    "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  clipboard:
    "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
  chart:
    "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  sparkle:
    "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
};

interface CardDef {
  title: string;
  value: (d: KPIData) => number | string;
  icon: keyof typeof ICONS;
  accent: string;       // top bar + icon bg tint
  iconColor: string;    // icon stroke color
  iconBg: string;       // icon circle bg
  trend?: (d: KPIData) => number | null;
  trendLabel?: string;
  alert?: (d: KPIData) => boolean;
}

const CARDS: CardDef[] = [
  {
    title: "Total Items",
    value: (d) => d.totalItems,
    icon: "box",
    accent: "#3b82f6",
    iconBg: "#eff6ff",
    iconColor: "#3b82f6",
  },
  {
    title: "Direct Materials",
    value: (d) => d.directMaterials,
    icon: "flask",
    accent: "#6366f1",
    iconBg: "#eef2ff",
    iconColor: "#6366f1",
  },
  {
    title: "Production Consumables",
    value: (d) => d.productionConsumables,
    icon: "cog",
    accent: "#8b5cf6",
    iconBg: "#f5f3ff",
    iconColor: "#8b5cf6",
  },
  {
    title: "Active Film Rolls",
    value: (d) => d.activeFilmRolls,
    icon: "film",
    accent: "#06b6d4",
    iconBg: "#ecfeff",
    iconColor: "#06b6d4",
  },
  {
    title: "Low Stock Items",
    value: (d) => d.lowStockItems,
    icon: "warning",
    accent: "#ef4444",
    iconBg: "#fef2f2",
    iconColor: "#ef4444",
    alert: (d) => d.lowStockItems > 0,
  },
  {
    title: "Today's Entries",
    value: (d) => d.todayConsumptions,
    icon: "clipboard",
    accent: "#10b981",
    iconBg: "#f0fdf4",
    iconColor: "#10b981",
    trend: (d) => d.countTrend,
    trendLabel: "vs yesterday",
  },
  {
    title: "Polishing Consumables",
    value: (d) => d.polishingConsumables,
    icon: "sparkle",
    accent: "#ec4899",
    iconBg: "#fdf2f8",
    iconColor: "#ec4899",
  },
];

function TrendBadge({ value, label }: { value: number; label: string }) {
  const up = value > 0;
  const neutral = value === 0;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md"
      style={{
        background: neutral ? "#f3f4f6" : up ? "#f0fdf4" : "#fef2f2",
        color: neutral ? "#6b7280" : up ? "#15803d" : "#dc2626",
        border: `1px solid ${neutral ? "#e5e7eb" : up ? "#bbf7d0" : "#fecaca"}`,
      }}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {neutral ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 12H7" />
        ) : up ? (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        )}
      </svg>
      {up ? "+" : ""}{value} {label}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden animate-pulse">
      <div className="h-1 bg-gray-200 w-full" />
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <div className="h-3 bg-gray-200 rounded w-24" />
            <div className="h-8 bg-gray-200 rounded w-16 mt-3" />
          </div>
          <div className="w-10 h-10 rounded-xl bg-gray-100" />
        </div>
      </div>
    </div>
  );
}

export default function KPICards() {
  const [data, setData] = useState<KPIData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/consumables/kpi")
      .then(jsonOrThrow)
      .then(setData)
      .catch((e) => { console.error(e); setLoadError(e instanceof Error && e.message ? e.message : "Could not load."); });
  }, []);

  if (!data) {
    if (loadError) return <p className="text-xs text-red-600">{loadError}</p>;
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {CARDS.map((c) => <SkeletonCard key={c.title} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {CARDS.map((card) => {
        const val = card.value(data);
        const trend = card.trend ? card.trend(data) : null;
        const isAlert = card.alert ? card.alert(data) : false;

        return (
          <div
            key={card.title}
            className={`rounded-2xl border bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${isAlert ? "border-red-200 ring-1 ring-red-100" : "border-gray-200/80"}`}
          >
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                {/* Left: label + value + trend */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium uppercase tracking-wide text-gray-400">
                    {card.title}
                  </p>
                  <p className={`mt-1.5 text-3xl font-semibold tracking-tight tabular-nums ${isAlert ? "text-red-600" : "text-gray-900"}`}>
                    {val}
                  </p>
                  {trend !== null && card.trendLabel && (
                    <div className="mt-2">
                      <TrendBadge value={trend} label={card.trendLabel} />
                    </div>
                  )}
                  {isAlert && (
                    <p className="text-xs text-red-500 font-medium mt-1.5">
                      Needs attention
                    </p>
                  )}
                </div>

                {/* Right: icon */}
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isAlert ? "bg-red-50 text-red-500" : "bg-brand/10 text-brand"}`}>
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={ICONS[card.icon]} />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
