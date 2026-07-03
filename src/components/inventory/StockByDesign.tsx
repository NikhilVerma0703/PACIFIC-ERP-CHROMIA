"use client";
// Stock summary in the physical register's layout: design header row, then one
// row per thickness+batch with bay-wise stock, grade split, dispatched and
// pending polish / R&W. All trial designs live under one "Trials" group.
import { Fragment, useEffect, useMemo, useState } from "react";

interface Row {
  design: string; thickness: string; batch: string; total: number; dispatched: number;
  bay5: number; bay4: number; bay3: number; nobay: number;
  a: number; a2: number; b: number; c: number; cts: number; printing: number;
  trial: number; ungraded: number; pending_polish: number; pending_rw: number;
}
const NUMS = ["total","dispatched","bay5","bay4","bay3","nobay","a","a2","b","c","cts","printing","trial","ungraded","pending_polish","pending_rw"] as const;
type Agg = Record<(typeof NUMS)[number], number>;
const isTrialName = (d: string) => /(trial|trail)/i.test(d);

function sumRows(rows: Row[]): Agg {
  const out = Object.fromEntries(NUMS.map((k) => [k, 0])) as Agg;
  for (const r of rows) for (const k of NUMS) out[k] += r[k];
  return out;
}

function Cells({ v }: { v: Agg }) {
  const cell = (n: number, cls = "") => (
    <td className={`px-2 py-1.5 text-right tabular-nums ${n ? cls : "text-gray-300"}`}>{n || "-"}</td>
  );
  return (
    <>
      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{v.total.toLocaleString("en-IN")}</td>
      {cell(v.dispatched, "text-gray-500")}
      {cell(v.bay5)}{cell(v.bay4)}{cell(v.bay3)}{cell(v.nobay, "text-gray-500")}
      {cell(v.a)}{cell(v.a2)}{cell(v.b)}{cell(v.c)}{cell(v.cts)}{cell(v.printing)}
      {cell(v.trial, "text-gray-500")}{cell(v.ungraded, "text-gray-500")}
      {cell(v.pending_polish, "font-medium text-red-600")}
      {cell(v.pending_rw, "font-medium text-red-600")}
    </>
  );
}

export function StockByDesign() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/inventory/summary")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const byDesign = new Map<string, Row[]>();
    for (const r of rows) {
      if (term && !r.design.toLowerCase().includes(term)) continue;
      const list = byDesign.get(r.design) ?? [];
      if (!list.length) byDesign.set(r.design, list);
      list.push(r);
    }
    const normal: { name: string; rows: Row[]; agg: Agg; trial: boolean }[] = [];
    const trialRows: Row[] = [];
    for (const [design, list] of byDesign) {
      const agg = sumRows(list);
      const allTrial = agg.trial > 0 && agg.trial >= agg.total + agg.dispatched;
      if (isTrialName(design) || allTrial) {
        for (const r of list) trialRows.push({ ...r, batch: `${design} - ${r.batch}` });
      } else {
        normal.push({ name: design, rows: list, agg, trial: false });
      }
    }
    normal.sort((x, y) => x.name.localeCompare(y.name));
    if (trialRows.length) normal.push({ name: "Trials", rows: trialRows, agg: sumRows(trialRows), trial: true });
    return normal;
  }, [rows, q]);

  const toggle = (k: string) => setClosed((s) => { const c = new Set(s); if (c.has(k)) c.delete(k); else c.add(k); return c; });
  const sortRows = (list: Row[]) =>
    [...list].sort((x, y) => x.thickness.localeCompare(y.thickness) || x.batch.localeCompare(y.batch, undefined, { numeric: true }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <input className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" placeholder="Filter colour / design..." value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="text-xs text-gray-400">Register view - a row per thickness &amp; batch - bay-wise stock on hand - all trial designs under &quot;Trials&quot; - click a design name to collapse.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-3 py-2">Thick</th><th className="px-3 py-2">Batch</th>
              <th className="px-2 py-2 text-right">Slabs</th><th className="px-2 py-2 text-right">Disp.</th>
              <th className="px-2 py-2 text-right">Bay 5</th><th className="px-2 py-2 text-right">Bay 4</th>
              <th className="px-2 py-2 text-right">Bay 3</th><th className="px-2 py-2 text-right">Other</th>
              <th className="px-2 py-2 text-right">A</th><th className="px-2 py-2 text-right">A2</th>
              <th className="px-2 py-2 text-right">B</th><th className="px-2 py-2 text-right">C</th>
              <th className="px-2 py-2 text-right">CTS</th><th className="px-2 py-2 text-right">Print</th>
              <th className="px-2 py-2 text-right">Trial</th><th className="px-2 py-2 text-right">No gr.</th>
              <th className="px-2 py-2 text-right">Pend. Pol</th><th className="px-2 py-2 text-right">Pend. R/W</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={18} className="px-3 py-10 text-center text-gray-400">Loading...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={18} className="px-3 py-10 text-center text-gray-400">No stock matches.</td></tr>
            ) : groups.map(({ name, rows: list, agg }) => (
              <Fragment key={name}>
                <tr className="cursor-pointer border-t border-gray-200 bg-gray-50/80 hover:bg-gray-100/70" onClick={() => toggle(name)}>
                  <td colSpan={2} className="px-3 py-2 font-semibold text-gray-900">
                    <span className="mr-1.5 inline-block w-3 text-gray-400">{closed.has(name) ? "▸" : "▾"}</span>
                    {name}
                  </td>
                  <Cells v={agg} />
                </tr>
                {!closed.has(name) && sortRows(list).map((r) => (
                  <tr key={`${name}|${r.design}|${r.thickness}|${r.batch}`} className="border-t border-gray-50">
                    <td className="py-1.5 pl-8 pr-3 font-medium text-gray-700">{r.thickness}</td>
                    <td className="px-3 py-1.5 text-gray-600">{r.batch}</td>
                    <Cells v={r} />
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && <p className="text-xs text-gray-400">{groups.length.toLocaleString("en-IN")} design group(s) in stock.</p>}
    </div>
  );
}
