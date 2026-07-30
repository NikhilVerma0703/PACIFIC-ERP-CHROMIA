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

export function DowntimeLogCard({ incidents, incidentsTotal, typeTotals, initialType, from, to, batch, canRespond, respFailed, responses, photos }: {
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
              {shown.map((i) => (
                <tr key={i.id} className="border-t border-gray-100 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{i.date ?? "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{i.hour ?? "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.batch ? <Link href={`/batch?b=${encodeURIComponent(i.batch)}`} className="text-brand hover:underline">{i.batch}</Link> : "—"}</td>
                  <td className={`py-2 pr-3 whitespace-nowrap font-medium ${i.over ? "text-red-600" : "text-gray-900"}`} title={i.over ? `This hour logs ${fmtDur(i.minutes)} across all types — more than 60 min in one hour, an entry error` : undefined}>{(() => { const m = type ? i.minutesByType[type] ?? 0 : i.minutes; return m > 0 ? fmtDur(m) : "—"; })()}{i.over ? " ⚠" : ""}{(() => {
                    // Amber dot: maintenance disputes one of this row's durations and the
                    // figures still differ. Independent of the active type filter — the
                    // disagreement belongs to the row. Green handled in the response cell.
                    const r = responses[i.id];
                    if (!r || r.dispMinutes == null) return null;
                    const cur = i.minutesByType[r.dispType ?? ""] ?? 0;
                    if (Math.round(cur) === Math.round(r.dispMinutes)) return null;
                    return <span className="text-amber-600" title={`Maintenance says ${fmtDur(r.dispMinutes)} — see the response column`}> ●</span>;
                  })()}</td>
                  <td className="py-2 pr-3 text-gray-600">{type
                    ? (DELAY_FIELDS.find((d) => d.key === type)?.label ?? "—")
                    : Object.keys(i.minutesByType).length > 1
                      ? DELAY_FIELDS.filter((d) => i.minutesByType[d.key]).map((d) => `${d.label} ${fmtDur(i.minutesByType[d.key])}`).join(" · ")
                      : i.types.join(", ") || "—"}</td>
                  <td className="py-2 pr-3 text-gray-600">{(type ? i.reasonsByType[type] ?? [] : i.reasons).join(", ") || "—"}</td>
                  <td className="py-2 pr-3 text-gray-600">{[i.details, i.rca ? `RCA ${i.rca}` : null, i.action, i.spares ? `spares: ${i.spares}` : null].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.elecIncharge || "—"}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.mechIncharge || "—"}</td>
                  <td className="py-2 align-top"><DowntimeRespond misId={i.id} canRespond={canRespond}
                    status={responses[i.id]?.status ?? null} note={responses[i.id]?.note ?? null}
                    by={responses[i.id]?.by ?? null} at={responses[i.id]?.at ?? null}
                    dispType={responses[i.id]?.dispType ?? null} dispMinutes={responses[i.id]?.dispMinutes ?? null}
                    dispBy={responses[i.id]?.dispBy ?? null} dispAt={responses[i.id]?.dispAt ?? null}
                    minutesByType={i.minutesByType} photos={photos[i.id] ?? []} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
