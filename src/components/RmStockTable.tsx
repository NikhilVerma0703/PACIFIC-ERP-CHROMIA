"use client";

import { Fragment, useMemo, useState } from "react";
import type { RmGroup } from "@/lib/rmStock";

const gradeRank = (g: string) => (g === "Premium" ? 0 : g === "Supreme" ? 1 : 2);
const sizeKey = (s: string) => { const m = s.match(/[\d.]+/); return m ? parseFloat(m[0]) : 9999; };
const fmtKg = (n: number) => n.toLocaleString("en-IN");

type SortKey = "type" | "size" | "grade" | "supplier" | "bags" | "kg" | "invoices";

export function RmStockTable({ groups, showType = false }: { groups: RmGroup[]; showType?: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("size");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const keyOf = (g: RmGroup) => `${g.type}|${g.size}|${g.grade}`;

  function toggleSort(k: SortKey) {
    if (sortKey === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setDir(k === "kg" || k === "bags" || k === "invoices" ? "desc" : "asc"); }
  }
  function toggleOpen(k: string) {
    setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }

  const rows = useMemo(() => {
    const val = (g: RmGroup): number | string => {
      switch (sortKey) {
        case "type": return g.type ?? "";
        case "grade": return gradeRank(g.grade);
        case "supplier": return g.supplier.toLowerCase();
        case "bags": return g.bags;
        case "kg": return g.kg;
        case "invoices": return g.invoices.length;
        default: return sizeKey(g.size);
      }
    };
    return [...groups].sort((a, b) => {
      const av = val(a), bv = val(b);
      const c = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return dir === "asc" ? c : -c;
    });
  }, [groups, sortKey, dir]);

  const arrow = (k: SortKey) => (sortKey === k ? (dir === "asc" ? "↑" : "↓") : "");
  const th = (k: SortKey, label: string, right = false) => (
    <th className={`px-3 py-2 ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-600 ${sortKey === k ? "text-gray-600" : ""} ${right ? "flex-row-reverse" : ""}`}>
        <span>{label}</span><span className="text-[9px] leading-none">{arrow(k)}</span>
      </button>
    </th>
  );

  const colCount = showType ? 7 : 6;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
          <tr>
            {showType && th("type", "Type")}
            {th("size", "Size")}
            {th("grade", "Grade")}
            {th("supplier", "Supplier")}
            {th("bags", "Bags", true)}
            {th("kg", "Kg in store", true)}
            {th("invoices", "Invoices")}
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const k = keyOf(g);
            const isOpen = open.has(k);
            return (
              <Fragment key={k}>
                <tr className={`border-t border-gray-100 ${isOpen ? "bg-brand/[0.03]" : "hover:bg-gray-50/50"}`}>
                  {showType && <td className="px-3 py-2 text-gray-700">{g.type}</td>}
                  <td className="px-3 py-2 font-medium text-gray-900">{g.size}</td>
                  <td className="px-3 py-2 text-gray-700">{g.grade}</td>
                  <td className="px-3 py-2 text-gray-700"><span className="block max-w-[200px] truncate" title={g.supplier}>{g.supplier}</span></td>
                  <td className="px-3 py-2 text-right text-gray-700">{g.bags}</td>
                  <td className="px-3 py-2 text-right font-medium text-brand">{fmtKg(g.kg)}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => toggleOpen(k)} className="inline-flex items-center gap-1 text-gray-600 hover:text-brand">
                      <span className="text-[10px] leading-none">{isOpen ? "▾" : "▸"}</span>
                      <span>{g.invoices.length} invoice{g.invoices.length === 1 ? "" : "s"}</span>
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t border-brand/10 bg-brand/[0.02]">
                    <td colSpan={colCount} className="px-3 py-2">
                      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                        {g.invoices.map((i) => {
                          const range = i.minBag != null && i.maxBag != null ? (i.minBag === i.maxBag ? `#${i.minBag}` : `#${i.minBag}–${i.maxBag}`) : "";
                          return (
                            <div key={i.invNo} className="flex items-baseline justify-between gap-2 text-[11px] text-gray-500">
                              <span className="truncate">inv <span className="font-medium text-gray-700">{i.invNo}</span>{range && <span className="ml-1">{range}</span>}</span>
                              <span className="shrink-0">{i.bags} bag{i.bags === 1 ? "" : "s"}</span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
