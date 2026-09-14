"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displaySlab } from "@/lib/slabLabel";
import { displayBatch } from "@/lib/batchDisplay";
import { NONE } from "@/lib/inventory/filterValues";
// Which of the four flags below are on, decided in a module of its own so the
// decision can be tested without rendering anything. See its header for why
// readOnly removes controls rather than disabling them.
import { inventoryDashboardView, type InventoryViewAs } from "@/lib/inventory/dashboardView";
// THE MARK, BESIDE THE GRADE. Both imports are pure and import-free themselves
// (slabMark.ts states that rule in its own header), so a client component may
// take them. MarkChip is the fab module's chip, reused rather than re-drawn:
// two chips for one fact would drift, and the fab CEO board and this table must
// not disagree about what a cut slab looks like.
import { SLAB_MARKS, SLAB_MARK_LABEL, slabMarkOf } from "@/lib/fab/slabMark";
import { MarkChip } from "@/components/fab/SlabChips";
import { StockByDesign } from "./StockByDesign";
import { PolishingReport } from "./PolishingReport";
import { Lightbox, type LightboxPhoto } from "@/components/Lightbox";

interface Kpi {
  total: number; gradeA: number; gradeA2: number; gradeB: number; gradeC: number;
  // `cut` is the honest name for what the old CTS card counted: slabs that HAVE
  // BEEN CUT, by grade OR by mark (/api/inventory/kpi anyCutWhere). `cts` is the
  // same number under the older key — the route returns both so this screen
  // could not go blank on deploy — and it is optional here only because `cut` is
  // the one that is read; see the card below.
  //
  // NULLABLE, and the null is load-bearing: the route sends null for "the slab
  // mark could not be read, so we cannot say how much stock has been cut". It
  // must not be coalesced to 0 anywhere on this screen. 0 means a yard with no
  // cut slabs in it, which is a thing somebody will quote against; null means we
  // do not know, and it renders "?".
  cut?: number | null; cts: number | null; printing: number; available: number; reserved: number; packed: number;
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
  // WHAT BECAME OF THE SLAB — FULL_SLAB / CTS / SAMPLE (fg_finished_slab.slab_mark,
  // scripts/0070). OPTIONAL on purpose, and it must stay optional: the column does not
  // exist on live Neon yet (measured 2026-09-03), so /api/inventory returns rows without
  // it, and a required field here would be a type that lies about today's payload.
  // Everything below reads it through slabMarkOf(mark, grade), which falls back to the
  // legacy grade='CTS' write — so the 62 rows that carry it (60 in stock, 2 dispatched)
  // read as cut on the screen from the first render, migration or no migration.
  slabMark?: string | null;
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
//
// ══════════════ CTS IS GONE FROM THIS LIST, AND ONLY FROM THIS LIST ══════════
//
// The owner, 2026-09-03: "look at any status filter in finished goods. It has
// CTS which should ideally not be there as we have moved it to any mark filter
// right?" He is right, and the numbers are why. Measured on live Neon that day,
// fg_finished_slab.status reads AVAILABLE 16,585 · DISPATCHED 6,742 · CHROMIA
// 62 · CTS 1 — the single CTS row being slab 154757 (Arva White, 2 cm, batch
// 1413), which also carries slab_mark 'CTS' and grade 'B'. Meanwhile 63 rows
// carry slab_mark = 'CTS', 61 of them on the floor. So a person who opened this
// dropdown looking for "what has been cut" was offered a filter that answers
// with 1 slab and hides 60, while the Mark filter three controls up answers
// with all 61. Two controls, the same word, two orders of magnitude apart.
//
// WHAT IS **NOT** BEING DONE, because each would break something:
//   * The Prisma SlabStatus enum keeps CTS — the row exists and the column must
//     be able to hold it.
//   * intakeRules.SLAB_STATUSES keeps CTS: that list VALIDATES writes, and
//     taking the word out of it would make slab 154757 unsaveable from the
//     intake form. Only the picker list beside it (SLAB_STATUS_OPTIONS) lost it.
//   * The `cts` / `uncts` ACTIONS below are untouched. The status is still
//     WRITTEN by hand from this screen and by Commercial, so it must stay
//     findable — see the guard on the status select, which re-adds CTS as an
//     option whenever something has actually selected it.
//
// RESERVED, PACKED and RETURNED hold zero rows today and stay: they are real
// lifecycle states that the actions above move slabs into, and a status you can
// apply but not filter for is the bug this comment is about, upside down.
const STATUSES = ["", "AVAILABLE", "RESERVED", "PACKED", "DISPATCHED", "RETURNED", "CHROMIA"];
// The statuses the STOCK REGISTER may be filtered by — a narrower question than
// the slab table's. Dispatched is excluded because every column the register
// prints counts stock still on the floor (`status <> 'DISPATCHED'`), so asking
// for dispatched stock there returns a table of zeros; /api/inventory/summary
// refuses the value in words for the same reason. The blank "any" entry is the
// register's own first option, not part of this list.
const REGISTER_STATUSES = STATUSES.filter((s) => s !== "" && s !== "DISPATCHED");

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
//
// FALLBACK_GRADES WAS MISSING CTS, AND THAT WAS A LIVE BUG (owner, this week).
// On a failed /api/inventory/filters fetch this list IS the grade dropdown, and
// with CTS absent from it there was no way to select CTS at all — on the exact
// screen whose CTS KPI card had just sent the user looking for those 62 slabs
// (60 in stock, 2 dispatched, measured on live Neon 2026-09-03). The guard a few
// hundred lines down re-adds whatever f.grade holds, so the card's own click
// still worked; typing the search by hand did not.
//
// The list is now the intake vocabulary (lib/inventory/intakeRules GRADE_OPTIONS
// is the authority: A, A2, B, C, CTS, SAMPLE, Printing) — every value the intake
// form can WRITE must be a value this row can FIND, or the degraded path hides
// stock the plant just entered. It is a hand copy and not an import because
// intakeRules pulls in grading.ts; tests/inventoryMarkFilter.test.ts asserts the
// two lists agree, so the copy cannot drift in silence.
//
// "Trial" is NOT in GRADE_OPTIONS and stays anyway: it is a real value in the
// grade column (the summary route counts grade = 'Trial' and the register pins a
// "Trial" group at the bottom), so dropping it would make trial stock
// unfilterable in this path — the same regression this list already caused once
// with CTS. Additive only: a slab findable today stays findable.
const FALLBACK_GRADES = ["A", "A2", "B", "C", "CTS", "SAMPLE", "Printing", "Trial"];
// THE MARK'S OWN FALLBACK — the three states in lib/fab/slabMark.ts, in full,
// because unlike grade there is no drifted history to preserve: slab_mark is NOT
// NULL DEFAULT 'FULL_SLAB' with a CHECK constraint pinning it to exactly these
// three (scripts/0070), so the vocabulary is closed and the column is never null.
// That is also why the select below offers no "— no mark —" option the way grade
// and bay do: there is no such row to find.
const FALLBACK_MARKS: string[] = [...SLAB_MARKS];
// Only reached if the fetch fails. Mirrors the list this replaced, minus "7 mm" (no slab
// has it) — dropping "8 mm"/"10 mm" here would make 32 slabs unfilterable in the degraded
// path, which the old list handled.
const FALLBACK_THICKNESSES = ["1.2 cm", "2 cm", "3 cm", "8 mm", "10 mm"];
// The canonical bays. Still used as-is by the bay-ASSIGNMENT control, which must offer
// every bay that exists on the floor, not only the ones that happen to hold stock today.
const BAYS = ["Bay 1", "Bay 2", "Bay 3", "Bay 4", "Bay 5"];

// `marks` is OPTIONAL and its absence is load-bearing — see the mark select below.
// An /api/inventory/filters that does not return the key is one that does not know
// the word yet, and that is a different thing from one that returned an empty list.
interface FilterOpts { thicknesses: string[]; grades: string[]; bays: string[]; pis: string[]; customers: string[]; designs: string[]; marks?: string[] }
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
// `mark` rides with the rest as the query param `mark` (FULL_SLAB / CTS / SAMPLE).
// Every consumer of EMPTY walks Object.entries and skips blank values, so an extra
// key costs nothing anywhere: the search, the KPI cards, the Excel export URL and
// the Retry all carry it automatically the moment it is set.
const EMPTY = { design: "", batch: "", thickness: "", grade: "", mark: "", slab: "", bay: "", status: "", source: "", rw: "", pi: "", customer: "" };

// ═══════════ WHAT THE KPI STRIP IS COUNTING, SAID ON THE KPI STRIP ═══════════
//
// The cards mirror the last search — every filter in EMPTY travels to
// /api/inventory/kpi — and until now NOTHING on the strip said so. That was
// survivable while the only filters were the ones sitting in the visible boxes
// directly under the cards. It stopped being survivable when Stock by Design
// grew its four server-side filters: `onFilters` feeds them straight into
// kpiFilters, so the strip is narrowed from a control the user set on a
// different block, and only the register below it grew a heading.
//
// Measured on live Neon 2026-09-03, admin with "show unapproved stock" on and
// the register's mark filter set to CTS: the strip reads Total Slabs 63 (it
// counts dispatched stock too), Available 60, Grade B 61, Cut (any signal) 61,
// while the register underneath reads Grand Total 59 under a line saying it is
// filtered. Approved-only — the default admin view — the same strip reads
// 61 / 58 / 59 / 59. "Total Slabs 63" beside "Slabs 59", with nothing saying
// the strip is a cut-slabs-only view, is a number somebody quotes as the plant
// total (which is 22,361 approved rows, 23,394 in all).
//
// The strip already renders one such sentence, for `f.rw === '1'` alone. This
// generalises it: whatever the cards are counting under, they say so.
const FILTER_WORD: Record<string, string> = {
  design: "colour", batch: "batch", thickness: "thickness", grade: "grade", mark: "mark",
  slab: "slab", bay: "bay", status: "status", source: "source", pi: "PI", customer: "customer",
};
function describeFilters(f: typeof EMPTY): string[] {
  return Object.entries(f).flatMap(([k, v]) => {
    if (!v) return [];
    // rw is a flag, not a value: "rw 1" would be gibberish on the screen.
    if (k === "rw") return ["pending R/W only"];
    const word = FILTER_WORD[k] ?? k;
    if (v === NONE) return [`no ${word}`];
    // Plant words for the two coded columns, exactly as their own selects show
    // them — a strip saying "mark FULL_SLAB" over a select reading "Full slab"
    // is two spellings of one filter.
    if (k === "mark") return [`mark ${SLAB_MARK_LABEL[v as keyof typeof SLAB_MARK_LABEL] ?? v}`];
    if (k === "source") return [`source ${SOURCES.find(([sv]) => sv === v)?.[1] ?? v}`];
    return [`${word} ${v}`];
  });
}

// displaySlab (NB-label rule for legacy 9,000,000+ slabs) is shared from
// lib/slabLabel so this table and the register popup cannot disagree.

// A SEARCH THAT FAILED IS NOT AN EMPTY SHELF. A non-OK answer used to become
// `[]` and a dropped connection used to become setRows([]), and both then
// rendered "No slabs match the current filters" — so a Sales user on a plant
// tablet through a wifi blip was told the stock does not exist and quoted
// "none available" on it. This carries the HTTP status up to the catch so the
// banner can say which of the two happened; the rows on screen are left alone.
class LoadFailed extends Error {}

/**
 * THE GRADE CELL, WITH WHAT HAPPENED TO THE SLAB BESIDE IT.
 *
 * Two facts, two questions: the GRADE is how good the stone is (the polishing
 * line's A/B/C verdict), the MARK is what became of it (FULL_SLAB / CTS /
 * SAMPLE). Until now the grade column answered both, because fabrication
 * OVERWROTE quality_grade with 'CTS' — so a cut slab's real verdict was
 * destroyed and every inventory screen identified it by a word sitting in the
 * wrong column. The owner: "grade should be A/B/C like normal, and the MARK is
 * CTS or sampling."
 *
 * A grade-A slab that fabrication cut must therefore read as BOTH. Showing only
 * "A" hides the cut — that slab cannot go out whole (lib/inventory/grading.ts
 * slabBlocksDispatch refuses it) and a Sales user reading the table has no way
 * to see why. Showing only "CTS" is the bug being fixed.
 *
 * QUIET BY DEFAULT: no chip on a FULL_SLAB row. Every uncut slab in the yard is
 * FULL_SLAB, so a chip on each would be a column of identical noise a thousand
 * rows deep and the two interesting marks would disappear into it.
 *
 * THE ONE SPECIAL CASE — `redundant`. The 62 legacy rows measured on live Neon
 * (2026-09-03) have grade = 'CTS' AND mark CTS: the same word twice, because
 * their real A/B/C is gone and the owner is collecting it by hand. Printing
 * "CTS CTS" would read as a rendering bug, so the chip stands alone there — it
 * carries the same word plus the tooltip that says it is a mark, which is
 * strictly more than the bare text was saying. Nothing is hidden: when the
 * owner supplies the real grades those rows simply start reading "A" + chip,
 * with no change here.
 */
function GradeCell({ grade, mark }: { grade: string | null; mark?: string | null }) {
  // slabMarkOf falls back to the legacy grade='CTS' write, so this is correct
  // BEFORE scripts/0070 lands (no slab_mark on the row at all) and after it.
  const m = slabMarkOf(mark, grade);
  if (m === "FULL_SLAB") return <>{grade ?? "—"}</>;
  const redundant = typeof grade === "string" && grade.trim().toUpperCase() === m;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {!redundant && <span>{grade ?? "—"}</span>}
      <MarkChip mark={m} />
    </span>
  );
}

