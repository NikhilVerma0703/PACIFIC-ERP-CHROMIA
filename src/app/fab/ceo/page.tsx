"use client";
import { useEffect, useState, useCallback } from "react";

const TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  CUTTING:      { label: "Cutting",      color: "#3b82f6", bg: "#eff6ff" },
  POLISHING:    { label: "Polishing",    color: "#8b5cf6", bg: "#f5f3ff" },
  SINK_CUTTING: { label: "Sink Cutting", color: "#f97316", bg: "#fff7ed" },
  FABRICATION:  { label: "Fabrication",  color: "#f43f5e", bg: "#fff1f2" },
  PACKAGING:    { label: "Packaging",    color: "#22c55e", bg: "#f0fdf4" },
};
const ALL_STAGES = ["CUTTING","POLISHING","SINK_CUTTING","FABRICATION","PACKAGING"];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
/** n days before/after a 'YYYY-MM-DD' key. UTC arithmetic, because the key is a
 *  label and a label has no 23- or 25-hour variant. Mirrors addDays() in
 *  src/lib/fab/stageSeries.ts, which the API uses on the same strings. */
function shiftDayStr(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,"0")}-${String(t.getUTCDate()).padStart(2,"0")}`;
}
/** 'Mon 18 Aug' from a day key. Formatted in UTC on purpose: the key is parsed
 *  as UTC midnight, so letting the browser's zone re-interpret it would print
 *  the day before for anyone west of Greenwich. */
function fmtDayLabel(key: string) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-GB",
    { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}
function fmtDuration(mins: number) {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
function mm2ToSqft(mm2: number) { return (mm2 / 92903).toFixed(2); }

interface MachineStat { machineId: string; name: string; type: string; code: string; isActive: boolean; isIdle: boolean; currentOperator: string | null; sessionId: string | null; piecesToday: number; pendingCount: number }
interface SlabWastage { slabId: string; slabCode: string; pacificQcId: string; projectCode: string; wastePct: number; pieceCount: number; slabAreaMm2: number; piecesAreaMm2: number }
interface MachineLeaderEntry { operatorId: string; operatorName: string; machineName: string | null; piecesDay: number; slabsDay: number; avgCutMinutes: number | null; fastestCutMinutes: number | null; slowestCutMinutes: number | null }
interface OperatorDay {
  operatorId: string; operatorName: string;
  sessions: Array<{ machineName: string; machineType: string; loginTime: string; logoutTime: string | null; isActive: boolean; durationMinutes: number }>;
  totalMinutes: number; piecesByType: Record<string, number>;
}
interface StageCounts { cutting: number; polishing: number; sinkCutting: number; fabrication: number; packaging: number; total: number }
interface StageDayRow extends StageCounts { date: string }
/** Date-wise, stage-wise completions. `rows` always covers every calendar day
 *  in [from, to] — a day nothing happened on is a row of zeros, not a gap.
 *  Null when the API could not build it; the panel says so rather than
 *  rendering blanks that would read as a quiet day. */
interface StageSeries { from: string; to: string; days: number; rows: StageDayRow[]; totals: StageCounts }

interface CeoData {
  activeSessions: Array<{ id: string; user: { name: string | null }; machine: { name: string; type: string; code: string }; shift: string; loginTime: string; durationMinutes: number }>;
  pieceFunnel: { total: number; pending: number; cut: number; polishing: number; sinkCutting: number; fabrication: number; packaged: number };
  projectProgress: Array<{ id: string; projectCode: string; customerName: string; status: string; total: number; packaged: number; cut: number; avgWastagePct: number | null; assignedSlabs: number }>;
  leaderboard: Array<{ operatorId: string; operatorName: string | null; machineType: string | null; machineName: string | null; piecesToday: number }>;
  machineLeaderboard: Record<string, MachineLeaderEntry[]>;
  machineStats: MachineStat[];
  pendingByType: Record<string, number>;
  cloSlabsPending: number;
  slabWastage: SlabWastage[];
  idleAlerts: Array<{ sessionId: string; operatorName: string; machineType: string; machineName: string; idleMinutes: number; hasPendingJobs: boolean; pendingCount: number; lastActivity: string }>;
  dailyThroughput: { cutting: number; polishing: number; sinkCutting: number; fabrication: number; packaging: number };
  stageSeries: StageSeries | null;
  operatorsToday: OperatorDay[];
}

/** The five stages as the breakdown prints them, sharing the tile colours the
 *  throughput strip already uses so the two panels read as one thing. */
const STAGE_COLS = [
  { key: "cutting"     as const, label: "Cut",    bar: "bg-blue-500",   text: "text-blue-600"   },
  { key: "polishing"   as const, label: "Polish", bar: "bg-purple-500", text: "text-purple-600" },
  { key: "sinkCutting" as const, label: "Sink",   bar: "bg-orange-500", text: "text-orange-600" },
  { key: "fabrication" as const, label: "Fab",    bar: "bg-rose-500",   text: "text-rose-600"   },
  { key: "packaging"   as const, label: "Pack",   bar: "bg-green-500",  text: "text-green-600"  },
];
const RANGE_CHOICES = [7, 14, 30];

/* ─────────────────────────────── Operator Modal ─────────────────────────── */
function OperatorModal({ op, machineLeaderboard, onClose }: {
  op: { operatorId: string; operatorName: string };
  machineLeaderboard: Record<string, MachineLeaderEntry[]>;
  onClose: () => void;
}) {
  const myStats = ALL_STAGES
    .map(type => {
      const entry = (machineLeaderboard[type] ?? []).find(e => e.operatorId === op.operatorId);
      return entry ? { type, ...entry } : null;
    })
    .filter(Boolean) as (MachineLeaderEntry & { type: string })[];

  const best = myStats.length > 1
    ? [...myStats].sort((a, b) => {
        if (a.type === "CUTTING" && b.type === "CUTTING") return (a.avgCutMinutes ?? 999) - (b.avgCutMinutes ?? 999);
        return b.piecesDay - a.piecesDay;
      })[0]
    : myStats[0] ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">{op.operatorName}</h3>
            {best && <p className="text-xs text-slate-400 mt-0.5">Best at: <span className="font-medium text-slate-600">{TYPE_META[best.type]?.label}</span></p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl font-bold leading-none">&times;</button>
        </div>
        <div className="px-6 py-4 space-y-3 max-h-96 overflow-y-auto">
          {myStats.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">No activity recorded</p>
          ) : myStats.map(s => {
            const meta = TYPE_META[s.type];
            return (
              <div key={s.type} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: meta.bg }}>
                <div className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: meta.color }}></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{meta.label}</p>
                  {s.machineName && <p className="text-xs text-slate-500">{s.machineName}</p>}
                  <div className="flex items-center gap-4 mt-1.5 text-xs">
                    {s.type === "CUTTING" && s.slabsDay > 0
                      ? <span className="font-semibold text-slate-700">{s.slabsDay} slab{s.slabsDay !== 1 ? "s" : ""} ({s.piecesDay} pcs)</span>
                      : <span className="font-semibold text-slate-700">{s.piecesDay} pcs</span>}
                    {s.avgCutMinutes !== null && <>
                      <span className="text-slate-400">avg {s.avgCutMinutes}m/slab</span>
                      {s.fastestCutMinutes !== null && <span className="text-green-600">fastest {s.fastestCutMinutes}m</span>}
                      {s.slowestCutMinutes !== null && <span className="text-red-500">slowest {s.slowestCutMinutes}m</span>}
                    </>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Machine Leaderboard ────────────────────── */
function MachineLeaderboard({ machineLeaderboard, onSelectOperator }: {
  machineLeaderboard: Record<string, MachineLeaderEntry[]>;
  onSelectOperator: (op: { operatorId: string; operatorName: string }) => void;
}) {
  const types = ALL_STAGES.filter(t => (machineLeaderboard[t]?.length ?? 0) > 0);
  const [activeType, setActiveType] = useState<string>(types[0] ?? "CUTTING");

  useEffect(() => {
    if (!types.includes(activeType) && types.length > 0) setActiveType(types[0]);
  }, [types.join(",")]);

  if (types.length === 0) return <p className="text-sm text-slate-400 text-center py-8">No completed operations</p>;
  const rows = machineLeaderboard[activeType] ?? [];
  const isCutting = activeType === "CUTTING";
  const medals = ["#f59e0b","#94a3b8","#cd7f32"];

  return (
    <div>
      <div className="flex gap-1 flex-wrap mb-4">
        {types.map(t => {
          const meta = TYPE_META[t];
          return (
            <button key={t} onClick={() => setActiveType(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${activeType === t ? "text-white" : "text-slate-500 bg-slate-100 hover:bg-slate-200"}`}
              style={activeType === t ? { background: meta.color } : {}}>
              {meta.label}
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {rows.map((op, i) => (
          <button key={op.operatorId} onClick={() => onSelectOperator(op)}
            className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition hover:bg-slate-50 border ${i === 0 ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-white"}`}>
            <span className="text-sm font-bold w-6 text-center flex-shrink-0" style={{ color: medals[i] ?? "#64748b" }}>{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{op.operatorName}</p>
              {op.machineName && <p className="text-xs text-slate-400 truncate">{op.machineName}</p>}
            </div>
            <div className="flex items-center gap-3 text-xs flex-shrink-0">
              {isCutting && op.slabsDay > 0
                ? <span className="font-bold text-slate-700">{op.slabsDay} slabs</span>
                : <span className="font-bold text-slate-700">{op.piecesDay} pcs</span>}
              {op.avgCutMinutes !== null && <span className="text-slate-400">{op.avgCutMinutes}m/slab</span>}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-3 text-center">Tap an operator to see performance across machines</p>
    </div>
  );
}

/* ─────────────────────────────── Stage Card (for flow diagram) ──────────── */
function StageCard({ type, machineStats, pendingByType, cloSlabsPending }: {
  type: string;
  machineStats: MachineStat[];
  pendingByType: Record<string, number>;
  cloSlabsPending: number;
}) {
  const meta     = TYPE_META[type];
  const machines = machineStats.filter(m => m.type === type);
  const pending  = pendingByType[type] ?? 0;
  const active   = machines.filter(m => m.isActive).length;
  const pendingLabel = type === "CUTTING" && cloSlabsPending > 0
    ? `${cloSlabsPending} slab${cloSlabsPending !== 1 ? "s" : ""} (${pending} pcs)`
    : `${pending} pcs`;

  return (
    <div className="w-48 flex-shrink-0">
      <div className="rounded-t-xl px-3 py-2.5 border border-b-0" style={{ background: meta.bg, borderColor: `${meta.color}40` }}>
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }}></span>
          <span className="text-sm font-bold text-slate-800">{meta.label}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span style={{ color: meta.color }} className="font-semibold">{active} active</span>
          <span>{pendingLabel} pending</span>
        </div>
      </div>
      <div className="border border-t-0 rounded-b-xl overflow-hidden divide-y divide-slate-100" style={{ borderColor: `${meta.color}40` }}>
        {machines.length === 0 ? (
          <div className="px-4 py-4 text-xs text-slate-400 text-center bg-white">No machines</div>
        ) : machines.map(m => (
          <div key={m.machineId} className={`px-3 py-2.5 bg-white ${m.isIdle ? "bg-red-50" : ""}`}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-semibold text-slate-700 truncate">{m.name}</span>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ml-1 ${m.isActive && !m.isIdle ? "bg-emerald-500" : m.isIdle ? "bg-red-400 animate-pulse" : "bg-slate-300"}`}></span>
            </div>
            {m.currentOperator
              ? <p className="text-[11px] text-slate-600 truncate">{m.currentOperator}{m.isIdle ? " (idle)" : ""}</p>
              : <p className="text-[10px] text-slate-400">Unoccupied</p>}
            <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
              <span>{m.piecesToday} done</span>
              <span>{m.pendingCount} pending</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────── Main Dashboard ─────────────────────────── */
export default function CeoDashboard() {
  const [data,        setData]        = useState<CeoData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error,       setError]       = useState("");
  const [tab,           setTab]           = useState<"overview"|"flow"|"slabs"|"operators">("overview");
  const [dateFilter,    setDateFilter]    = useState(todayStr());
  // Two working weeks ending on the selected date — see DEFAULT_RANGE_DAYS in
  // src/lib/fab/stageSeries.ts for why. Only the new breakdown reads this;
  // every other block on the page stays on dateFilter alone.
  const [rangeDays,     setRangeDays]     = useState(14);
  const [selectedOp,    setSelectedOp]    = useState<{ operatorId: string; operatorName: string } | null>(null);
  // RETIRED 2026-08 with the cascade-fix panel: nothing else on this page reads
  // fixingCascade or fixResult.
//   const [fixingCascade, setFixingCascade] = useState(false);
//   const [fixResult,     setFixResult]     = useState<string | null>(null);

  const load = useCallback(async (date: string, days: number) => {
    try {
      // date= is unchanged and still drives everything else on this page;
      // from=/to= only widen the date-wise breakdown, and the window ends on
      // the selected date so its last row matches the throughput strip.
      const from = shiftDayStr(date, -(days - 1));
      const res = await fetch(`/api/fab/ceo?date=${date}&from=${from}&to=${date}`);
      if (!res.ok) { setError("Failed to load"); return; }
      setData(await res.json());
      setLastRefresh(new Date());
      setError("");
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load(dateFilter, rangeDays);
    const t = setInterval(() => load(dateFilter, rangeDays), 30000);
    return () => clearInterval(t);
  }, [load, dateFilter, rangeDays]);

  // RETIRED 2026-08 with POST /api/fab/admin/fix-cascade -- see the panel below.
//   async function runCascadeFix() {
//     setFixingCascade(true);
//     setFixResult(null);
//     try {
//       const res = await fetch("/api/fab/admin/fix-cascade", { method: "POST" });
//       const json = await res.json();
//       if (res.ok) {
//         const created = json.piecesCreated ?? 0;
//         const unstuck = json.piecesFixed ?? 0;
//         const jobs    = json.jobsFixed ?? 0;
//         if (created + unstuck === 0) {
//           setFixResult("All up to date — nothing to fix");
//         } else {
//           setFixResult(`Fixed ${jobs} job(s): created ${created} piece(s), unstuck ${unstuck} piece(s)`);
//         }
//         load(dateFilter);
//       } else {
//         setFixResult(json.error ?? "Fix failed");
//       }
//     } catch {
//       setFixResult("Network error");
//     } finally {
//       setFixingCascade(false);
//     }
//   }

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading dashboard…</div>;
  if (error)   return <div className="flex items-center justify-center h-64 text-red-400 text-sm">{error}</div>;
  if (!data)   return null;

  const { activeSessions, pieceFunnel, projectProgress, machineLeaderboard, machineStats, pendingByType, cloSlabsPending, slabWastage, idleAlerts, dailyThroughput, stageSeries, operatorsToday } = data;
  const isToday = dateFilter === todayStr();
  // Busiest day in the range, so every bar below is drawn to the same scale.
  // Hoisted out of the row loop: the range can be 92 days.
  const stagePeak = stageSeries ? Math.max(1, ...stageSeries.rows.map(r => r.total)) : 1;

  const funnelSteps = [
    { label: "Pending",     count: pieceFunnel.pending,     color: "#94a3b8" },
    { label: "Cut",         count: pieceFunnel.cut,         color: "#3b82f6" },
    { label: "Polishing",   count: pieceFunnel.polishing,   color: "#8b5cf6" },
    { label: "Sink Cut",    count: pieceFunnel.sinkCutting, color: "#f97316" },
    { label: "Fabrication", count: pieceFunnel.fabrication, color: "#f43f5e" },
    { label: "Packaged",    count: pieceFunnel.packaged,    color: "#22c55e" },
  ];

  return (
    <div className="space-y-5">
      {selectedOp && (
        <OperatorModal op={selectedOp} machineLeaderboard={machineLeaderboard} onClose={() => setSelectedOp(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Operations Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : "Loading…"} &middot; auto-refreshes 30s
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200" />
          {/* Range for the date-wise breakdown only. Everything else on this
              page still shows the single day picked above. */}
          <select value={rangeDays} onChange={e => setRangeDays(Number(e.target.value))}
            title="Range for the date-wise breakdown"
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200">
            {RANGE_CHOICES.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <button onClick={() => load(dateFilter, rangeDays)}
            className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg px-3 py-2 transition">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {(["overview","flow","operators","slabs"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {t === "overview" ? "Overview" : t === "flow" ? "Live Flow" : t === "operators" ? `Operators${operatorsToday.length > 0 ? ` (${operatorsToday.length})` : ""}` : "Slab Wastage"}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === "overview" && (
        <div className="space-y-5">
          {isToday && idleAlerts.length > 0 && (
            <div className="space-y-2">
              {idleAlerts.map(alert => {
                const meta = TYPE_META[alert.machineType];
                return (
                  <div key={alert.sessionId}
                    className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${alert.hasPendingJobs ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm flex-shrink-0 mt-0.5 ${alert.hasPendingJobs ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>!</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold ${alert.hasPendingJobs ? "text-red-800" : "text-amber-800"}`}>
                        {alert.operatorName} idle {alert.idleMinutes}m
                        {alert.hasPendingJobs ? ` — ${alert.pendingCount} piece${alert.pendingCount !== 1 ? "s" : ""} waiting` : " — queue empty"}
                      </p>
                      <p className={`text-xs mt-0.5 ${alert.hasPendingJobs ? "text-red-600" : "text-amber-600"}`}>
                        {alert.machineName} &middot; {meta?.label ?? alert.machineType}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Active Operators", value: activeSessions.length,                    color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-100" },
              { label: "Total Pieces",     value: pieceFunnel.total,                        color: "text-slate-700",   bg: "bg-white border-slate-100" },
              { label: "In Production",    value: pieceFunnel.cut + pieceFunnel.polishing + pieceFunnel.sinkCutting + pieceFunnel.fabrication, color: "text-blue-600", bg: "bg-blue-50 border-blue-100" },
              { label: "Packaged",         value: pieceFunnel.packaged,                     color: "text-green-600",   bg: "bg-green-50 border-green-100" },
            ].map(s => (
              <div key={s.label} className={`rounded-xl border p-4 ${s.bg}`}>
                <p className="text-xs font-medium text-slate-500">{s.label}</p>
                <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {isToday && activeSessions.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-slate-900">Active Floor</h2>
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                  {activeSessions.length} clocked in
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {activeSessions.map(s => {
                  const meta   = TYPE_META[s.machine.type];
                  const isIdle = idleAlerts.some(a => a.sessionId === s.id);
                  return (
                    <div key={s.id} className={`flex items-center gap-3 p-3 rounded-xl border ${isIdle ? "border-red-200 bg-red-50" : "border-slate-100 bg-slate-50"}`}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: meta?.bg ?? "#f8fafc" }}>
                        <span className="w-3 h-3 rounded-full" style={{ background: meta?.color ?? "#94a3b8" }}></span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-slate-900 truncate">{s.user.name ?? "Operator"}</p>
                          {isIdle && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">Idle</span>}
                        </div>
                        <p className="text-xs text-slate-500 truncate">{s.machine.name} &middot; {s.shift}</p>
                      </div>
                      <p className="text-xs font-medium text-slate-400 flex-shrink-0">{fmtDuration(s.durationMinutes)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-slate-100 p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-1">Production Funnel</h2>
              <p className="text-xs text-slate-400 mb-4">Current state of all pieces</p>
              <div className="space-y-2.5">
                {funnelSteps.map(step => {
                  const pct = pieceFunnel.total > 0 ? Math.round((step.count / pieceFunnel.total) * 100) : 0;
                  return (
                    <div key={step.label} className="flex items-center gap-3">
                      <div className="w-20 text-xs text-slate-500 text-right flex-shrink-0">{step.label}</div>
                      <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                        <div className="h-full rounded-full flex items-center pl-2 text-xs text-white font-medium"
                          style={{ width: `${Math.max(pct, 4)}%`, background: step.color }}>
                          {pct > 8 ? step.count : ""}
                        </div>
                      </div>
                      <div className="w-14 text-xs font-semibold text-slate-700 flex-shrink-0">
                        {step.count} <span className="text-slate-400 font-normal">({pct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Daily throughput strip */}
              <div className="mt-5 pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 mb-2.5">
                  {isToday ? "Today's throughput" : `${dateFilter} throughput`}
                </p>
                <div className="grid grid-cols-5 gap-1.5">
                  {[
                    { label: "Cut",    count: dailyThroughput?.cutting     ?? 0, color: "bg-blue-500"   },
                    { label: "Polish", count: dailyThroughput?.polishing    ?? 0, color: "bg-purple-500" },
                    { label: "Sink",   count: dailyThroughput?.sinkCutting  ?? 0, color: "bg-orange-500" },
                    { label: "Fab",    count: dailyThroughput?.fabrication  ?? 0, color: "bg-rose-500"   },
                    { label: "Pack",   count: dailyThroughput?.packaging    ?? 0, color: "bg-green-500"  },
                  ].map(s => (
                    <div key={s.label} className="text-center">
                      <div className={`text-white text-sm font-bold rounded-lg py-2 ${s.color} ${s.count === 0 ? "opacity-30" : ""}`}>
                        {s.count}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* RETIRED 2026-08: the "Fix Now" cascade-fix panel (it was preceded by
                  a {/ * Fix stuck pieces * /} label comment, spelled out here because a
                  real one would close this comment). It called
                  POST /api/fab/admin/fix-cascade, which existed only to repair the damage
                  caused by two competing piece-creation paths; the second path went with
                  the CLO round-trip, so there is nothing left to repair.

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-400">Pieces stuck in Pending after cutting? Run cascade fix.</p>
                <button onClick={runCascadeFix} disabled={fixingCascade}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50 flex-shrink-0">
                  {fixingCascade ? "Fixing…" : "🔧 Fix Now"}
                </button>
              </div>
              {fixResult && (
                <p className="text-xs text-emerald-600 mt-1 font-medium">{fixResult}</p>
              )}
              */}
            </div>

            <div className="bg-white rounded-xl border border-slate-100 p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-1">
                {isToday ? "Leaderboard" : `Leaderboard — ${dateFilter}`}
              </h2>
              <MachineLeaderboard machineLeaderboard={machineLeaderboard} onSelectOperator={setSelectedOp} />
            </div>
          </div>

          {/* ── Date-wise, stage-wise completions ──────────────────────────────
              The strip above is one day. This is the same five stages across
              the selected range, one row per day, with the range totals. Its
              last row is the day the strip shows, so the two agree on screen.
              A day nothing was completed on prints a row of zeros: the API
              fills every calendar day in the range, because a trend that drops
              its empty days closes ranks and reads as consecutive. */}
          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Completed by Day and Stage</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {stageSeries
                    ? `${fmtDayLabel(stageSeries.from)} to ${fmtDayLabel(stageSeries.to)} · ${stageSeries.days} days`
                    : "Pieces finished at each stage, per day"}
                </p>
              </div>
              {stageSeries && stageSeries.totals.total > 0 && (
                <div className="flex items-center gap-3 text-xs">
                  {STAGE_COLS.map(c => (
                    <span key={c.key} className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${c.bar}`}></span>
                      <span className="text-slate-500">{c.label}</span>
                      <span className="font-semibold text-slate-700">{stageSeries.totals[c.key]}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {!stageSeries ? (
              <p className="text-sm text-slate-400 text-center py-8">Breakdown unavailable — the rest of this page is unaffected.</p>
            ) : stageSeries.rows.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No days in range</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-400 border-b border-slate-100">
                      <th className="text-left font-medium pb-2 pl-1">Date</th>
                      {STAGE_COLS.map(c => <th key={c.key} className="text-right font-medium pb-2 w-16">{c.label}</th>)}
                      <th className="text-right font-medium pb-2 w-16">Total</th>
                      <th className="pb-2 pl-4 w-2/5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {stageSeries.rows.map(r => {
                      // Bar widths are relative to the busiest day in the
                      // range (stagePeak), drawn with plain divs — the same way
                      // the funnel and project bars on this page already are.
                      // No chart library is involved.
                      const quiet = r.total === 0;
                      return (
                        <tr key={r.date} className={quiet ? "bg-slate-50/50" : ""}>
                          <td className="py-1.5 pl-1 text-xs text-slate-600 whitespace-nowrap">{fmtDayLabel(r.date)}</td>
                          {STAGE_COLS.map(c => (
                            <td key={c.key} className={`py-1.5 text-right tabular-nums ${r[c.key] > 0 ? `font-medium ${c.text}` : "text-slate-300"}`}>
                              {r[c.key]}
                            </td>
                          ))}
                          <td className={`py-1.5 text-right font-bold tabular-nums ${quiet ? "text-slate-300" : "text-slate-800"}`}>{r.total}</td>
                          <td className="py-1.5 pl-4">
                            <div className="flex h-3 rounded-full overflow-hidden bg-slate-100" style={{ width: `${(r.total / stagePeak) * 100}%`, minWidth: r.total > 0 ? "2px" : "0" }}>
                              {STAGE_COLS.map(c => r[c.key] > 0 && (
                                <div key={c.key} className={c.bar} style={{ width: `${(r[c.key] / r.total) * 100}%` }}
                                  title={`${c.label} ${r[c.key]}`}></div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="pt-2 pl-1 text-xs">Total</td>
                      {STAGE_COLS.map(c => (
                        <td key={c.key} className="pt-2 text-right tabular-nums">{stageSeries.totals[c.key]}</td>
                      ))}
                      <td className="pt-2 text-right tabular-nums">{stageSeries.totals.total}</td>
                      <td className="pt-2 pl-4 text-xs font-normal text-slate-400">
                        {Math.round((stageSeries.totals.total / Math.max(1, stageSeries.days)) * 10) / 10} / day avg
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-4">Project Progress</h2>
            {projectProgress.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No active projects</p>
            ) : (
              <div className="space-y-3">
                {projectProgress.map(p => {
                  const pct    = p.total > 0 ? Math.round((p.packaged / p.total) * 100) : 0;
                  const cutPct = p.total > 0 ? Math.round((p.cut / p.total) * 100) : 0;
                  const STATUS_COLOR: Record<string, string> = { PLANNING: "bg-amber-400", ALLOCATED: "bg-blue-400", RELEASED_TO_PRODUCTION: "bg-emerald-400", COMPLETED: "bg-slate-400" };
                  return (
                    <div key={p.id} className="flex items-center gap-4">
                      <div className={`w-1 h-10 rounded-full flex-shrink-0 ${STATUS_COLOR[p.status] ?? "bg-slate-200"}`}></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <div>
                            <span className="text-sm font-semibold text-slate-900">{p.projectCode}</span>
                            <span className="text-xs text-slate-400 ml-2">{p.customerName}</span>
                            {p.assignedSlabs > 0 && <span className="text-xs text-slate-400 ml-2">&middot; {p.assignedSlabs} slabs</span>}
                          </div>
                          <div className="flex items-center gap-3">
                            {p.avgWastagePct !== null && (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.avgWastagePct > 20 ? "bg-red-100 text-red-700" : p.avgWastagePct > 10 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                                {p.avgWastagePct}% waste
                              </span>
                            )}
                            <span className="text-xs text-slate-500">{p.packaged}/{p.total}</span>
                          </div>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden relative">
                          <div className="absolute inset-y-0 left-0 bg-blue-200 rounded-full" style={{ width: `${cutPct}%` }}></div>
                          <div className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full" style={{ width: `${pct}%` }}></div>
                        </div>
                      </div>
                      <div className="text-sm font-bold text-slate-700 w-10 text-right flex-shrink-0">{pct}%</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LIVE FLOW TAB ── */}
      {tab === "flow" && (
        <div className="space-y-4">
          {/* Non-linear flow:
              CUTTING ──→ POLISHING    ──→ FABRICATION → PACKAGING
                      ╲→ SINK_CUTTING ──╱
          */}
          <div className="overflow-x-auto pb-2">
            <div className="inline-flex items-start gap-2">
              {/* CUTTING */}
              <StageCard type="CUTTING" machineStats={machineStats} pendingByType={pendingByType} cloSlabsPending={cloSlabsPending} />

              {/* Branch: splits to POLISHING (top) and SINK_CUTTING (bottom) */}
              <div className="flex-shrink-0 self-stretch flex items-center" style={{ width: 36 }}>
                <svg width="36" height="160" viewBox="0 0 36 160" fill="none">
                  <line x1="0" y1="50" x2="18" y2="50" stroke="#cbd5e1" strokeWidth="2"/>
                  <line x1="18" y1="50" x2="18" y2="110" stroke="#cbd5e1" strokeWidth="2"/>
                  <line x1="18" y1="50" x2="36" y2="50" stroke="#cbd5e1" strokeWidth="2"/>
                  <line x1="18" y1="110" x2="36" y2="110" stroke="#cbd5e1" strokeWidth="2"/>
                  <polygon points="30,46 36,50 30,54" fill="#cbd5e1"/>
                  <polygon points="30,106 36,110 30,114" fill="#cbd5e1"/>
                </svg>
              </div>

              {/* POLISHING + SINK_CUTTING stacked */}
              <div className="flex flex-col gap-3 flex-shrink-0">
                <StageCard type="POLISHING" machineStats={machineStats} pendingByType={pendingByType} cloSlabsPending={cloSlabsPending} />
                <StageCard type="SINK_CUTTING" machineStats={machineStats} pendingByType={pendingByType} cloSlabsPending={cloSlabsPending} />
              </div>

              {/* Merge: both converge to FABRICATION */}
              <div className="flex-shrink-0 self-stretch flex items-center" style={{ width: 36 }}>
                <svg width="36" height="160" viewBox="0 0 36 160" fill="none">
                  <line x1="0" y1="50" x2="18" y2="50" stroke="#cbd5e1" strokeWidth="2"/>
                  <line x1="18" y1="50" x2="18" y2="80" stroke="#cbd5e1" strokeWidth="2"/>
                  <line x1="0" y1="110" x2="18" y2="110" stroke="#cbd5e1" strokeWidth="2"/>
                  <line x1="18" y1="110" x2="18" y2="80" stroke="#cbd5e1" strokeWidth="2"/>
                  <line x1="18" y1="80" x2="36" y2="80" stroke="#cbd5e1" strokeWidth="2"/>
                  <polygon points="30,76 36,80 30,84" fill="#cbd5e1"/>
                </svg>
              </div>

              {/* FABRICATION */}
              <StageCard type="FABRICATION" machineStats={machineStats} pendingByType={pendingByType} cloSlabsPending={cloSlabsPending} />

              {/* Arrow to PACKAGING */}
              <div className="flex-shrink-0 self-start mt-10 flex items-center" style={{ width: 28 }}>
                <svg width="28" height="16" viewBox="0 0 28 16" fill="none">
                  <line x1="0" y1="8" x2="20" y2="8" stroke="#cbd5e1" strokeWidth="2"/>
                  <polygon points="14,4 22,8 14,12" fill="#cbd5e1"/>
                </svg>
              </div>

              {/* PACKAGING */}
              <StageCard type="PACKAGING" machineStats={machineStats} pendingByType={pendingByType} cloSlabsPending={cloSlabsPending} />
            </div>
          </div>

          {/* Stage summary counts */}
          <div className="grid grid-cols-5 gap-3">
            {ALL_STAGES.map(stageType => {
              const meta        = TYPE_META[stageType];
              const machines    = machineStats.filter(m => m.type === stageType);
              const piecesTotal = machines.reduce((s, m) => s + m.piecesToday, 0);
              return (
                <div key={stageType} className="bg-white rounded-xl border border-slate-100 p-3 text-center">
                  <div className="w-3 h-3 rounded-full mx-auto mb-1.5" style={{ background: meta.color }}></div>
                  <p className="text-xs text-slate-500 mb-1">{meta.label}</p>
                  <p className="text-xl font-bold text-slate-800">{piecesTotal}</p>
                  <p className="text-[10px] text-slate-400">pieces {isToday ? "today" : dateFilter}</p>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <h2 className="text-sm font-bold text-slate-900 mb-1">Machine Leaderboard</h2>
            <MachineLeaderboard machineLeaderboard={machineLeaderboard} onSelectOperator={setSelectedOp} />
          </div>
        </div>
      )}

      {/* ── OPERATORS TAB ── */}
      {tab === "operators" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {isToday ? "Operators on Floor Today" : `Operators — ${dateFilter}`}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">{operatorsToday.length} operator{operatorsToday.length !== 1 ? "s" : ""} worked on this date</p>
            </div>
          </div>

          {operatorsToday.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-100 p-12 text-center">
              <p className="text-slate-400 text-sm">No operators logged any machine time on this date.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {operatorsToday.map(op => {
                const totalPieces = Object.values(op.piecesByType).reduce((s, v) => s + v, 0);
                const machineTypes = [...new Set(op.sessions.map(s => s.machineType))];
                return (
                  <div key={op.operatorId} className="bg-white rounded-xl border border-slate-100 p-5">
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-bold text-slate-600">
                            {op.operatorName.split(" ").map(n => n[0]).slice(0,2).join("").toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <button onClick={() => setSelectedOp({ operatorId: op.operatorId, operatorName: op.operatorName })}
                            className="text-sm font-bold text-slate-900 hover:text-blue-600 transition text-left">
                            {op.operatorName}
                          </button>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {machineTypes.map(t => {
                              const meta = TYPE_META[t];
                              return (
                                <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                                  style={{ background: meta?.bg ?? "#f1f5f9", color: meta?.color ?? "#64748b" }}>
                                  {meta?.label ?? t}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xl font-bold text-slate-900">{totalPieces}</p>
                        <p className="text-xs text-slate-400">pieces</p>
                      </div>
                    </div>

                    {/* Pieces by type */}
                    {Object.keys(op.piecesByType).length > 0 && (
                      <div className="flex flex-wrap gap-3 mb-4">
                        {Object.entries(op.piecesByType).map(([type, count]) => {
                          const meta = TYPE_META[type];
                          return (
                            <div key={type} className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5"
                              style={{ background: meta?.bg ?? "#f1f5f9" }}>
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta?.color ?? "#94a3b8" }}></span>
                              <span className="font-semibold" style={{ color: meta?.color ?? "#64748b" }}>{count}</span>
                              <span className="text-slate-500">{meta?.label ?? type}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Machine sessions */}
                    <div className="space-y-1.5">
                      {op.sessions.map((s, i) => {
                        const meta = TYPE_META[s.machineType];
                        return (
                          <div key={i} className="flex items-center gap-3 text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta?.color ?? "#94a3b8" }}></span>
                            <span className="font-medium text-slate-700 flex-shrink-0">{s.machineName}</span>
                            <span className="text-slate-400 flex-shrink-0">{meta?.label ?? s.machineType}</span>
                            <span className="flex-1"></span>
                            <span className="text-slate-500">
                              {new Date(s.loginTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              {" \u2192 "}
                              {s.isActive
                                ? <span className="text-emerald-600 font-medium">Active</span>
                                : s.logoutTime
                                  ? new Date(s.logoutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                  : "\u2014"}
                            </span>
                            <span className="font-semibold text-slate-700 flex-shrink-0">{fmtDuration(s.durationMinutes)}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="text-slate-500">Total time on floor</span>
                      <span className="font-bold text-slate-800">{fmtDuration(op.totalMinutes)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SLAB WASTAGE TAB ── */}
      {tab === "slabs" && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Assigned Slabs",   value: slabWastage.length,                                                   color: "text-slate-700",  bg: "bg-white border-slate-100" },
              { label: "Avg Wastage",       value: slabWastage.length > 0 ? `${Math.round(slabWastage.reduce((s,w)=>s+w.wastePct,0)/slabWastage.length*10)/10}%` : "\u2014", color: "text-amber-600", bg: "bg-amber-50 border-amber-100" },
              { label: "High Waste >20%",   value: slabWastage.filter(w => w.wastePct > 20).length,                     color: "text-red-600",    bg: "bg-red-50 border-red-100" },
              { label: "Total Pieces",      value: slabWastage.reduce((s,w) => s + w.pieceCount, 0),                    color: "text-blue-600",   bg: "bg-blue-50 border-blue-100" },
            ].map(s => (
              <div key={s.label} className={`rounded-xl border p-4 ${s.bg}`}>
                <p className="text-xs font-medium text-slate-500">{s.label}</p>
                <p className={`text-3xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Slab Breakdown</h2>
              <span className="text-xs text-slate-400">{slabWastage.length} slabs assigned</span>
            </div>
            {slabWastage.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-12">No slabs assigned yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-5 py-3">Slab</th>
                    <th className="text-left px-5 py-3">Project</th>
                    <th className="text-center px-5 py-3">Pcs</th>
                    <th className="text-right px-5 py-3">Slab Area</th>
                    <th className="text-right px-5 py-3">Used</th>
                    <th className="text-right px-5 py-3">Waste</th>
                    <th className="text-center px-5 py-3">Wastage %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {[...slabWastage].sort((a,b) => b.wastePct - a.wastePct).map(s => {
                    const wasteArea = s.slabAreaMm2 - s.piecesAreaMm2;
                    const bad = s.wastePct > 20, mid = s.wastePct > 10;
                    return (
                      <tr key={s.slabId} className="hover:bg-slate-50">
                        <td className="px-5 py-3 font-mono text-xs font-semibold text-slate-700">{s.slabCode}</td>
                        <td className="px-5 py-3 text-slate-600">{s.projectCode}</td>
                        <td className="px-5 py-3 text-center font-semibold text-slate-700">{s.pieceCount}</td>
                        <td className="px-5 py-3 text-right text-slate-500 font-mono text-xs">{mm2ToSqft(s.slabAreaMm2)} sqft</td>
                        <td className="px-5 py-3 text-right text-slate-500 font-mono text-xs">{mm2ToSqft(s.piecesAreaMm2)} sqft</td>
                        <td className="px-5 py-3 text-right text-slate-500 font-mono text-xs">{mm2ToSqft(wasteArea)} sqft</td>
                        <td className="px-5 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.min(s.wastePct,100)}%`, background: bad ? "#ef4444" : mid ? "#f59e0b" : "#22c55e" }}></div>
                            </div>
                            <span className={`text-xs font-bold min-w-[36px] ${bad ? "text-red-600" : mid ? "text-amber-600" : "text-green-600"}`}>{s.wastePct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
