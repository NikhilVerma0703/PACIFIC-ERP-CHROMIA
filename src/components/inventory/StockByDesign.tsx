"use client";
// Stock summary styled after the physical stock register: SL.NO + merged
// colour cell, a row per thickness+batch, full grid lines, yellow sticky
// header. Designs collapsed by default; all trial designs under "Trials".
import { Fragment, useEffect, useMemo, useState } from "react";

interface Row {
  design: string; thickness: string; batch: string; rawBatch?: string; total: number; dispatched: number;
  bay5: number; bay4: number; bay3: number; nobay: number;
  a: number; a2: number; b: number; c: number; cts: number; printing: number;
  trial: number; ungraded: number; pending_polish: number; pending_rw: number;
  approved: boolean; designApproved: boolean; pending: boolean;
}
const NUMS = ["total","dispatched","bay5","bay4","bay3","nobay","a","a2","b","c","cts","printing","trial","ungraded","pending_polish","pending_rw"] as const;
type Agg = Record<(typeof NUMS)[number], number>;
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

export function StockByDesign({ canApprove = false, showPending = false, onFilters, onOpenSlabs }: {
  canApprove?: boolean;
  showPending?: boolean;
  onFilters?: (f: { design: string; thickness: string; batch: string }) => void;
  onOpenSlabs?: (sel: { design?: string; thickness?: string; batch?: string }) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [thick, setThick] = useState("");
  const [batchQ, setBatchQ] = useState("");
  const [sorts, setSorts] = useState<{ k: "name" | (typeof NUMS)[number]; d: 1 | -1 }[]>([{ k: "name", d: 1 }]);
  const [open, setOpen] = useState<Set<string>>(new Set());   // open designs (closed by default)
  const [ov, setOv] = useState<Map<string, boolean>>(new Map()); // optimistic Approved overrides
  const [openT, setOpenT] = useState<Set<string>>(new Set()); // open thickness groups

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/inventory/summary${showPending ? "?pending=1" : ""}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => { if (alive) setRows(Array.isArray(d) ? d : []); })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false); });
    load();
    // live sync: a ~5ms version check every 1.5s; approval changes anywhere
    // trigger an immediate full reload (plus a 30s full-refresh floor for stock).
    //
    // Both ticks fire only while the tab is visible. A hidden tab shows nothing,
    // yet at 1.5 s it was the single biggest caller of the whole system — ~57k
    // function invocations a day per forgotten tab, each a session check plus
    // the version probe on Neon, and it kept the database from ever idling.
    // Nothing visible changes: the focus/visibilitychange handler below already
    // reloads in full the moment the tab is looked at again, before anyone can
    // read a stale figure. The intervals themselves are untouched.
    let ver = "";
    const check = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/inventory/approve")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d?.v !== undefined) { if (ver && d.v !== ver) load(); ver = d.v; } })
        .catch(() => {});
    };
    const idV = setInterval(check, 1500);
    const idFull = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000);
    // visibilitychange fires on the HIDE transition too; without the guard each
    // hide cost one full (~400 KB) summary reload that nobody was looking at.
    const onFocus = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { alive = false; clearInterval(idV); clearInterval(idFull); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPending]);

  const pendingRows = useMemo(
    () => (canApprove ? rows.filter((r) => r.pending) : []),
    [rows, canApprove]
  );

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const byDesign = new Map<string, Row[]>();
    for (const r of rows) {
      if (canApprove && r.pending) continue; // pending stock sits in the strip above
      if (term && !r.design.toLowerCase().includes(term)) continue;
      if (thick && r.thickness !== thick) continue;
      if (batchQ.trim() && !r.batch.toLowerCase().includes(batchQ.trim().toLowerCase())) continue;
      const list = byDesign.get(r.design) ?? [];
      if (!list.length) byDesign.set(r.design, list);
      list.push(r);
    }
    const normal: { name: string; rows: Row[]; agg: Agg }[] = [];
    for (const [design, list] of byDesign) {
      normal.push({ name: design, rows: list, agg: sumRows(list) });
    }
    normal.sort((x, y) => {
      for (const so of sorts) {
        const c = so.k === "name" ? x.name.localeCompare(y.name) : x.agg[so.k] - y.agg[so.k];
        if (c) return so.d * c;
      }
      return 0;
    });
    // "(No Name)" and "Trial" always pin to the bottom (in that order)
    for (const pin of ["(No Name)", "Trial"]) {
      const i = normal.findIndex((g) => g.name === pin);
      if (i >= 0) normal.push(normal.splice(i, 1)[0]);
    }
    return normal;
  }, [rows, q, thick, batchQ, sorts, canApprove]);

  useEffect(() => {
    onFilters?.({ design: q.trim(), thickness: thick, batch: batchQ.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, thick, batchQ]);

  const thickOptions = useMemo(() => [...new Set(rows.map((r) => r.thickness))].sort(), [rows]);
  // click = primary sort (click again to flip) · Shift+Click = add another level
  const onSort = (k: "name" | (typeof NUMS)[number], additive: boolean) => {
    setSorts((cur) => {
      const i = cur.findIndex((x) => x.k === k);
      if (additive) {
        if (i >= 0) { const c = [...cur]; c[i] = { k, d: c[i].d === 1 ? -1 : 1 }; return c; }
        return [...cur, { k, d: k === "name" ? 1 : -1 }];
      }
      if (i === 0 && cur.length === 1) return [{ k, d: cur[0].d === 1 ? -1 : 1 }];
      return [{ k, d: k === "name" ? 1 : -1 }];
    });
  };
  const arrow = (k: string) => {
    const i = sorts.findIndex((x) => x.k === k);
    if (i < 0) return "";
    return (sorts[i].d === 1 ? " ▴" : " ▾") + (sorts.length > 1 ? String(i + 1) : "");
  };

  const toggle = (k: string) => setOpen((s) => { const c = new Set(s); if (c.has(k)) c.delete(k); else c.add(k); return c; });
  const toggleT = (k: string) => setOpenT((s) => { const c = new Set(s); if (c.has(k)) c.delete(k); else c.add(k); return c; });
  const setApproved = (groupName: string, batch: string, approved: boolean) => {
    setOv((m) => new Map(m).set(`${groupName}|${batch}`, approved));
    const design = groupName;
    fetch("/api/inventory/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design, batch, approved }) }).catch(() => {});
  };
  // batch = "" -> the whole colour's master checkbox
  const ApproveBox = ({ name, batch = "", current }: { name: string; batch?: string; current: boolean }) => (
    <td className={`${bcell} align-middle`} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={ov.get(`${name}|${batch}`) ?? current} onChange={(e) => setApproved(name, batch, e.target.checked)}
        title={batch ? `Show batch ${batch} in the Sales register` : "Show this colour in the Sales register"} />
    </td>
  );
  const sortRows = (list: Row[]) =>
    [...list].sort((x, y) => x.thickness.localeCompare(y.thickness) || x.batch.localeCompare(y.batch, undefined, { numeric: true }));

  return (
    <div className="space-y-3">
      {canApprove && showPending && pendingRows.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-amber-800">New stock awaiting approval ({pendingRows.length})</h3>
          <p className="mb-2 text-xs text-amber-700">Tick to approve — the line moves into the register and becomes visible to Sales within seconds.</p>
          <div className="max-h-64 overflow-auto rounded-lg border border-amber-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-amber-100 text-left text-[11px] font-bold uppercase text-amber-900">
                  <th className="px-3 py-1.5">Colour</th><th className="px-2 py-1.5">Thick</th><th className="px-2 py-1.5">Batch</th>
                  <th className="px-2 py-1.5 text-right">Slabs</th><th className="px-2 py-1.5 text-center">Approve</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((r) => (
                  <tr key={`${r.design}|${r.thickness}|${r.batch}`} className="border-t border-amber-100">
                    <td
                      className={`px-3 py-1.5 font-medium text-gray-900 ${onOpenSlabs ? "cursor-pointer hover:text-brand hover:underline" : ""}`}
                      title={onOpenSlabs ? "Open these slabs" : undefined}
                      onClick={onOpenSlabs ? () => onOpenSlabs({ design: r.design, thickness: r.thickness === "-" ? undefined : r.thickness, batch: r.batch === "-" ? undefined : r.batch }) : undefined}
                    >{r.design}</td>
                    <td className="px-2 py-1.5">{r.thickness}</td>
                    <td className="px-2 py-1.5">{r.batch}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.total + r.dispatched}</td>
                    <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={ov.get(`${r.design}|${r.batch}`) ?? false} onChange={(e) => setApproved(r.design, r.batch, e.target.checked)} title="Approve for the register + Sales" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <input className="w-full max-w-[220px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" placeholder="Filter colour / design..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" value={thick} onChange={(e) => setThick(e.target.value)}>
          <option value="">Any thickness</option>
          {thickOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="w-full max-w-[140px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" placeholder="Batch..." value={batchQ} onChange={(e) => setBatchQ(e.target.value)} />
        <p className="text-xs text-gray-400">Stock register - click a colour to open its batches - trials grouped at the end.</p>
      </div>
      <div className="max-h-[85vh] overflow-auto rounded-lg border border-gray-300 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-brand text-[11px] font-bold uppercase tracking-wide text-white">
              <th className="border border-brand-dark/40 px-2 py-2">SL.No</th>
              <th className="cursor-pointer border border-brand-dark/40 px-3 py-2 hover:bg-brand-dark/40" title="Sort · Shift+Click adds a level" onClick={(e) => onSort("name", e.shiftKey)}>Colour Name{arrow("name")}</th>
              <th className="border border-brand-dark/40 px-2 py-2">Thick</th>
              <th className="border border-brand-dark/40 px-2 py-2">Batch No</th>
              {([["Slabs","total"],["A","a"],["A2","a2"],["B","b"],["C","c"],["CTS","cts"],["Print","printing"],["Trial","trial"],["No Gr.","ungraded"],["R/W","pending_rw"]] as [string, (typeof NUMS)[number]][]).map(([label, k]) => (
                <th key={k} className="cursor-pointer border border-brand-dark/40 px-2 py-2 hover:bg-brand-dark/40" title="Sort · Shift+Click adds a level" onClick={(e) => onSort(k, e.shiftKey)}>{label}{arrow(k)}</th>
              ))}
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
                  {canApprove && <ApproveBox name={name} current={list[0]?.designApproved ?? true} />}
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
                          <td
                            className={`${bcell} ${onOpenSlabs ? "cursor-pointer font-medium text-brand hover:underline" : ""}`}
                            title={onOpenSlabs ? "Open these slabs" : undefined}
                            onClick={onOpenSlabs ? (ev) => { ev.stopPropagation(); onOpenSlabs({ design: e.r.design, thickness: e.r.thickness === "-" ? undefined : e.r.thickness, batch: e.r.batch === "-" ? undefined : (e.r.rawBatch ?? e.r.batch) }); } : undefined}
                          >{e.r.batch}</td>
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
                      {canApprove && e.kind === "thick" && <td className={`${bcell} text-gray-300`}>-</td>}
                      {canApprove && e.kind === "batch" && <ApproveBox name={e.r.design} batch={e.r.rawBatch ?? e.r.batch} current={e.r.approved} />}
                      {canApprove && e.kind === "total" && <ApproveBox name={name} current={list[0]?.designApproved ?? true} />}
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
