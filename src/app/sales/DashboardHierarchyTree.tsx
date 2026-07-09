"use client";
import { useState } from "react";

type Client = { id: string; name: string; country: string };
type SpNode = {
  id: string; name: string; email: string;
  orderCount: number; piCount: number;
  clients: Client[];
};
type ManagerNode = {
  id: string; name: string; email: string; role: string;
  orderCount: number; piCount: number;
  sps: SpNode[];
};

type Props = {
  hierarchy: {
    managers: ManagerNode[];
    unassigned: SpNode[];
  };
};

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    REPORTING_MANAGER: "bg-violet-100 text-violet-700",
    SALES_ADMIN: "bg-amber-100 text-amber-700",
    ADMIN: "bg-rose-100 text-rose-700",
    SALESPERSON: "bg-blue-100 text-blue-700",
  };
  const label: Record<string, string> = {
    REPORTING_MANAGER: "RM",
    SALES_ADMIN: "Sales Admin",
    ADMIN: "Admin",
    SALESPERSON: "SP",
  };
  return (
    <span className={"text-[10px] font-semibold px-1.5 py-0.5 rounded-full " + (map[role] ?? "bg-slate-100 text-slate-500")}>
      {label[role] ?? role}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="flex flex-col items-center">
      <span className={"text-sm font-bold " + color}>{value}</span>
      <span className="text-[10px] text-slate-400">{label}</span>
    </span>
  );
}

function SPRow({ sp, depth = 1 }: { sp: SpNode; depth?: number }) {
  const [open, setOpen] = useState(false);
  const indent = depth === 1 ? "ml-6" : "ml-12";
  return (
    <div className={indent}>
      <div
        className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-slate-50 cursor-pointer transition group"
        onClick={() => sp.clients.length > 0 && setOpen(o => !o)}
      >
        {/* connector line */}
        <div className="flex flex-col items-center self-stretch mr-1">
          <div className="w-px flex-1 bg-slate-200" />
        </div>
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs shrink-0">
          {(sp.name || sp.email)?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">{sp.name || sp.email}</p>
          <p className="text-[11px] text-slate-400 truncate">{sp.email}</p>
        </div>
        <RoleBadge role="SALESPERSON" />
        <div className="flex gap-4 ml-4">
          <Stat label="Orders" value={sp.orderCount} color="text-blue-600" />
          <Stat label="PIs" value={sp.piCount} color="text-green-600" />
        </div>
        {sp.clients.length > 0 && (
          <span className="text-slate-300 text-xs ml-2 group-hover:text-slate-400 transition">
            {open ? "▲" : "▼"} {sp.clients.length} client{sp.clients.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {open && sp.clients.length > 0 && (
        <div className="ml-16 border-l border-slate-100 pl-3 mb-1">
          {sp.clients.map(c => (
            <div key={c.id} className="flex items-center gap-2 py-1 px-2">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
              <span className="text-xs text-slate-600 font-medium">{c.name}</span>
              <span className="text-[10px] text-slate-400">{c.country}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ManagerBlock({ mgr }: { mgr: ManagerNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-slate-100 rounded-2xl overflow-hidden">
      {/* Manager header */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 cursor-pointer transition"
        onClick={() => setOpen(o => !o)}
      >
        <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-sm shrink-0">
          {(mgr.name || mgr.email)?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{mgr.name || mgr.email}</p>
          <p className="text-[11px] text-slate-400 truncate">{mgr.email}</p>
        </div>
        <RoleBadge role={mgr.role} />
        <div className="flex gap-4 ml-4">
          <Stat label="Own Orders" value={mgr.orderCount} color="text-violet-600" />
          <Stat label="Own PIs" value={mgr.piCount} color="text-violet-600" />
        </div>
        <div className="flex gap-4 ml-4">
          <Stat label="Team Orders" value={mgr.sps.reduce((s, sp) => s + sp.orderCount, 0)} color="text-blue-600" />
          <Stat label="Team PIs" value={mgr.sps.reduce((s, sp) => s + sp.piCount, 0)} color="text-green-600" />
        </div>
        <span className="text-slate-400 text-xs ml-3">
          {open ? "▲" : "▼"} {mgr.sps.length} SP{mgr.sps.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* SP rows */}
      {open && (
        <div className="py-1">
          {mgr.sps.length === 0 ? (
            <p className="ml-8 py-3 text-xs text-slate-400 italic">No salespersons assigned</p>
          ) : (
            mgr.sps.map(sp => <SPRow key={sp.id} sp={sp} />)
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardHierarchyTree({ hierarchy }: Props) {
  return (
    <div className="space-y-3">
      {hierarchy.managers.map(mgr => (
        <ManagerBlock key={mgr.id} mgr={mgr} />
      ))}

      {hierarchy.unassigned.length > 0 && (
        <div className="border border-dashed border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Unassigned Salespersons ({hierarchy.unassigned.length})
            </p>
          </div>
          <div className="py-1">
            {hierarchy.unassigned.map(sp => <SPRow key={sp.id} sp={sp} />)}
          </div>
        </div>
      )}

      {hierarchy.managers.length === 0 && hierarchy.unassigned.length === 0 && (
        <p className="text-center text-slate-400 text-sm py-8">
          No team members found. Create users with Salesperson or Reporting Manager roles.
        </p>
      )}
    </div>
  );
}
