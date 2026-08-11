"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { formatSlabRemarks, slabStatusClass, slabStatusLabel, type DelayLike } from "@/lib/robo/utils";
import { DESIGN_SUGGESTIONS } from "@/lib/robo/design-presets";

interface SlabRecord {
  id: string;
  serialNumber: number | null;
  slabNumber: string;
  inTime: string | null;
  outTime: string | null;
  status: string;
  remarks: string | null;
  shift: { date: string; shiftNumber: number } | null;
  batchRecipe: { designName: string } | null;
  delayLogs: (DelayLike & { id: string })[];
}

const EMPTY = { date: "", slabNumber: "", designName: "" };

export function SlabsBrowser() {
  const [filters, setFilters] = useState(EMPTY);
  const [results, setResults] = useState<SlabRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [applied, setApplied] = useState(false);
  const [designOptions, setDesignOptions] = useState<string[]>([...DESIGN_SUGGESTIONS]);

  /* Suggestions = designs already produced, plus the plant reference designs.
     The field stays free text, so anything else can still be typed. */
  useEffect(() => {
    fetch("/api/robo/designs")
      .then(r => (r.ok ? r.json() : []))
      .then((designs: { name: string }[]) => {
        const seen = new Map<string, string>();
        for (const name of [...designs.map(d => d.name), ...DESIGN_SUGGESTIONS]) {
          const key = name.trim().toLowerCase();
          if (key && !seen.has(key)) seen.set(key, name.trim());
        }
        setDesignOptions([...seen.values()].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
  }, []);

  const runSearch = useCallback(async (f: typeof EMPTY) => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (f.date.trim()) qs.set("date", f.date.trim());
    if (f.slabNumber.trim()) qs.set("slabNumber", f.slabNumber.trim());
    if (f.designName.trim()) qs.set("designName", f.designName.trim());
    const hasFilters = qs.toString().length > 0;
    const res = await fetch(`/api/robo/production?${qs.toString()}`);
    const data: SlabRecord[] = res.ok ? await res.json() : [];
    setResults(data);
    setApplied(hasFilters);
    setLoading(false);
  }, []);

  useEffect(() => { runSearch(EMPTY); }, [runSearch]);

  const set = (k: keyof typeof EMPTY, v: string) => setFilters(p => ({ ...p, [k]: v }));

  const search = (e: React.FormEvent) => { e.preventDefault(); runSearch(filters); };
  const clear = () => { setFilters(EMPTY); runSearch(EMPTY); };

  const inp = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <div className="max-w-6xl space-y-6">
      {/* ── A. Find a Slab ── */}
      <Card>
        <form onSubmit={search}>
          <h2 className="mb-4 font-semibold text-gray-800">Find a Slab</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Production Date</label>
              <input type="date" value={filters.date} onChange={e => set("date", e.target.value)} className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Slab Number</label>
              <input value={filters.slabNumber} onChange={e => set("slabNumber", e.target.value)}
                placeholder="e.g. 140748" className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Design Name</label>
              <input value={filters.designName} onChange={e => set("designName", e.target.value)}
                list="slab-design-suggestions" autoComplete="off"
                placeholder="Type or pick a design name..." className={inp} />
              <datalist id="slab-design-suggestions">
                {designOptions.map(d => <option key={d} value={d} />)}
              </datalist>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit"
              className="rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold tracking-wide text-white transition hover:bg-brand/90">
              SEARCH
            </button>
            <button type="button" onClick={clear}
              className="rounded-lg border border-gray-300 px-6 py-2.5 text-sm font-semibold tracking-wide text-gray-700 transition hover:bg-gray-50">
              CLEAR FILTERS
            </button>
          </div>
        </form>
      </Card>

      {/* ── B. Results ── */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Results</h2>
          <span className="text-xs text-gray-400">
            {loading ? "Loading..." : applied
              ? `${results.length} matching record${results.length !== 1 ? "s" : ""}`
              : `Latest ${results.length} record${results.length !== 1 ? "s" : ""}`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-slate-50">
              <tr>
                {["Production Date", "Slab Number", "Design Name", "In Time", "Out Time", "Status", "Remark", ""].map(h => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && results.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    {applied ? "No slabs match these filters." : "No production records yet."}
                  </td>
                </tr>
              )}
              {results.map(r => (
                <tr key={r.id} className="border-b border-gray-50 transition hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{r.shift?.date ?? "-"}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.slabNumber}</td>
                  <td className="px-4 py-3 text-gray-600">{r.batchRecipe?.designName || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{r.inTime || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{r.outTime || "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${slabStatusClass(r.status)}`}>
                      {slabStatusLabel(r.status)}
                    </span>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-gray-600">{formatSlabRemarks(r.remarks, r.delayLogs)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/robo/slabs/${r.id}`}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand/20 bg-brand/5 px-3 py-1.5 text-xs font-semibold text-brand transition hover:border-brand hover:bg-brand hover:text-white">
                      Complete Details
                      <span aria-hidden>→</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
