"use client";
// THE MIS HOURLY LOG, as the maintenance manager needs to see it: one row per logged
// hour with the four delay buckets side by side, and the control that moves minutes
// between them.
//
// WHY A SECOND TABLE, when the Breakdown & deviation log is right below it. They answer
// different questions. That log is a narrative — one line per incident, the four
// buckets flattened into a "Type" string, RCA and response beside it — and it is built
// for reading what happened. This is the ledger the correction acts on: four columns,
// four numbers, the hour's total at the end, so the manager can see at a glance that
// 40 minutes sit in Breakdown on an hour the line was being cleaned, and move them
// without arithmetic. The owner asked for the edit in both places by name, and these
// are the two places production's classification is actually visible.
//
// It deliberately does NOT re-query. The rows are the same MIS hours the downtime
// report already loaded (any hour with stoppage time, a breakdown flag, an RCA or a
// note), projected down to the few fields this table draws — a second query for the
// same hours would be a second answer that can disagree with the first.
import { useMemo, useState } from "react";
import { Card, H2 } from "@/components/ui";
import { DELAY_FIELDS, fmtDur } from "@/lib/downtimeShared";
import { ReclassifyDelay, reclassFigureClass, reclassFigureTitle } from "@/components/ReclassifyDelay";
import { describeReclass, RECLASS_TONE, type ReclassRecord } from "@/lib/delayReclass";

/** The projection this table needs — not IncidentRow, which carries reasons, RCA,
 *  details and incharges this view never draws. Passing the fat row would double the
 *  page's payload for the same hours the log card below already ships. */
export interface MisHourRow {
  id: string;
  date: string | null;
  hour: string | null;
  batch: string | null;
  /** The hour's total across all four buckets. A reclassification never changes it. */
  minutes: number;
  /** Over 60 min in one hour — production's entry error, flagged not fixed. */
  over: boolean;
  minutesByType: Record<string, number>;
}

export function MisHourlyLogCard({ rows, rowsTotal, canReclass, reclass, reclassFailed }: {
  rows: MisHourRow[];
  /** Hours in the range, which may exceed `rows` — the list is capped for payload size,
   *  exactly as the log card below is, and the difference has to be stated or the two
   *  tables look like they are contradicting each other. */
  rowsTotal: number;
  canReclass: boolean;
  reclass: Record<string, ReclassRecord[]>;
  reclassFailed: boolean;
}) {
  // Most hours were never touched, and on a 30-day range the manager is looking for the
  // handful that were. Client-side, like the type chips below: a searchParams change
  // re-keys the segment and throws the scroll to the top.
  const [onlyCorrected, setOnlyCorrected] = useState(false);
  const correctedCount = useMemo(
    () => rows.filter((r) => (reclass[r.id]?.length ?? 0) > 0).length,
    [rows, reclass],
  );
  const shown = onlyCorrected ? rows.filter((r) => (reclass[r.id]?.length ?? 0) > 0) : rows;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <H2>MIS hourly log · delay classification · {shown.length}</H2>
        {correctedCount > 0 && (
          <button
            type="button"
            onClick={() => setOnlyCorrected((v) => !v)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${onlyCorrected ? "border-violet-400 bg-violet-100 text-violet-800" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
          >
            ⇄ Reclassified only · {correctedCount}
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-500">
        The four delay buckets as production entered them, hour by hour. A stoppage booked under the wrong
        type — cleaning time charged to maintenance, or the reverse — is corrected here: the minutes MOVE to
        the right bucket and the hour&apos;s total stays exactly as it was.
        {rowsTotal > rows.length ? ` Showing the oldest ${rows.length} of ${rowsTotal} logged hours in this range.` : ""}
      </p>

      {reclassFailed && (
        <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ Applied corrections could not be loaded just now — an already-reclassified hour will look untouched here, because these figures come from the MIS row and the MIS row is already corrected. Reload the page; reclassifying is disabled meanwhile so a second move can&apos;t be stacked on one nobody can see.
        </p>
      )}
      {!reclassFailed && correctedCount > 0 && (
        <p className={`mb-3 rounded-lg border px-3 py-2 text-xs ${RECLASS_TONE.panel} ${RECLASS_TONE.text}`}>
          <span className="font-medium">⇄ Reclassified</span> — a figure in violet was moved by maintenance, not entered by production. Hover it for what it was before, and the badge for who moved it, when and why.
        </p>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-gray-400">{onlyCorrected ? "No hours in this range have been reclassified." : "No hours logged in this range."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500">
              <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Hour</th><th className="py-2 pr-3">Batch</th>
              {DELAY_FIELDS.map((d) => <th key={d.key} className="py-2 pr-3 text-right">{d.label}</th>)}
              <th className="py-2 pr-3 text-right">Hour total</th>
              <th className="py-2">Correction</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const recs = reclass[r.id] ?? [];
                const mark = describeReclass(recs);
                return (
                  <tr key={r.id} className="border-t border-gray-100 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{r.date ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{r.hour ?? "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{r.batch ?? "—"}</td>
                    {DELAY_FIELDS.map((d) => {
                      const m = r.minutesByType[d.key] ?? 0;
                      const cls = reclassFigureClass(mark, d.key);
                      return (
                        <td key={d.key} className={`py-2 pr-3 whitespace-nowrap text-right ${cls || "text-gray-700"}`}
                            title={reclassFigureTitle(mark, d.key, r.minutesByType, recs)}>
                          {m > 0 ? fmtDur(m) : "—"}
                          {/* Never colour alone: the arrow says "moved" in a printout and
                              to a reader who cannot tell violet from grey. */}
                          {cls ? " ⇄" : ""}
                        </td>
                      );
                    })}
                    <td className={`py-2 pr-3 whitespace-nowrap text-right font-medium ${r.over ? "text-red-600" : "text-gray-900"}`}
                        title={r.over ? `This hour logs ${fmtDur(r.minutes)} across all types — more than 60 min in one hour, an entry error` : undefined}>
                      {r.minutes > 0 ? fmtDur(r.minutes) : "—"}{r.over ? " ⚠" : ""}
                    </td>
                    <td className="py-2 align-top">
                      <ReclassifyDelay misId={r.id} canReclass={canReclass} minutesByType={r.minutesByType} records={recs} showLines />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
