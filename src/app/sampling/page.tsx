"use client";

// SAMPLE INVENTORY — what is on the shelf.
//
// series -> colour -> finish -> size, with quantities, in the printed chart's
// own order (product_series.position, product_colour.position) because the
// person reading this has the chart in front of them.
//
// IT IS BUILT AROUND THE FACT THAT MOST OF IT IS EMPTY. 56 colours over 7
// series, three with a second finish, and any number of sizes under each — a
// flat list is hundreds of rows of which a handful hold anything. So:
//
//   * only shelves with pieces on them are listed, by default. A sampling_stock
//     row is not deleted when it empties (the quantity moves, the row does
//     not), so the shelf accumulates zeroes, and a zero is not stock;
//   * a search box, matching every term against the series, the colour, the
//     finish and every spelling of the size ("4x4" finds 4 × 4 in · 20 mm);
//   * "Show everything" turns the empty shelves and the never-cut colours back
//     on — because "have we ever cut Nebula Ash" is a real question and the
//     default would answer it with silence;
//   * and when the default IS hiding something the search matched, it says so,
//     with the count. "No results" and "none left" must not read the same.
//
// The grouping, the searching and the counting are lib/sampling/inventory.ts —
// pure and unit-tested. This file renders; it decides nothing.
//
// getJson, never raw fetch (lib/fab/postJson.ts): "the shelf is empty" and "the
// shelf failed to load" are not allowed to look the same.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getJson } from "@/lib/fab/postJson";
import {
  filterInventory, groupInventory, summariseInventory, type InventoryRow,
} from "@/lib/sampling/inventory";

export default function SamplingInventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [search, setSearch] = useState("");
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getJson<InventoryRow>("/api/sampling/inventory");
    setRows(r.data);
    setLoadError(r.error);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const opts = useMemo(() => ({ search, includeEmpty }), [search, includeEmpty]);
  const shown = useMemo(() => filterInventory(rows, opts), [rows, opts]);
  const tree = useMemo(() => groupInventory(shown), [shown]);
  const summary = useMemo(() => summariseInventory(rows, opts), [rows, opts]);

  return (
    <div className="max-w-5xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sample Inventory</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            What is on the shelf, by colour, finish and size
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sampling/add-stock"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700">
            Add stock
          </Link>
          <button onClick={load} disabled={loading}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition hover:border-gray-300 disabled:opacity-40">
            Refresh
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>This inventory may be out of date.</b> {loadError} Nothing below is confirmed — an
          empty shelf here does not mean there is no stock.
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: "Pieces in stock", value: summary.pieces },
          { label: "Shelves listed", value: summary.shelves },
          { label: "Colour + finish", value: summary.colours },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-100 bg-white p-4">
            <p className="mb-1 text-xs text-slate-400">{s.label}</p>
            <p className="text-lg font-semibold text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search colour, series, finish or size — try “cappuccino 4x4”"
          aria-label="Search the sample inventory"
          className="min-w-[18rem] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100"
        />
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={includeEmpty}
            onChange={(e) => setIncludeEmpty(e.target.checked)} />
          Show everything, including empty
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-gray-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" />
          </svg>
          Loading…
        </div>
      ) : tree.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center text-sm text-gray-400">
          {/* THE THREE EMPTY STATES ARE DIFFERENT SENTENCES, because they are
              different facts and the person reading has to act differently on
              each. */}
          {summary.hiddenEmpty > 0 ? (
            <>
              Nothing in stock matches that.{" "}
              <button onClick={() => setIncludeEmpty(true)} className="font-medium text-indigo-600 underline underline-offset-2">
                {summary.hiddenEmpty} empty shelf{summary.hiddenEmpty === 1 ? "" : "s"} match{summary.hiddenEmpty === 1 ? "es" : ""} —
                show everything
              </button>
            </>
          ) : search.trim() ? (
            <>No colour, finish or size matches “{search.trim()}”.</>
          ) : (
            <>
              Nothing in stock yet.{" "}
              <Link href="/sampling/add-stock" className="font-medium text-indigo-600 underline underline-offset-2">
                Add the first pieces
              </Link>.
            </>
          )}
        </div>
      ) : (
        <>
          {summary.hiddenEmpty > 0 && (
            <p className="mb-3 text-xs text-gray-400">
              {summary.hiddenEmpty} empty shelf{summary.hiddenEmpty === 1 ? "" : "s"} hidden.{" "}
              <button onClick={() => setIncludeEmpty(true)} className="font-medium text-indigo-600 underline underline-offset-2">
                Show everything
              </button>
            </p>
          )}
          <div className="space-y-3">
            {tree.map((s) => (
              <section key={s.seriesName} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                <header className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-5 py-2.5">
                  <h2 className="text-sm font-bold text-slate-800">{s.seriesName}</h2>
                  <span className="text-[11px] text-slate-400">
                    {s.colours.length} colour{s.colours.length === 1 ? "" : "s"} ·{" "}
                    <b className="text-slate-700">{s.quantity}</b> piece{s.quantity === 1 ? "" : "s"}
                  </span>
                </header>
                <div className="divide-y divide-gray-50">
                  {s.colours.map((c) => (
                    <div key={c.colourName} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-900">{c.colourName}</span>
                        <span className={`text-[11px] font-bold ${c.quantity > 0 ? "text-gray-600" : "text-gray-300"}`}>
                          {c.quantity} piece{c.quantity === 1 ? "" : "s"}
                        </span>
                      </div>
                      {c.finishes.map((f) => (
                        <div key={f.colourFinishId} className="mt-1.5">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                              {f.finish}
                            </span>
                            {f.sizes.length === 0 && (
                              <span className="text-[11px] italic text-gray-300">never cut</span>
                            )}
                          </div>
                          {f.sizes.length > 0 && (
                            <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                              {f.sizes.map((z) => (
                                <li key={z.sizeId} className="text-xs text-gray-600">
                                  <span className="font-mono">{z.label}</span>
                                  <b className={`ml-2 ${z.quantity > 0 ? "text-gray-900" : "text-gray-300"}`}>
                                    ×{z.quantity}
                                  </b>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
