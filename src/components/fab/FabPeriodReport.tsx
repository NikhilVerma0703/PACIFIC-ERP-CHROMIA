"use client";

// THE FABRICATION REPORT — day, week, month, with what it was worth.
//
// The owner: "there is report in the full project, same like I need that type
// for my fabrication module — day wise, month wise, weekly, along with pricing."
//
// ───────────────────────────────── TWO COLUMNS, NEVER ONE ───────────────────
// The owner again, on the panel this sits beside: "same piece is being cut,
// polished, sinked, fabricated and packaged but added as 4-5 times."
//
// So OPS and PACKED are separate columns and are never added together:
//
//   Ops      stage completions. 250 on a day of 50 pieces is normal and healthy
//            — it is how busy the floor was.
//   Packed   pieces that actually reached the end. The output figure.
//
// A single "total" column merging them was the original bug, and it read as a
// piece count to everybody who saw it.
//
// ───────────────────────────────── THE GRAIN IS FREE ────────────────────────
// Day, week and month are folded on this screen from ONE payload, so switching
// costs no request and cannot show a week built from different data than the
// days under it. lib/fab/periodReport.ts does the arithmetic and is unit-tested;
// nothing here computes anything.

import { useMemo, useState } from "react";
import { buildPeriodReport, type PeriodStageRow, type PeriodMoneyRow } from "@/lib/fab/periodReport";
import { GRAIN_LABEL, PERIOD_GRAINS, type PeriodGrain } from "@/lib/fab/reportPeriods";
import { formatRupees } from "@/lib/fab/pricing";

export interface PeriodReportProps {
  /** stageSeries.days from /api/fab/ceo — one row per calendar day. */
  days: Array<{
    date: string;
    cutting: number; polishing: number; sinkCutting: number;
    fabrication: number; packaging: number;
  }> | null;
  /** periodMoney from /api/fab/ceo — one row per (day, ordered row). */
  money: Array<{
    dayKey: string; edgeCost: number; sinkCost: number;
    piecesPacked: number; piecesCharged?: number;
  }>;
  /** The window, so empty days appear instead of being skipped. */
  range?: { from: string; to: string } | null;
}

