"use client";
import { useState } from "react";

export type HierarchyClient = {
  id: string;
  name: string;
  country: string;
  email: string | null;
};

export type HierarchySP = {
  id: string;
  name: string | null;
  email: string | null;
  clients: HierarchyClient[];
};

export type HierarchyManager = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  salesRole: string | null;
  sps: HierarchySP[];
};

export type UnassignedSP = {
  id: string;
  name: string | null;
  email: string | null;
  clients: HierarchyClient[];
};

export default function HierarchyTreeClient({
  managers,
  unassigned,
}: {
  managers: HierarchyManager[];
  unassigned: UnassignedSP[];
}) {
  const [openManagers, setOpenManagers] = useState<Set<string>>(new Set(managers.map(m => m.id)));
  const [openSPs, setOpenSPs]           = useState<Set<string>>(new Set());

  function toggleManager(id: string) {
    setOpenManagers(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleSP(id: string) {
    setOpenSPs(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <div className="space-y-3">
      {managers.length === 0 && unassigned.length === 0 && (
        <p className="text-sm text-slate-400">No hierarchy configured yet. Assign managers to SPs in the RM Assignment section above.</p>
      )}

      {managers.map(mgr => (
        <div key={mgr.id} className="border border-slate-200 rounded-xl overflow-hidden">
          {/* Manager row */}
          <button
            onClick={() => toggleManager(mgr.id)}
            className="w-full flex items-center gap-3 px-4 py-3 bg-slate-900 text-left hover:bg-slate-800 transition"
          >
            <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {(mgr.name ?? mgr.email ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{mgr.name ?? mgr.email}</p>
              <p className="text-[10px] text-slate-400">
                {mgr.salesRole ?? mgr.role} · {mgr.sps.length} SP{mgr.sps.length !== 1 ? "s" : ""}
              </p>
            </div>
            <span className={`text-slate-400 text-sm transition-transform ${openManagers.has(mgr.id) ? "rotate-90" : ""}`}>›</span>
          </button>

          {openManagers.has(mgr.id) && (
            <div className="divide-y divide-slate-100 bg-white">
              {mgr.sps.length === 0 && (
                <p className="px-6 py-3 text-xs text-slate-400">No SPs assigned to this manager.</p>
              )}
              {mgr.sps.map(sp => (
                <div key={sp.id}>
                  {/* SP row */}
                  <button
                    onClick={() => toggleSP(sp.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left transition"
                  >
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-[10px] font-bold shrink-0 ml-4">
                      {(sp.name ?? sp.email ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{sp.name ?? sp.email}</p>
                      <p className="text-[10px] text-slate-400">
                        SALESPERSON · {sp.clients.length} customer{sp.clients.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <span className={`text-slate-300 text-xs transition-transform ${openSPs.has(sp.id) ? "rotate-90" : ""}`}>›</span>
                  </button>

                  {openSPs.has(sp.id) && sp.clients.length > 0 && (
                    <div className="bg-slate-50 px-4 pb-3 pt-1">
                      <div className="ml-10 space-y-1">
                        {sp.clients.map(c => (
                          <div key={c.id} className="flex items-center gap-2 py-1 px-3 bg-white border border-slate-100 rounded-lg">
                            <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-[9px] font-bold shrink-0">
                              {c.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-700 truncate">{c.name}</p>
                              <p className="text-[10px] text-slate-400 truncate">{c.country}{c.email ? ` · ${c.email}` : ""}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {openSPs.has(sp.id) && sp.clients.length === 0 && (
                    <p className="ml-14 py-2 text-xs text-slate-400">No customers yet.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Unassigned SPs */}
      {unassigned.length > 0 && (
        <div className="border border-amber-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50">
            <span className="text-amber-600 text-sm">⚠</span>
            <div>
              <p className="text-sm font-semibold text-amber-800">Unassigned SPs ({unassigned.length})</p>
              <p className="text-[10px] text-amber-600">These SPs have no manager assigned. Use RM Assignment to assign them.</p>
            </div>
          </div>
          <div className="divide-y divide-amber-100 bg-white">
            {unassigned.map(sp => (
              <div key={sp.id}>
                <button
                  onClick={() => toggleSP(sp.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50 text-left transition"
                >
                  <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-[10px] font-bold shrink-0">
                    {(sp.name ?? sp.email ?? "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-600 truncate">{sp.name ?? sp.email}</p>
                    <p className="text-[10px] text-slate-400">{sp.clients.length} customer{sp.clients.length !== 1 ? "s" : ""}</p>
                  </div>
                  <span className={`text-slate-300 text-xs transition-transform ${openSPs.has(sp.id) ? "rotate-90" : ""}`}>›</span>
                </button>
                {openSPs.has(sp.id) && sp.clients.map(c => (
                  <div key={c.id} className="flex items-center gap-2 py-1 px-3 ml-10 bg-slate-50 border-t border-slate-100">
                    <span className="text-xs text-slate-500 font-medium">{c.name}</span>
                    <span className="text-[10px] text-slate-400">· {c.country}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
