"use client";

// WHAT EACH SLAB IS WORTH, AND WHAT MADE IT UP.
//
// The owner: "in the CEO dashboard, as we have project and slab wise, I need to
// see the slab-wise cost and the subdivisions also. Be precise."
//
// On the board above this, money is per ORDERED ROW. But a row is cut from
// whatever stone the supervisor put it on — 22 pieces here, 38 there — and
// "what did that slab cost" is a different question, asked by a different
// person, than "what does that row cost".
//
// SO EACH SLAB OPENS. The slab line answers the first question; the lines under
// it name the rows that made the figure, with how many pieces of each came off
// that stone. Without the subdivisions a slab total is a number nobody can
// check without opening every row of the project and doing the division by
// hand — which is exactly what "be precise" rules out.
//
// THE ARITHMETIC IS NOT HERE. costPerSlab only divides up figures priceRow has
// already produced — the same call that renders the row lines on the board — so
// this panel cannot disagree with the project total it sits under, and the
// subdivisions cannot disagree with the slab line they sit under. See
// settleShares in lib/fab/slabCosting.ts for why "sums to the line above" is
// not automatic once four buckets are each rounded on their own.
//
// ─────────────────────── ONE FILE LATER THAN IT SHOULD HAVE BEEN ────────────
// This panel was written and tested a commit ago and shipped with its mount
// commented out inside CeoOverviewBoard, so that push could be the 0067-0070
// pricing work and nothing else. It is on now, it lives in its own file, and
// the subdivisions are new.

import { Fragment, useState } from "react";
import { formatRupees } from "@/lib/fab/pricing";
// THE SIZE BESIDE THE LETTER — shape-aware, and printed in the unit the
// customer ordered in. "Row C" alone is a label somebody has to go and look up.
import { describeShapeSize } from "@/lib/fab/shape";
import type { SlabCosting, SlabRowShare } from "@/lib/fab/slabCosting";

/** EXACT OR APPORTIONED, said with a mark rather than a sentence per row.
 *
 *  Edge money is exact: every piece of a row carries the same edge work, so a
 *  slab holding 22 of 60 pieces owes exactly 22 shares. Sink money is spread by
 *  piece count, because WHICH pieces of a row get the cutout is settled at the
 *  bench and is written down nowhere. */
function SinkMark({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span
      className="text-amber-600"
      title="Apportioned by piece count. Which pieces of a row carry the sink cutout is decided at the bench and is not recorded, so a slab holding part of a row holds an unknown share of its sinks."
    >
      *
    </span>
  );
}