export function FabPeriodReport({ days, money, range }: PeriodReportProps) {
  const [grain, setGrain] = useState<PeriodGrain>("day");

  const report = useMemo(() => {
    // stageSeries names its day column `date`; the report engine wants
    // `dayKey`. Renamed here rather than in either module: one of them is the
    // floor's vocabulary and the other is the calendar's, and neither should
    // have to learn the other's.
    const stageRows: PeriodStageRow[] = (days ?? []).map((d) => ({
      dayKey: d.date,
      cutting: d.cutting, polishing: d.polishing, sinkCutting: d.sinkCutting,
      fabrication: d.fabrication, packaging: d.packaging,
    }));
    const moneyRows: PeriodMoneyRow[] = (money ?? []).map((m) => ({
      dayKey: m.dayKey,
      edgeCost: m.edgeCost, sinkCost: m.sinkCost,
      piecesPacked: m.piecesPacked, piecesCharged: m.piecesCharged,
    }));
    return buildPeriodReport(stageRows, moneyRows, grain, range?.from, range?.to);
  }, [days, money, grain, range?.from, range?.to]);

  if (!days) {
    return (
      <div className="bg-white rounded-xl border border-slate-100 p-5">
        <h3 className="text-sm font-bold text-slate-800">Report</h3>
        <p className="text-xs text-amber-700 mt-2">
          The stage series could not be read, so this report would be missing a column rather than
          a row. A wrong number here is worse than a gap — nothing is shown until it loads.
        </p>
      </div>
    );
  }

  const { rows, totals } = report;
  const th = "text-right px-3 py-2 font-semibold whitespace-nowrap";
  const td = "text-right px-3 py-2 tabular-nums whitespace-nowrap";

  return (
    <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800">Report</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {/* The distinction spelt out where it is read, not only in the code. */}
            <strong className="text-slate-500">Ops</strong> is stage completions — one piece cut,
            polished, sink-cut, fabricated and packed is five. <strong className="text-slate-500">Packed</strong> is
            pieces that finished. Money is earned on the day a piece is packed.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {PERIOD_GRAINS.map((gr) => (
            <button key={gr} type="button" onClick={() => setGrain(gr)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${
                grain === gr
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>
              {GRAIN_LABEL[gr]}
            </button>
          ))}
        </div>
      </div>

      {report.dropped > 0 && (
        <p className="px-5 py-2 text-[11px] text-amber-700 bg-amber-50 border-b border-amber-100">
          {report.dropped} row{report.dropped === 1 ? "" : "s"} had a date this could not read and
          {report.dropped === 1 ? " is" : " are"} not counted anywhere. They are not silently moved
          to today.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-12">Nothing completed in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="text-left px-5 py-2 font-semibold">{GRAIN_LABEL[grain]}</th>
                <th className={th}>Cut</th>
                <th className={th}>Polish</th>
                <th className={th}>Sink</th>
                <th className={th}>Fab</th>
                <th className={th}>Pack</th>
                <th className={`${th} border-l border-slate-200`}>Ops</th>
                <th className={th}>Packed</th>
                <th className={`${th} border-l border-slate-200`}>Edge</th>
                <th className={th}>Sink ₹</th>
                <th className={th}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r) => {
                const quiet = r.operations === 0;
                return (
                  <tr key={r.period.key} className={quiet ? "text-slate-300" : "hover:bg-slate-50"}>
                    <td className="text-left px-5 py-2 font-medium text-slate-700 whitespace-nowrap">
                      {r.period.label}
                    </td>
                    <td className={td}>{r.cutting || "—"}</td>
                    <td className={td}>{r.polishing || "—"}</td>
                    <td className={td}>{r.sinkCutting || "—"}</td>
                    <td className={td}>{r.fabrication || "—"}</td>
                    <td className={td}>{r.packaging || "—"}</td>
                    <td className={`${td} font-semibold text-slate-800 border-l border-slate-100`}>
                      {r.operations || "—"}
                    </td>
                    <td className={`${td} font-semibold text-slate-800`}>{r.piecesPacked || "—"}</td>
                    <td className={`${td} text-slate-600 border-l border-slate-100`}>
                      {r.edgeCost ? formatRupees(r.edgeCost) : "—"}
                    </td>
                    <td className={`${td} text-slate-600`}>{r.sinkCost ? formatRupees(r.sinkCost) : "—"}</td>
                    <td className={`${td} font-bold ${r.total ? "text-indigo-700" : ""}`}>
                      {r.total ? formatRupees(r.total) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* The footer is the sum of the column above it, computed in the
                same function — the failure this replaces was a total that did
                not equal what it was totalling. */}
            <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-800">
              <tr>
                <td className="text-left px-5 py-2">Total</td>
                <td className={td}>{totals.cutting}</td>
                <td className={td}>{totals.polishing}</td>
                <td className={td}>{totals.sinkCutting}</td>
                <td className={td}>{totals.fabrication}</td>
                <td className={td}>{totals.packaging}</td>
                <td className={`${td} border-l border-slate-200`}>{totals.operations}</td>
                <td className={td}>{totals.piecesPacked}</td>
                <td className={`${td} border-l border-slate-200`}>{formatRupees(totals.edgeCost)}</td>
                <td className={td}>{formatRupees(totals.sinkCost)}</td>
                <td className={`${td} text-indigo-700`}>{formatRupees(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="px-5 py-2 text-[11px] text-slate-400 border-t border-slate-50">
        A row&apos;s charge spreads over its <strong>fabrication pieces</strong> — the sink ones —
        because edge work is fabrication work and a plain piece never reaches the fabricator. Rows
        with no sinks, and every sample order, are cut, polished and packed without a charge here.
        {totals.piecesPacked > 0 && (
          <>
            {" "}Of the <strong className="text-slate-500">{totals.piecesPacked}</strong> pieces
            packed in this window,{" "}
            <strong className="text-slate-500">{totals.piecesCharged}</strong> earned the money
            above.
            {/* The two counts are printed together on purpose. They were once
                the same number, which is how a mixed row of 60 pieces and 30
                sinks came to be billed twice over — right on the screen, exact
                in the ledger, and invisible because both halves look alike. */}
          </>
        )}
      </p>
    </div>
  );
}
