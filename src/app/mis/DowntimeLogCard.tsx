"use client";
// Breakdown & deviation log — THE one downtime table, with a CLIENT-SIDE type filter.
//
// THIS TABLE ABSORBED THE MIS HOURLY LOG. There used to be a second card above this
// one (MisHourlyLogCard, deleted) that showed the same hours with the four delay
// buckets as columns and the Reclassify control beside them. Both cards were fed the
// SAME r.incidents rows over the same window, so both headers carried the same count
// and the owner read them as one table printed twice — "cant we merge these two
// tables into one?". They are one now: the four buckets are explicit columns here
// (replacing the flattened "Type" string), the hour's total sits beside them, and the
// correction control stays where it already lived — inside DowntimeRespond in the
// Maintenance response column. Nothing either card showed is gone: the bucket figures
// carry the same violet reclass marks and hover text (reclassFigureClass/Title, the
// shared helpers the old card rendered with), the "⇄ Reclassified only" toggle moved
// here, and zero-delay hours (breakdown flag / RCA / note with no minutes) were
// always in r.incidents, so they keep their row with em-dashes across the buckets.
//
// The chips used to be <Link scroll={false}> — but a searchParams navigation re-keys
// the page segment, the root loading skeleton swaps in, the page collapses and the
// browser throws the scroll to the top (scroll={false} can't prevent a layout
// collapse). Every row already carries minutesByType/reasonsByType, so filtering is
// pure state: no navigation, no skeleton, no scroll. The URL still gets ?type= via
// history.replaceState so the view stays shareable and the Excel export carries the
// active filter; a ?type= deep link arrives as initialType and renders filtered on
// first paint.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, H2 } from "@/components/ui";
import { DELAY_FIELDS, fmtDur } from "@/lib/downtimeShared";
import type { IncidentRow } from "@/lib/downtime";
import type { DowntimeResp } from "@/lib/downtimeResponse";
import { DowntimeRespond } from "@/components/DowntimeRespond";
import { reclassFigureClass, reclassFigureTitle } from "@/components/ReclassifyDelay";
import { describeReclass, RECLASS_TONE, type ReclassRecord } from "@/lib/delayReclass";

