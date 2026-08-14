"use client";
// Breakdown & deviation log with a CLIENT-SIDE type filter. The chips used to be
// <Link scroll={false}> — but a searchParams navigation re-keys the page segment, the
// root loading skeleton swaps in, the page collapses and the browser throws the scroll
// to the top (scroll={false} can't prevent a layout collapse). Every row already
// carries minutesByType/reasonsByType, so filtering is pure state: no navigation, no
// skeleton, no scroll. The URL still gets ?type= via history.replaceState so the view
// stays shareable and the Excel export carries the active filter; a ?type= deep link
// arrives as initialType and renders filtered on first paint.
import { useState } from "react";
import Link from "next/link";
import { Card, H2 } from "@/components/ui";
import { DELAY_FIELDS, fmtDur } from "@/lib/downtimeShared";
import type { IncidentRow } from "@/lib/downtime";
import type { DowntimeResp } from "@/lib/downtimeResponse";
import { DowntimeRespond } from "@/components/DowntimeRespond";
import { ReclassBadge, reclassFigureClass, reclassFigureTitle } from "@/components/ReclassifyDelay";
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
   *  untouched, so the "Down" column is unaffected and only the Type breakdown moved. */
  reclass: Record<string, ReclassRecord[]>;
  /** The corrections lookup itself failed. The figures are still production's plus
   *  whatever was moved — we just cannot say which — so the marks are unreliable for
   *  this load and correcting is withheld until a reload proves otherwise. */
  reclassFailed: boolean;
  canReclass: boolean;
}) {
  const [type, setType] = useState<string | null>(initialType);
  const shown = type ? incidents.filter((i) => i.typeKeys.includes(type)) : incidents;

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
          // over every row, never from the capped list.
          const realTotal = type ? (typeTotals[type] ?? shown.length) : incidentsTotal;
          if (realTotal <= shown.length) return null;
          return (
            <span className="text-xs text-amber-700">
              showing the oldest {shown.length} of {realTotal} — the totals above cover all
              {" "}{realTotal}; download for the full list
            </span>
          );
        })()}
        {shown.length > 0 && (
          <a href={exportHref} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">↓ Download (Excel)</a>
        )}
      </div>
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
          <span className="font-medium">⇄ Reclassified</span> — maintenance moved these minutes to a different delay type. The hour&apos;s total is unchanged; hover the mark for what moved, who moved it, when and why. A <span className="font-medium text-amber-800">⚠ amber</span> note is a different thing: an open disagreement about a duration, with nothing changed.
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
      {shown.length === 0 ? <p className="text-sm text-gray-400">No incidents logged in this range.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500">
              <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Hour</th><th className="py-2 pr-3">Batch</th>
              <th className="py-2 pr-3">Down</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Reason(s)</th><th className="py-2 pr-3">Details / RCA / action</th><th className="py-2 pr-3">Electrical incharge</th><th className="py-2 pr-3">Mechanical incharge</th><th className="py-2">Maintenance response</th>
            </tr></thead>
            <tbody>
              {shown.map((i) => {
                // One mark per row, built by the shared pure helper so this screen and
                // the MIS hourly log cannot describe the same correction differently.
                const recs = reclass[i.id] ?? [];
                const mark = describeReclass(recs);
                return (
                <tr key={i.id} className="border-t border-gray-100 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{i.date ?? "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{i.hour ?? "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.batch ? <Link href={`/batch?b=${encodeURIComponent(i.batch)}`} className="text-brand hover:underline">{i.batch}</Link> : "—"}</td>
                  <td className={`py-2 pr-3 whitespace-nowrap font-medium ${i.over ? "text-red-600" : "text-gray-900"}`} title={i.over ? `This hour logs ${fmtDur(i.minutes)} across all types — more than 60 min in one hour, an entry error` : undefined}>{(() => {
                    const m = type ? i.minutesByType[type] ?? 0 : i.minutes;
                    const txt = m > 0 ? fmtDur(m) : "—";
                    // Under a type filter this cell IS one bucket's figure, so it is a
                    // number a reclassification can have moved and it takes the mark.
                    // Unfiltered it is the hour's TOTAL, which a move never changes —
                    // colouring it there would claim a change that did not happen.
                    const cls = type ? reclassFigureClass(mark, type) : "";
                    return cls ? <span className={cls} title={reclassFigureTitle(mark, type!, i.minutesByType, recs)}>{txt}</span> : txt;
                  })()}{i.over ? " ⚠" : ""}{mark.count > 0 && <span className={RECLASS_TONE.dot} title={mark.tooltip}> ⇄</span>}</td>
                  {/* The Type cell is where the four buckets live, so it is where a
                      correction is visible: the moved figures carry the violet mark,
                      the untouched ones stay grey, and the badge names the act. */}
                  <td className="py-2 pr-3 text-gray-600">{(() => {
                    const held = DELAY_FIELDS.filter((d) => i.minutesByType[d.key]);
                    if (type) {
                      const d = DELAY_FIELDS.find((x) => x.key === type);
                      if (!d) return "—";
                      return <span className={reclassFigureClass(mark, d.key)} title={reclassFigureTitle(mark, d.key, i.minutesByType, recs)}>{d.label}</span>;
                    }
                    if (held.length > 1) {
                      return held.map((d, idx) => (
                        <span key={d.key}>
                          {idx > 0 ? " · " : ""}
                          <span className={reclassFigureClass(mark, d.key)} title={reclassFigureTitle(mark, d.key, i.minutesByType, recs)}>{d.label} {fmtDur(i.minutesByType[d.key])}</span>
                        </span>
                      ));
                    }
                    const only = held[0]?.key;
                    const text = i.types.join(", ") || "—";
                    return only
                      ? <span className={reclassFigureClass(mark, only)} title={reclassFigureTitle(mark, only, i.minutesByType, recs)}>{text}</span>
                      : text;
                  })()}{mark.count > 0 && <> <ReclassBadge mark={mark} /></>}</td>
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
