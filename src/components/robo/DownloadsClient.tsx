"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui";
import { fmtDurationLong, formatDate, todayStr } from "@/lib/robo/utils";
import { reportQuery, type ReportMode } from "@/lib/robo/reportQuery";
import { robotDelayPie } from "@/lib/robo/referenceSheet";
import { RoboReportFilters, useRoboBatchOptions } from "@/components/robo/RoboReportFilters";

// The Robot Delay pie pulls in Recharts, so it loads only when a Reference Sheet
// result actually has robot delays — the same next/dynamic pattern the Reports
// charts use to keep the charting library out of this page's first load.
const RobotDelayPie = dynamic(
  () => import("@/components/robo/RobotDelayPie").then((m) => m.RobotDelayPie),
  { ssr: false, loading: () => <div className="h-[210px] animate-pulse rounded-lg bg-slate-50" /> },
);

interface Preview {
  totalSlabs: number;
  totalDelayMins: number;
  delayEvents: number;
}

/** The Reference Sheet — the latest run's summary the API returns. Shown on the
 *  page now rather than written to a file; see the section comment below. */
interface RefPreview {
  found: boolean;
  designName: string;
  batchNo: string | null;
  productionDate: string;
  thickness: number | null;
  totalSlabs: number;
  productionTimeMinutes: number | null;
  totalDelayMins: number;
  avgSlabsPerHour: number | null;
  programs: { robo: string; program: string }[];
  robotDelays: { code: string; description: string; robos: string[]; minutes: number; events: number }[];
}

/** QC Rejection Analysis — what QC rejected in a batch DUE TO THE ROBO LINE
 *  (Spillage and Pattern Problem in QC Line only; see lib/robo/qcRejection.ts). */
interface QcPreview {
  found: boolean;
  batchNo: string;
  produced: number;
  inspected: number;
  roboRejected: number;
  rejectionRatePct: number | null;
  reasons: { reason: string; slabs: number; pct: number }[];
}

function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
}

/** One label/value pair in a summary grid. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 font-semibold text-gray-800">{value}</p>
    </div>
  );
}

/** A section heading, so the three subsections read as three things. */
function SectionHead({ icon, title, blurb }: { icon: string; title: string; blurb: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </div>
      <p className="mt-0.5 text-sm text-gray-500">{blurb}</p>
    </div>
  );
}

const searchInput =
  "flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";
const searchBtn =
  "rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold tracking-wide text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50";
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
const td = "px-3 py-2 text-sm text-gray-700";