const fmtAt = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function InventoryDashboard({ admin: isRealAdmin = false, summaryOnly: roleSummaryOnly = false, slabsOnly: roleSlabsOnly = false, readOnly: roleReadOnly = false }: { admin?: boolean; summaryOnly?: boolean; slabsOnly?: boolean;
  /** This login may LOOK at finished goods and change nothing in it — the
   *  2026-09-14 view grant (users.fg_view), which chromia@ and gibin@ hold.
   *  The page sets it to `!canWriteInventory(user)`, the same rule the write
   *  gate on every /api/inventory route runs, so what is hidden below is
   *  exactly what the server would refuse. Every control that posts is NOT
   *  RENDERED for such a login; nothing that merely shows a number, a row or a
   *  photo is touched, because the grant was "full visibility". */
  readOnly?: boolean }) {
  // ADMIN preview: view the module exactly as a Sales or Commercial login would
  // Admin-only preview of the module as each role that can reach it sees it.
  // "office" is Finance/Accounts: everything except the admin-only controls.
  const [viewAs, setViewAs] = useState<InventoryViewAs>("admin");
  // The four flags, resolved in lib/inventory/dashboardView.ts rather than here.
  // They were three lines of && and || in this spot until the view grant made a
  // fourth, and the rule that a preview can only ever take things away is worth
  // more as something a test can hold than as something a reader has to verify
  // by eye every time a flag is added.
  const { admin, summaryOnly, slabsOnly, readOnly } = inventoryDashboardView(
    { admin: isRealAdmin, summaryOnly: roleSummaryOnly, slabsOnly: roleSlabsOnly, readOnly: roleReadOnly },
    viewAs,
  );
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [rows, setRows] = useState<Slab[]>([]);
  const [showPending, setShowPending] = useState(false); // ADMIN: include unapproved stock everywhere
  // How many slabs matched the filters but were withheld because Sales has not
  // approved their design+batch (the route counts them and says so in a header).
  const [withheld, setWithheld] = useState(0);
  const [sSorts, setSSorts] = useState<{ k: keyof Slab; d: 1 | -1 }[]>([]);
  const [loading, setLoading] = useState(true);
  // Why the last search did not land, or null. Never cleared by a NEW search
  // starting — only by one succeeding — so the warning stays up while a retry
  // is in flight and the stale rows are still on screen.
  const [loadError, setLoadError] = useState<string | null>(null);
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
  // The same filters as words, for the sentence above the cards. It has to be
  // STATE and the fetch input has to stay a REF (a ref does not re-render, which
  // is the whole reason it is one), so the only safe arrangement is that nobody
  // assigns the ref directly — every write goes through here and the two cannot
  // come to describe different things.
  const [kpiOn, setKpiOn] = useState<string[]>([]);
  const applyKpiFilters = (next: typeof EMPTY) => { kpiFilters.current = next; setKpiOn(describeFilters(next)); };
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

  // The filters of the last search, so the Retry button re-runs THAT search and
  // not whatever is in the boxes now — the two differ the moment someone starts
  // typing a new search while the failed one is still on screen.
  const lastRun = useRef({ ...EMPTY });
  const run = (filters: typeof EMPTY) => {
    setLoading(true);
    // NOTE: the selection is deliberately NOT cleared here — it is cleared only after an
    // action succeeds (applyMove / applyStatus) or when the user clears it themselves.
    lastRun.current = { ...filters };
    applyKpiFilters({ ...filters });
    loadKpi();
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(k, v); });
    if (showPendingRef.current) p.set("pending", "1");
    fetch(`/api/inventory?${p.toString()}`)
      .then((r) => {
        if (!r.ok) throw new LoadFailed(`the server answered ${r.status}`);
        // Read only from an answer that arrived: an error response carries no
        // X-Withheld-Unapproved header, and taking it as 0 would quietly retire
        // the "held back" note that belongs to the rows still on screen.
        const n = Number(r.headers.get("X-Withheld-Unapproved") ?? 0);
        setWithheld(Number.isFinite(n) ? n : 0);
        return r.json();
      })
      .then((d) => {
        const list: Slab[] = Array.isArray(d) ? d : [];
        setLoadError(null);
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
      // KEEP THE ROWS. Blanking the table on a failure is what made a wifi blip
      // look like "we have none of that colour"; the last good list, clearly
      // flagged as possibly stale, is the honest thing to leave on screen.
      .catch((e: unknown) => {
        setLoadError(e instanceof LoadFailed ? e.message : "the request did not complete, so the tablet may have lost the network");
      })
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
          const v = e.target.value as InventoryViewAs;
          setViewAs(v);
          showPendingRef.current = showPending && v === "admin";
          // Land on the view that role actually opens on. Commercial has no
          // tabs at all, so previewing it while parked on "Stock by Design" or
          // "Designs" showed a screen they can never reach.
          if (v !== "admin") setView("slabs");
          applyKpiFilters({ ...EMPTY });
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
        {/* The 2026-09-14 view grant — chromia@ and gibin@, who see the whole
            module and may press none of it. Here for the same reason Finance /
            Accounts is: the owner asked for that screen and is entitled to look
            at it without signing in as somebody else. It previews as the office
            view with every control that posts removed, which is precisely what
            those two logins get. */}
        <option value="viewer">Finished-goods viewer</option>
      </select>
    </label>
  ) : null;

  const applyCard = (patch: Partial<typeof EMPTY>) => {
    const next = { ...EMPTY, ...patch };
    setView("slabs"); setF(next); run(next);
  };
  // `note` replaces the default "Click to see these slabs" hover text, for a card
  // whose number needs a sentence of its own — today that is the Cut card, which
  // OVERLAPS the grade cards and must never be added into them.
  //
  // `value` may be NULL, meaning "this number could not be computed" — the cut
  // count when the slab mark is unreadable. It prints "?" in muted amber, never
  // a zero: a zero on this strip is read as "no cut stock here" and quoted
  // against, which is exactly the sentence nobody may be told by accident.
  const card = (label: string, value: number | null | undefined, tone = "text-gray-900", patch?: Partial<typeof EMPTY>, note?: string) => (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 ${patch ? "cursor-pointer transition hover:border-brand hover:shadow-sm" : ""}`}
      title={note ?? (patch ? "Click to see these slabs" : undefined)}
      onClick={patch ? () => applyCard(patch) : undefined}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${typeof value === "number" ? tone : "text-amber-600"}`}>
        {typeof value === "number" ? value.toLocaleString("en-IN") : "?"}
      </div>
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
          <button className={tabCls(view === "slabs")} onClick={() => { setView("slabs"); applyKpiFilters({ ...f }); loadKpi(); }}>Slabs</button>
          <button className={tabCls(view === "summary")} onClick={() => setView("summary")}>Stock by Design</button>
          <button className={tabCls(view === "activity")} onClick={() => openActivity(evSlab)}>Activity</button>
          {admin && <button className={tabCls(view === "designs")} onClick={() => { setView("designs"); loadDesigns(); }}>Designs</button>}
        </div>}
      </div>

      <PolishingReport />

      {!slabsOnly && kpi && (
        <div className="space-y-4">
          {/* EVERY CARD BELOW IS COUNTED UNDER THESE, so they are named here.
              See describeFilters at the top of the file for the measurements —
              the short version is that the register's four server filters reach
              these cards through onFilters and used to move Total Slabs from
              22,361 to 61 with nothing on the strip saying why. Rendered above
              the Stock row rather than beside any one card because it governs
              all four blocks: Stock, Grades, Thickness and Needs attention. */}
          {kpiOn.length > 0 && (
            <p className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs font-medium text-gray-700">
              These cards count {kpiOn.join(" · ")} only — not the whole plant. Clear the filters to count everything.
            </p>
          )}
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Stock</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
              {/* ═══ TOTAL SLABS COUNTS DISPATCHED STOCK. THE REGISTER BELOW DOES NOT ═══
                  This card has no status clause (route: `db.finishedSlab.count({ where: w })`),
                  so it counts stock that has already left. Every column the stock register
                  prints carries `status <> 'DISPATCHED'`, so its Grand Total does not. Two
                  numbers, one screen, captions that both name the same filter.

                  Unfiltered nobody confuses them — measured on live Neon 2026-09-03, admin,
                  approved-only: 22,418 against a Grand Total of 15,774. Under a REGISTER
                  filter they land next to each other and look like the same question asked
                  twice: bay 'Bay 4' the same day reads 4,565 under "These cards count bay
                  Bay 4 only" against 4,459 under "every count below is for Bay 4 only".
                  The plant is live, so re-derive rather than quoting those:
                    SELECT count(*) FILTER (WHERE status <> 'DISPATCHED') AS on_floor,
                           count(*) FILTER (WHERE status =  'DISPATCHED') AS dispatched
                    FROM fg_finished_slab WHERE bay_number = 'Bay 4';
                  (the KPI figures are additionally narrowed by approvedOnlyWhere).

                  THE FIX IS THE DISPATCHED CARD BELOW, and it is the one of the three
                  options on offer that adds a fact instead of a sentence. The 106 had
                  nothing on screen to attach to — /api/inventory/kpi has always returned
                  `dispatched` and this strip has never rendered it — so the gap read as a
                  disagreement. With the card drawn, Available + Reserved + Packed +
                  Returned + Dispatched + Chromia (+ the legacy CTS card while it is
                  non-zero) is every value of the SlabStatus enum, and it closes on Total
                  Slabs exactly: verified against live Neon 2026-09-03, unfiltered
                  22,418 = 15,718 + 0 + 0 + 0 + 6,644 + 55 + 1, and under bay 'Bay 4'
                  4,565 = 4,456 + 0 + 0 + 0 + 106 + 3 + 0.

                  Not chosen: making Total Slabs on-floor under a register filter, which
                  would give the same card two meanings depending on a control somewhere
                  else on the page; and a sentence alone, which explains a number the
                  strip still refuses to show. A card is clickable, and the click lands on
                  the dispatched slabs themselves.

                  IF A STATUS IS EVER ADDED TO THE ENUM WITHOUT A CARD HERE, the row stops
                  closing and this comment is the thing that says so. */}
              {card("Total Slabs", kpi.total, "text-gray-900", {},
                "Every slab matching the filters, INCLUDING stock already dispatched — so this is larger than the stock register's Grand Total below, which counts only what is still on the floor. The difference is the Dispatched card beside it. Click to clear the filters and list the whole yard.")}
              {card("Available", kpi.available, "text-emerald-600", { status: "AVAILABLE" })}
              {card("Reserved", kpi.reserved, "text-amber-600", { status: "RESERVED" })}
              {card("Packed", kpi.packed, "text-amber-600", { status: "PACKED" })}
              {card("Returned", kpi.returned, "text-sky-600", { status: "RETURNED" })}
              {card("Dispatched", kpi.dispatched, "text-gray-500", { status: "DISPATCHED" },
                "Slabs that have left the yard. Counted in Total Slabs above and in NO column of the stock register below, which counts stock still on the floor — this card is that difference. Click to see them.")}
              {/* TWO CARDS ABOUT CUT SLABS, AND THEY ARE NOT THE SAME CARD — the same
                  distinction the register draws between its CTS and Cut columns.

                  The STATUS card is the inventory STATUS somebody applied by hand.
                  "Cut (any signal)" is the FACT: grade says cut, or the mark does.
                  The gap between them is the point — a slab is very often cut
                  without anyone remembering to apply the status, which is why the
                  dispatch rule reads the mark and not this.

                  ═════ IT NOW HIDES ITSELF AT ZERO, AND IT IS RENAMED (2026-09-03) ══
                  It used to be titled "Cut to size (status)" and to render always.
                  Beside a card reading 61 that is a card reading 1 with almost the
                  same name, under a status the filter row no longer offers — three
                  ways for one number to be misread as "the plant has cut one slab".
                  Measured on live Neon 2026-09-03: status CTS 1 row (slab 154757),
                  slab_mark CTS 63 rows, 61 of them on the floor.

                  So it says LEGACY in its own title, and it renders only while the
                  count is above zero. That second half matters more than the first:
                  the moment somebody releases slab 154757 this card disappears
                  instead of sitting at a permanent 0 under the word CTS, which is
                  exactly the "place for the eye to check for cut stone and find
                  none" that the Grades block below refuses to keep. It is also the
                  ONLY door left to a status='CTS' row now that the dropdown does not
                  offer the word — and the `cts` ACTION can still create one — so
                  hiding it at zero is safe and removing it would not be.

                  The click still sets status: "CTS". That value is FOUND, not
                  offered; the status select re-adds it as an option when it is set,
                  so the filter row cannot read "Any status" over a filtered table. */}
              {kpi.ctsStatus > 0 && card("CTS status (legacy)", kpi.ctsStatus, "text-amber-600", { status: "CTS" },
                "The old inventory STATUS 'CTS', applied by hand — NOT the count of cut slabs, which is the Cut card beside it (a slab is usually cut without anyone applying this status). The status is no longer offered in the status filter: what has been cut lives in the slab MARK now. 1 slab carries it today, against 61 cut slabs on the floor. Click to see it.")}
              {/* MOVED OUT OF "GRADES (IN STOCK)", AND THIS IS THE WHOLE FIX.

                  This card used to sit in the grade block between Grade C and
                  Printing, under a heading that says "Grades" and above a row of
                  cards a person naturally adds up. It counts grade-OR-mark, so it
                  is not a grade and it does not partition anything. Measured on
                  live Neon 2026-09-03: on the floor A 8,304 + A2 859 + B 3,424 +
                  C 2,346 + Trial 384 + ungraded 1,311 = 16,628, exactly the
                  on-floor total — and adding this card's 61 gave 16,689, 61 too
                  many, because all 61 cut slabs read grade 'B' since scripts/0072
                  and were counted twice. Before the regrade they read grade 'CTS'
                  and the six cards were disjoint — CTS was a grade like any other.
                  They are not disjoint any more, so the card cannot stay here.

                  The summary route's own header warned about exactly this
                  ("widening the `cts` column to count it would have counted that
                  slab twice ... and the row would stop adding up") and the register
                  put Cut outside the grade block for the same reason. This strip
                  now does what the register does.

                  The click-through is `mark: "CTS"`, not `grade: "CTS"`: both
                  resolve to the same grade-OR-mark clause (searchWhere
                  cutSignalWhere), but no slab carries that GRADE any more, so
                  filling in the Grade filter box would show the user a filter
                  nothing on the floor actually matches. */}
              {card("Cut (any signal)", kpi.cut ?? kpi.cts, "text-indigo-700", { mark: "CTS" },
                "Slabs that are no longer whole — cut to size or cut down for samples, by grade or by mark. NOT a grade: these slabs are also counted in the Grade cards below (all of them read Grade B today), so do NOT add this number into that row. '?' means the slab mark could not be read and the count is unknown. Click to see these slabs.")}
              {card("At Chromia", kpi.chromia ?? 0, "text-violet-600", { status: "CHROMIA" })}
            </div>
          </div>
          <div>
            {/* A PARTITION AGAIN. Every card in this block counts one exclusive
                value of the grade column, so no slab is in two of them and a person
                may add them across. (Trial and ungraded are not shown here, so the
                visible row sums to less than Total Slabs — but never to MORE than it,
                which is the failure that matters: a card that double-counts makes the
                strip claim more stock than the plant holds.)

                The CTS card that used to sit between Grade C and Printing has moved up
                into the Stock row as "Cut (any signal)". It counted grade-OR-mark, all
                61 of those slabs read grade 'B' since scripts/0072, and it was
                therefore adding 61 slabs to this block that Grade B had already
                counted. Nothing that overlaps another card belongs under this heading.

                There is no grade-only CTS card left because there is nothing left for
                it to count: measured on live Neon 2026-09-03, zero rows anywhere carry
                grade 'CTS' or 'SAMPLE'. A card reading a permanent 0 under "Grades"
                would be a place for the eye to check for cut stock and find none. */}
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Grades (in stock)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {card("Grade A", kpi.gradeA, "text-gray-900", { grade: "A" })}
              {card("Grade A2", kpi.gradeA2, "text-gray-900", { grade: "A2" })}
              {card("Grade B", kpi.gradeB, "text-gray-900", { grade: "B" },
                "Slabs graded B. Includes the 61 already-cut slabs scripts/0071 and 0072 regraded from CTS to B — the Cut card in the Stock row is what tells them apart. Click to see these slabs.")}
              {card("Grade C", kpi.gradeC, "text-gray-900", { grade: "C" })}
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
          // THE OPTION LISTS, HANDED DOWN RATHER THAN FETCHED TWICE. `opts` is
          // already this component's copy of /api/inventory/filters, so bays and
          // marks are the live values read back off the column; SOURCES and
          // REGISTER_STATUSES are the constants the slab filter row above uses.
          // One list per column, for both screens — the register and the slab
          // table cannot come to offer different options for the same question.
          //
          // `marks` is passed straight through, ABSENCE AND ALL: an
          // /api/inventory/filters that returns no `marks` key is one that does
          // not know the word, and the register hides the control rather than
          // posting a `mark=` the summary route would refuse. Same rule as the
          // slab table's own mark select a few hundred lines down.
          filterOptions={{ bays: opts.bays, marks: opts.marks, sources: SOURCES, statuses: REGISTER_STATUSES }}
          // The four ride along with design/thickness/batch so the KPI strip
          // above the register counts the same stock the register does.
          onFilters={(sf) => { applyKpiFilters({ ...EMPTY, design: sf.design, thickness: sf.thickness, batch: sf.batch, source: sf.source, status: sf.status, bay: sf.bay, mark: sf.mark }); loadKpi(); }}
          onOpenSlabs={admin ? (sel) => { const next = { ...EMPTY, design: sel.design ?? "", thickness: sel.thickness ?? "", batch: sel.batch ?? "", source: sel.source ?? "", status: sel.status ?? "", bay: sel.bay ?? "", mark: sel.mark ?? "" }; setView("slabs"); setF(next); run(next); } : undefined}
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

              {/* ─────────────────────────── FIND A CUT SLAB BY ITS MARK ───────
                  THE QUESTION THIS ANSWERS: "if this change happens will it
                  become unfilterable in the inventory?" Until today every
                  surface on this screen identified a cut slab by its GRADE —
                  this dropdown, the CTS KPI card, the register's CTS column —
                  and nothing anywhere filtered by the mark. The moment
                  fabrication stops writing grade = 'CTS' there would have been
                  no way left to find one. This is that way.

                  IT ONLY APPEARS WHEN IT WORKS. `marks` absent from
                  /api/inventory/filters means the server does not know the word
                  yet (either deploy order is allowed — see scripts/0070), and a
                  select that posts `mark=CTS` to a route that ignores it would
                  hand back the WHOLE yard while claiming to show cut slabs.
                  That is the same class of lie as the empty-shelf incident
                  above, so the control hides instead and the grade filter —
                  which still finds all 62 legacy rows — carries on doing the
                  job it does today. Self-healing: the option list is the
                  server's own answer, so this lights up by itself the moment
                  the route ships, and stays dark on a database without the
                  column (where the route can only answer with an empty list).

                  A FAILED FETCH IS THE EXCEPTION: optsFailed means we learned
                  nothing either way, and the same fallback rule the grade,
                  thickness and bay selects use applies — offer the vocabulary
                  so the row still works offline. */}
              {(opts.marks?.length || optsFailed || f.mark) ? (
                <select className={inputCls} value={f.mark} onChange={(e) => { const n = { ...f, mark: e.target.value }; setF(n); run(n); }}
                  title="What became of the slab — whole, cut to size by fabrication, or cut down for samples. Not a quality grade.">
                  <option value="">Any mark</option>
                  {(() => {
                    const list = opts.marks?.length ? opts.marks : FALLBACK_MARKS;
                    // Same guard as grade and thickness: keep a selected value that
                    // is not in the list, or the select would read "Any mark" while
                    // the results ARE filtered.
                    const all = f.mark && !list.includes(f.mark) ? [...list, f.mark] : list;
                    // Plant words, not column values: SLAB_MARK_LABEL turns
                    // FULL_SLAB into "Full slab". An unrecognised value (a mark
                    // some future migration adds) prints raw rather than being
                    // dropped — this row must never silently hide a filter the
                    // server just offered it.
                    return all.map((m) => (
                      <option key={m} value={m}>{SLAB_MARK_LABEL[m as keyof typeof SLAB_MARK_LABEL] ?? m}</option>
                    ));
                  })()}
                </select>
              ) : null}

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
              {/* THE SAME GUARD THE GRADE, THICKNESS AND MARK SELECTS CARRY, and
                  it is what lets CTS leave the offered list without stranding the
                  one row that holds it. STATUSES no longer offers CTS (see the
                  constant), but the "CTS status (legacy)" KPI card still sets it,
                  and a select whose value is not among its options renders as
                  blank — so the box would read "Any status" while the table below
                  it WAS filtered. Re-adding a status only when something has
                  already selected it means it is never OFFERED from a standing
                  start and never silently dropped once chosen. */}
              <select className={inputCls} value={f.status} onChange={(e) => { const n = { ...f, status: e.target.value }; setF(n); run(n); }}>
                {(f.status && !STATUSES.includes(f.status) ? [...STATUSES, f.status] : STATUSES)
                  .map((s) => <option key={s} value={s}>{s || "Any status"}</option>)}
              </select>
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

          {/* THE SEARCH FAILED — SAY SO, LOUDLY, AND DO NOT LET THE LIST BELOW BE
              READ AS STOCK. Same rule as the cutting queue's banner: an empty or
              stale list after a failed load is not evidence of anything, and a
              Sales user quoting "none available" off it is the incident this
              exists to prevent. Red, not amber: on this screen the wrong reading
              leaves the plant in a quotation. */}
          {loadError && (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
              <span>
                <b>Stock list not refreshed</b> — {loadError}. What is shown below is the last
                list that loaded and may be out of date; do not read it as &ldquo;no stock&rdquo;.
              </span>
              <button onClick={() => run(lastRun.current)} disabled={loading}
                className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50">
                {loading ? "Retrying…" : "Retry"}
              </button>
            </div>
          )}

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
                      {/* Same cell as the results table below — the basket is where a
                          dispatch is actually assembled, so a cut slab must read as cut
                          HERE above anywhere else. */}
                      <td className="px-3 py-2"><GradeCell grade={r.grade} mark={r.slabMark} /></td>
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

          {/* EVERYTHING IN THIS PANEL POSTS, so a view-grant login gets none of
              it. The move fields write /api/inventory/location; the action
              select writes /api/inventory/status, or /api/inventory/dispatch
              once an invoice is attached. Not rendered rather than disabled: a
              greyed Apply still tells somebody the action is theirs to ask for,
              and still hands their browser the handler that asks.

              THE BASKET ABOVE STAYS, and that is not an oversight. Ticking a
              slab writes nothing anywhere — it gathers rows into a list that
              survives the next search, which is how anybody compares eight
              slabs found across three searches. It is a reading tool, and the
              grant is "full visibility". What it gathered FOR is what goes. */}
          {sel.size > 0 && !readOnly && (
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
              {/* ─────────── MARK CTS IS PERMANENT, AND IT SAYS SO BEFORE THE CLICK ────
                  changeSlabStatus's `cts` now also writes fg_finished_slab.slab_mark
                  = 'CTS'. That is what makes the cut FINDABLE — by the Mark filter
                  above, which Commercial does have, unlike the status filter (CTS
                  left it) and unlike the "CTS status (legacy)" card (it renders
                  inside `!slabsOnly`, so the role that owns this button never sees
                  it) — and it is what makes the dispatch rule refuse the slab, since
                  that rule reads the mark and not the status.

                  The mark is ONE-WAY everywhere in this codebase: fabrication's own
                  writers all carry "only a FULL_SLAB moves" and nothing anywhere
                  clears one. So "Undo CTS" returns the STATUS to Available and
                  leaves the mark standing. That asymmetry is deliberate and safe in
                  the only direction that matters (setting a mark can only refuse a
                  dispatch; clearing one can only allow it) — but it is also a thing
                  a person must know BEFORE pressing this on 500 slabs, because
                  `uncts` is the documented recovery for a mis-click and it no longer
                  recovers everything. Hence a line on the screen, not a tooltip. */}
              {/* Shown for the two actions it is about, and for both roles: the
                  Commercial select and the admin ACTIONS list write the same
                  st.action, and Commercial's default ("" resolving to dispatch)
                  is deliberately not one of them — a dispatch note about cutting
                  is noise on the screen that role uses all day. */}
              {(st.action === "cts" || st.action === "uncts") && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  Mark CTS also records the cut on the slab itself, so it stops being dispatchable as a full
                  slab and the Mark filter finds it. That mark is permanent — Undo CTS puts the status back to
                  Available but does not un-cut the slab.
                </p>
              )}
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
                ) : rows.length === 0 && loadError ? (
                  // "Nothing matched" and "the request never landed" are opposite
                  // facts and must never print the same sentence.
                  <tr><td colSpan={13} className="px-3 py-10 text-center text-red-700">
                    The stock list could not be loaded — this is <b>not</b> a result. Use Retry above.
                  </td></tr>
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
                      ["Grade", detail.slab.grade],
                      // WHAT BECAME OF IT, spelled out rather than chipped: this grid is
                      // string pairs, and the panel is where somebody asks "why can I not
                      // dispatch this one" — "Cut to size" answers it in words. Reads
                      // correctly on a database without slab_mark, because slabMarkOf
                      // falls back to the legacy grade='CTS' write.
                      ["Mark", SLAB_MARK_LABEL[slabMarkOf(detail.slab.slabMark, detail.slab.grade)]],
                      ["Polish type", detail.slab.polishType],
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
                    plant actually made rows for.

                    AND IT IS NOT FOR A VIEWER, because /slab is not theirs to
                    open. The 2026-09-14 grant reaches finished goods and the
                    whole of finished goods and nothing else — fgViewMayVisit
                    admits /inventory, /api/inventory and the panel's own photo
                    endpoint, and stops there — so chromia@ and gibin@ are
                    refused this page by their own
                    branch caps in middleware.ts and land on
                    /no-access?from=/slab. Drawing the button for them anyway is
                    the failure the fab-OPERATOR block of that file records at
                    length: a widened API gate is not access, the page has to be
                    reachable too, and a control that leads to a refusal is
                    worse than no control.

                    HIDDEN HERE RATHER THAN OPENED AT THE FENCE, and that
                    direction is the decision rather than the lazier of two
                    fixes. The photo endpoint beside it went the other way and
                    was let through fgViewMayVisit, which is right for what it
                    is: /api/photo is drawn BY this panel, and the route behind
                    it can still scope a viewer to FinishedSlab and refuse every
                    other model. /slab can do neither. It is another module's
                    page rather than a part of this one, and it cannot narrow
                    itself for a viewer — its `basic` stripping, the thing that
                    keeps machine settings and RM composition off the copy
                    Commercial reads, is keyed on isCommercialRole. A
                    LINE_MANAGER viewer sent there would therefore be handed
                    MORE of that page than the role the module actually shares
                    it with, out of a grant whose words were "finished good's
                    visibility". Widening the fence that far is the owner's
                    decision to take and not a button's to assume.

                    ON readOnly RATHER THAN ON THE FLAG ITSELF, like every other
                    control on this screen. readOnly is `!canWriteInventory(user)`,
                    which is false for every login that can actually follow this
                    link — an admin on any branch, Finance and Accounts on
                    OFFICE, and Commercial, which carries its own under("/slab")
                    allowance in middleware — and true for exactly the two that
                    cannot. Sales is read-only here as well and loses nothing:
                    it is summary-only and never opens this panel. */}
                {!readOnly && detail.slab?.source !== "MANUAL_ENTRY" && (
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
          <td className="px-3 py-2"><GradeCell grade={r.grade} mark={r.slabMark} /></td>
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
