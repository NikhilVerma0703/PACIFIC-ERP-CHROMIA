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
  approved: boolean;
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
      {cell(v.a, "font-semibold")}{cell(v.a2)}{cell(v.b)}{cell(v.c)}
      {cell(v.cts)}{cell(v.printing)}{cell(v.trial)}{cell(v.ungraded, "text-gray-500")}
      {cell(v.pending_rw, "font-semibold text-red-600")}
    </>
  );
}

export function StockByDesign({ canApprove = false }: { canApprove?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());   // open designs (closed by default)
  const [ov, setOv] = useState<Map<string, boolean>>(new Map()); // optimistic Approved overrides
  const [openT, setOpenT] = useState<Set<string>>(new Set()); // open thickness groups

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
  const toggleT = (k: string) => setOpenT((s) => { const c = new Set(s); if (c.has(k)) c.delete(k); else c.add(k); return c; });
  const setApproved = (groupName: string, approved: boolean) => {
    setOv((m) => new Map(m).set(groupName, approved));
    const design = groupName === "Trials" ? "__TRIALS__" : groupName;
    fetch("/api/inventory/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design, approved }) }).catch(() => {});
  };
  const ApproveBox = ({ name, rows: list, span }: { name: string; rows: Row[]; span?: number }) => (
    <td rowSpan={span} className={`${bcell} align-middle`} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={ov.get(name) ?? (list[0]?.approved ?? true)} onChange={(e) => setApproved(name, e.target.checked)} title="Show in the Sales register" />
    </td>
  );
  const sortRows = (list: Row[]) =>
    [...list].sort((x, y) => x.thickness.localeCompare(y.thickness) || x.batch.localeCompare(y.batch, undefined, { numeric: true }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <input className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" placeholder="Filter colour / design..." value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="text-xs text-gray-400">Stock register - click a colour to open its batches - trials grouped at the end.</p>
      </div>
      <div className="max-h-[85vh] overflow-auto rounded-lg border border-gray-300 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-brand text-[11px] font-bold uppercase tracking-wide text-white">
              <th className="border border-brand-dark/40 px-2 py-2">SL.No</th>
              <th className="border border-brand-dark/40 px-3 py-2">Colour Name</th>
              <th className="border border-brand-dark/40 px-2 py-2">Thick</th>
              <th className="border border-brand-dark/40 px-2 py-2">Batch No</th>
              <th className="border border-brand-dark/40 px-2 py-2">Slabs</th>
              <th className="border border-brand-dark/40 px-2 py-2">A</th>
              <th className="border border-brand-dark/40 px-2 py-2">A2</th>
              <th className="border border-brand-dark/40 px-2 py-2">B</th>
              <th className="border border-brand-dark/40 px-2 py-2">C</th>
              <th className="border border-brand-dark/40 px-2 py-2">CTS</th>
              <th className="border border-brand-dark/40 px-2 py-2">Print</th>
              <th className="border border-brand-dark/40 px-2 py-2">Trial</th>
              <th className="border border-brand-dark/40 px-2 py-2">No Gr.</th>
              <th className="border border-brand-dark/40 px-2 py-2">R/W</th>
              {canApprove && <th className="border border-brand-dark/40 px-2 py-2">Approved</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canApprove ? 15 : 14} className="px-3 py-10 text-center text-gray-400">Loading...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={canApprove ? 15 : 14} className="px-3 py-10 text-center text-gray-400">No stock matches.</td></tr>
            ) : groups.map(({ name, rows: list, agg }, gi) => {
              const slno = String(gi + 1).padStart(2, "0");
              const isOpen = open.has(name);
              const sorted = sortRows(list);
              if (!isOpen) return (
                <tr key={name} className="cursor-pointer hover:bg-brand/5" onClick={() => toggle(name)}>
                  <td className={bcell}>{slno}</td>
                  <td className="border border-gray-300 px-3 py-1.5 font-semibold uppercase tracking-wide text-gray-900">
                    <span className="mr-1.5 text-gray-400">&#9656;</span>{name}
                    <span className="ml-2 text-[11px] font-normal normal-case text-gray-400">{list.length} batch(es)</span>
                  </td>
                  <td className={bcell}>-</td><td className={bcell}>-</td>
                  <Cells v={agg} />
                  {canApprove && <ApproveBox name={name} rows={list} />}
                </tr>
              );
              const byThick = new Map<string, Row[]>();
              for (const r of sorted) {
                const l = byThick.get(r.thickness) ?? [];
                if (!l.length) byThick.set(r.thickness, l);
                l.push(r);
              }
              type Entry = { kind: "thick"; thick: string; agg: Agg; count: number } | { kind: "batch"; r: Row } | { kind: "total" };
              const entries: Entry[] = [];
              for (const [thick, tl] of byThick) {
                entries.push({ kind: "thick", thick, agg: sumRows(tl), count: tl.length });
                if (openT.has(`${name}|${thick}`)) for (const r of tl) entries.push({ kind: "batch", r });
              }
              entries.push({ kind: "total" });
              return (
                <Fragment key={name}>
                  {entries.map((e, i) => (
                    <tr
                      key={i}
                      className={e.kind === "total" ? "bg-gray-100/80 font-semibold" : e.kind === "thick" ? "cursor-pointer bg-brand/[0.04] hover:bg-brand/10" : "hover:bg-gray-50/60"}
                      onClick={e.kind === "thick" ? () => toggleT(`${name}|${e.thick}`) : undefined}
                    >
                      {i === 0 && <td rowSpan={entries.length} className={`${bcell} align-middle`}>{slno}</td>}
                      {i === 0 && (
                        <td rowSpan={entries.length} className="cursor-pointer border border-gray-300 px-3 py-1.5 text-center align-middle font-semibold uppercase tracking-wide text-gray-900 hover:bg-brand/5" onClick={(ev) => { ev.stopPropagation(); toggle(name); }}>
                          <span className="mr-1.5 text-gray-400">&#9662;</span>{name}
                        </td>
                      )}
                      {e.kind === "thick" && (
                        <>
                          <td className={`${bcell} font-semibold`}><span className="mr-1 text-gray-400">{openT.has(`${name}|${e.thick}`) ? "▾" : "▸"}</span>{e.thick}</td>
                          <td className={`${bcell} text-[11px] text-gray-400`}>{e.count} batch(es)</td>
                          <Cells v={e.agg} />
                        </>
                      )}
                      {e.kind === "batch" && (
                        <>
                          <td className={bcell}></td>
                          <td className={bcell}>{e.r.batch}</td>
                          <Cells v={e.r} />
                        </>
                      )}
                      {e.kind === "total" && (
                        <>
                          <td className={bcell}>-</td>
                          <td className={`${bcell} text-left text-[11px] uppercase text-gray-500`}>Total</td>
                          <Cells v={agg} />
                        </>
                      )}
                      {i === 0 && canApprove && <ApproveBox name={name} rows={list} span={entries.length} />}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          {!loading && groups.length > 0 && (
            <tfoot className="sticky bottom-0 z-10">
              <tr className="bg-brand font-bold text-white">
                <td className="border border-brand-dark/40 px-2 py-2 text-center">-</td>
                <td className="border border-brand-dark/40 px-3 py-2 text-[11px] uppercase tracking-wide">Grand Total</td>
                <td className="border border-brand-dark/40 px-2 py-2 text-center">-</td>
                <td className="border border-brand-dark/40 px-2 py-2 text-center">-</td>
                {(() => { const g = sumRows(groups.flatMap((x) => x.rows)); return NUMS.filter((k) => !["dispatched","bay5","bay4","bay3","nobay","pending_polish"].includes(k)).map((k) => (
                  <td key={k} className="border border-brand-dark/40 px-2 py-2 text-center tabular-nums">{g[k] ? g[k].toLocaleString("en-IN") : "-"}</td>
                )); })()}
                {canApprove && <td className="border border-brand-dark/40 px-2 py-2 text-center">-</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!loading && <p className="text-xs text-gray-400">{groups.length.toLocaleString("en-IN")} colour(s) in stock.</p>}
    </div>
  );
}
