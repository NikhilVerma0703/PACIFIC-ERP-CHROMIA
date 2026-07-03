"use client";
// Stock summary view: design (colour) -> thickness -> batch, with grade split
// and pending polish / R&W. Data from /api/inventory/summary (stock on hand).
import { Fragment, useEffect, useMemo, useState } from "react";

interface Row {
  design: string; thickness: string; batch: string; total: number;
  a: number; a2: number; b: number; c: number; cts: number; printing: number;
  trial: number; ungraded: number; pending_polish: number; pending_rw: number;
}
const NUMS = ["total","a","a2","b","c","cts","printing","trial","ungraded","pending_polish","pending_rw"] as const;
type Agg = Record<(typeof NUMS)[number], number>;

function sumRows(rows: Row[]): Agg {
  const out = Object.fromEntries(NUMS.map((k) => [k, 0])) as Agg;
  for (const r of rows) for (const k of NUMS) out[k] += r[k];
  return out;
}

export function StockByDesign() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/inventory/summary")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const designs = useMemo(() => {
    const term = q.trim().toLowerCase();
    const byDesign = new Map<string, Row[]>();
    for (const r of rows) {
      if (term && !r.design.toLowerCase().includes(term)) continue;
      const list = byDesign.get(r.design) ?? [];
      if (!list.length) byDesign.set(r.design, list);
      list.push(r);
    }
    return [...byDesign.entries()]
      .map(([design, list]) => ({ design, list, agg: sumRows(list) }))
      .sort((x, y) => y.agg.total - x.agg.total);
  }, [rows, q]);

  const toggle = (k: string) => setOpen((s) => { const c = new Set(s); if (c.has(k)) c.delete(k); else c.add(k); return c; });
  const inputCls = "w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  const Cells = ({ v }: { v: Agg }) => (
    <>
      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{v.total.toLocaleString("en-IN")}</td>
      {(["a","a2","b","c","cts","printing","trial"] as const).map((k) => (
        <td key={k} className={`px-2 py-1.5 text-right tabular-nums ${v[k] ? "" : "text-gray-300"}`}>{v[k] || "—"}</td>
      ))}
      <td className={`px-2 py-1.5 text-right tabular-nums ${v.ungraded ? "text-gray-500" : "text-gray-300"}`}>{v.ungraded || "—"}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${v.pending_polish ? "font-medium text-red-600" : "text-gray-300"}`}>{v.pending_polish || "—"}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${v.pending_rw ? "font-medium text-red-600" : "text-gray-300"}`}>{v.pending_rw || "—"}</td>
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <input className={inputCls} placeholder="Filter colour / design…" value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="text-xs text-gray-400">Stock on hand (dispatched excluded) · click a design for thicknesses, a thickness for batches.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-3 py-2">Design / Thickness / Batch</th>
              <th className="px-2 py-2 text-right">Slabs</th>
              <th className="px-2 py-2 text-right">A</th><th className="px-2 py-2 text-right">A2</th>
              <th className="px-2 py-2 text-right">B</th><th className="px-2 py-2 text-right">C</th>
              <th className="px-2 py-2 text-right">CTS</th><th className="px-2 py-2 text-right">Print</th>
              <th className="px-2 py-2 text-right">Trial</th><th className="px-2 py-2 text-right">No grade</th>
              <th className="px-2 py-2 text-right">Pend. Polish</th><th className="px-2 py-2 text-right">Pend. R/W</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="px-3 py-10 text-center text-gray-400">Loading…</td></tr>
            ) : designs.length === 0 ? (
              <tr><td colSpan={12} className="px-3 py-10 text-center text-gray-400">No stock matches.</td></tr>
            ) : designs.map(({ design, list, agg }) => {
              const dKey = `d:${design}`;
              const byThick = new Map<string, Row[]>();
              for (const r of list) {
                const tl = byThick.get(r.thickness) ?? [];
                if (!tl.length) byThick.set(r.thickness, tl);
                tl.push(r);
              }
              return (
                <Fragment key={design}>
                  <tr className="cursor-pointer border-t border-gray-100 bg-gray-50/60 hover:bg-gray-100/60" onClick={() => toggle(dKey)}>
                    <td className="px-3 py-1.5 font-semibold text-gray-900"><span className="mr-1.5 inline-block w-3 text-gray-400">{open.has(dKey) ? "▾" : "▸"}</span>{design}</td>
                    <Cells v={agg} />
                  </tr>
                  {open.has(dKey) && [...byThick.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([thickness, tlist]) => {
                    const tKey = ["t", design, thickness].join("\u0000");
                    return (
                      <Fragment key={tKey}>
                        <tr className="cursor-pointer border-t border-gray-50 hover:bg-gray-50/50" onClick={() => toggle(tKey)}>
                          <td className="py-1.5 pl-10 pr-3 font-medium text-gray-700"><span className="mr-1.5 inline-block w-3 text-gray-400">{open.has(tKey) ? "▾" : "▸"}</span>{thickness}</td>
                          <Cells v={sumRows(tlist)} />
                        </tr>
                        {open.has(tKey) && [...tlist].sort((x, y) => x.batch.localeCompare(y.batch, undefined, { numeric: true })).map((r) => (
                          <tr key={`${tKey}:${r.batch}`} className="border-t border-gray-50">
                            <td className="py-1.5 pl-16 pr-3 text-gray-500">Batch {r.batch}</td>
                            <Cells v={r} />
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!loading && <p className="text-xs text-gray-400">{designs.length.toLocaleString("en-IN")} design(s) in stock.</p>}
    </div>
  );
}
