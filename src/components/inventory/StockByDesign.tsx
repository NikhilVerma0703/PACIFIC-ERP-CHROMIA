"use client";
// Stock summary styled after the physical stock register: SL.NO + merged
// colour cell, a row per thickness+batch, full grid lines, yellow sticky
// header. Designs collapsed by default; all trial designs under "Trials".
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { displaySlab } from "@/lib/slabLabel";
// The same chip the slab table and the fab CEO board use — one drawing of one
// fact, so the three screens cannot disagree about what a cut slab looks like.
import { MarkChip } from "@/components/fab/SlabChips";
import { SLAB_MARK_LABEL } from "@/lib/fab/slabMark";
import { NONE } from "@/lib/inventory/filterValues";

// `mark` is what became of the slab. /api/inventory/batch-quality now selects
// fg_finished_slab.slab_mark and sends it (it did not when the Mark column
// shipped, which is why the column printed a dash on all 205 slabs of Arva
// White · 2 cm · 1413 while 11 of them had been cut).
//
// IT IS STILL OPTIONAL, and the popup must not read a missing `mark` as "whole".
// The comment that used to sit here said MarkChip's `legacyGrade` covers a row
// with no mark by reading the old grade='CTS' write — THAT IS NO LONGER TRUE.
// scripts/0071 and 0072 regraded all 63 cut slabs to 'B', so on live Neon today
// slabMarkOf(undefined, 'B') is FULL_SLAB for a slab that has been cut. The
// route therefore says whether it could read the column at all (`markAvailable`)
// and the column below renders "?" when it could not, never a dash.
interface QcSlab { slab: number; grade: string | null; mark?: string | null; issues: string[]; rw: string | null; repolish: string | null; status: string | null; barcode: string | null }
interface QcTarget { design: string; thickness: string; batch: string }

// R/W and repolish, tinted by what they mean on the floor: "RW Required and
// ongoing" is live rework (red), "Repolish Required" is pending polish work
// (amber). "Can't be Reworked" is a REPAIRABILITY flag, not scrap — it stays
// neutral. The Ok states print quietly; they are information, not alarm.
const RW_ONGOING = /^rw required/i;
const REPOLISH_REQUIRED = /^repolish required/i;
const CANT_REWORK = /^can'?t be reworked/i;
function WorkState({ v, alarm }: { v: string | null; alarm: RegExp }) {
  if (!v) return <span className="text-gray-300">—</span>;
  if (alarm.test(v)) {
    const tone = alarm === RW_ONGOING ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
    return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{v}</span>;
  }
  if (CANT_REWORK.test(v)) return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{v}</span>;
  return <span className="text-xs text-gray-400">{v}</span>;
}

interface Row {
  design: string; thickness: string; batch: string; rawBatch?: string; total: number; dispatched: number;
  bay5: number; bay4: number; bay3: number; nobay: number;
  a: number; a2: number; b: number; c: number; cts: number; printing: number;
  // `cut` is NOT a grade and does not belong to the partition above — see the
  // column comment in the header. It counts slabs that have been cut, by grade
  // OR by mark, and therefore overlaps A/A2/B/C on purpose: every one of the 61
  // cut slabs on the floor today is grade B AND mark CTS, counted under both.
  trial: number; ungraded: number; cut: number; pending_polish: number; pending_rw: number;
  approved: boolean; designApproved: boolean; pending: boolean;
}
// THE ORDER OF THIS LIST IS THE ORDER OF THE COLUMNS. The grand-total row in the
// tfoot renders `NUMS.filter(...).map(...)`, while the header is a separate
// literal — so a key inserted here in the wrong place prints every grand total
// from that point on under the wrong heading, with no error anywhere. "cut" goes
// where its column goes: after the grade partition, beside R/W, because it is
// not a grade. tests/inventoryMarkFilter.test.ts pins the two orders together.
const NUMS = ["total","dispatched","bay5","bay4","bay3","nobay","a","a2","b","c","cts","printing","trial","ungraded","cut","pending_polish","pending_rw"] as const;
type Agg = Record<(typeof NUMS)[number], number>;

/** EVERY COUNT ARRIVES AS A NUMBER OR AS ZERO — NEVER AS undefined.
 *
 *  sumRows below does `out[k] += r[k]`, so ONE key missing from the summary
 *  payload does not blank one cell: it makes that column NaN for the design, the
 *  thickness group, the design total AND the grand total, and NaN renders as the
 *  same "-" a real zero does. The register would look right and be wrong.
 *
 *  This is not hypothetical any more. /api/inventory/summary grew a `cut` column
 *  in the same breath as this file (slabs cut by grade OR by mark — 61 on the
 *  floor, measured on live Neon 2026-09-03, all found by the mark since 0071 and
 *  0072 emptied the grade of routing states), and the two may deploy in either
 *  order. A
 *  register running against a route that does not send `cut` yet prints "-" in
 *  that one column, which is visibly missing rather than quietly wrong — and,
 *  crucially, leaves every other column and both totals correct. */
