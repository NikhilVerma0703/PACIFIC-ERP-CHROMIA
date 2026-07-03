"use client";

import { useEffect, useState } from "react";

interface Kpi {
  total: number; gradeA: number; gradeA2: number; gradeB: number; gradeC: number;
  cts: number; printing: number; available: number; reserved: number; packed: number;
  dispatched: number; returned: number; pendingPolish: number; pendingRw: number;
  thk12cm: number; thk2cm: number; thk3cm: number;
}
interface Slab {
  id: string; slabNumber: number; design: string | null; grade: string | null;
  slabThickness: string | null; polishType: string | null; batchNumber: string | null;
  bayNumber: string | null; frameNumber: string | null; status: string; sqft: number; sqm: number;
  ageDays: number | null; qualityIssue: string[] | null;
}
interface Alias { id: string; variant: string; canonical: string; createdBy: string | null }

interface SlabEvent {
  id: string; slabNumber: number; kind: string; field: string | null;
  oldValue: string | null; newValue: string | null; changedBy: string | null;
  source: string | null; at: string;
}

const STATUSES = ["", "AVAILABLE", "RESERVED", "PACKED", "DISPATCHED", "RETURNED"];
const GRADES = ["", "A", "A2", "B", "C", "CTS", "Printing", "Trial"];
const THICKNESSES = ["", "1.2 cm", "2 cm", "3 cm", "4 cm", "7 mm", "8 mm", "10 mm"];
const BAYS = ["Bay 1", "Bay 2", "Bay 3", "Bay 4", "Bay 5"];
const ACTIONS = [
  { value: "", label: "Change status…" },
  { value: "reserve", label: "Reserve (PI hold)" },
  { value: "pack", label: "Mark Packed" },
  { value: "dispatch", label: "Mark Dispatched" },
  { value: "return", label: "Mark Returned (un-dispatch)" },
  { value: "release", label: "Release to Available" },
];
const EMPTY = { design: "", batch: "", thickness: "", grade: "", slab: "", bay: "", status: "" };