/** The ordered rows that made one line's figure. Sums to that line exactly. */
function Subdivisions({ shares, what }: { shares: SlabRowShare[]; what: string }) {
  if (shares.length === 0) return null;
  return (
    <tr className="bg-slate-50/80">
      <td colSpan={6} className="px-3 py-1.5">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">
          {what} &middot; the ordered rows that make it up
        </div>
        <table className="w-full text-[11px]">
          <tbody className="divide-y divide-slate-200/70">
            {shares.map((r) => (
              <tr key={r.requirementId}>
                <td className="py-1 pr-3 font-mono text-slate-600 whitespace-nowrap">
                  {r.rowLetter ? `Row ${r.rowLetter}` : "—"}
                  {r.lengthIn != null && (
                    <span className="ml-1.5 font-sans text-slate-400">
                      {describeShapeSize(r.shapeType, { lengthIn: r.lengthIn, widthIn: r.widthIn }, r.dimUnit)}
                    </span>
                  )}
                  {r.unpriced && (
                    <span
                      className="ml-1.5 font-sans text-amber-700"
                      title="This row could not be priced — an L outline, a missing size, or a mode with no rate. Its pieces are counted here; its money is not."
                    >
                      not costed
                    </span>
                  )}
                </td>
                <td className="py-1 pr-3 text-slate-500 tabular-nums whitespace-nowrap">
                  {/* "22 of 60" — so it is obvious at a glance that the rest of
                      the row is on other stone, and that a slab is not a row. */}
                  {r.pieces} of {r.orderedQuantity} pc{r.orderedQuantity === 1 ? "" : "s"}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums text-slate-600">
                  {formatRupees(r.edgeCost)}
                </td>
                <td className="py-1 pr-3 text-right tabular-nums text-slate-600">
                  {formatRupees(r.sinkCost)}
                  <SinkMark on={r.sinkEstimated} />
                </td>
                <td className="py-1 text-right tabular-nums font-semibold text-slate-700">
                  {formatRupees(r.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

export function SlabCostPanel({ costing }: { costing: SlabCosting }) {
  /** WHICH LINES ARE OPEN — a set, not a single id, so two slabs can be read
   *  side by side. The usual reason to open one at all is to ask why it is
   *  dearer than the one under it. */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (costing.slabs.length === 0 && costing.unallocated.pieces === 0) return null;

  const anyEstimated =
    costing.slabs.some((s) => s.sinkEstimated) ||
    costing.unallocated.breakdown.some((r) => r.sinkEstimated);

  return (
    <div className="mt-3 rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Cost per slab
        </span>
        <span className="text-[10px] text-slate-400">
          the rows above, split by where their pieces were cut &middot; click a slab for its rows
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-400 bg-white">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">Slab</th>
              <th className="text-center px-3 py-1.5 font-medium">Pieces</th>
              <th className="text-center px-3 py-1.5 font-medium">Rows</th>
              <th className="text-right px-3 py-1.5 font-medium">Edge</th>
              <th className="text-right px-3 py-1.5 font-medium">Sink</th>
              <th className="text-right px-3 py-1.5 font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {costing.slabs.map((s) => (
              <Fragment key={s.slabId}>
                <tr
                  className="hover:bg-slate-50/60 cursor-pointer"
                  onClick={() => toggle(s.slabId)}
                  aria-expanded={open.has(s.slabId)}
                >
                  <td className="px-3 py-1.5">
                    <span
                      className={`inline-block w-3 text-slate-400 text-[9px] transition-transform ${
                        open.has(s.slabId) ? "rotate-90" : ""
                      }`}
                    >
                      &#9654;
                    </span>
                    <span className="font-mono text-slate-700">{s.slabCode ?? "—"}</span>
                    {s.colour && <span className="ml-1.5 text-slate-400">{s.colour}</span>}
                    {s.unpricedRows > 0 && (
                      <span
                        className="ml-1.5 text-[10px] text-amber-700"
                        title="Some of this slab's stone is on a row the system cannot price — an L outline, a blank size, or a mode with no rate. Its pieces are counted; its money is not."
                      >
                        &middot; {s.unpricedRows} row{s.unpricedRows === 1 ? "" : "s"} not costed
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums text-slate-600">{s.pieces}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums text-slate-400">{s.rows}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {formatRupees(s.edgeCost)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {formatRupees(s.sinkCost)}
                    <SinkMark on={s.sinkEstimated} />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-indigo-700">
                    {formatRupees(s.total)}
                  </td>
                </tr>
                {open.has(s.slabId) && (
                  <Subdivisions
                    shares={s.breakdown}
                    what={s.slabCode ? `Slab ${s.slabCode}` : "This slab"}
                  />
                )}
              </Fragment>
            ))}

            {/* NOT ON STONE YET, AND SAID SO. Without this line the slab figures
                quietly fail to add up to the project total above, and somebody
                spends an afternoon on the difference. A project half planned is
                SUPPOSED to show most of its money here. */}
            {costing.unallocated.pieces > 0 && (
              <Fragment>
                <tr
                  className="bg-slate-50/60 cursor-pointer hover:bg-slate-100/60"
                  onClick={() => toggle("__unallocated__")}
                  aria-expanded={open.has("__unallocated__")}
                >
                  <td className="px-3 py-1.5 text-slate-500 italic">
                    <span
                      className={`inline-block w-3 text-slate-400 text-[9px] not-italic transition-transform ${
                        open.has("__unallocated__") ? "rotate-90" : ""
                      }`}
                    >
                      &#9654;
                    </span>
                    not on a slab yet
                    <span className="ml-1.5 text-[10px] text-slate-400 not-italic">
                      {costing.unallocated.rows} row{costing.unallocated.rows === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center tabular-nums text-slate-500">
                    {costing.unallocated.pieces}
                  </td>
                  <td className="px-3 py-1.5" />
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {formatRupees(costing.unallocated.edgeCost)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {formatRupees(costing.unallocated.sinkCost)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-500">
                    {formatRupees(costing.unallocated.total)}
                  </td>
                </tr>
                {open.has("__unallocated__") && (
                  <Subdivisions shares={costing.unallocated.breakdown} what="Waiting for stone" />
                )}
              </Fragment>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-white">
              <td className="px-3 py-1.5 font-semibold text-slate-600" colSpan={5}>
                Every slab, plus what is not on stone
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums font-bold text-slate-800">
                {formatRupees(costing.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {anyEstimated && (
        <p className="px-3 py-1.5 text-[10px] text-slate-400 border-t border-slate-100">
          <span className="text-amber-600">*</span> Edge money is exact — every piece of a row
          carries the same edge work. Sink money is apportioned by piece count, because which
          pieces of a row get the cutout is settled at the bench and is not recorded.
        </p>
      )}
    </div>
  );
}
