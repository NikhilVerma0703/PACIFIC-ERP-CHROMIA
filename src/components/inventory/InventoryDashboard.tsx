"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displaySlab } from "@/lib/slabLabel";
import { displayBatch } from "@/lib/batchDisplay";
import { NONE } from "@/lib/inventory/filterValues";
import { StockByDesign } from "./StockByDesign";
import { PolishingReport } from "./PolishingReport";
import { Lightbox, type LightboxPhoto } from "@/components/Lightbox";

interface Kpi {
  total: number; gradeA: number; gradeA2: number; gradeB: number; gradeC: number;
  cts: number; printing: number; available: number; reserved: number; packed: number;
  dispatched: number; returned: number; ctsStatus: number; chromia: number;
  pendingPolish: number; pendingRw: number;
  thk12cm: number; thk2cm: number; thk3cm: number;
}
interface Slab {
  id: string; slabNumber: number; design: string | null; grade: string | null;
  slabThickness: string | null; polishType: string | null; batchNumber: string | null;
  bayNumber: string | null; frameNumber: string | null; status: string; source: string | null;
  sqft: number; sqm: number;
  ageDays: number | null; qualityIssue: string[] | null; barcode: string | null;
}
interface Alias { id: string; variant: string; canonical: string; createdBy: string | null }

interface SlabEvent {
  id: string; slabNumber: number; kind: string; field: string | null;
  oldValue: string | null; newValue: string | null; changedBy: string | null;
  source: string | null; at: string;
}

// SlabStatus is a Prisma enum — a fixed set, so it stays hardcoded.
// CHROMIA (scripts/0063) is written only by the Chromia intake bridge — it is
// filterable and visible here, but deliberately absent from ACTIONS below.
const STATUSES = ["", "AVAILABLE", "RESERVED", "PACKED", "DISPATCHED", "RETURNED", "CTS", "CHROMIA"];

// Where a row came from: the SlabSource enum, in plant words.
const SOURCES: [string, string][] = [
  ["QC_AUTOLINK", "From QC"],
  ["BULK_UPLOAD", "Bulk upload"],
  ["MANUAL_ENTRY", "Entered by hand"],
];

// Soft row tints by status, so held / gone / cut / printing stock reads at a
// glance without opening a single row. Selection's brand tint still wins.
const STATUS_TINT: Record<string, string> = {
  RESERVED:   "bg-amber-50/70 hover:bg-amber-50",
  PACKED:     "bg-orange-50/70 hover:bg-orange-50",
  DISPATCHED: "bg-gray-100/60 hover:bg-gray-100",
  RETURNED:   "bg-emerald-50/60 hover:bg-emerald-50",
  CTS:        "bg-sky-50/70 hover:bg-sky-50",
  CHROMIA:    "bg-violet-50/70 hover:bg-violet-50",
};

// Grade, thickness and bay are free-text columns and are NOT hardcoded any more: the old
// lists had drifted from the data, and because buildInventoryWhere matches thickness
// exactly, the 287 slabs recorded as "3 cm to 2 cm" / "2 cm to 1 cm" / "2cm to 8mm" could
// not be reached by that filter at all, while it offered "7 mm", which no slab has. The
// real values come from /api/inventory/filters; these remain only as the fallback for a
// failed fetch, so the row still works offline.
const FALLBACK_GRADES = ["A", "A2", "B", "C", "Trial"];
// Only reached if the fetch fails. Mirrors the list this replaced, minus "7 mm" (no slab
// has it) — dropping "8 mm"/"10 mm" here would make 32 slabs unfilterable in the degraded
// path, which the old list handled.
const FALLBACK_THICKNESSES = ["1.2 cm", "2 cm", "3 cm", "8 mm", "10 mm"];
// The canonical bays. Still used as-is by the bay-ASSIGNMENT control, which must offer
// every bay that exists on the floor, not only the ones that happen to hold stock today.
const BAYS = ["Bay 1", "Bay 2", "Bay 3", "Bay 4", "Bay 5"];

interface FilterOpts { thicknesses: string[]; grades: string[]; bays: string[]; pis: string[]; customers: string[]; designs: string[] }
const NO_OPTS: FilterOpts = { thicknesses: [], grades: [], bays: [], pis: [], customers: [], designs: [] };
const ACTIONS = [
  { value: "", label: "Change status…" },
  { value: "reserve", label: "Reserve (PI hold)" },
  { value: "pack", label: "Mark Packed" },
  { value: "dispatch", label: "Mark Dispatched" },
  { value: "return", label: "Mark Returned (un-dispatch)" },
  { value: "cts", label: "Mark CTS (cut to size)" },
  { value: "uncts", label: "Undo CTS (back to Available)" },
  { value: "release", label: "Release to Available" },
];
const EMPTY = { design: "", batch: "", thickness: "", grade: "", slab: "", bay: "", status: "", source: "", rw: "", pi: "", customer: "" };

// displaySlab (NB-label rule for legacy 9,000,000+ slabs) is shared from
// lib/slabLabel so this table and the register popup cannot disagree.