const fmtAt = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function InventoryDashboard({ admin = false }: { admin?: boolean }) {
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [rows, setRows] = useState<Slab[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ ...EMPTY });

  // dispatch move/assign
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [mv, setMv] = useState({ bay: "", frame: "", clearBay: false, clearFrame: false });
  const [moving, setMoving] = useState(false);
  const [moveMsg, setMoveMsg] = useState<string | null>(null);
  const [st, setSt] = useState({ action: "", pi: "", customer: "", expiryDays: "" });
  const [stBusy, setStBusy] = useState(false);

  // slab detail modal
  const [detail, setDetail] = useState<any | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  // activity feed
  const [view, setView] = useState<"slabs" | "activity" | "designs">("slabs");
  const [events, setEvents] = useState<SlabEvent[]>([]);
  const [evSlab, setEvSlab] = useState("");
  const [evLoading, setEvLoading] = useState(false);

  // design merge (admin)
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [designs, setDesigns] = useState<string[]>([]);
  const [merge, setMerge] = useState({ variant: "", canonical: "" });
  const [mergeMsg, setMergeMsg] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  const loadKpi = () => {
    fetch("/api/inventory/kpi").then((r) => (r.ok ? r.json() : null)).then((d) => setKpi(d && !d.error ? d : null)).catch(() => {});
  };
  useEffect(() => {
    loadKpi();
    const id = setInterval(loadKpi, 60000); // live refresh every minute
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (filters: typeof EMPTY) => {
    setLoading(true);
    setSel(new Set());
    loadKpi();
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    fetch(`/api/inventory?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { run(EMPTY); }, []);

  const loadEvents = (slab: string) => {
    setEvLoading(true);
    const p = new URLSearchParams();
    if (slab.trim()) p.set("slab", slab.trim());
    fetch(`/api/inventory/events?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEvents(Array.isArray(d) ? d : []))
      .catch(() => setEvents([]))
      .finally(() => setEvLoading(false));
  };
  const openActivity = (slab: string) => { setEvSlab(slab); setView("activity"); loadEvents(slab); };

  const openDetail = (n: number) => {
    setDetailBusy(true); setDetail({ slabNumber: n });
    fetch(`/api/inventory/slab?number=${n}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDetail((cur: any) => (cur?.slabNumber === n ? (d && !d.error ? { slabNumber: n, ...d } : { slabNumber: n, error: d?.error ?? "Failed to load" }) : cur)))
      .catch(() => setDetail((cur: any) => (cur?.slabNumber === n ? { slabNumber: n, error: "Failed to load" } : cur)))
      .finally(() => setDetail((cur: any) => { if (cur?.slabNumber === n || cur == null) setDetailBusy(false); return cur; }));
  };

  const loadDesigns = () => {
    fetch("/api/inventory/designs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) { setAliases(d.aliases ?? []); setDesigns(d.designs ?? []); } })
      .catch(() => {});
  };
  const saveMerge = async () => {
    if (!merge.variant.trim() || !merge.canonical.trim()) { setMergeMsg("Pick a variant and a canonical name."); return; }
    setMerging(true); setMergeMsg(null);
    try {
      const r = await fetch("/api/inventory/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(merge) });
      const d = await r.json().catch(() => null);
      if (!r.ok || d?.error) setMergeMsg(d?.error ?? "Save failed.");
      else { setMerge({ variant: "", canonical: "" }); setMergeMsg("Merged."); loadDesigns(); }
    } catch { setMergeMsg("Save failed."); }
    finally { setMerging(false); }
  };
  const unmerge = async (variant: string) => {
    try {
      const r = await fetch(`/api/inventory/designs?variant=${encodeURIComponent(variant)}`, { method: "DELETE" });
      if (r.ok) loadDesigns();
    } catch { /* noop */ }
  };

  const toggle = (n: number) => setSel((s) => { const c = new Set(s); if (c.has(n)) c.delete(n); else c.add(n); return c; });
  const toggleAll = () => setSel((s) => (s.size === rows.length ? new Set<number>() : new Set(rows.map((r) => r.slabNumber))));

  const applyMove = async () => {
    if (sel.size === 0) return;
    const payload: Record<string, unknown> = { slabs: [...sel] };
    if (mv.clearBay) payload.bay = null; else if (mv.bay.trim()) payload.bay = mv.bay.trim();
    if (mv.clearFrame) payload.frame = null; else if (mv.frame.trim()) payload.frame = mv.frame.trim();
    if (payload.bay === undefined && payload.frame === undefined) { setMoveMsg("Enter a bay and/or frame (or tick a clear box)."); return; }
    setMoving(true); setMoveMsg(null);
    try {
      const r = await fetch("/api/inventory/location", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || d.error) { setMoveMsg(d?.error ?? "Move failed."); }
      else {
        setMoveMsg(`Updated ${d.updated} slab(s)` + (d.unchanged ? `, ${d.unchanged} unchanged` : "") + (d.missing?.length ? `, ${d.missing.length} not in inventory (${d.missing.slice(0, 5).join(", ")}${d.missing.length > 5 ? "…" : ""})` : "") + ".");
        setMv({ bay: "", frame: "", clearBay: false, clearFrame: false });
        run(f);
      }
    } catch { setMoveMsg("Move failed."); }
    finally { setMoving(false); }
  };

  const applyStatus = async () => {
    if (sel.size === 0 || !st.action) return;
    setStBusy(true); setMoveMsg(null);
    try {
      const payload: Record<string, unknown> = { slabs: [...sel], action: st.action };
      if (st.pi.trim()) payload.pi = st.pi.trim();
      if (st.customer.trim()) payload.customer = st.customer.trim();
      if (admin && st.expiryDays.trim()) payload.expiryDays = Number(st.expiryDays);
      const r = await fetch("/api/inventory/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || d.error) setMoveMsg(d?.error ?? "Action failed.");
      else {
        setMoveMsg(`${d.updated} slab(s) updated` +
          (d.skipped?.length ? `; ${d.skipped.length} skipped (${d.skipped.slice(0, 3).map((x: any) => `#${x.slab}: ${x.reason}`).join("; ")}${d.skipped.length > 3 ? "…" : ""})` : "") +
          (d.missing?.length ? `; ${d.missing.length} not in inventory` : "") + ".");
        setSt({ action: "", pi: "", customer: "", expiryDays: "" });
        run(f); loadKpi();
      }
    } catch { setMoveMsg("Action failed."); }
    finally { setStBusy(false); }
  };

  const card = (label: string, value: number, tone = "text-gray-900") => (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value.toLocaleString("en-IN")}</div>
    </div>
  );
  const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
  const tabCls = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-brand text-white" : "text-gray-600 hover:bg-gray-100"}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Finished-Goods Inventory</h1>
          <p className="mt-1 text-sm text-gray-500">Slabs from QC approval through packing &amp; dispatch.</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
          <button className={tabCls(view === "slabs")} onClick={() => setView("slabs")}>Slabs</button>
          <button className={tabCls(view === "activity")} onClick={() => openActivity(evSlab)}>Activity</button>
          {admin && <button className={tabCls(view === "designs")} onClick={() => { setView("designs"); loadDesigns(); }}>Designs</button>}
        </div>
      </div>

      {kpi && (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Stock</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {card("Total Slabs", kpi.total)}
              {card("Available", kpi.available, "text-emerald-600")}
              {card("Reserved", kpi.reserved, "text-amber-600")}
              {card("Packed", kpi.packed, "text-amber-600")}
              {card("Dispatched", kpi.dispatched, "text-gray-500")}
              {card("Returned", kpi.returned, "text-sky-600")}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Grades (in stock)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {card("Grade A", kpi.gradeA)}
              {card("Grade A2", kpi.gradeA2)}
              {card("Grade B", kpi.gradeB)}
              {card("Grade C", kpi.gradeC)}
              {card("CTS", kpi.cts)}
              {card("Printing", kpi.printing)}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Thickness (in stock)</p>
              <div className="grid grid-cols-3 gap-3">
                {card("1.2 cm", kpi.thk12cm)}
                {card("2 cm", kpi.thk2cm)}
                {card("3 cm", kpi.thk3cm)}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Needs attention</p>
              <div className="grid grid-cols-2 gap-3">
                {card("Pending Polish", kpi.pendingPolish, "text-red-600")}
                {card("Pending R/W", kpi.pendingRw, "text-red-600")}
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "designs" && admin ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Merge two designs</h2>
            <p className="mt-1 text-xs text-gray-500">Rows keep their original (variant) name; searches and grouping treat the variant as the canonical. Reversible — un-merge any time.</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="w-64">
                <label className="mb-1 block text-xs font-medium text-gray-500">Variant (merge this…)</label>
                <input className={inputCls} list="fg-designs" placeholder="e.g. Calacatta Gold (Bypass)" value={merge.variant} onChange={(e) => setMerge({ ...merge, variant: e.target.value })} />
              </div>
              <div className="w-64">
                <label className="mb-1 block text-xs font-medium text-gray-500">Canonical (…into this)</label>
                <input className={inputCls} list="fg-designs" placeholder="e.g. Calacatta Gold" value={merge.canonical} onChange={(e) => setMerge({ ...merge, canonical: e.target.value })} />
              </div>
              <datalist id="fg-designs">{designs.map((d) => <option key={d} value={d} />)}</datalist>
              <button onClick={saveMerge} disabled={merging} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50">{merging ? "Saving…" : "Merge"}</button>
            </div>
            {mergeMsg && <p className="mt-2 text-xs text-gray-600">{mergeMsg}</p>}
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-3 py-2">Variant</th><th className="px-3 py-2">Merged into</th><th className="px-3 py-2">By</th><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {aliases.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-10 text-center text-gray-400">No design merges yet.</td></tr>
                ) : (
                  aliases.map((a) => (
                    <tr key={a.id} className="border-t border-gray-50">
                      <td className="px-3 py-2">{a.variant}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{a.canonical}</td>
                      <td className="px-3 py-2 text-gray-500">{a.createdBy ?? "—"}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => unmerge(a.variant)} className="text-xs text-red-500 hover:underline">Un-merge</button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : view === "activity" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-4">
            <button onClick={() => setView("slabs")} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">← Back to slabs</button>
            <div className="w-40">
              <label className="mb-1 block text-xs font-medium text-gray-500">Slab #</label>
              <input className={inputCls} placeholder="All slabs" value={evSlab} onChange={(e) => setEvSlab(e.target.value)} />
            </div>
            <button onClick={() => loadEvents(evSlab)} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark">Load</button>
            <button onClick={() => { setEvSlab(""); loadEvents(""); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">All activity</button>
            <p className="ml-auto text-xs text-gray-400">Every status, location and dispatch change — who, when, source.</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-3 py-2">When (IST)</th><th className="px-3 py-2">Slab #</th><th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Field</th><th className="px-3 py-2">Change</th><th className="px-3 py-2">By</th><th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {evLoading ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-400">Loading…</td></tr>
                ) : events.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-gray-400">No activity yet.</td></tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.id} className="border-t border-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{fmtAt(e.at)}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{e.slabNumber}</td>
                      <td className="px-3 py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{e.kind}</span></td>
                      <td className="px-3 py-2">{e.field ?? "—"}</td>
                      <td className="px-3 py-2">{e.oldValue || e.newValue ? <>{e.oldValue ?? "—"} <span className="text-gray-400">→</span> {e.newValue ?? "—"}</> : "—"}</td>
                      <td className="px-3 py-2">{e.changedBy ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{e.source ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <input className={inputCls} placeholder="Colour / design" value={f.design} onChange={(e) => setF({ ...f, design: e.target.value })} />
              <input className={inputCls} placeholder="Batch" value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} />
              <input className={inputCls} placeholder="Slab # / barcode" value={f.slab} onChange={(e) => setF({ ...f, slab: e.target.value })} />
              <select className={inputCls} value={f.bay} onChange={(e) => setF({ ...f, bay: e.target.value })}>{["", ...BAYS].map((b) => <option key={b} value={b}>{b || "Any bay"}</option>)}</select>
              <select className={inputCls} value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}>{GRADES.map((g) => <option key={g} value={g}>{g || "Any grade"}</option>)}</select>
              <select className={inputCls} value={f.thickness} onChange={(e) => setF({ ...f, thickness: e.target.value })}>{THICKNESSES.map((t) => <option key={t} value={t}>{t || "Any thickness"}</option>)}</select>
              <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s || "Any status"}</option>)}</select>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => run(f)} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark">Search</button>
              <button onClick={() => { setF({ ...EMPTY }); run(EMPTY); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Clear</button>
            </div>
          </div>

          {sel.size > 0 && (
            <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="text-sm font-medium text-gray-900">{sel.size} slab(s) selected</div>
                <div className="w-36">
                  <label className="mb-1 block text-xs font-medium text-gray-500">Move to bay</label>
                  <select className={inputCls} value={mv.bay} disabled={mv.clearBay} onChange={(e) => setMv({ ...mv, bay: e.target.value })}>
                    {["", ...BAYS].map((b) => <option key={b} value={b}>{b || "— keep bay —"}</option>)}
                  </select>
                </div>
                <div className="w-36">
                  <label className="mb-1 block text-xs font-medium text-gray-500">Assign frame</label>
                  <input className={inputCls} placeholder="Frame" value={mv.frame} disabled={mv.clearFrame} onChange={(e) => setMv({ ...mv, frame: e.target.value })} />
                </div>
                <label className="flex items-center gap-1.5 pb-2 text-xs text-gray-600"><input type="checkbox" checked={mv.clearBay} onChange={(e) => setMv({ ...mv, clearBay: e.target.checked, bay: "" })} /> Clear bay</label>
                <label className="flex items-center gap-1.5 pb-2 text-xs text-gray-600"><input type="checkbox" checked={mv.clearFrame} onChange={(e) => setMv({ ...mv, clearFrame: e.target.checked, frame: "" })} /> Clear frame</label>
                <button onClick={applyMove} disabled={moving} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50">{moving ? "Applying…" : "Apply"}</button>
                <button onClick={() => setSel(new Set())} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Deselect</button>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-brand/10 pt-3">
                <div className="w-56">
                  <label className="mb-1 block text-xs font-medium text-gray-500">Status action</label>
                  <select className={inputCls} value={st.action} onChange={(e) => setSt({ ...st, action: e.target.value })}>
                    {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                {(st.action === "reserve" || st.action === "dispatch") && (
                  <div className="w-40">
                    <label className="mb-1 block text-xs font-medium text-gray-500">PI no.</label>
                    <input className={inputCls} placeholder="PI" value={st.pi} onChange={(e) => setSt({ ...st, pi: e.target.value })} />
                  </div>
                )}
                {st.action === "reserve" && (
                  <div className="w-44">
                    <label className="mb-1 block text-xs font-medium text-gray-500">Customer</label>
                    <input className={inputCls} placeholder="Customer" value={st.customer} onChange={(e) => setSt({ ...st, customer: e.target.value })} />
                  </div>
                )}
                {st.action === "reserve" && admin && (
                  <div className="w-28">
                    <label className="mb-1 block text-xs font-medium text-gray-500">Hold (days)</label>
                    <input className={inputCls} placeholder="7" value={st.expiryDays} onChange={(e) => setSt({ ...st, expiryDays: e.target.value })} />
                  </div>
                )}
                <button onClick={applyStatus} disabled={stBusy || !st.action} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50">{stBusy ? "Applying…" : "Apply status"}</button>
                {st.action === "reserve" && !admin && <p className="pb-2 text-xs text-gray-400">7-day hold (Admin can change)</p>}
              </div>
              <p className="mt-2 text-xs text-gray-500">Blank field = unchanged. Reservations auto-release after the hold lapses. Every change is logged to the audit trail.</p>
            </div>
          )}
          {moveMsg && <p className="text-sm text-gray-600">{moveMsg}</p>}

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-3 py-2"><input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={toggleAll} /></th>
                  <th className="px-3 py-2">Slab #</th><th className="px-3 py-2">Design</th><th className="px-3 py-2">Batch</th>
                  <th className="px-3 py-2">Thk</th><th className="px-3 py-2">Grade</th><th className="px-3 py-2">Quality Issue</th><th className="px-3 py-2">Polish</th>
                  <th className="px-3 py-2">Bay</th><th className="px-3 py-2">Frame</th><th className="px-3 py-2 text-right">Sqft</th><th className="px-3 py-2 text-right">Age</th><th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={13} className="px-3 py-10 text-center text-gray-400">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={13} className="px-3 py-10 text-center text-gray-400">No slabs match the current filters.</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-3 py-2"><input type="checkbox" checked={sel.has(r.slabNumber)} onChange={() => toggle(r.slabNumber)} /></td>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        <button className="hover:text-brand hover:underline" title="View slab details" onClick={() => openDetail(r.slabNumber)}>{r.slabNumber}</button>
                      </td>
                      <td className="px-3 py-2">{r.design ?? "—"}</td>
                      <td className="px-3 py-2">{r.batchNumber ?? "—"}</td>
                      <td className="px-3 py-2">{r.slabThickness ?? "—"}</td>
                      <td className="px-3 py-2">{r.grade ?? "—"}</td>
                      <td className="px-3 py-2 max-w-[180px] truncate" title={(r.qualityIssue ?? []).join(", ")}>{r.qualityIssue?.length ? r.qualityIssue.join(", ") : "—"}</td>
                      <td className="px-3 py-2">{r.polishType ?? "—"}</td>
                      <td className="px-3 py-2">{r.bayNumber ?? "—"}</td>
                      <td className="px-3 py-2">{r.frameNumber ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.sqft || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums" title="Days in inventory">{r.ageDays ?? "—"}{r.ageDays != null ? "d" : ""}</td>
                      <td className="px-3 py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{r.status}</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && rows.length > 0 && (
            <p className="text-xs text-gray-400">{rows.length.toLocaleString("en-IN")} slab(s){rows.length === 1000 ? " (showing first 1000 — narrow the filters)" : ""}.</p>
          )}
        </>
      )}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={() => setDetail(null)}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Slab {detail.slabNumber}</h2>
                {detail.slab && <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{detail.slab.status}</span>}
              </div>
              <button onClick={() => setDetail(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Close ✕</button>
            </div>
            {detailBusy ? (
              <p className="py-10 text-center text-gray-400">Loading…</p>
            ) : detail.error ? (
              <p className="py-10 text-center text-gray-400">{detail.error}</p>
            ) : (
              <div className="mt-4 space-y-5">
                {detail.slab && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    {([
                      ["Design", detail.slab.design], ["Batch", detail.slab.batchNumber], ["Thickness", detail.slab.slabThickness],
                      ["Grade", detail.slab.grade], ["Polish type", detail.slab.polishType],
                      ["Quality issues", (detail.slab.qualityIssue ?? []).join(", ") || null],
                      ["Bay", detail.slab.bayNumber], ["Frame", detail.slab.frameNumber],
                      ["Size", `${detail.slab.sqft} sqft · ${detail.slab.sqm} sqm`],
                      ["Age in stock", detail.slab.ageDays != null ? `${detail.slab.ageDays} day(s)` : null],
                      ["Barcode", detail.slab.barcode], ["Source", detail.slab.source],
                      ["PI", detail.slab.reservedForPi], ["Customer", detail.slab.customer],
                      ["Hold expires", detail.slab.reservationExpiresAt ? fmtAt(detail.slab.reservationExpiresAt) : null],
                      ["Entered stock", detail.slab.firstSeenAt ? fmtAt(detail.slab.firstSeenAt) : null],
                      ["Last QC", detail.slab.lastQcAt ? fmtAt(detail.slab.lastQcAt) : null],
                    ] as [string, string | null][]).map(([k, v]) => (
                      <div key={k}><span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">{k}</span><span className="text-gray-900">{v ?? "—"}</span></div>
                    ))}
                  </div>
                )}
                {detail.qc && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-900">Latest QC record</h3>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl bg-gray-50 p-3 text-sm sm:grid-cols-3">
                      {([
                        ["Inspector", detail.qc.inspector], ["QC grade", detail.qc.qualityGrade],
                        ["R/W status", detail.qc.rwStatus], ["Repolish", detail.qc.repolishStatus],
                        ["Top polish", detail.qc.topPolish ? "Yes" : "No"], ["Bottom polish", detail.qc.bottomPolish ? "Yes" : "No"],
                        ["QC at", detail.qc.createdTime ? fmtAt(detail.qc.createdTime) : null],
                      ] as [string, string | null][]).map(([k, v]) => (
                        <div key={k}><span className="block text-[11px] font-medium uppercase tracking-wide text-gray-400">{k}</span><span className="text-gray-900">{v ?? "—"}</span></div>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-900">History</h3>
                  {Array.isArray(detail.events) && detail.events.length > 0 ? (
                    <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-100">
                      <table className="w-full text-sm">
                        <tbody>
                          {detail.events.map((e: SlabEvent) => (
                            <tr key={e.id} className="border-t border-gray-50 first:border-t-0">
                              <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{fmtAt(e.at)}</td>
                              <td className="px-3 py-1.5"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{e.kind}</span></td>
                              <td className="px-3 py-1.5">{e.oldValue || e.newValue ? <>{e.oldValue ?? "—"} <span className="text-gray-400">→</span> {e.newValue ?? "—"}</> : "—"}</td>
                              <td className="px-3 py-1.5 text-gray-500">{e.changedBy ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No events yet.</p>
                  )}
                </div>
                <div className="flex justify-end">
                  <a href={`/slab?s=${detail.slabNumber}`} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark">Full production timeline →</a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