export function DownloadsClient() {
  const [mode, setMode] = useState<ReportMode>("ALL");
  const [date, setDate] = useState<string>(todayStr());
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [batch, setBatch] = useState<string>("");
  const batchOptions = useRoboBatchOptions(setBatch);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Reference Sheet: a design-name lookup independent of the filters above ──
  const [refDesign, setRefDesign] = useState("");
  const [refLoading, setRefLoading] = useState(false);
  const [refResult, setRefResult] = useState<RefPreview | null>(null);
  const [refSearched, setRefSearched] = useState(false);

  const searchRef = useCallback(async () => {
    const q = refDesign.trim();
    if (!q) return;
    setRefLoading(true);
    setRefSearched(true);
    try {
      const res = await fetch(`/api/robo/reference/summary?design=${encodeURIComponent(q)}`);
      const data: RefPreview | null = res.ok ? await res.json() : null;
      setRefResult(data && data.found ? data : null);
    } catch {
      setRefResult(null);
    } finally {
      setRefLoading(false);
    }
  }, [refDesign]);

  // ── QC Rejection Analysis: a batch-number lookup into the QC module ─────────
  const [qcBatch, setQcBatch] = useState("");
  const [qcLoading, setQcLoading] = useState(false);
  const [qcResult, setQcResult] = useState<QcPreview | null>(null);
  const [qcSearched, setQcSearched] = useState(false);

  const searchQc = useCallback(async () => {
    const q = qcBatch.trim();
    if (!q) return;
    setQcLoading(true);
    setQcSearched(true);
    try {
      const res = await fetch(`/api/robo/qc-rejections?batch=${encodeURIComponent(q)}`);
      const data: QcPreview | null = res.ok ? await res.json() : null;
      setQcResult(data && data.found ? data : null);
    } catch {
      setQcResult(null);
    } finally {
      setQcLoading(false);
    }
  }, [qcBatch]);

  const loadPreview = useCallback(async (qs: string) => {
    setLoading(true);
    const res = await fetch(`/api/robo/reports/summary${qs}`);
    const data: Preview | null = res.ok ? await res.json() : null;
    setPreview(data);
    setLoading(false);
  }, []);

  const query = reportQuery({ mode, date, from, to, batch });
  useEffect(() => {
    const t = setTimeout(() => loadPreview(query), 250);
    return () => clearTimeout(t);
  }, [query, loadPreview]);

  const dateScope =
    mode === "ALL" ? "All production records to date"
    : mode === "DATE" ? `Records for ${formatDate(date)}`
    : `Records from ${from ? formatDate(from) : "the start"} to ${to ? formatDate(to) : "now"}`;
  const scopeLabel = batch.trim() ? `${dateScope} · Batch ${batch.trim()}` : dateScope;

  const hasProduction = (preview?.totalSlabs ?? 0) > 0;
  const hasDelays = (preview?.delayEvents ?? 0) > 0;

  return (
    <div className="max-w-3xl space-y-10">
      {/* ═══ 1. DOWNLOAD SLAB RECORDS ═══════════════════════════════════════ */}
      {/* Renamed only. The filters, the two exports and the query they share are
          untouched — the brief was explicit that this section keeps working
          exactly as it does. */}
      <section>
        <SectionHead
          icon="📥"
          title="Download Slab Records"
          blurb="Export robo production and delay records to Excel for the selected filter."
        />

        <div className="space-y-5">
          <Card>
            <h3 className="mb-4 font-semibold text-gray-800">Filters</h3>
            <RoboReportFilters
              mode={mode} setMode={setMode}
              date={date} setDate={setDate}
              from={from} setFrom={setFrom}
              to={to} setTo={setTo}
              batch={batch} setBatch={setBatch}
              batchOptions={batchOptions}
            />
            <p className="mt-2 text-xs text-gray-500">{scopeLabel}</p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label: "Production Records", value: loading ? "…" : String(preview?.totalSlabs ?? 0) },
                { label: "Delay Records", value: loading ? "…" : String(preview?.delayEvents ?? 0) },
                { label: "Total Delay Duration", value: loading ? "…" : fmtDurationLong(preview?.totalDelayMins ?? 0) },
              ].map(s => (
                <div key={s.label} className="rounded-lg border border-gray-100 bg-slate-50 px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">{s.label}</p>
                  <p className="mt-0.5 text-sm font-semibold text-gray-800">{s.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Card className="flex flex-col">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xl">📄</span>
                <h3 className="font-semibold text-gray-800">Complete Production</h3>
              </div>
              <button
                onClick={() => download(`/api/robo/exports/production${query}`)}
                disabled={loading || !hasProduction}
                className="mt-4 w-full rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold tracking-wide text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50">
                📥 DOWNLOAD EXCEL
              </button>
              {!loading && !hasProduction && (
                <p className="mt-2 text-center text-xs text-gray-400">No production records for this filter</p>
              )}
            </Card>

            <Card className="flex flex-col">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xl">⏱</span>
                <h3 className="font-semibold text-gray-800">Delay List</h3>
              </div>
              <button
                onClick={() => download(`/api/robo/exports/delays${query}`)}
                disabled={loading || !hasDelays}
                className="mt-4 w-full rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold tracking-wide text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50">
                📥 DOWNLOAD EXCEL
              </button>
              {!loading && !hasDelays && (
                <p className="mt-2 text-center text-xs text-gray-400">No delay records for this filter</p>
              )}
            </Card>
          </div>
        </div>
      </section>

      <hr className="border-gray-200" />

      {/* ═══ 2. REFERENCE SHEET ═════════════════════════════════════════════ */}
      {/* ON THE PAGE, NOT IN A FILE. This used to show four figures and put the
          rest — programs and robot delays — in an Excel download, so the two
          things an operator setting up a repeat run actually needs were the two
          they had to open a spreadsheet to read. Everything is here now and the
          download is gone. */}
      <section>
        <SectionHead
          icon="📋"
          title="Reference Sheet"
          blurb="Search a design to see its latest production run — setup, output and the robot delays that occurred."
        />

        <Card className="flex flex-col">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={refDesign}
              onChange={(e) => { setRefDesign(e.target.value); setRefSearched(false); setRefResult(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") searchRef(); }}
              placeholder="Design Name (e.g. Costa)"
              className={searchInput}
            />
            <button onClick={searchRef} disabled={!refDesign.trim() || refLoading} className={searchBtn}>
              {refLoading ? "Searching…" : "🔍 Search"}
            </button>
          </div>

          {refSearched && !refLoading && !refResult && (
            <p className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              No previous production record found
            </p>
          )}

          {refResult && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-gray-100 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Latest production run</p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                  <Field label="Design" value={refResult.designName} />
                  <Field label="Batch No." value={refResult.batchNo ?? "-"} />
                  <Field label="Production Date" value={refResult.productionDate ? formatDate(refResult.productionDate) : "-"} />
                  <Field label="Thickness" value={refResult.thickness != null ? `${refResult.thickness} cm` : "-"} />
                  {/* These four are Reports' own figures for this batch
                      (lib/robo/reportSummary.ts), shown in Reports' own labels
                      and format, so the two screens read identically. */}
                  <Field label="Total Slabs Produced" value={String(refResult.totalSlabs)} />
                  <Field label="Total Production Time" value={refResult.productionTimeMinutes != null ? fmtDurationLong(refResult.productionTimeMinutes) : "—"} />
                  <Field label="Total Delays" value={fmtDurationLong(refResult.totalDelayMins)} />
                  <Field label="Avg Slabs/hour" value={refResult.avgSlabsPerHour != null ? String(refResult.avgSlabsPerHour) : "—"} />
                </div>
              </div>

              {/* Programs — what the Robos were set to for this run. */}
              <div>
                <p className="mb-1 text-xs font-medium text-gray-500">Programs used</p>
                {refResult.programs.length === 0 ? (
                  <p className="text-sm text-gray-500">No program recorded for this run.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="w-full">
                      <thead className="bg-slate-50"><tr><th className={th}>Robo</th><th className={th}>Program</th></tr></thead>
                      <tbody className="divide-y divide-gray-100">
                        {refResult.programs.map((p, i) => (
                          <tr key={`${p.robo}-${p.program}-${i}`}>
                            <td className={`${td} font-medium text-gray-800`}>{p.robo}</td>
                            <td className={td}>{p.program}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Robot delays — every Section G code that occurred in the batch,
                  longest total duration first, then their share as a pie. */}
              <div>
                <p className="mb-1 text-xs font-medium text-gray-500">
                  Robot delays in this batch — longest first{" "}
                  <span className="text-gray-400">(Delay Codes → Section G)</span>
                </p>
                {refResult.robotDelays.length === 0 ? (
                  <p className="text-sm text-gray-500">No robot delays were recorded for this batch.</p>
                ) : (
                  <>
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className={th}>Code</th><th className={th}>Delay</th><th className={th}>Robo</th>
                          <th className={`${th} text-right`}>Times</th><th className={`${th} text-right`}>Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {refResult.robotDelays.map((d) => (
                          <tr key={d.code}>
                            <td className={`${td} font-semibold text-gray-800`}>{d.code}</td>
                            <td className={td}>{d.description}</td>
                            <td className={`${td} text-gray-500`}>{d.robos.length ? d.robos.join(", ") : "-"}</td>
                            <td className={`${td} text-right`}>{d.events}</td>
                            <td className={`${td} text-right`}>{fmtDurationLong(d.minutes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Their share of the batch's robot delay time: 1–3 slices, or the
                      top 3 by duration when there are more — the table above
                      still lists every one. */}
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-gray-500">Robot delay share</p>
                    <RobotDelayPie pie={robotDelayPie(refResult.robotDelays)} />
                  </div>
                  </>
                )}
              </div>
            </div>
          )}
        </Card>
      </section>

      <hr className="border-gray-200" />

      {/* ═══ 3. QC REJECTION ANALYSIS ═══════════════════════════════════════ */}
      {/* Read-only, from the QC module. ROBO-LINE FAULTS ONLY: Spillage and
          Pattern Problem in QC Line are the only QC faults counted or shown
          here (owner's decision 2026-09-25) — every other fault is left out so
          nothing reads as caused by the Robo line when it was not. See
          lib/robo/qcRejection.ts for the matching rules. */}
      <section>
        <SectionHead
          icon="🔍"
          title="QC Rejection Analysis"
          blurb="Search a batch number to see how many slabs QC rejected due to the Robo line — Spillage and Pattern Problem in QC Line only."
        />

        <Card className="flex flex-col">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={qcBatch}
              onChange={(e) => { setQcBatch(e.target.value); setQcSearched(false); setQcResult(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") searchQc(); }}
              placeholder="Batch Number (e.g. D-1449 or 1449)"
              className={searchInput}
            />
            <button onClick={searchQc} disabled={!qcBatch.trim() || qcLoading} className={searchBtn}>
              {qcLoading ? "Searching…" : "🔍 Search"}
            </button>
          </div>

          {qcSearched && !qcLoading && !qcResult && (
            <p className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              No production or QC record found for that batch number
            </p>
          )}

          {qcResult && (
            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Batch {qcResult.batchNo}</p>
                {/* Four small KPI cards — the same tile the filter preview above
                    uses. Label at the top, figure at the bottom of each card, so
                    the figures line up even when the long third label wraps. */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Total Slabs Produced", value: String(qcResult.produced) },
                    { label: "QC Inspected", value: String(qcResult.inspected) },
                    { label: "Total Rejected Slabs due to robots/robo line", value: String(qcResult.roboRejected) },
                    {
                      label: "Rejection Rate",
                      value: qcResult.rejectionRatePct != null ? `${qcResult.rejectionRatePct}%` : "-",
                    },
                  ].map((k) => (
                    <div
                      key={k.label}
                      className="flex flex-col justify-between rounded-lg border border-gray-100 bg-slate-50 px-3 py-2"
                    >
                      <p className="text-xs uppercase tracking-wide text-gray-500">{k.label}</p>
                      <p className="mt-1 text-sm font-semibold text-gray-800">{k.value}</p>
                    </div>
                  ))}
                </div>
                {/* The rate is of every slab PRODUCED (the owner's formula). QC
                    lags the line, so while a batch is still being inspected the
                    rate can rise — said here rather than left to be read as final. */}
                {qcResult.inspected < qcResult.produced && (
                  <p className="mt-2 text-xs text-gray-500">
                    QC has inspected {qcResult.inspected} of the {qcResult.produced} slabs produced so far —{" "}
                    {qcResult.produced - qcResult.inspected} have not reached QC yet, so the rejection rate can still
                    rise.
                  </p>
                )}
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-gray-500">Robo-line rejection reasons</p>
                <div className="overflow-x-auto rounded-lg border border-gray-100">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className={th}>Robo-line Rejection Reason</th>
                        <th className={`${th} text-right`}>No. of Slabs</th>
                        <th className={`${th} text-right`}>Percentage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {qcResult.reasons.map((r) => (
                        <tr key={r.reason}>
                          <td className={`${td} text-gray-800`}>{r.reason}</td>
                          <td className={`${td} text-right`}>{r.slabs}</td>
                          <td className={`${td} text-right`}>{r.pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {qcResult.roboRejected === 0 ? (
                    "No slabs in this batch were rejected for Spillage or Pattern Problem in QC Line."
                  ) : (
                    <>
                      Percentage is of the {qcResult.roboRejected} slab{qcResult.roboRejected === 1 ? "" : "s"}{" "}
                      rejected due to the Robo line.
                      {/* One slab can carry both faults, so the rows can sum past
                          the total — said only when it actually happens. */}
                      {qcResult.reasons.reduce((n, r) => n + r.slabs, 0) > qcResult.roboRejected &&
                        ` A slab can carry both faults, so the counts add up to more than ${qcResult.roboRejected}.`}
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
