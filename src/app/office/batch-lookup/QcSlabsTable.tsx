"use client";

import { useMemo, useState } from "react";
import { Badge, Empty, fmt } from "@/components/ui";
import { slabLabel } from "@/lib/slabLabel";
import type { BatchQcSlab } from "@/lib/batchQcList";

// Finished-goods status, rendered as-is from fg_finished_slab.status.
const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  PACKED: "Packed",
  DISPATCHED: "Dispatched",
  RETURNED: "Returned",
};
const STATUS_TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  AVAILABLE: "brand",
  RESERVED: "amber",
  PACKED: "amber",
  DISPATCHED: "green",
  RETURNED: "red",
};

/** Shared "blank" sentinel for the three dropdowns — no grade, no thickness, or no
 *  finished-goods row at all. Each filter reads it with its own meaning; see the
 *  predicates below. It cannot be mistaken for a real value: status is a Prisma enum,
 *  thickness comes from the canonical resolver, and no QC grade is this string. */
const NO_LEDGER = "__none__";

const sel = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-brand";

/** The per-slab QC list, filtered in the browser.
 *
 *  Client-side on purpose. Every row is already in the payload (the page fetches the
 *  whole list to count it), so filtering is pure state: no navigation, no server round
 *  trip, no scroll jump — the same reason the MIS downtime log filters this way. (That
 *  one also mirrors its filter into the URL so the view is shareable and its Excel export
 *  inherits it; this table has neither, so it does not.)
 *
 *  It also keeps this page's defining property intact: the component takes BatchQcSlab[],
 *  the closed shape the page already projects, and reads nothing else. A filter cannot
 *  widen what reaches the JSX.
 *
 *  Options come from the rows themselves rather than a hardcoded list — the same lesson
 *  the inventory filter row taught: a hand-written list drifts from the data and starts
 *  offering values nothing matches, or hiding values that exist. */
export function QcSlabsTable({ rows }: { rows: BatchQcSlab[] }) {
  const [slab, setSlab] = useState("");
  const [grade, setGrade] = useState("");
  const [thickness, setThickness] = useState("");
  const [status, setStatus] = useState("");

  const opts = useMemo(() => {
    const g = new Set<string>(), t = new Set<string>(), s = new Set<string>();
    let anyNoLedger = false;
    for (const r of rows) {
      if (r.grade) g.add(r.grade);
      if (r.thickness) t.add(r.thickness);
      if (r.status) s.add(r.status); else anyNoLedger = true;
    }
    return {
      grades: [...g].sort((a, b) => a.localeCompare(b)),
      thicknesses: [...t].sort((a, b) => a.localeCompare(b)),
      statuses: [...s].sort((a, b) => a.localeCompare(b)),
      anyNoLedger,
      // Only offer "—" where a blank actually occurs, so no option is dead on arrival
      // (it can still return nothing in combination with another filter).
      anyNoGrade: rows.some((r) => !r.grade),
      anyNoThickness: rows.some((r) => !r.thickness),
    };
  }, [rows]);

  const shown = useMemo(() => {
    // Lower-cased: slabLabel renders an insert slab with a LETTER suffix (1.1 -> "1a"),
    // so "12C" must match "12c". Matched against both the label and the stored number,
    // since either is a reasonable thing to type.
    const q = slab.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !slabLabel(r.slab).toLowerCase().includes(q) && !String(r.slab).includes(q)) return false;
      if (grade && (grade === NO_LEDGER ? !!r.grade : r.grade !== grade)) return false;
      if (thickness && (thickness === NO_LEDGER ? !!r.thickness : r.thickness !== thickness)) return false;
      if (status && (status === NO_LEDGER ? r.status !== null : r.status !== status)) return false;
      return true;
    });
  }, [rows, slab, grade, thickness, status]);

  const active = !!(slab.trim() || grade || thickness || status);
  const clear = () => { setSlab(""); setGrade(""); setThickness(""); setStatus(""); };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={slab}
          onChange={(e) => setSlab(e.target.value)}
          placeholder="Slab #"
          className={`${sel} w-28`}
        />
        <select value={grade} onChange={(e) => setGrade(e.target.value)} className={sel}>
          <option value="">Any grade</option>
          {opts.grades.map((g) => <option key={g} value={g}>{g}</option>)}
          {opts.anyNoGrade && <option value={NO_LEDGER}>— no grade —</option>}
        </select>
        <select value={thickness} onChange={(e) => setThickness(e.target.value)} className={sel}>
          <option value="">Any thickness</option>
          {opts.thicknesses.map((t) => <option key={t} value={t}>{t}</option>)}
          {opts.anyNoThickness && <option value={NO_LEDGER}>— not recorded —</option>}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
          <option value="">Any status</option>
          {opts.statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
          {opts.anyNoLedger && <option value={NO_LEDGER}>— not in ledger —</option>}
        </select>
        {active && (
          <>
            <button type="button" onClick={clear} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
              Clear
            </button>
            {/* Say what is being hidden — a filtered table that silently shows fewer rows
                than the count above it reads as missing data. The unit is named because
                the caption above counts DISTINCT SLABS while this counts QC ROWS, and on a
                batch with re-QC'd slabs the two legitimately differ. */}
            <span className="text-sm text-gray-500">
              Showing {fmt(shown.length)} of {fmt(rows.length)} QC rows
            </span>
          </>
        )}
      </div>

      {shown.length === 0 ? (
        <Empty>No slabs match these filters.</Empty>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-4">Slab #</th>
                <th className="py-2 pr-4">Grade</th>
                <th className="py-2 pr-4">Thickness</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {/* A slab QC'd twice appears twice — rows are 1:1 with polish_qc, minus rows
                  carrying no slab number. Those are dropped upstream: a row with no slab is
                  not a slab, and surfacing the count would re-expose slabAudit.blankRows, a
                  rectification signal this page's projection excludes on purpose. */}
              {shown.map((s, i) => (
                <tr key={`${s.slab}-${i}`} className="border-t border-gray-100">
                  <td className="py-2 pr-4 font-medium text-gray-900">{slabLabel(s.slab)}</td>
                  <td className="py-2 pr-4">{s.grade ?? "—"}</td>
                  <td className="py-2 pr-4">{s.thickness ?? "—"}</td>
                  <td className="py-2">
                    {s.status ? (
                      <Badge tone={STATUS_TONE[s.status] ?? "brand"}>
                        {STATUS_LABEL[s.status] ?? s.status}
                      </Badge>
                    ) : (
                      <span className="text-gray-400">not in ledger</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
