"use client";
// The stock check itself: search one design, see what finished goods has by
// batch, tick the slabs you want.
//
// Batches matter more than slab numbers here. A customer who orders 40 slabs of
// Carrara Royale wants them to look alike, and slabs from one batch were cut
// from one lot — so the results are grouped by batch with the count, the grade
// breakdown and the sqft per group, and "tick all in this batch" is one click.
// The running counter under the list is against the ORDER LINE's slab count, so
// the person picking never has to hold "how many more" in their head.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Empty, fmt } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import {
  toggleSlab, toggleBatch, batchTickState, selectionSummary, shortfallOffer,
} from "@/lib/commercial/holds-rules";
import { THICKNESS_OPTS } from "@/lib/thickness";

export interface StockSlab {
  slabNumber: number;
  design: string | null;
  designCanonical: string | null;
  grade: string | null;
  thickness: string | null;
  thicknessCanonical: string;
  batchKey: string | null;
  batchNumber: string | null;
  batchDisplay: string;
  bay: string | null;
  frame: string | null;
  lengthIn: number;
  widthIn: number;
  sqft: number;
  status: string;
}

export interface StockBatch {
  batchKey: string | null;
  batchDisplay: string;
  design: string | null;
  thickness: string;
  count: number;
  sqft: number;
  grades: Record<string, number>;
  slabs: StockSlab[];
}

export interface StockSearchResult {
  design: string;
  thickness: string | null;
  grade: string | null;
  holdDays: number;
  groups: StockBatch[];
  total: number;
  totalSqft: number;
}

const btn = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimary = "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const input = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none";