export function DowntimeLogCard({ incidents, incidentsTotal, typeTotals, initialType, from, to, batch, canRespond, respFailed, responses, photos, reclass, reclassFailed, canReclass }: {
  incidents: IncidentRow[];
  /** Rows in the range, which may exceed `incidents` — that list is capped for payload
   *  size. The KPI cards above are aggregated over ALL of them, so the difference has to
   *  be stated or the log looks like it is contradicting them. */
  incidentsTotal: number;
  /** True per-type incident counts over the WHOLE range (report byType). Needed because
   *  a type-filtered view filters the already-capped list, so its own length is not the
   *  real count — that view was the one still contradicting the KPI tile above it. */
  typeTotals: Record<string, number>;
  initialType: string | null;
  from: string; to: string; batch: string;
  canRespond: boolean;
  respFailed: boolean;
  responses: Record<string, DowntimeResp>;
  /** Response photos per MIS row id, served by /api/photo under its own gate. */
  photos: Record<string, { id: string; filename: string }[]>;
  /** Applied delay-type corrections per MIS row id, oldest first. A row that appears
   *  here has figures maintenance moved between buckets — the hour's TOTAL is
   *  untouched, so the "Down" column is unaffected and only the bucket figures moved. */
  reclass: Record<string, ReclassRecord[]>;
  /** The corrections lookup itself failed. The figures are still production's plus
   *  whatever was moved — we just cannot say which — so the marks are unreliable for
   *  this load and correcting is withheld until a reload proves otherwise. */
  reclassFailed: boolean;
  canReclass: boolean;
}) {
  const [type, setType] = useState<string | null>(initialType);
  // Most hours were never corrected, and on a 30-day range the manager is looking for
  // the handful that were. Client-side like the type chips, and for the same reason:
  // a searchParams change re-keys the segment and throws the scroll to the top.
  const [onlyCorrected, setOnlyCorrected] = useState(false);
  const correctedCount = useMemo(
    () => incidents.filter((i) => (reclass[i.id]?.length ?? 0) > 0).length,
    [incidents, reclass],
  );
  const typed = type ? incidents.filter((i) => i.typeKeys.includes(type)) : incidents;
  const shown = onlyCorrected ? typed.filter((i) => (reclass[i.id]?.length ?? 0) > 0) : typed;

  const pick = (t: string | null) => {
    setType(t);
    const q = new URLSearchParams(window.location.search);
    if (t) q.set("type", t); else q.delete("type");
    window.history.replaceState(null, "", `${window.location.pathname}${q.toString() ? `?${q.toString()}` : ""}`);
  };
  const exportHref = (() => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (batch) q.set("b", batch);
    if (type) q.set("type", type);
    return `/api/mis/export?${q.toString()}`;
  })();
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${active ? "border-brand bg-brand text-white" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <H2>Breakdown &amp; deviation log · {shown.length}</H2>
        {(() => {
          // Compare against the RIGHT denominator: the whole range unfiltered, or that
          // type's true count when a chip is active. Both come from figures aggregated
          // over every row, never from the capped list. Suppressed while "Reclassified
          // only" is on — that view is narrowed on purpose, and "showing the oldest 3
          // of 190" would read as a payload cap when it is the manager's own filter.
          if (onlyCorrected) return null;
          const realTotal = type ? (typeTotals[type] ?? shown.length) : incidentsTotal;
          if (realTotal <= shown.length) return null;
          return (
            <span className="text-xs text-amber-700">
              showing the oldest {shown.length} of {realTotal} — the totals above cover all
              {" "}{realTotal}; download for the full list
            </span>
          );
        })()}
        {correctedCount > 0 && (
          <button
            type="button"
            onClick={() => setOnlyCorrected((v) => !v)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${onlyCorrected ? "border-violet-400 bg-violet-100 text-violet-800" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
          >
            ⇄ Reclassified only · {correctedCount}
          </button>
        )}
        {shown.length > 0 && (
          <a href={exportHref} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">↓ Download (Excel)</a>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-500">
        The four delay buckets as production entered them, hour by hour, with the incident&apos;s reasons, RCA
        and the maintenance response beside them. A stoppage booked under the wrong type — cleaning time
        charged to maintenance, or the reverse — is corrected via ⇄ Reclassify in the Maintenance response
        column: the minutes MOVE to the right bucket and the hour&apos;s total stays exactly as it was.
      </p>
      {respFailed && (
        <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ Saved maintenance responses could not be loaded just now — the column below is <b>unknown</b>, not empty. Reload the page; responding is disabled meanwhile so an earlier response can&apos;t be overwritten unseen.
        </p>
      )}
      {reclassFailed && (
        <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ Applied delay-type corrections could not be loaded just now — a reclassified hour below will look untouched, because the MIS row already carries the corrected figures. Reload the page; reclassifying is disabled meanwhile so a second move can&apos;t be stacked on one nobody can see.
        </p>
      )}
      {/* The legend, shown only when there is something to explain. A colour with no
          explanation raises the question it exists to answer — and the mark is a glyph
          and a word as well as a colour, so it survives a printout and a colour-blind
          reader. */}
      {!reclassFailed && shown.some((i) => (reclass[i.id]?.length ?? 0) > 0) && (
        <p className={`mb-3 rounded-lg border px-3 py-2 text-xs ${RECLASS_TONE.panel} ${RECLASS_TONE.text}`}>
          <span className="font-medium">⇄ Reclassified</span> — a figure in violet was moved by maintenance, not entered by production. The hour&apos;s total is unchanged; hover the figure for what it was before, and the badge for who moved it, when and why. A <span className="font-medium text-amber-800">⚠ amber</span> note is a different thing: an open disagreement about a duration, with nothing changed.
        </p>
      )}
      {/* Sub-filter: narrow the log to one delay type (in place — no navigation, no scroll) */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium uppercase tracking-wider text-gray-400">Type</span>
        <button type="button" onClick={() => pick(null)} className={chip(!type)}>All</button>
        {DELAY_FIELDS.map((d) => (
          <button key={d.key} type="button" onClick={() => pick(d.key)} className={chip(type === d.key)}>{d.label}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-400">{onlyCorrected ? "No hours in this view have been reclassified." : "No incidents logged in this range."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500">
              <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Hour</th><th className="py-2 pr-3">Batch</th>
              {/* The four buckets as columns — the ledger view the deleted hourly-log
                  card existed for. A chip narrows the ROWS to hours holding that
                  bucket; the columns always show all four, so the manager can still
                  see where the rest of a filtered hour's minutes sit. */}
              {DELAY_FIELDS.map((d) => <th key={d.key} className="py-2 pr-3 text-right">{d.label}</th>)}
              <th className="py-2 pr-3 text-right">Down</th><th className="py-2 pr-3">Reason(s)</th><th className="py-2 pr-3">Details / RCA / action</th><th className="py-2 pr-3">Electrical incharge</th><th className="py-2 pr-3">Mechanical incharge</th><th className="py-2">Maintenance response</th>
            </tr></thead>
            <tbody>
              {shown.map((i) => {
                // One mark per row, built by the shared pure helper — the same one the
                // Maintenance response cell's badge describes the correction with.
                const recs = reclass[i.id] ?? [];
                const mark = describeReclass(recs);
                return (
                <tr key={i.id} className="border-t border-gray-100 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{i.date ?? "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{i.hour ?? "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.batch ? <Link href={`/batch?b=${encodeURIComponent(i.batch)}`} className="text-brand hover:underline">{i.batch}</Link> : "—"}</td>
                  {/* The bucket figures are where a correction is visible: the moved
                      figure carries the violet mark and the hover reconstructs what it
                      was; untouched figures stay grey. A zero-delay incident (breakdown
                      flag / RCA / note with no minutes) reads em-dash across all four —
                      the row is here for its story, not its arithmetic. */}
                  {DELAY_FIELDS.map((d) => {
                    const m = i.minutesByType[d.key] ?? 0;
                    const cls = reclassFigureClass(mark, d.key);
                    return (
                      <td key={d.key} className={`py-2 pr-3 whitespace-nowrap text-right ${cls || "text-gray-600"}`}
                          title={reclassFigureTitle(mark, d.key, i.minutesByType, recs)}>
                        {m > 0 ? fmtDur(m) : "—"}
                        {/* Never colour alone: the arrow says "moved" in a printout and
                            to a reader who cannot tell violet from grey. */}
                        {cls ? " ⇄" : ""}
                      </td>
                    );
                  })}
                  {/* The hour's TOTAL, which a reclassification never changes — so it is
                      never coloured violet, and the row-level ⇄ dot beside it says
                      "something in this hour moved" without claiming the total did. */}
                  <td className={`py-2 pr-3 whitespace-nowrap text-right font-medium ${i.over ? "text-red-600" : "text-gray-900"}`} title={i.over ? `This hour logs ${fmtDur(i.minutes)} across all types — more than 60 min in one hour, an entry error` : undefined}>
                    {i.minutes > 0 ? fmtDur(i.minutes) : "—"}{i.over ? " ⚠" : ""}{mark.count > 0 && <span className={RECLASS_TONE.dot} title={mark.tooltip}> ⇄</span>}
                  </td>
                  <td className="py-2 pr-3 text-gray-600">{(type ? i.reasonsByType[type] ?? [] : i.reasons).join(", ") || "—"}</td>
                  <td className="py-2 pr-3 text-gray-600">{[i.details, i.rca ? `RCA ${i.rca}` : null, i.action, i.spares ? `spares: ${i.spares}` : null].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.elecIncharge || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.mechIncharge || "—"}</td>
                  <td className="py-2 align-top"><DowntimeRespond misId={i.id} canRespond={canRespond}
                    status={responses[i.id]?.status ?? null} note={responses[i.id]?.note ?? null}
                    by={responses[i.id]?.by ?? null} at={responses[i.id]?.at ?? null}
                    minutesByType={i.minutesByType} photos={photos[i.id] ?? []}
                    reclass={recs} canReclass={canReclass} /></td>
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
