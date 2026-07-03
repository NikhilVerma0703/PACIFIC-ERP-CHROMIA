"use client";
// Stock summary styled after the physical stock register: SL.NO + merged
// colour cell, a row per thickness+batch, full grid lines, yellow sticky
// header. Designs collapsed by default; all trial designs under "Trials".
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

const bcell = "border border-gray-300 px-2 py-1.5 text-center tabular-nums";

function Cells({ v }: { v: Agg }) {
  const cell = (n: number, cls = "") => (
    <td className={`${bcell} ${n ? cls : "text-gray-300"}`}>{n || "-"}</td>
  );
  return (
    <>
      <td className={`${bcell} font-semibold`}>{v.total || "-"}</td>
      {cell(v.dispatched)}
      {cell(v.a, "font-semibold")}{cell(v.a2)}{cell(v.b)}{cell(v.c)}
      {cell(v.cts)}{cell(v.printing)}{cell(v.trial)}{cell(v.ungraded, "text-gray-500")}
      {cell(v.pending_polish, "font-semibold text-red-600")}
      {cell(v.pending_rw, "font-semibold text-red-600")}
    </>
  );
}

export function StockByDesign() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set()); // closed by default

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
    const normal: { name: string; rows: Row[]; agg: Agg }[] = [];
    const trialRows: Row[] = [];
    for (const [design, list] of byDesign) {
      const agg = sumRows(list);
      const allTrial = agg.trial > 0 && agg.trial >= agg.total + agg.dispatched;
      if (isTrialName(design) || allTrial) {
        for (const r of list) trialRows.push({ ...r, batch: `${design} - ${r.batch}` });
      } else {
        normal.push({ name: design, rows: list, agg });
      }
    }
    normal.sort((x, y) => x.name.localeCompare(y.name));
    if (trialRows.length) normal.push({ name: "Trials", rows: trialRows, agg: sumRows(trialRows) });
    return normal;
  }, [rows, q]);

  const toggle = (k: string) => setOpen((s) => { const c = new Set(s); if (c.has(k)) c.delete(k); else c.add(k); return c; });
  const sortRows = (list: Row[]) =>
    [...list].sort((x, y) => x.thickness.localeCompare(y.thickness) || x.batch.localeCompare(y.batch, undefined, { numeric: true }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <input className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" placeholder="Filter colour / design..." value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="text-xs text-gray-400">Stock register - click a colour to open its batches - trials grouped at the end.</p>
      </div>
      <div className="max-h-[75vh] overflow-auto rounded-lg border border-gray-300 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-yellow-300 text-[11px] font-bold uppercase tracking-wide text-gray-900">
              <th className="border border-gray-400 px-2 py-2">SL.No</th>
              <th className="border border-gray-400 px-3 py-2">Colour Name</th>
              <th className="border border-gray-400 px-2 py-2">Thick</th>
              <th className="border border-gray-400 px-2 py-2">Batch No</th>
              <th className="border border-gray-400 px-2 py-2">Slabs</th>
              <th className="border border-gray-400 px-2 py-2">Dispatch</th>
              <th className="border border-gray-400 px-2 py-2">A</th>
              <th className="border border-gray-400 px-2 py-2">A2</th>
              <th className="border border-gray-400 px-2 py-2">B</th>
              <th className="border border-gray-400 px-2 py-2">C</th>
              <th className="border border-gray-400 px-2 py-2">CTS</th>
              <th className="border border-gray-400 px-2 py-2">Print</th>
              <th className="border border-gray-400 px-2 py-2">Trial</th>
              <th className="border border-gray-400 px-2 py-2">No Gr.</th>
              <th className="border border-gray-400 px-2 py-2">Pol/Bal</th>
              <th className="border border-gray-400 px-2 py-2">R/W</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={16} className="px-3 py-10 text-center text-gray-400">Loading...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={16} className="px-3 py-10 text-center text-gray-400">No stock matches.</td></tr>
            ) : groups.map(({ name, rows: list, agg }, gi) => {
              const slno = String(gi + 1).padStart(2, "0");
              const isOpen = open.has(name);
              const sorted = sortRows(list);
              if (!isOpen) return (
                <tr key={name} className="cursor-pointer hover:bg-yellow-50" onClick={() => toggle(name)}>
                  <td className={bcell}>{slno}</td>
                  <td className="border border-gray-300 px-3 py-1.5 font-semibold uppercase tracking-wide text-gray-900">
                    <span className="mr-1.5 text-gray-400">&#9656;</span>{name}
                    <span className="ml-2 text-[11px] font-normal normal-case text-gray-400">{list.length} batch(es)</span>
                  </td>
                  <td className={bcell}>-</td><td className={bcell}>-</td>
                  <Cells v={agg} />
                </tr>
              );
              return (
                <Fragment key={name}>
                  {sorted.map((r, i) => (
                    <tr key={`${r.design}|${r.thickness}|${r.batch}`} className="hover:bg-gray-50/60">
                      {i === 0 && <td rowSpan={sorted.length + 1} className={`${bcell} align-middle`}>{slno}</td>}
                      {i === 0 && (
                        <td rowSpan={sorted.length + 1} className="cursor-pointer border border-gray-300 px-3 py-1.5 text-center align-middle font-semibold uppercase tracking-wide text-gray-900 hover:bg-yellow-50" onClick={() => toggle(name)}>
                          <span className="mr-1.5 text-gray-400">&#9662;</span>{name}
                        </td>
                      )}
                      <td className={`${bcell} font-medium`}>{r.thickness}</td>
                      <td className={bcell}>{r.batch}</td>
                      <Cells v={r} />
                    </tr>
                  ))}
                  <tr className="bg-gray-100/80 font-semibold">
                    <td className={bcell}>-</td>
                    <td className={`${bcell} text-left text-[11px] uppercase text-gray-500`}>Total</td>
                    <Cells v={agg} />
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!loading && <p className="text-xs text-gray-400">{groups.length.toLocaleString("en-IN")} colour(s) in stock.</p>}
    </div>
  );
}