export function StockPicker({
  design: initialDesign, thickness: initialThickness, required, autoSearch = false,
  selected, onSelectedChange, onResult,
}: {
  design: string;
  thickness: string | null;
  /** The order line's slab count, for the counter. Null when the line states none. */
  required: number | null;
  autoSearch?: boolean;
  selected: number[];
  onSelectedChange: (next: number[]) => void;
  /** So the parent can offer a production request from what the search found. */
  onResult?: (r: StockSearchResult | null) => void;
}) {
  const [design, setDesign] = useState(initialDesign);
  const [thickness, setThickness] = useState(initialThickness ?? "");
  const [grade, setGrade] = useState("");
  const [designs, setDesigns] = useState<string[]>([]);
  const [result, setResult] = useState<StockSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch("/api/office/commercial/stock/designs", { cache: "no-store" });
      const res = await readJson<{ designs: string[] }>(r);
      if (alive && res.ok && res.data) setDesigns(res.data.designs);
    })();
    return () => { alive = false; };
  }, []);

  const search = useCallback(async (d: string, t: string, gr: string) => {
    if (!d.trim()) { setError("Pick a design to check"); return; }
    setBusy(true); setError(null);
    const qs = new URLSearchParams({ design: d.trim() });
    if (t.trim()) qs.set("thickness", t.trim());
    if (gr.trim()) qs.set("grade", gr.trim());
    const r = await fetch(`/api/office/commercial/stock?${qs.toString()}`, { cache: "no-store" });
    const res = await readJson<StockSearchResult>(r);
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error ?? "Could not read stock");
      setResult(null); onResultRef.current?.(null);
      return;
    }
    setResult(res.data);
    onResultRef.current?.(res.data);
    // First batch open, the rest collapsed: a popular design can return twenty.
    const first = res.data.groups[0]?.batchDisplay;
    setOpen(first ? { [first]: true } : {});
  }, []);

  // The tab opens the picker on a line that already names a design, so the
  // first search runs itself — one click ("Check stock") should show stock.
  const ran = useRef(false);
  useEffect(() => {
    if (!autoSearch || ran.current || !initialDesign.trim()) return;
    ran.current = true;
    void search(initialDesign, initialThickness ?? "", "");
  }, [autoSearch, initialDesign, initialThickness, search]);

  const sqftOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const g of result?.groups ?? []) for (const s of g.slabs) m.set(s.slabNumber, s.sqft);
    return (n: number) => m.get(n) ?? null;
  }, [result]);

  const summary = selectionSummary(selected, required, sqftOf);
  const offer = shortfallOffer(required, result?.total ?? 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Design</span>
          <input
            className={`${input} w-56`} list="commercial-stock-designs" value={design}
            onChange={(e) => setDesign(e.target.value)} placeholder="Carrara Royale"
          />
          <datalist id="commercial-stock-designs">
            {designs.map((d) => <option key={d} value={d} />)}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Thickness</span>
          <select className={`${input} w-32`} value={thickness} onChange={(e) => setThickness(e.target.value)}>
            <option value="">Any</option>
            {THICKNESS_OPTS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Grade</span>
          <input className={`${input} w-24`} value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="A" />
        </label>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void search(design, thickness, grade)}>
          {busy ? "Checking…" : "Check stock"}
        </button>
        {result && (
          <div className="ml-auto text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{fmt(result.total)}</span> slab(s) available
            <span className="text-gray-400"> · {fmt(result.totalSqft, 2)} sqft · {result.groups.length} batch(es)</span>
          </div>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {result && result.groups.length === 0 && (
        <Empty>No available slab of {result.design}{result.thickness ? ` ${result.thickness}` : ""} in finished goods.</Empty>
      )}

      {result && result.groups.map((b) => {
        const nums = b.slabs.map((s) => s.slabNumber);
        const state = batchTickState(selected, nums);
        const isOpen = open[b.batchDisplay] ?? false;
        return (
          <div key={`${b.batchDisplay}|${b.thickness}`} className="rounded-xl border border-gray-200">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={state === "all"}
                ref={(el) => { if (el) el.indeterminate = state === "some"; }}
                onChange={(e) => onSelectedChange(toggleBatch(selected, nums, e.target.checked))}
                aria-label={`Tick every slab in batch ${b.batchDisplay}`}
              />
              <button type="button" className="text-left" onClick={() => setOpen((o) => ({ ...o, [b.batchDisplay]: !isOpen }))}>
                <span className="font-medium text-gray-900">{b.batchDisplay}</span>
                <span className="ml-2 text-sm text-gray-500">{b.thickness}</span>
              </button>
              <span className="text-sm text-gray-600">{b.count} slab(s) · {fmt(b.sqft, 2)} sqft</span>
              <span className="flex flex-wrap gap-1">
                {Object.entries(b.grades).sort(([a], [c]) => a.localeCompare(c)).map(([gk, n]) => (
                  <Badge key={gk} tone={gk === "A" ? "green" : gk === "ungraded" ? "amber" : "brand"}>{gk} {n}</Badge>
                ))}
              </span>
              <button type="button" className={`${btn} ml-auto`} onClick={() => setOpen((o) => ({ ...o, [b.batchDisplay]: !isOpen }))}>
                {isOpen ? "Hide slabs" : "Show slabs"}
              </button>
            </div>
            {isOpen && (
              <div className="overflow-x-auto border-t border-gray-100">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
                    <tr>
                      <th className="w-10 px-3 py-2"></th>
                      <th className="px-3 py-2 text-left">Slab</th>
                      <th className="px-3 py-2 text-left">Grade</th>
                      <th className="px-3 py-2 text-left">Bay / frame</th>
                      <th className="px-3 py-2 text-right">Size (in)</th>
                      <th className="px-3 py-2 text-right">Sqft</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {b.slabs.map((s) => {
                      const on = selected.includes(s.slabNumber);
                      return (
                        <tr key={s.slabNumber} className={on ? "bg-brand/5" : ""}>
                          <td className="px-3 py-1.5">
                            <input
                              type="checkbox" className="h-4 w-4" checked={on}
                              onChange={(e) => onSelectedChange(toggleSlab(selected, s.slabNumber, e.target.checked))}
                              aria-label={`Pick slab ${s.slabNumber}`}
                            />
                          </td>
                          <td className="px-3 py-1.5 font-medium text-gray-900">{s.slabNumber}</td>
                          <td className="px-3 py-1.5">{s.grade ?? "—"}</td>
                          <td className="px-3 py-1.5 text-gray-500">{[s.bay, s.frame].filter(Boolean).join(" / ") || "—"}</td>
                          <td className="px-3 py-1.5 text-right text-gray-500">{s.lengthIn} × {s.widthIn}</td>
                          <td className="px-3 py-1.5 text-right">{fmt(s.sqft, 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {result && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <span>
            Picked <span className="font-semibold text-gray-900">{summary.picked}</span>
            {summary.required != null && <> of <span className="font-semibold text-gray-900">{summary.required}</span> needed</>}
          </span>
          {summary.sqft > 0 && <span className="text-gray-500">{fmt(summary.sqft, 2)} sqft</span>}
          {summary.required != null && summary.short > 0 && (
            <Badge tone="amber">{summary.short} more to pick</Badge>
          )}
          {summary.required != null && summary.short === 0 && <Badge tone="green">Quantity covered</Badge>}
          {selected.length > 0 && (
            <button type="button" className={`${btn} ml-auto`} onClick={() => onSelectedChange([])}>Clear picks</button>
          )}
          {offer.offer && (
            <Badge tone="red">Stock is {offer.short} short of the line</Badge>
          )}
        </div>
      )}
    </div>
  );
}
