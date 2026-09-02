"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { formatSlabRemarks, slabStatusClass, slabStatusLabel, type DelayLike } from "@/lib/robo/utils";
import { productionDateOf } from "@/lib/robo/productionDate";
import { DESIGN_SUGGESTIONS } from "@/lib/robo/design-presets";

interface SlabRecord {
  id: string;
  serialNumber: number | null;
  slabNumber: string;
  /** The slab's own production date, when it has one (a batch past midnight).
   *  Highest precedence in productionDateOf — see productionDate.ts. */
  productionDate: string | null;
  inTime: string | null;
  outTime: string | null;
  status: string;
  remarks: string | null;
  shift: { date: string; shiftNumber: number } | null;
  batchRecipe: { designName: string; batchNo: string | null; productionDate: string | null } | null;
  delayLogs: (DelayLike & { id: string })[];
}

const EMPTY = { date: "", batchNo: "", slabNumber: "", designName: "" };

export function SlabsBrowser({ canDelete = false }: {
  /** Whether the signed-in user may delete a slab. A courtesy so a ROBO
   *  operator never meets a button that 403s — the real gate is in the route
   *  handler (see canDeleteRoboSlab in src/lib/rbac.ts). */
  canDelete?: boolean;
}) {
  const [filters, setFilters] = useState(EMPTY);
  const [results, setResults] = useState<SlabRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [applied, setApplied] = useState(false);
  const [designOptions, setDesignOptions] = useState<string[]>([...DESIGN_SUGGESTIONS]);
  const [actionError, setActionError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    if (f.batchNo.trim()) qs.set("batchNo", f.batchNo.trim());
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

  /**
   * Permanently removes one slab record and its delay logs, then re-runs the
   * current search so the row disappears without losing the filters.
   *
   * The confirm names the slab number rather than saying "this record":
   * the operator's own check is against the paper register, and a row
   * position on a filtered table is not something they can verify.
   */
  const removeSlab = async (r: SlabRecord) => {
    if (!confirm(`Are you sure you want to delete this slab record?\n\nSlab No. ${r.slabNumber} — this cannot be undone.`)) return;
    setActionError("");
    setDeletingId(r.id);
    const res = await fetch(`/api/robo/production/${r.id}`, { method: "DELETE" }).catch(() => null);
    setDeletingId(null);
    if (!res?.ok) {
      const data = res ? await res.json().catch(() => ({})) : {};
      setActionError(data.error || "Could not delete this slab record.");
      return;
    }
    runSearch(filters);
  };

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Production Date</label>
              <input type="date" value={filters.date} onChange={e => set("date", e.target.value)} className={inp} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Batch No.</label>
              <input value={filters.batchNo} onChange={e => set("batchNo", e.target.value)}
                placeholder="e.g. B-1042" className={inp} />
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

      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
      )}

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
                {["Production Date", "Design Name", "Batch No.", "Slab Number", "In Time", "Out Time", "Status", "Remarks", "Action"].map((h, i, arr) => (
                  <th key={h} className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${i === arr.length - 1 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!loading && results.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                    {applied ? "No slabs match these filters." : "No production records yet."}
                  </td>
                </tr>
              )}
              {results.map(r => (
                <tr key={r.id} className="border-b border-gray-50 transition hover:bg-slate-50">
                  {/* The date the operator entered on the setup, not the shift's
                      own — that one is the day the tablet was open, so a
                      register caught up on Monday showed Monday for every slab
                      of the previous week. See productionDate.ts. */}
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{productionDateOf(r) || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{r.batchRecipe?.designName || "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{r.batchRecipe?.batchNo || "-"}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.slabNumber}</td>
                  <td className="px-4 py-3 text-gray-600">{r.inTime || "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{r.outTime || "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${slabStatusClass(r.status)}`}>
                      {slabStatusLabel(r.status)}
                    </span>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-gray-600">{formatSlabRemarks(r.remarks, r.delayLogs)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <Link href={`/robo/slabs/${r.id}`}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand/20 bg-brand/5 px-3 py-1.5 text-xs font-semibold text-brand transition hover:border-brand hover:bg-brand hover:text-white">
                        Complete Details
                        <span aria-hidden>→</span>
                      </Link>
                      {/* Edit reaches every slab in every shift, closed ones
                          included — this table is the only way back to a slab
                          once its shift has rolled over. It opens on two tabs,
                          Edit slab and Edit setup, because the design and the
                          machines live on the batch's setup row rather than on
                          the slab. */}
                      <Link href={`/robo/slabs/${r.id}/edit`}
                        className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50">
                        Edit
                      </Link>
                      {canDelete && (
                        <button type="button" onClick={() => removeSlab(r)} disabled={deletingId === r.id}
                          className="inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:border-red-600 hover:bg-red-600 hover:text-white disabled:opacity-50">
                          {deletingId === r.id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
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