const fmtAt = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function InventoryDashboard({ admin: isRealAdmin = false, summaryOnly: roleSummaryOnly = false, slabsOnly: roleSlabsOnly = false }: { admin?: boolean; summaryOnly?: boolean; slabsOnly?: boolean }) {
  // ADMIN preview: view the module exactly as a Sales or Commercial login would
  // Admin-only preview of the module as each role that can reach it sees it.
  // "office" is Finance/Accounts: everything except the admin-only controls.
  const [viewAs, setViewAs] = useState<"admin" | "office" | "sales" | "commercial">("admin");
  const admin = isRealAdmin && viewAs === "admin";
  const summaryOnly = roleSummaryOnly || (isRealAdmin && viewAs === "sales");
  const slabsOnly = roleSlabsOnly || (isRealAdmin && viewAs === "commercial");
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [rows, setRows] = useState<Slab[]>([]);
  const [showPending, setShowPending] = useState(false); // ADMIN: include unapproved stock everywhere
  // How many slabs matched the filters but were withheld because Sales has not
  // approved their design+batch (the route counts them and says so in a header).
  const [withheld, setWithheld] = useState(0);
  const [sSorts, setSSorts] = useState<{ k: keyof Slab; d: 1 | -1 }[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ ...EMPTY });
  const [opts, setOpts] = useState<FilterOpts>(NO_OPTS);
  const [optsFailed, setOptsFailed] = useState(false);

  // dispatch move/assign
  // Selection is a Map (slab number -> the slab row), not a Set of numbers: the picked slabs
  // must survive the next search, so we keep their data with them. A search no longer clears
  // it — you can search, pick, search again, pick more, then act on the whole basket.
  const [sel, setSel] = useState<Map<number, Slab>>(new Map());
  const clearSel = () => setSel(new Map());
  const [mv, setMv] = useState({ bay: "", frame: "", clearBay: false, clearFrame: false });
  const [moving, setMoving] = useState(false);
  const [moveMsg, setMoveMsg] = useState<string | null>(null);
  const [st, setSt] = useState({ action: "", pi: "", customer: "", expiryDays: "" });
  const [invFile, setInvFile] = useState<File | null>(null);
  const [stBusy, setStBusy] = useState(false);

  // slab detail modal
  const [detail, setDetail] = useState<any | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  // which of the open slab's photos is showing full screen (null = none)
  const [lightbox, setLightbox] = useState<number | null>(null);

  // activity feed
  const [view, setView] = useState<"slabs" | "activity" | "designs" | "summary">("slabs");
  const [events, setEvents] = useState<SlabEvent[]>([]);
  const [evSlab, setEvSlab] = useState("");
  const [evLoading, setEvLoading] = useState(false);

  // design merge (admin)
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [designs, setDesigns] = useState<string[]>([]);
  const [merge, setMerge] = useState({ variant: "", canonical: "" });
  const [mergeMsg, setMergeMsg] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  const kpiFilters = useRef({ ...EMPTY }); // cards mirror the last search
  const showPendingRef = useRef(false);
  const loadKpi = () => {
    const p = new URLSearchParams();
    Object.entries(kpiFilters.current).forEach(([k, v]) => { if (v) p.set(k, v); });
    if (showPendingRef.current) p.set("pending", "1");
    fetch(`/api/inventory/kpi?${p.toString()}`).then((r) => (r.ok ? r.json() : null)).then((d) => setKpi(d && !d.error ? d : null)).catch(() => {});
  };
  useEffect(() => {
    loadKpi();
    // Live refresh every minute — but only while the tab is visible, and once
    // when it becomes visible again so a returned-to tab is current. Same gate
    // as the fab pages and StockByDesign; this one was missed, so a forgotten
    // /inventory tab kept hitting /api/inventory/kpi all night, and every tick
    // also re-rendered the 1000-row table below.
    const tick = () => { if (document.visibilityState === "visible") loadKpi(); };
    const id = setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (filters: typeof EMPTY) => {
    setLoading(true);
    // NOTE: the selection is deliberately NOT cleared here — it is cleared only after an
    // action succeeds (applyMove / applyStatus) or when the user clears it themselves.
    kpiFilters.current = { ...filters };
    loadKpi();
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    if (showPendingRef.current) p.set("pending", "1");
    fetch(`/api/inventory?${p.toString()}`)
      .then((r) => {
        const n = Number(r.headers.get("X-Withheld-Unapproved") ?? 0);
        setWithheld(Number.isFinite(n) ? n : 0);
        return r.ok ? r.json() : [];
      })
      .then((d) => {
        const list: Slab[] = Array.isArray(d) ? d : [];
        setRows(list);
        // keep the basket honest: refresh the data of any selected slab that this search
        // returned (its bay/status may have moved on). Selected slabs NOT in these results
        // stay in the basket untouched.
        setSel((s) => {
          if (s.size === 0) return s;
          const c = new Map(s);
          for (const r of list) if (c.has(r.slabNumber)) c.set(r.slabNumber, r);
          return c;
        });
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { run(EMPTY); }, []);
  useEffect(() => {
    // Fetch once. Values change only when stock does, and a stale option simply returns
    // no rows — so this is deliberately not refetched after every search.
    fetch("/api/inventory/filters")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setOpts({ ...NO_OPTS, ...d }); else setOptsFailed(true); })
      .catch(() => setOptsFailed(true));
  }, []);

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

  const [editing, setEditing] = useState(false);
  const [ef, setEf] = useState<Record<string, string>>({});
  const [editMsg, setEditMsg] = useState<string | null>(null);
  const startEdit = () => {
    const sl = detail?.slab; if (!sl) return;
    setEf({
      design: sl.designRaw ?? sl.design ?? "", batchNumber: sl.batchNumber ?? "", slabThickness: sl.slabThickness ?? "",
      grade: sl.grade ?? "", polishType: sl.polishType ?? "", bayNumber: sl.bayNumber ?? "",
      frameNumber: sl.frameNumber ?? "", notes: sl.notes ?? "",
    });
    setEditMsg(null); setEditing(true);
  };
  const saveEdit = async () => {
    if (!detail) return;
    setEditMsg(null);
    try {
      const r = await fetch("/api/inventory/slab/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slabNumber: detail.slabNumber, ...ef }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || d?.error) setEditMsg(d?.error ?? "Save failed.");
      else { setEditing(false); openDetail(detail.slabNumber); run(f); }
    } catch { setEditMsg("Save failed."); }
  };

  // useCallback with no deps: the body touches only state setters (stable) and
  // fetch, and a stable identity is what lets SlabRows below skip re-rendering.
  const openDetail = useCallback((n: number) => {
    setEditing(false);
    setLightbox(null);   // a photo from the last slab must not survive the next
    setDetailBusy(true); setDetail({ slabNumber: n });
    fetch(`/api/inventory/slab?number=${n}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDetail((cur: any) => (cur?.slabNumber === n ? (d && !d.error ? { slabNumber: n, ...d } : { slabNumber: n, error: d?.error ?? "Failed to load" }) : cur)))
      .catch(() => setDetail((cur: any) => (cur?.slabNumber === n ? { slabNumber: n, error: "Failed to load" } : cur)))
      .finally(() => setDetail((cur: any) => { if (cur?.slabNumber === n || cur == null) setDetailBusy(false); return cur; }));
  }, []);

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

  const toggle = useCallback((r: Slab) => setSel((s) => { const c = new Map(s); if (c.has(r.slabNumber)) c.delete(r.slabNumber); else c.set(r.slabNumber, r); return c; }), []);
  const allShownSelected = rows.length > 0 && rows.every((r) => sel.has(r.slabNumber));
  // header checkbox acts on THIS result page only — it never drops slabs picked in an earlier search
  const toggleAll = () => setSel((s) => {
    const c = new Map(s);
    if (allShownSelected) for (const r of rows) c.delete(r.slabNumber);
    else for (const r of rows) c.set(r.slabNumber, r);
    return c;
  });
  const selList = [...sel.values()].sort((a, b) => a.slabNumber - b.slabNumber);
  const MAX_ACTION_SLABS = 500;             // every action route caps at 500
  const tooMany = sel.size > MAX_ACTION_SLABS;

  const applyMove = async () => {
    if (sel.size === 0) return;
    const payload: Record<string, unknown> = { slabs: [...sel.keys()] };
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
        clearSel();
        run(f);
      }
    } catch { setMoveMsg("Move failed."); }
    finally { setMoving(false); }
  };

  // Commercial's dispatch is the only one of their two actions that records a sale, so
  // it alone asks for a PI, customer and invoice. CTS asks for none of them.
  const commercialDispatch = slabsOnly && st.action !== "cts" && st.action !== "uncts";

  const applyStatus = async () => {
    // Commercial used to be hardwired to dispatch. It may now also mark cut-to-size, so
    // the choice comes from the dropdown when they have made one; dispatch stays the
    // default so the existing one-click flow is unchanged.
    const action = slabsOnly ? (st.action === "cts" || st.action === "uncts" ? st.action : "dispatch") : st.action;
    if (sel.size === 0 || !action) return;
    if (action === "dispatch" && (invFile || slabsOnly)) {
      if (slabsOnly && !invFile) { setMoveMsg("Attach the invoice file."); return; }
      if (!st.pi.trim() || !st.customer.trim()) { setMoveMsg("PI number and customer name are required."); return; }
      setStBusy(true); setMoveMsg(null);
      try {
        const body = new FormData();
        body.set("slabs", JSON.stringify([...sel.keys()]));
        body.set("pi", st.pi.trim());
        body.set("customer", st.customer.trim());
        if (invFile) body.set("invoice", invFile);
        const r = await fetch("/api/inventory/dispatch", { method: "POST", body });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || d.error) setMoveMsg(d?.error ?? "Dispatch failed.");
        else {
          setMoveMsg(`Dispatched ${d.updated} slab(s)` + (d.skipped?.length ? `; ${d.skipped.length} skipped` : "") + (d.invoiceId ? " · invoice attached" : "") + ".");
          setSt({ action: "", pi: "", customer: "", expiryDays: "" }); setInvFile(null);
          clearSel();
          run(f); loadKpi();
        }
      } catch { setMoveMsg("Dispatch failed."); }
      finally { setStBusy(false); }
      return;
    }
    setStBusy(true); setMoveMsg(null);
    try {
      // `action`, not st.action: for Commercial the two differ whenever the dropdown is
      // left at its default, and posting the raw state would send "" instead of the
      // resolved action.
      const payload: Record<string, unknown> = { slabs: [...sel.keys()], action };
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
        clearSel();
        run(f); loadKpi();
      }
    } catch { setMoveMsg("Action failed."); }
    finally { setStBusy(false); }
  };

  // Memoised: a pure function of rows and the sort levels. Every keystroke in
  // the filter, move, status and edit boxes re-renders this component, and
  // re-sorting 1000 rows with localeCompare on each one was most of the
  // measured 50-60 ms per character.
  const displayRows = useMemo(() => sSorts.length
    ? [...rows].sort((a, b) => {
        for (const so of sSorts) {
          const va = a[so.k], vb = b[so.k];
          let c = 0;
          if (va == null && vb == null) c = 0;
          else if (va == null) c = 1 / so.d; // nulls always last
          else if (vb == null) c = -1 / so.d;
          else if (typeof va === "number" && typeof vb === "number") c = va - vb;
          else c = String(va).localeCompare(String(vb), undefined, { numeric: true });
          if (c) return so.d * c;
        }
        return 0;
      })
    : rows, [rows, sSorts]);
  // click = primary sort (asc -> desc -> off) · Shift+Click = add another level
  const slabSort = (k: keyof Slab, additive: boolean) =>
    setSSorts((cur) => {
      const i = cur.findIndex((x) => x.k === k);
      if (additive) {
        if (i >= 0) { const c = [...cur]; c[i] = { k, d: c[i].d === 1 ? -1 : 1 }; return c; }
        return [...cur, { k, d: 1 }];
      }
      if (i === 0 && cur.length === 1) return cur[0].d === 1 ? [{ k, d: -1 }] : [];
      return [{ k, d: 1 }];
    });
  const slabArrow = (k: keyof Slab) => {
    const i = sSorts.findIndex((x) => x.k === k);
    if (i < 0) return "";
    return (sSorts[i].d === 1 ? " ▴" : " ▾") + (sSorts.length > 1 ? String(i + 1) : "");
  };
  const thSort = "cursor-pointer px-3 py-2 hover:text-brand";

  const viewAsControl = isRealAdmin ? (
    <label className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-600" title="Preview the module as another role sees it">
      View as
      <select
        className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
        value={viewAs}
        onChange={(e) => {
          const v = e.target.value as "admin" | "office" | "sales" | "commercial";
          setViewAs(v);
          showPendingRef.current = showPending && v === "admin";
          // Land on the view that role actually opens on. Commercial has no
          // tabs at all, so previewing it while parked on "Stock by Design" or
          // "Designs" showed a screen they can never reach.
          if (v !== "admin") setView("slabs");
          kpiFilters.current = { ...EMPTY };
          run(EMPTY); setF({ ...EMPTY });
        }}
      >
        <option value="admin">Admin</option>
        {/* Finance and Accounts reach this module too, and see materially less
            than Admin — no approvals, no Designs tab, no Excel export. Without
            an option for them the preview could not show that screen at all. */}
        <option value="office">Finance / Accounts</option>
        <option value="sales">Sales</option>
        <option value="commercial">Commercial</option>
      </select>
    </label>
  ) : null;

  const applyCard = (patch: Partial<typeof EMPTY>) => {
    const next = { ...EMPTY, ...patch };
    setView("slabs"); setF(next); run(next);
  };
  const card = (label: string, value: number, tone = "text-gray-900", patch?: Partial<typeof EMPTY>) => (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 ${patch ? "cursor-pointer transition hover:border-brand hover:shadow-sm" : ""}`}
      title={patch ? "Click to see these slabs" : undefined}
      onClick={patch ? () => applyCard(patch) : undefined}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value.toLocaleString("en-IN")}</div>
    </div>
  );
  const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
  const tabCls = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-brand text-white" : "text-gray-600 hover:bg-gray-100"}`;

  if (summaryOnly) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Finished-Goods Stock</h1>
            <p className="mt-1 text-sm text-gray-500">Stock by design, thickness and batch.</p>
          </div>
          {viewAsControl}
        </div>
        <StockByDesign />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Finished-Goods Inventory</h1>
          <p className="mt-1 text-sm text-gray-500">Slabs from QC approval through packing &amp; dispatch.</p>
        </div>
        {viewAsControl}
        {admin && !slabsOnly && (
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800" title="Admin only — include stock that is still awaiting approval in every list and card">
            <input type="checkbox" checked={showPending} onChange={(e) => { setShowPending(e.target.checked); showPendingRef.current = e.target.checked; if (!e.target.checked) clearSel(); run(f); }} />
            Show unapproved stock
          </label>
        )}
        {!slabsOnly && <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
          <button className={tabCls(view === "slabs")} onClick={() => { setView("slabs"); kpiFilters.current = { ...f }; loadKpi(); }}>Slabs</button>
          <button className={tabCls(view === "summary")} onClick={() => setView("summary")}>Stock by Design</button>
          <button className={tabCls(view === "activity")} onClick={() => openActivity(evSlab)}>Activity</button>
          {admin && <button className={tabCls(view === "designs")} onClick={() => { setView("designs"); loadDesigns(); }}>Designs</button>}
        </div>}
      </div>

      <PolishingReport />

      {!slabsOnly && kpi && (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Stock</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
              {card("Total Slabs", kpi.total, "text-gray-900", {})}
              {card("Available", kpi.available, "text-emerald-600", { status: "AVAILABLE" })}
              {card("Reserved", kpi.reserved, "text-amber-600", { status: "RESERVED" })}
              {card("Packed", kpi.packed, "text-amber-600", { status: "PACKED" })}
              {card("Returned", kpi.returned, "text-sky-600", { status: "RETURNED" })}
              {card("Cut to size", kpi.ctsStatus, "text-amber-600", { status: "CTS" })}
              {card("At Chromia", kpi.chromia ?? 0, "text-violet-600", { status: "CHROMIA" })}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Grades (in stock)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {card("Grade A", kpi.gradeA, "text-gray-900", { grade: "A" })}
              {card("Grade A2", kpi.gradeA2, "text-gray-900", { grade: "A2" })}
              {card("Grade B", kpi.gradeB, "text-gray-900", { grade: "B" })}
              {card("Grade C", kpi.gradeC, "text-gray-900", { grade: "C" })}
              {card("CTS", kpi.cts, "text-gray-900", { grade: "CTS" })}
              {card("Printing", kpi.printing, "text-gray-900", { grade: "Printing" })}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Thickness (in stock)</p>
              <div className="grid grid-cols-3 gap-3">
                {card("1.2 cm", kpi.thk12cm, "text-gray-900", { thickness: "1.2 cm" })}
                {card("2 cm", kpi.thk2cm, "text-gray-900", { thickness: "2 cm" })}
                {card("3 cm", kpi.thk3cm, "text-gray-900", { thickness: "3 cm" })}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Needs attention</p>
              <div className="grid grid-cols-2 gap-3">
                {card("Pending R/W", kpi.pendingRw, "text-red-600", { rw: "1" })}
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "summary" ? (
        <StockByDesign
          canApprove={admin}
          // AND admin: the strip that shows unapproved stock is already gated on
          // canApprove, but the fetch behind it is not — so while previewing
          // another role this still pulled ?pending=1 and folded unapproved
          // stock into totals that role can never see.
          showPending={showPending && admin}
          onFilters={(sf) => { kpiFilters.current = { ...EMPTY, design: sf.design, thickness: sf.thickness, batch: sf.batch }; loadKpi(); }}
          onOpenSlabs={admin ? (sel) => { const next = { ...EMPTY, design: sel.design ?? "", thickness: sel.thickness ?? "", batch: sel.batch ?? "" }; setView("slabs"); setF(next); run(next); } : undefined}
        />
      ) : view === "designs" && admin ? (
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
          <form className="rounded-xl border border-gray-200 bg-white p-4" onSubmit={(e) => { e.preventDefault(); run(f); }}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {/* Free text: the term is matched alias-aware server-side, so partial text is
                  the point. The list offers CANONICAL names only — the raw column holds 414
                  values but 274 of them are merged-away variants that buildInventoryWhere
                  explicitly excludes, so offering those would suggest 274 dead searches. */}
              <input className={inputCls} placeholder="Colour / design" list="inv-designs" value={f.design} onChange={(e) => setF({ ...f, design: e.target.value })} />
              <datalist id="inv-designs">{opts.designs.map((d) => <option key={d} value={d} />)}</datalist>

              <input className={inputCls} placeholder="Batch" value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} />
              <input className={inputCls} placeholder="Slab # / barcode" value={f.slab} onChange={(e) => setF({ ...f, slab: e.target.value })} />

              {/* PI and customer: new. Both were already visible per slab in the detail
                  panel, but there was no way to ask "everything on PI 1416" — the question
                  a Commercial login exists to answer. */}
              <select className={inputCls} value={f.pi} onChange={(e) => { const n = { ...f, pi: e.target.value }; setF(n); run(n); }}>
                <option value="">{optsFailed ? "PI list unavailable" : "Any PI"}</option>
                {opts.pis.map((v) => <option key={v} value={v}>PI {v}</option>)}
                <option value={NONE}>— no PI —</option>
              </select>
              <select className={inputCls} value={f.customer} onChange={(e) => { const n = { ...f, customer: e.target.value }; setF(n); run(n); }}>
                <option value="">{optsFailed ? "Customer list unavailable" : "Any customer"}</option>
                {opts.customers.map((v) => <option key={v} value={v}>{v}</option>)}
                <option value={NONE}>— no customer —</option>
              </select>

              <select className={inputCls} value={f.bay} onChange={(e) => { const n = { ...f, bay: e.target.value }; setF(n); run(n); }}>
                <option value="">Any bay</option>
                {(opts.bays.length ? opts.bays : BAYS).map((b) => <option key={b} value={b}>{b}</option>)}
                <option value={NONE}>— no bay —</option>
              </select>
              <select className={inputCls} value={f.grade} onChange={(e) => { const n = { ...f, grade: e.target.value }; setF(n); run(n); }}>
                <option value="">Any grade</option>
                {(() => {
                  const list = opts.grades.length ? opts.grades : FALLBACK_GRADES;
                  // The KPI cards can set a grade that no slab currently has (CTS,
                  // Printing). Without an option for it the select would fall back to
                  // showing "Any grade" while the results ARE filtered — so keep it.
                  const all = f.grade && f.grade !== NONE && !list.includes(f.grade) ? [...list, f.grade] : list;
                  return all.map((g) => <option key={g} value={g}>{g}</option>);
                })()}
                <option value={NONE}>— not graded —</option>
              </select>
              <select className={inputCls} value={f.thickness} onChange={(e) => { const n = { ...f, thickness: e.target.value }; setF(n); run(n); }}>
                <option value="">Any thickness</option>
                {(() => {
                  const list = opts.thicknesses.length ? opts.thicknesses : FALLBACK_THICKNESSES;
                  // Same guard as grade: onOpenSlabs can set a thickness the fallback list
                  // lacks ("3 cm to 2 cm"), and without an option the select would read
                  // "Any thickness" while the results ARE filtered.
                  const all = f.thickness && f.thickness !== NONE && !list.includes(f.thickness) ? [...list, f.thickness] : list;
                  return all.map((t) => <option key={t} value={t}>{t}</option>);
                })()}
                <option value={NONE}>— not set —</option>
              </select>
              <select className={inputCls} value={f.status} onChange={(e) => { const n = { ...f, status: e.target.value }; setF(n); run(n); }}>{STATUSES.map((s) => <option key={s} value={s}>{s || "Any status"}</option>)}</select>
              <select className={inputCls} value={f.source} onChange={(e) => { const n = { ...f, source: e.target.value }; setF(n); run(n); }}>
                <option value="">Any source</option>
                {SOURCES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>
            {f.rw === "1" && (
              <p className="mt-2 text-xs text-red-600">Showing: Pending R/W slabs <button type="button" className="ml-1 underline" onClick={() => { const n = { ...f, rw: "" }; setF(n); run(n); }}>clear</button></p>
            )}
            <div className="mt-3 flex gap-2">
              <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark">Search</button>
              <button type="button" onClick={() => { setF({ ...EMPTY }); run(EMPTY); }} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Clear</button>
              {admin && (
                <a
                  href={`/api/inventory/export?${(() => { const p = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); }); if (showPending && admin) p.set("pending", "1"); return p.toString(); })()}`}
                  className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                  title="Excel file of everything matching the current filters"
                >
                  ⬇ Download (Excel)
                </a>
              )}
            </div>
          </form>

          {/* The basket: every slab picked so far, in its OWN table outside the results table.
              It survives a new search, so you can gather slabs across several searches before
              acting. Nothing here changes the results table below — until an action is applied. */}
          {sel.size > 0 && (
            <div className="overflow-x-auto rounded-xl border border-brand/30 bg-white">
              <div className="flex items-center justify-between border-b border-brand/20 bg-brand/5 px-3 py-2">
                <div className="text-sm font-medium text-gray-900">Selected slabs · {sel.size}</div>
                <button onClick={clearSel} className="text-xs text-gray-500 underline hover:text-gray-800">Clear all</button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="px-3 py-2">Slab #</th><th className="px-3 py-2">Design</th><th className="px-3 py-2">Batch</th>
                    <th className="px-3 py-2">Thk</th><th className="px-3 py-2">Grade</th><th className="px-3 py-2">Bay</th>
                    <th className="px-3 py-2">Status</th><th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {selList.map((r) => (
                    <tr key={`sel-${r.slabNumber}`} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-3 py-2 font-medium text-gray-900">
                        <button className="hover:text-brand hover:underline" title="View slab details" onClick={() => openDetail(r.slabNumber)}>{displaySlab(r.slabNumber, r.barcode)}</button>
                      </td>
                      <td className="px-3 py-2">{r.design ?? "—"}</td>
                      <td className="px-3 py-2">{displayBatch(r.batchNumber)}</td>
                      <td className="px-3 py-2">{r.slabThickness ?? "—"}</td>
                      <td className="px-3 py-2">{r.grade ?? "—"}</td>
                      <td className="px-3 py-2">{r.bayNumber ?? "—"}</td>
                      <td className="px-3 py-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{r.status}</span></td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => toggle(r)} title="Remove from selection" className="rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-500 hover:border-red-300 hover:text-red-600">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {sel.size > 0 && (
            <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="text-sm font-medium text-gray-900">{sel.size} slab(s) selected</div>
                {!slabsOnly && <><div className="w-36">
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
                <button onClick={applyMove} disabled={moving || tooMany} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50">{moving ? "Applying…" : "Apply"}</button></>}
                <button onClick={clearSel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Deselect all</button>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-brand/10 pt-3">
                {slabsOnly ? (
                  // Commercial has exactly two actions. Dispatch is the default so the
                  // existing flow is unchanged; CTS records no sale, so it asks for no PI,
                  // customer or invoice (see the conditions on those fields below).
                  <div className="w-56">
                    <label className="mb-1 block text-xs font-medium text-gray-500">Action</label>
                    <select className={inputCls} value={st.action === "cts" || st.action === "uncts" ? st.action : "dispatch"} onChange={(e) => setSt({ ...st, action: e.target.value })}>
                      <option value="dispatch">Mark Dispatched</option>
                      <option value="cts">Mark CTS (cut to size)</option>
                      <option value="uncts">Undo CTS (back to Available)</option>
                    </select>
                  </div>
                ) : (
                <div className="w-56">
                  <label className="mb-1 block text-xs font-medium text-gray-500">Status action</label>
                  <select className={inputCls} value={st.action} onChange={(e) => setSt({ ...st, action: e.target.value })}>
                    {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                )}
                {(commercialDispatch || (!slabsOnly && (st.action === "reserve" || st.action === "dispatch"))) && (
                  <div className="w-40">
                    <label className="mb-1 block text-xs font-medium text-gray-500">PI no.</label>
                    <input className={inputCls} placeholder="PI" value={st.pi} onChange={(e) => setSt({ ...st, pi: e.target.value })} />
                  </div>
                )}
                {(commercialDispatch || (!slabsOnly && (st.action === "reserve" || st.action === "dispatch"))) && (
                  <div className="w-44">
                    <label className="mb-1 block text-xs font-medium text-gray-500">Customer</label>
                    <input className={inputCls} placeholder="Customer" value={st.customer} onChange={(e) => setSt({ ...st, customer: e.target.value })} />
                  </div>
                )}
                {(commercialDispatch || (admin && st.action === "dispatch")) && (
                  <div className="w-60">
                    <label className="mb-1 block text-xs font-medium text-gray-500">Invoice (PDF/image){commercialDispatch ? "" : " — optional"}</label>
                    <input type="file" accept="application/pdf,image/*" className="block w-full text-xs text-gray-600 file:mr-2 file:rounded-lg file:border-0 file:bg-brand/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-brand"
                      onChange={(e) => setInvFile(e.target.files?.[0] ?? null)} />
                  </div>
                )}
                {st.action === "reserve" && admin && (
                  <div className="w-28">
                    <label className="mb-1 block text-xs font-medium text-gray-500">Hold (days)</label>
                    <input className={inputCls} placeholder="7" value={st.expiryDays} onChange={(e) => setSt({ ...st, expiryDays: e.target.value })} />
                  </div>
                )}
                <button onClick={applyStatus} disabled={stBusy || tooMany || (!slabsOnly && !st.action)} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark disabled:opacity-50">{stBusy ? "Applying…" : slabsOnly ? (st.action === "cts" ? "Mark CTS" : st.action === "uncts" ? "Undo CTS" : "Mark Dispatched") : "Apply status"}</button>
                {st.action === "reserve" && !admin && <p className="pb-2 text-xs text-gray-400">7-day hold (Admin can change)</p>}
              </div>
              {tooMany && <p className="mt-2 text-xs font-medium text-red-600">{sel.size} slabs selected — actions are limited to {MAX_ACTION_SLABS} at a time. Remove some from the selection above.</p>}
              <p className="mt-2 text-xs text-gray-500">Blank field = unchanged. Reservations auto-release after the hold lapses. Every change is logged to the audit trail.</p>
            </div>
          )}
          {moveMsg && <p className="text-sm text-gray-600">{moveMsg}</p>}

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="px-3 py-2"><input type="checkbox" title="Select every slab in these results" checked={allShownSelected} onChange={toggleAll} /></th>
                  <th className={thSort} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("slabNumber", e.shiftKey)}>Slab #{slabArrow("slabNumber")}</th><th className={thSort} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("design", e.shiftKey)}>Design{slabArrow("design")}</th><th className={thSort} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("batchNumber", e.shiftKey)}>Batch{slabArrow("batchNumber")}</th>
                  <th className={thSort} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("slabThickness", e.shiftKey)}>Thk{slabArrow("slabThickness")}</th><th className={thSort} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("grade", e.shiftKey)}>Grade{slabArrow("grade")}</th><th className="px-3 py-2">Quality Issue</th><th className={thSort} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("polishType", e.shiftKey)}>Polish{slabArrow("polishType")}</th>
                  <th className={thSort} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("bayNumber", e.shiftKey)}>Bay{slabArrow("bayNumber")}</th><th className={thSort} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("frameNumber", e.shiftKey)}>Frame{slabArrow("frameNumber")}</th><th className={`${thSort} text-right`} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("sqft", e.shiftKey)}>Sqft{slabArrow("sqft")}</th><th className={`${thSort} text-right`} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("ageDays", e.shiftKey)}>Age{slabArrow("ageDays")}</th><th className={thSort} title="Sort · Shift+Click adds a level" onClick={(e) => slabSort("status", e.shiftKey)}>Status{slabArrow("status")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={13} className="px-3 py-10 text-center text-gray-400">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={13} className="px-3 py-10 text-center text-gray-400">
                    No slabs match the current filters.
                    {withheld > 0 && <span className="mt-1 block text-amber-700">{withheld === 1 ? "One slab matches" : `${withheld.toLocaleString("en-IN")} slabs match`} but {withheld === 1 ? "is" : "are"} held back — see below.</span>}
                  </td></tr>
                ) : (
                  <SlabRows rows={displayRows} sel={sel} onToggle={toggle} onOpen={openDetail} />
                )}
              </tbody>
            </table>
          </div>
          {/* NOT SHOWN, AND WHY. Sales approves stock by design+batch; anything
              outside that list is withheld from this view whatever its source —
              a hand-entered slab with a batch nobody has approved yet, a typo'd
              design, an autolinked slab of a new batch. Saying nothing made the
              source filter look broken. */}
          {!loading && withheld > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {withheld.toLocaleString("en-IN")} more slab{withheld === 1 ? "" : "s"} match{withheld === 1 ? "es" : ""} these filters but {withheld === 1 ? "is" : "are"} not listed:
              {" "}{withheld === 1 ? "its" : "their"} design and batch are not on the Sales-approved list yet.
              {admin
                ? " Tick “Show unapproved stock” above to include them."
                : " An administrator can show them with “Show unapproved stock”."}
            </p>
          )}
          {!loading && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
              <span>{rows.length.toLocaleString("en-IN")} slab(s){rows.length === 1000 ? " (showing first 1000 — narrow the filters)" : ""}.</span>
              {/* what the row tints mean — AVAILABLE stays untinted on purpose */}
              {([["bg-amber-100", "Reserved"], ["bg-orange-100", "Packed"], ["bg-gray-200", "Dispatched"], ["bg-emerald-100", "Returned"], ["bg-sky-100", "Cut to size"], ["bg-violet-100", "At Chromia"]] as [string, string][]).map(([dot, label]) => (
                <span key={label} className="inline-flex items-center gap-1.5"><span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />{label}</span>
              ))}
            </div>
          )}
        </>
      )}
      {/* Above the slab panel, and closed with it — a photo left open over a
          dismissed panel would belong to a slab no longer on screen. */}
      {detail && Array.isArray(detail.photos) && (
        <Lightbox
          photos={detail.photos as LightboxPhoto[]}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          title={`Slab ${displaySlab(detail.slabNumber, detail.slab?.barcode)}`}
        />
      )}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={() => { setLightbox(null); setDetail(null); }}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Slab {displaySlab(detail.slabNumber, detail.slab?.barcode)}</h2>
                {detail.slab && <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{detail.slab.status}</span>}
              </div>
              <div className="flex gap-2">
                {admin && detail.slab && !editing && (
                  <button onClick={startEdit} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Edit</button>
                )}
                <button onClick={() => { setLightbox(null); setDetail(null); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Close ✕</button>
              </div>
            </div>
            {detailBusy ? (
              <p className="py-10 text-center text-gray-400">Loading…</p>
            ) : detail.error ? (
              <p className="py-10 text-center text-gray-400">{detail.error}</p>
            ) : (
              <div className="mt-4 space-y-5">
                {detail.slab && editing && (
                  <div className="space-y-3 rounded-xl border border-brand/20 bg-brand/[0.03] p-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {([["design","Design"],["batchNumber","Batch"],["slabThickness","Thickness"],["grade","Grade"],["polishType","Polish type"],["bayNumber","Bay"],["frameNumber","Frame"]] as [string,string][]).map(([k, label]) => (
                        <label key={k} className="block">
                          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</span>
                          <input className={inputCls} value={ef[k] ?? ""} onChange={(e) => setEf({ ...ef, [k]: e.target.value })} />
                        </label>
                      ))}
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Notes</span>
                      <input className={inputCls} value={ef.notes ?? ""} onChange={(e) => setEf({ ...ef, notes: e.target.value })} />
                    </label>
                    {editMsg && <p className="text-sm text-red-600">{editMsg}</p>}
                    <div className="flex gap-2">
                      <button onClick={saveEdit} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark">Save changes</button>
                      <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                      {detail.qc?.id && <a href={`/tables/PolishQc/${detail.qc.id}`} className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Open QC record →</a>}
                    </div>
                    <p className="text-xs text-gray-400">Every change is logged. QC-owned fields will be refreshed if this slab passes QC again.</p>
                  </div>
                )}
                {detail.slab && !editing && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    {([
                      ["Design", detail.slab.design], ["Batch", displayBatch(detail.slab.batchNumber)], ["Thickness", detail.slab.slabThickness],
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
                {Array.isArray(detail.photos) && detail.photos.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-900">Photos</h3>
                    <p className="mb-2 text-xs text-gray-400">Click a photo to see it full screen.</p>
                    <div className="flex flex-wrap gap-3">
                      {detail.photos.map((p: LightboxPhoto, i: number) => (
                        <button key={p.id} type="button" onClick={() => setLightbox(i)} className="block text-left" title={`${p.filename} — click to enlarge`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/photo?id=${p.id}`} alt={p.filename} className="h-28 w-28 rounded-lg border border-gray-200 object-cover transition hover:border-brand hover:shadow-sm" />
                          <span className="mt-1 block text-center text-[11px] text-gray-500">
                            {p.slot === "far" ? "Far — whole slab" : p.slot === "near" ? "Near — the defect" : "Photo"}
                          </span>
                        </button>
                      ))}
                    </div>
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
                {detail.invoice && (
                  <p className="text-sm text-gray-600">
                    Invoice: <a className="font-medium text-brand hover:underline" href={`/api/inventory/invoice?id=${detail.invoice.id}`}>{detail.invoice.filename}</a>
                    {detail.invoice.pi ? ` · PI ${detail.invoice.pi}` : ""}{detail.invoice.customer ? ` · ${detail.invoice.customer}` : ""} · {fmtAt(detail.invoice.at)}
                  </p>
                )}
                {/* A hand-entered slab has no production timeline to open: it
                    exists BECAUSE the line never recorded it, so /slab would
                    answer with an empty page. The button is for slabs the
                    plant actually made rows for. */}
                {detail.slab?.source !== "MANUAL_ENTRY" && (
                  <div className="flex justify-end">
                    <a href={`/slab?s=${detail.slabNumber}`} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-dark">Full production timeline →</a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The result rows, memoised. The filter, move, status and edit inputs all
 *  live in InventoryDashboard's state, so every keystroke re-rendered the
 *  whole dashboard — including up to 1000 of these rows and their checkboxes
 *  (measured 50-60 ms per character in jsdom before the browser laid anything
 *  out). With the rows behind memo and stable callbacks, a keystroke re-renders
 *  only the form strip; the rows still re-render whenever rows, the sort or
 *  the selection change, exactly as before. Markup is byte-for-byte what the
 *  inline map produced. */
const SlabRows = memo(function SlabRows({ rows, sel, onToggle, onOpen }: {
  rows: Slab[]; sel: Map<number, Slab>; onToggle: (r: Slab) => void; onOpen: (n: number) => void;
}) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.id} className={`border-t border-gray-50 ${sel.has(r.slabNumber) ? "bg-brand/5 hover:bg-brand/10" : STATUS_TINT[r.status] ?? "hover:bg-gray-50/50"}`}>
          <td className="px-3 py-2"><input type="checkbox" checked={sel.has(r.slabNumber)} onChange={() => onToggle(r)} /></td>
          <td className="px-3 py-2 font-medium text-gray-900">
            <button className="hover:text-brand hover:underline" title="View slab details" onClick={() => onOpen(r.slabNumber)}>{displaySlab(r.slabNumber, r.barcode)}</button>
          </td>
          <td className="px-3 py-2">{r.design ?? "—"}</td>
          <td className="px-3 py-2">{displayBatch(r.batchNumber)}</td>
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
      ))}
    </>
  );
});
