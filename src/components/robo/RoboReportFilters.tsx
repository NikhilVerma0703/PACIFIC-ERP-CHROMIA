"use client";
// The filter bar shared by Reports and Downloads: Batch Number first, then
// Production Date (All / Date Wise / Date Range). One component so the two
// screens can never drift in order, wording, or behaviour — change (4)/(6).
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ReportMode } from "@/lib/robo/reportQuery";

const input =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

/**
 * Load every batch number on record (for the dropdown) and, on first load,
 * select the LATEST one — the batch at the top of the list — unless the operator
 * has already typed something. Returns the options for the datalist.
 *
 * The default is applied exactly once (a ref, not the options length), so it
 * seeds the screen without ever fighting a value the operator sets afterwards.
 */
export function useRoboBatchOptions(setBatch: Dispatch<SetStateAction<string>>): string[] {
  const [options, setOptions] = useState<string[]>([]);
  const didDefault = useRef(false);
  useEffect(() => {
    let ignore = false;
    fetch("/api/robo/batch-numbers")
      .then((r) => (r.ok ? r.json() : { batchNumbers: [] }))
      .then((d: { batchNumbers?: string[] }) => {
        if (ignore) return;
        const list = d.batchNumbers ?? [];
        setOptions(list);
        if (!didDefault.current && list.length > 0) {
          didDefault.current = true;
          setBatch((cur) => (cur.trim() ? cur : list[0]));
        }
      })
      .catch(() => {});
    return () => { ignore = true; };
  }, [setBatch]);
  return options;
}

interface Props {
  mode: ReportMode;
  setMode: Dispatch<SetStateAction<ReportMode>>;
  date: string;
  setDate: Dispatch<SetStateAction<string>>;
  from: string;
  setFrom: Dispatch<SetStateAction<string>>;
  to: string;
  setTo: Dispatch<SetStateAction<string>>;
  batch: string;
  setBatch: Dispatch<SetStateAction<string>>;
  /** Every batch number on record, for the dropdown; free typing is allowed. */
  batchOptions: string[];
}

export function RoboReportFilters({
  mode, setMode, date, setDate, from, setFrom, to, setTo, batch, setBatch, batchOptions,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      {/* 1 ── Batch Number (a dropdown of every batch, plus free typing) ── */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="w-32 text-sm font-medium text-gray-700">Batch Number</label>
        <input
          list="robo-batch-options"
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
          placeholder="All batches — pick or type"
          aria-label="Batch number"
          className={input}
        />
        <datalist id="robo-batch-options">
          {batchOptions.map((b) => <option key={b} value={b} />)}
        </datalist>
        {batch.trim() && (
          <button
            type="button"
            onClick={() => setBatch("")}
            className="text-xs font-medium text-gray-500 underline hover:text-gray-700"
          >
            Clear
          </button>
        )}
      </div>

      {/* 2 ── Production Date (All / Date Wise / Date Range) ── */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="w-32 text-sm font-medium text-gray-700">Production Date</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as ReportMode)} className={input}>
          <option value="ALL">All</option>
          <option value="DATE">Date Wise</option>
          <option value="RANGE">Date Range</option>
        </select>
        {mode === "DATE" && (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        )}
        {mode === "RANGE" && (
          <>
            <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
            <span className="text-sm text-gray-400">to</span>
            <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
          </>
        )}
      </div>
    </div>
  );
}