function normalizeRow(r: Record<string, unknown>): Row {
  const out: Record<string, unknown> = { ...r };
  for (const k of NUMS) {
    const n = Number(r?.[k]);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  return out as unknown as Row;
}

function sumRows(rows: Row[]): Agg {
  const out = Object.fromEntries(NUMS.map((k) => [k, 0])) as Agg;
  for (const r of rows) for (const k of NUMS) out[k] += r[k];
  return out;
}

const bcell = "border border-gray-300 px-2 py-1.5 text-center tabular-nums";
/** The existing thickness select's classes, lifted to a constant so the four
 *  admin filters beside it cannot drift into looking like a different control. */
const selCls = "rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

function Cells({ v }: { v: Agg }) {
  const cell = (n: number, cls = "") => (
    <td className={`${bcell} ${n ? cls : "text-gray-300"}`}>{n || "-"}</td>
  );
  return (
    <>
      <td className={`${bcell} font-semibold`}>{v.total || "-"}</td>
      {cell(v.a, "font-semibold")}{cell(v.a2)}{cell(v.b)}{cell(v.c)}
      {cell(v.cts)}{cell(v.printing)}{cell(v.trial)}{cell(v.ungraded, "text-gray-500")}
      {/* Indigo, the same ink MarkChip uses for a fabrication mark, and never the
          red of R/W beside it: a cut slab is not a fault. It is also not on the
          grade scale, which is why it is out here past "No Gr." rather than
          sitting between C and Print pretending to be a verdict. */}
      {cell(v.cut, "font-medium text-indigo-700")}
      {cell(v.pending_rw, "font-semibold text-red-600")}
    </>
  );
}

// ══════════ THE FOUR SERVER-SIDE FILTERS, AND WHY THEY ARE NOT LIKE THE OTHER THREE ══
//
// Colour, thickness and batch filter the rows ALREADY FETCHED, in the browser.
// That works because they are grouping keys: every row the register prints is
// one (design, thickness, batch), so hiding rows cannot change a number inside
// one. Source, status, bay and mark are properties of the individual SLABS
// underneath, so they can only be applied where the counting happens — in
// /api/inventory/summary. They travel as a query string and re-fetch.
//
// ALL FOUR ARE ADMIN-ONLY (owner, 2026-09-03: "all the new filters you'll be
// addin in stock by design should be only visible and accessable for admin
// view"). `canApprove` is the admin flag InventoryDashboard already passes down,
// and it decides whether these are DRAWN. It does NOT decide whether they WORK:
// the summary route re-reads the role off the session and refuses the four
// parameters outright for anybody else, because a hidden select is not an access
// control and a query string can be typed. Both halves exist on purpose.
type RegisterFilters = { source: string; status: string; bay: string; mark: string };
const NO_SERVER_FILTERS: RegisterFilters = { source: "", status: "", bay: "", mark: "" };

/** Option lists for the four, handed down rather than fetched again: the values
 *  come from /api/inventory/filters (bays, marks) and from the dashboard's own
 *  SOURCES / STATUSES constants, all of which InventoryDashboard already holds.
 *  A second fetch of the same lists would be a second chance for the two screens
 *  to offer different options for the same column. */
export interface RegisterFilterOptions {
  bays?: string[];
  /** Absent OR EMPTY means the register cannot be filtered by mark — the same
   *  signal the slab list's mark select reads, and the control hides rather
   *  than posting a `mark=` the summary route would refuse.
   *
   *  The "or empty" half is new and is the whole point: /api/inventory/filters
   *  used to answer `['FULL_SLAB']` on a checkout where slab_mark is unreadable,
   *  so the one state this is meant to hide in was the one state it drew a
   *  select in — offering the single value that returns 503. offerableMarks now
   *  returns [] there, and `marks?.length` covers both cases in one test. */
  marks?: string[];
  sources?: readonly (readonly [string, string])[];
  statuses?: readonly string[];
}

export function StockByDesign({ canApprove = false, showPending = false, filterOptions, onFilters, onOpenSlabs }: {
  canApprove?: boolean;
  showPending?: boolean;
  filterOptions?: RegisterFilterOptions;
  onFilters?: (f: { design: string; thickness: string; batch: string } & RegisterFilters) => void;
  onOpenSlabs?: (sel: { design?: string; thickness?: string; batch?: string } & Partial<RegisterFilters>) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [thick, setThick] = useState("");
  const [batchQ, setBatchQ] = useState("");
  // The four that go to the server. Admin-only, and never sent when the four
  // controls are not drawn — see the block above the component.
  const [srv, setSrv] = useState<RegisterFilters>({ ...NO_SERVER_FILTERS });
  // ══ WHAT THE ROWS ON SCREEN WERE COUNTED UNDER — not what the selects hold ══
  //
  // The heading used to read `srv` directly, so it changed the instant a select
  // did, while the PREVIOUS fetch's rows were still under it. setLoading(true)
  // is deliberately NOT called on a refetch: the same load() runs on the 30s
  // poll and on every focus/visibilitychange, and blanking a ~2,300-row /
  // ~400 KB register to "Loading…" twice a minute on a plant tablet is worse
  // than a heading that lags by one request.
  //
  // So the two were made to lag TOGETHER instead. Measured on live Neon
  // 2026-09-03 by replaying this route's merge/alias/approval logic: setting
  // bay='Bay 4' printed "every count below is for Bay 4 only" over a Grand
  // Total of 15,716 — the whole yard — and CLEARING it dropped the heading
  // while Bay 4's own 4,407 was still on screen, which reads as an unfiltered
  // yard holding 4,407 slabs. `shown` is written in the SAME .then that writes
  // the rows, so the sentence above the table and the numbers in it always
  // describe one answer.
  const [shown, setShown] = useState<RegisterFilters>({ ...NO_SERVER_FILTERS });
  // Why the last register load did not land, or null. A REFUSED filter arrives
  // here as the route's own sentence ("The stock register cannot be filtered to
  // Dispatched: …"), which is the whole reason the route refuses rather than
  // ignoring: there is something true to print.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sorts, setSorts] = useState<{ k: "name" | (typeof NUMS)[number]; d: 1 | -1 }[]>([{ k: "name", d: 1 }]);
  const [open, setOpen] = useState<Set<string>>(new Set());   // open designs (closed by default)
  const [ov, setOv] = useState<Map<string, boolean>>(new Map()); // optimistic Approved overrides
  const [approveError, setApproveError] = useState<string | null>(null); // last approval write that did not land
  const [openT, setOpenT] = useState<Set<string>>(new Set()); // open thickness groups

  // Per-slab quality popup — the Sales drill-down. Where the Admin register
  // opens a batch into the full slab table (onOpenSlabs), the Sales register
  // has no such table; the same click opens this instead. Sequence-guarded so
  // a slow answer for batch A cannot land on an open popup for batch B.
  const [qc, setQc] = useState<QcTarget | null>(null);
  const [qcRows, setQcRows] = useState<QcSlab[] | null>(null);
  const [qcTruncated, setQcTruncated] = useState(false);
  const [qcError, setQcError] = useState<string | null>(null);
  // Whether the route could read fg_finished_slab.slab_mark for this answer.
  // Starts FALSE and is only turned on by an explicit `markAvailable: true` in
  // the payload — a route older than this file sends no such key, and the safe
  // reading of silence is "this answer cannot tell you what has been cut",
  // never "nothing here has been cut". See the interface comment at the top.
  const [qcMarks, setQcMarks] = useState(false);
  const qcSeq = useRef(0);
  const openQuality = (r: Row) => {
    const seq = ++qcSeq.current;
    setQc({ design: r.design, thickness: r.thickness, batch: r.batch });
    setQcRows(null); setQcTruncated(false); setQcError(null); setQcMarks(false);
    // The SHOWN values travel as-is, "-" placeholders included — the route
    // resolves them the way the register grouped them (canonical design,
    // display batch, "-" = not recorded).
    const p = new URLSearchParams({ design: r.design, thickness: r.thickness, batch: r.batch });
    fetch(`/api/inventory/batch-quality?${p.toString()}`)
      .then(async (res) => {
        // Download the body FIRST, gate on seq LAST: checking before the await
        // let a stale answer slip through the gap while its body streamed.
        const body = await res.json().catch(() => null);
        if (seq !== qcSeq.current) return;
        if (!res.ok) {
          setQcError(`${body?.error ?? "Could not load the slab list"} (HTTP ${res.status}).`);
          return;
        }
        setQcRows(Array.isArray(body?.slabs) ? body.slabs : []);
        setQcTruncated(Boolean(body?.truncated));
        setQcMarks(body?.markAvailable === true);
      })
      .catch(() => { if (seq === qcSeq.current) setQcError("Could not load the slab list — the network request failed."); });
  };
  const closeQuality = () => { qcSeq.current++; setQc(null); setQcRows(null); setQcTruncated(false); setQcError(null); setQcMarks(false); };

  // The four are appended ONLY when they are drawn. A non-admin cannot set them
  // (the controls do not render) and this makes sure a stale value could not be
  // sent either — the route would refuse it with a 403 and blank the register
  // for somebody who never asked for a filter.
  const serverQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (showPending) p.set("pending", "1");
    if (canApprove) for (const [k, v] of Object.entries(srv)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  }, [showPending, canApprove, srv]);
  const anyServerFilter = canApprove && Object.values(srv).some(Boolean);

  /** The four in plant words — ONE rendering, used by the register's heading and
   *  by the approval strip. Two spellings of "what is being narrowed" is how the
   *  strip and the table came to describe different things on one screen. */
  const filterWords = (fl: RegisterFilters) => [
    fl.source && `source ${(filterOptions?.sources ?? []).find(([v]) => v === fl.source)?.[1] ?? fl.source}`,
    fl.status && `status ${fl.status}`,
    fl.bay && (fl.bay === NONE ? "slabs with no bay" : fl.bay),
    fl.mark && `mark ${SLAB_MARK_LABEL[fl.mark as keyof typeof SLAB_MARK_LABEL] ?? fl.mark}`,
  ].filter(Boolean).join(" · ");
  // `shown`, not `srv`: everything the screen SAYS about the numbers has to be
  // said about the fetch those numbers came from. `anyServerFilter` above stays
  // on `srv` — it decides what goes on the wire and what to do with stale rows
  // when a request fails, which are questions about the request, not the answer.
  const shownAny = canApprove && Object.values(shown).some(Boolean);
  const shownWords = filterWords(shown);
  // A change has been made but its answer has not landed yet. Said out loud
  // because the alternative is a register that looks settled while it is about
  // to be replaced — the same "which of these two numbers is it" the heading
  // fix above exists to end.
  const refetching = canApprove && (["source", "status", "bay", "mark"] as const).some((k) => srv[k] !== shown[k]);

  useEffect(() => {
    let alive = true;
    // The four THIS effect is asking with, frozen at the moment it was built.
    // It is what `shown` becomes when the answer lands — reading `srv` in the
    // .then would re-introduce the very lag this exists to remove, because by
    // then the user may have moved a select again.
    const applied: RegisterFilters = canApprove ? { ...srv } : { ...NO_SERVER_FILTERS };
    // A REGISTER THAT DID NOT LOAD IS NOT AN EMPTY YARD. The old body was
    // `r.ok ? r.json() : []`, so a 403, a 500 or a refused filter all rendered
    // as "No stock matches." — the same empty-shelf reading the slab table
    // above was fixed for, on a screen Sales quotes from.
    const load = () =>
      fetch(`/api/inventory/summary${serverQuery}`)
        .then(async (r) => {
          const body = await r.json().catch(() => null);
          if (!r.ok) throw new Error(`${body?.error ?? "the stock register could not be loaded"} (HTTP ${r.status})`);
          return Array.isArray(body) ? body.map(normalizeRow) : [];
        })
        .then((d) => { if (alive) { setRows(d); setShown(applied); setLoadError(null); } })
        .catch((e: unknown) => {
          if (!alive) return;
          setLoadError(e instanceof Error ? e.message : "the request did not complete");
          // WHETHER TO KEEP THE ROWS DEPENDS ON WHAT THEY WOULD BE READ AS.
          // With no server filter set they are the last good whole-yard answer
          // and the banner says they may be stale — better than a blank screen
          // on one dropped request. With a filter set they answer a DIFFERENT
          // question from the one on the screen: leaving the unfiltered
          // register under a heading that says "Bay 4 · cut only" is the
          // confident wrong answer this whole module refuses elsewhere.
          // `shown` moves with the rows either way, so the heading never
          // outlives the figures it belongs to.
          if (anyServerFilter) { setRows([]); setShown(applied); }
        })
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
    // serverQuery, not the four values separately: it is the memoised string
    // that actually goes on the wire, so a change to any of them re-runs this
    // once and a change to none of them (a re-render) does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPending, serverQuery]);

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

  // THE KPI STRIP ABOVE THIS TABLE MIRRORS THE REGISTER'S FILTERS, so the four
  // new ones have to travel with the other three or the cards would keep
  // counting the whole yard while the table below them counts one bay — two
  // numbers for the same question, on one screen, which is the failure this
  // module keeps coming back to. `srv` is spread whole; when the four controls
  // are not drawn every value in it is "" and nothing changes.
  useEffect(() => {
    onFilters?.({ design: q.trim(), thickness: thick, batch: batchQ.trim(), ...srv });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, thick, batchQ, srv]);

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
  // THE TICK IS OPTIMISTIC, SO IT MUST ALSO BE REVERSIBLE. The write used to be
  // fired with `.catch(() => {})`: a 403, a 500 or a dropped connection left the
  // box ticked and the override in `ov` outlived every reload, so an admin saw
  // "approved" on a colour Sales could not see and nobody could explain why. On
  // a failure we DELETE the override rather than set the old value — that hands
  // the checkbox back to the server's own answer, which is the only value that
  // is true.
  const setApproved = (groupName: string, batch: string, approved: boolean) => {
    const key = `${groupName}|${batch}`;
    setOv((m) => new Map(m).set(key, approved));
    setApproveError(null);
    const design = groupName;
    fetch("/api/inventory/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design, batch, approved }) })
      .then(async (r) => {
        if (r.ok) return;
        const body = await r.json().catch(() => null);
        throw new Error(`${body?.error ?? "the server refused it"} (HTTP ${r.status})`);
      })
      .catch((e: unknown) => {
        setOv((m) => { const c = new Map(m); c.delete(key); return c; });
        setApproveError(`Not saved — ${design}${batch ? ` · batch ${batch}` : ""} is unchanged: ${e instanceof Error ? e.message : "the network request failed"}.`);
      });
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
      {/* One line, above both the pending strip and the register, because the
          box that flipped back is in one of them and the user needs to know
          which way round the truth is before they tick it again. */}
      {approveError && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{approveError}</p>
      )}
      {/* ═══ THE APPROVAL QUEUE, AND WHY IT HAS TO SAY WHEN IT IS NOT THE QUEUE ══
          `pendingRows` is filtered off the same `rows` the register is, so the
          four server filters narrow this worklist exactly as they narrow the
          table — and this strip is drawn ABOVE the filter row, while the
          register's own heading sits below it and says "every count BELOW",
          explicitly disclaiming this. Nothing on the screen told an admin that
          the queue they were working was a slice.

          It decides what Sales can see, so that gap is expensive. Replaying the
          summary route's merge/alias/approval logic against live Neon
          2026-09-03: 83 unapproved lines with no filter, 28 under bay='Bay 4',
          4 under status=CHROMIA, 1 under mark=CTS. An admin who left a bay
          filter set worked 28 lines believing they were the 83, ticked them
          empty and concluded the queue was clear.

          Two changes, both needed. The heading names the filter, in the same
          words the register's heading uses (filterWords, one rendering for
          both). And the strip now renders at ZERO under a filter as well — the
          old `pendingRows.length > 0` guard made a narrowed-to-nothing queue
          vanish entirely, which is the same wrong reading with no text at all
          to argue with. */}
      {canApprove && showPending && (pendingRows.length > 0 || shownAny) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="text-sm font-bold uppercase tracking-wide text-amber-800">
            New stock awaiting approval ({pendingRows.length}{shownAny ? ` — ${shownWords} only` : ""})
          </h3>
          {shownAny && (
            <p className="mb-2 rounded-lg border border-amber-400 bg-white px-2 py-1.5 text-xs font-semibold text-amber-900">
              This is NOT the whole approval queue — it is only the stock matching {shownWords}. Emptying this list does not clear the queue.{" "}
              <button type="button" onClick={() => setSrv({ ...NO_SERVER_FILTERS })} className="underline hover:no-underline">
                Clear the filters
              </button>{" "}
              to see everything awaiting approval.
            </p>
          )}
          <p className="mb-2 text-xs text-amber-700">Tick to approve — the line moves into the register and becomes visible to Sales within seconds.</p>
          {pendingRows.length > 0 && (
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
                      onClick={onOpenSlabs ? () => onOpenSlabs({ design: r.design, thickness: r.thickness === "-" ? undefined : r.thickness, batch: r.batch === "-" ? undefined : r.batch, ...shown }) : undefined}
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
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <input className="w-full max-w-[220px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" placeholder="Filter colour / design..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none" value={thick} onChange={(e) => setThick(e.target.value)}>
          <option value="">Any thickness</option>
          {/* THE SAME NOT-IN-THE-LIST GUARD THE DASHBOARD'S GRADE, THICKNESS,
              MARK AND STATUS SELECTS ALL CARRY, and this select needs it now
              that the four server filters exist. thickOptions is derived from
              `rows`, which those filters SHRINK, while `thick` is still applied
              in the groups memo below — so a server filter can knock the
              selected thickness out of its own dropdown.

              Reproducible on live Neon 2026-09-03: pick '1.2 cm' (152 slabs on
              the floor), then bay 'Bay 1' — Bay 1 holds exactly one 2 cm slab
              and one 3 cm slab, so thickOptions became ['2 cm','3 cm'], the
              select fell back to rendering "Any thickness", and the table below
              it was STILL filtered to 1.2 cm and printed "No stock matches."
              Same with mark=CTS, whose stock is only 2 cm / 3 cm / '3 cm to
              2 cm' / '2cm to 12 mm' — every other thickness drops out of the
              list while staying in force. */}
          {(thick && !thickOptions.includes(thick) ? [...thickOptions, thick] : thickOptions)
            .map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="w-full max-w-[140px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" placeholder="Batch..." value={batchQ} onChange={(e) => setBatchQ(e.target.value)} />

        {/* ───────────────────── THE FOUR ADMIN-ONLY FILTERS ─────────────────
            Drawn only for an admin (`canApprove`), and honoured only for an
            admin — the summary route checks the session itself and answers 403
            to anybody else who sends one, so this guard is the convenience and
            the route is the control. See the block above the component.

            EVERY OPTION LIST IS SOMETHING THAT EXISTS, not a literal typed
            here: bays and marks are the live values /api/inventory/filters read
            back off the column, sources and statuses are the dashboard's own
            constants, and all four arrive as props so this screen and the slab
            table cannot come to offer different options for the same column. */}
        {canApprove && (
          <>
            <select className={selCls} value={srv.source} onChange={(e) => setSrv({ ...srv, source: e.target.value })}
              title="Where the row came from — the QC autolink, a bulk upload, or hand entry on the intake form.">
              <option value="">Any source</option>
              {(filterOptions?.sources ?? []).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>

            {/* WHAT THE STATUS FILTER NARROWS, because a naive one produces a
                register of dashes that reads as missing data.
                Every column this table prints counts stock ON THE FLOOR
                (status <> 'DISPATCHED') — that is what makes the grade columns
                add up to Slabs. So this narrows WHICH on-floor stock is
                counted, all seventeen columns together, and the row still adds
                up: measured on live Neon 2026-09-03 under status CHROMIA, 21
                rows, Slabs 62, grade columns 62.

                Dispatched is deliberately not offered — it is the exact
                complement of every column here, so the whole table would read
                zero — and the route refuses it in words rather than serving
                that. CTS is not offered either (owner, same day): the cut fact
                lives in the Mark filter beside this one, where 61 on-floor
                slabs answer to it against the ONE that carries the status. */}
            <select className={selCls} value={srv.status} onChange={(e) => setSrv({ ...srv, status: e.target.value })}
              title="Narrows which stock ON THE FLOOR the register counts. Dispatched is not offered: every column here counts un-dispatched stock, so the table would read zero.">
              <option value="">Any status</option>
              {(filterOptions?.statuses ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <select className={selCls} value={srv.bay} onChange={(e) => setSrv({ ...srv, bay: e.target.value })}
              title="Where the stock is standing.">
              <option value="">Any bay</option>
              {(filterOptions?.bays ?? []).map((b) => <option key={b} value={b}>{b}</option>)}
              {/* 6,526 of the 16,648 slabs on the floor have no bay recorded
                  (live Neon, 2026-09-03) and there was no way to ask for them. */}
              <option value={NONE}>— no bay —</option>
            </select>

            {/* THE MARK, AND IT FAILS THE SAME WAY THE REST OF THE APP DOES.
                It only appears when the server offered the vocabulary, exactly
                as the slab table's mark select does: `marks` absent means the
                route does not know the word, and posting `mark=CTS` to a route
                that ignored it would hand back the whole yard while claiming to
                show cut slabs. When the column is present but unreadable the
                summary route answers 503 rather than falling back to the grade
                — since scripts/0071 and 0072 a grade-only test finds 0 of the
                61 cut slabs on the floor, so `mark=FULL_SLAB` would list every
                one of them as whole sellable stock. The banner above prints
                that refusal.

                AND `marks` NOW REALLY IS EMPTY IN THAT STATE. This guard used
                to be decoration: /api/inventory/filters offerableMarks did
                `if (!hasMarkColumn) offer.add("FULL_SLAB")`, so the one state
                this hides in returned `marks: ['FULL_SLAB']` — length 1 — and
                the select was DRAWN, offering the single value that gets the
                503 above, on a register that retries on its 30s poll and on
                every focus. That fallback is gone (searchWhere's wholeSlabWhere
                throws without the mark, so there was nothing left for it to
                degrade to), and the length check is now load-bearing. */}
            {filterOptions?.marks?.length ? (
              <select className={selCls} value={srv.mark} onChange={(e) => setSrv({ ...srv, mark: e.target.value })}
                title="What became of the slab — whole, cut to size by fabrication, or cut down for samples. Not a quality grade: a cut slab keeps its A/B/C, so this does not move any slab between the grade columns.">
                <option value="">Any mark</option>
                {filterOptions.marks.map((m) => (
                  <option key={m} value={m}>{SLAB_MARK_LABEL[m as keyof typeof SLAB_MARK_LABEL] ?? m}</option>
                ))}
              </select>
            ) : null}

            {anyServerFilter && (
              <button type="button" onClick={() => setSrv({ ...NO_SERVER_FILTERS })}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Clear filters</button>
            )}
          </>
        )}
        <p className="text-xs text-gray-400">Stock register - click a colour to open its batches{onOpenSlabs ? "" : " - click a batch for per-slab quality"} - trials grouped at the end.</p>
      </div>

      {/* SAY WHAT THE TABLE IS, IN WORDS, WHENEVER IT IS NOT THE WHOLE YARD.
          Every number below — the Slabs total, the grade split, the grand total
          in the footer — is computed over the filtered stock, and a person
          reading a register they believe is the whole plant will quote it as
          one. The count of colours under the table is the same number under a
          filter, so it cannot carry this on its own. */}
      {(shownAny || refetching) && !loadError && (
        <p className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs font-medium text-gray-700">
          {shownAny
            ? `Filtered register — every count below is for ${shownWords} only, not the whole yard.`
            : "Unfiltered register — every count below is the whole yard."}
          {/* The heading describes the fetch the rows came from, so while a new
              one is in flight it is honest but out of date. Saying so is the
              difference between a lagging heading and a wrong one. */}
          {refetching && (
            <span className="ml-1 font-normal text-gray-500">
              Re-counting for {filterWords(srv) || "no filter"}…
            </span>
          )}
        </p>
      )}

      {/* A REGISTER THAT DID NOT LOAD, SAID OUT LOUD. Red, because the wrong
          reading of a blank register on this screen is "we have none of that"
          and it leaves the plant in a quotation. The sentence is the server's
          own — a refused filter explains itself here rather than looking like
          an outage. */}
      {loadError && (
        <div className="flex items-start justify-between gap-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span>
            <b>Stock register not loaded</b> — {loadError}.{" "}
            {anyServerFilter
              ? "The filtered register is not being shown; change or clear the filters above."
              : "What is shown below is the last register that loaded and may be out of date; do not read it as “no stock”."}
          </span>
        </div>
      )}
      <div className="max-h-[85vh] overflow-auto rounded-lg border border-gray-300 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-brand text-[11px] font-bold uppercase tracking-wide text-white">
              <th className="border border-brand-dark/40 px-2 py-2">SL.No</th>
              <th className="cursor-pointer border border-brand-dark/40 px-3 py-2 hover:bg-brand-dark/40" title="Sort · Shift+Click adds a level" onClick={(e) => onSort("name", e.shiftKey)}>Colour Name{arrow("name")}</th>
              <th className="border border-brand-dark/40 px-2 py-2">Thick</th>
              <th className="border border-brand-dark/40 px-2 py-2">Batch No</th>
              {/* TWO COLUMNS ABOUT CUT SLABS, AND THEY ARE NOT THE SAME COLUMN.
                  This is the whole shape of the change, in a table header.

                  CTS is a GRADE, and the grade columns are a PARTITION: every slab
                  on the floor is in exactly one of A / A2 / B / C / CTS / Print /
                  Trial / No Gr., which is what lets a person add the row across and
                  land on Slabs. It counts grade = 'CTS', and IT NOW READS ZERO ON
                  EVERY ROW: the comment here used to say it would "shrink to zero as
                  the owner replaces those grades with the real A/B/C verdicts he is
                  collecting by hand", and that is not what happened — the verdicts
                  turned out to be unrecoverable, so scripts/0071 and 0072 moved all
                  63 slabs to grade 'B' on his decision. Measured on live Neon
                  2026-09-03: zero rows with grade 'CTS' or 'SAMPLE' anywhere. The
                  column stays because the grade is still a column anyone can write,
                  and a routing word reappearing in it must show up somewhere — but
                  it is no longer where you look to find cut stone.

                  CUT is not a grade and does not partition anything. It counts
                  slabs whose GRADE says cut OR whose MARK does, so it OVERLAPS the
                  grade columns deliberately: today all 61 cut slabs on the floor are
                  grade B and mark CTS, and each is counted under both B and Cut. It
                  sits out past "No Gr." for exactly that reason — inside the grade
                  block it would break the one arithmetic check the register exists
                  to let you do by eye.

                  THIS IS THE ONLY COLUMN THAT ANSWERS "what here has been cut", now
                  that the grade no longer says so at all — with the CTS column at
                  zero, take Cut away and the register shows a yard full of cut stone
                  as ordinary grade B stock. The counts belong
                  to /api/inventory/summary (cts / cut); the third tuple slot is the
                  note that tells the next reader which question each one answers,
                  and nothing else uses it. */}
              {([["Slabs","total"],["A","a"],["A2","a2"],["B","b"],["C","c"],
                 ["CTS","cts","The GRADE 'CTS' — the legacy way a cut slab was recorded, before the mark carried it. Zero everywhere since scripts/0071 and 0072 regraded those 63 slabs to B; use the Cut column to find cut stone. Part of the grade split, so the grade columns still add up to Slabs."],
                 ["Print","printing"],["Trial","trial"],["No Gr.","ungraded"],
                 ["Cut","cut","Slabs that are no longer whole — cut to size or cut down for samples, by grade or by mark. NOT a grade: it overlaps the grade columns, so do not add it into the row."],
                 ["R/W","pending_rw"]] as [string, (typeof NUMS)[number], string?][]).map(([label, k, note]) => (
                <th key={k} className="cursor-pointer border border-brand-dark/40 px-2 py-2 hover:bg-brand-dark/40" title={note ? `${note} · Sort · Shift+Click adds a level` : "Sort · Shift+Click adds a level"} onClick={(e) => onSort(k, e.shiftKey)}>{label}{arrow(k)}</th>
              ))}
              {canApprove && <th className="border border-brand-dark/40 px-2 py-2">Approved</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canApprove ? 16 : 15} className="px-3 py-10 text-center text-gray-400">Loading...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={canApprove ? 16 : 15} className="px-3 py-10 text-center text-gray-400">No stock matches.</td></tr>
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
                          {/* One gesture, role-appropriate destination: with the full
                              slab table available (Admin/Office) the batch opens it;
                              without one (Sales) the same click opens the per-slab
                              quality popup instead. */}
                          <td
                            className={`${bcell} cursor-pointer font-medium text-brand hover:underline`}
                            title={onOpenSlabs ? "Open these slabs" : "Per-slab grades and quality issues"}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              // THE FOUR TRAVEL WITH THE CLICK. The number in this
                              // row was counted under them; opening the slab table
                              // without them would list more slabs than the row said
                              // it held, and the two screens would disagree about one
                              // batch with nothing on either saying why. `shown`, not
                              // `srv`: the four that COUNTED this row, not the four
                              // the selects hold while a newer count is in flight.
                              if (onOpenSlabs) onOpenSlabs({ design: e.r.design, thickness: e.r.thickness === "-" ? undefined : e.r.thickness, batch: e.r.batch === "-" ? undefined : (e.r.rawBatch ?? e.r.batch), ...shown });
                              else openQuality(e.r);
                            }}
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
      {qc && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={closeQuality}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold uppercase tracking-wide text-gray-900">{qc.design}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Batch {qc.batch}{qc.thickness !== "-" ? ` · ${qc.thickness}` : ""}
                  {qcRows ? ` · ${qcRows.length} slab(s)` : ""}
                </p>
              </div>
              <button onClick={closeQuality} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Close ✕</button>
            </div>
            {qcError ? (
              <p className="py-10 text-center text-sm text-red-600">{qcError}</p>
            ) : qcRows == null ? (
              <p className="py-10 text-center text-gray-400">Loading…</p>
            ) : qcRows.length === 0 ? (
              <p className="py-10 text-center text-gray-400">No slabs recorded for this line.</p>
            ) : (
              <div className="mt-4">
                {(() => {
                  const n = qcRows.filter((s) => s.issues.length > 0).length;
                  const rw = qcRows.filter((s) => s.rw && RW_ONGOING.test(s.rw)).length;
                  const rp = qcRows.filter((s) => s.repolish && REPOLISH_REQUIRED.test(s.repolish)).length;
                  const parts = [
                    n === 0 ? "No quality issues recorded on any slab in this line" : `${n} of ${qcRows.length} slab(s) carry a quality note`,
                    ...(rw ? [`${rw} in R/W`] : []),
                    ...(rp ? [`${rp} repolish required`] : []),
                  ];
                  return <p className="mb-2 text-xs text-gray-500">{parts.join(" · ")}.</p>;
                })()}
                {/* SAID ONCE, IN WORDS, not left to a column of question marks.
                    A Sales user reads the summary line and the Grade column; if the
                    Mark column is unreadable they have to be told, because the row
                    they are about to quote may be a cut slab and nothing else on
                    this screen would say so. */}
                {!qcMarks && (
                  <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                    The slab mark could not be read for this list, so it cannot say which of these slabs have been cut — check inventory before quoting any of them as a full slab.
                  </p>
                )}
                <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-gray-100 text-left text-gray-500">
                        <th className="px-3 py-2">Slab #</th>
                        <th className="px-3 py-2">Grade</th>
                        {/* GRADE AND MARK ARE TWO QUESTIONS. This popup is the SALES
                            drill-down — the only per-slab list that login has — so it is
                            the one place a cut slab has to declare itself before somebody
                            quotes it as a full slab. Grade stays the stone's verdict;
                            this column says what became of it.

                            AND THE GRADE COLUMN CANNOT COVER FOR IT ANY MORE. It used to:
                            a cut slab read "CTS" there and was identifiable even with no
                            Mark column at all. scripts/0071 and 0072 moved all 63 of them
                            to 'B', so the Grade column now reads exactly like every other
                            B slab in the plant and this column is the ONLY thing on the
                            screen that distinguishes them. */}
                        <th className="px-3 py-2">Mark</th>
                        <th className="px-3 py-2">Quality issue</th>
                        <th className="px-3 py-2">R/W</th>
                        <th className="px-3 py-2">Repolish</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {qcRows.map((s) => (
                        <tr key={s.slab} className="border-t border-gray-50 hover:bg-gray-50/60">
                          <td className="px-3 py-2 font-medium text-gray-900">{displaySlab(s.slab, s.barcode)}</td>
                          <td className="px-3 py-2">{s.grade ?? <span className="text-gray-400">—</span>}</td>
                          {/* hideWhole: most slabs are whole, and a column of identical
                              "Full slab" chips would bury the two marks worth seeing.

                              THE DASH IS ONLY HONEST WHEN THE MARK WAS READ. When the
                              route could not read slab_mark, MarkChip would fall back to
                              legacyGrade — and since scripts/0071 and 0072 every cut slab
                              reads grade 'B', so the fallback resolves to FULL_SLAB and
                              hideWhole prints "—" over a slab that has been cut. On the
                              Sales drill-down that dash IS the quote. So an unread column
                              prints "?" instead, and legacyGrade is not passed at all —
                              it has nothing left to say. */}
                          <td className="px-3 py-2">
                            {qcMarks
                              ? <MarkChip mark={s.mark} hideWhole />
                              : <span className="font-semibold text-amber-600" title="The slab mark could not be read for this list, so whether this slab has been cut is UNKNOWN. Do not quote it as a full slab on the strength of this row — check the slab in inventory first.">?</span>}
                          </td>
                          <td className="px-3 py-2">
                            {s.issues.length ? <span className="text-gray-700">{s.issues.join(", ")}</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-3 py-2"><WorkState v={s.rw} alarm={RW_ONGOING} /></td>
                          <td className="px-3 py-2"><WorkState v={s.repolish} alarm={REPOLISH_REQUIRED} /></td>
                          <td className="px-3 py-2">
                            {s.status ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{s.status}</span> : <span className="text-gray-400">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {qcTruncated && <p className="mt-2 text-xs font-medium text-amber-700">Showing the first 1,000 slabs — this line holds more.</p>}
                <p className="mt-2 text-xs text-gray-400">Approved, in-stock slabs only — dispatched slabs are not listed, exactly as the register counts them.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
