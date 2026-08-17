import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Badge, Card, Empty } from "@/components/ui";
import { chromiaGate } from "@/lib/chromia/access";
import { slabDetail } from "@/lib/chromia/store";
import {
  DISPOSITION_LABEL, GRADE_LABEL, recalibrationAgeing, STAGE_LABEL, STATUS_LABEL,
  type Disposition, type ProcessStage, type SlabGrade, type SlabStatus,
} from "@/lib/chromia/process";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Slab history | Pacific ERP" };

const dt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const dOnly = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—";

/**
 * One slab's complete forward and backward history — the audit trail a
 * spreadsheet row can never provide (CHROMIA_PROCESS.md section 2.5).
 *
 * Cycles are shown in full and separately, because that is the thing Excel
 * destroyed: one row per slab meant a second recalibration overwrote the first,
 * and nobody could tell whether the slab in front of them was on its first
 * attempt or its fourth.
 */
export default async function ChromiaSlabDetail({
  params,
}: {
  params: Promise<{ slabNo: string }>;
}) {
  const gate = await chromiaGate();
  if (!gate.ok) redirect("/");

  const { slabNo } = await params;
  const slab = await slabDetail(decodeURIComponent(slabNo));
  if (!slab) notFound();

  const status = slab.status as SlabStatus;
  const now = new Date();

  return (
    <Shell>
      <div className="mb-6">
        <Link href="/chromia/slabs" className="text-sm text-gray-400 hover:text-brand">
          ← All slabs
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{slab.slabNo}</h1>
          <Badge tone={status === "OUT_FOR_RECALIBRATION" || status === "WASTE" ? "red" : "brand"}>
            {STATUS_LABEL[status]}
          </Badge>
          {slab.recalibrationCount > 0 && (
            <Badge tone="amber">
              {slab.recalibrationCount} recalibration{slab.recalibrationCount === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Batch {slab.batch.batchNo} · {slab.baseMaterial.name} · received {dOnly(slab.receivedDate)}
        </p>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Where it is</h2>
          <dl className="space-y-1.5 text-sm">
            <Row k="Stage" v={slab.currentStage ? STAGE_LABEL[slab.currentStage as ProcessStage] : "—"} />
            <Row k="Location" v={slab.currentLocation?.name ?? "—"} />
            <Row k="Cycle" v={`${slab.currentCycleNumber}`} />
            <Row k="Grade" v={slab.currentGrade ? GRADE_LABEL[slab.currentGrade as SlabGrade] : "—"} />
            <Row
              k="Outcome"
              v={slab.currentDisposition
                ? DISPOSITION_LABEL[slab.currentDisposition as Disposition]
                : "—"}
            />
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Physical</h2>
          <dl className="space-y-1.5 text-sm">
            <Row k="Original thickness" v={slab.originalThicknessMm ? `${slab.originalThicknessMm} mm` : "—"} />
            <Row k="Current thickness" v={slab.currentThicknessMm ? `${slab.currentThicknessMm} mm` : "—"} />
            <Row
              k="Size"
              v={slab.lengthMm && slab.widthMm ? `${slab.lengthMm} × ${slab.widthMm} mm` : "—"}
            />
            <Row k="Planned design" v={slab.plannedDesign?.name ?? "—"} />
            <Row k="On arrival" v={slab.conditionOnArrival ?? "—"} />
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Origin</h2>
          <dl className="space-y-1.5 text-sm">
            <Row k="Batch received" v={dOnly(slab.batch.receivedDate)} />
            {/* Kept visible rather than hidden: a figure that came from the old
                workbook should never look like one the line recorded itself. */}
            <Row k="Imported from" v={slab.legacySourceFile ?? "entered in the ERP"} />
            {slab.legacySheetName && <Row k="Sheet" v={`${slab.legacySheetName} row ${slab.legacySourceRow ?? "?"}`} />}
            {slab.legacyRemark && <Row k="Original remark" v={slab.legacyRemark} />}
            <Row k="Remarks" v={slab.remarks ?? "—"} />
          </dl>
        </Card>
      </div>

      <Card className="mb-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Passes through the line · {slab.cycles.length}
        </h2>
        {slab.cycles.length === 0 ? (
          <Empty>This slab has not started processing.</Empty>
        ) : (
          <div className="space-y-4">
            {slab.cycles.map((c) => (
              <div key={c.id} className="rounded-xl border border-gray-200 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <span className="font-medium text-gray-900">Cycle {c.cycleNumber}</span>
                  <Badge tone={c.status === "COMPLETED" ? "green" : c.status === "ABORTED" ? "red" : "brand"}>
                    {c.status.toLowerCase()}
                  </Badge>
                  {c.design && <span className="text-sm text-gray-500">{c.design.name}</span>}
                  {c.printResult && (
                    <span className="text-xs text-gray-500">
                      {c.printResult.replace(/_/g, " ").toLowerCase()}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
                  <Row k="In" v={dt(c.inTime)} />
                  <Row k="Out" v={dt(c.outTime)} />
                  <Row
                    k="Window"
                    v={c.processingMinutes == null ? "—" : `${c.processingMinutes} min`}
                  />
                  <Row k="Fully printed" v={dOnly(c.fullyPrintedDate)} />
                </div>
                {(c.qcRecord || c.gradeDecision) && (
                  <div className="mt-2 border-t border-gray-100 pt-2 text-sm">
                    {c.qcRecord && (
                      <p className="text-gray-600">
                        QC <span className="font-medium text-gray-900">{c.qcRecord.verdict}</span>
                        {" · "}{dt(c.qcRecord.inspectedAt)}
                        {c.qcRecord.remarks ? ` — ${c.qcRecord.remarks}` : ""}
                      </p>
                    )}
                    {c.gradeDecision && (
                      <p className="text-gray-600">
                        Grade <span className="font-medium text-gray-900">{c.gradeDecision.grade}</span>
                        {" → "}
                        {DISPOSITION_LABEL[c.gradeDecision.disposition as Disposition]}
                        {c.gradeDecision.reason ? ` — ${c.gradeDecision.reason}` : ""}
                      </p>
                    )}
                  </div>
                )}
                {c.stageRecords.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.stageRecords.map((sr) => (
                      <span
                        key={sr.id}
                        className={`rounded-full px-2.5 py-0.5 text-xs ${
                          sr.status === "COMPLETED"
                            ? "bg-green-100 text-green-700"
                            : sr.status === "IN_PROGRESS"
                              ? "bg-brand/10 text-brand"
                              : "bg-gray-100 text-gray-500"
                        }`}
                        title={`${dt(sr.startedAt)} → ${dt(sr.endedAt)}`}
                      >
                        {STAGE_LABEL[sr.stage as ProcessStage]}
                        {sr.durationMinutes != null ? ` ${sr.durationMinutes}m` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Recalibrations · {slab.recalibrations.length}
        </h2>
        {slab.recalibrations.length === 0 ? (
          <Empty>This slab has never been recalibrated.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">Attempt</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Sent</th>
                  <th className="py-2 pr-4 font-medium">Expected</th>
                  <th className="py-2 pr-4 font-medium">Back</th>
                  <th className="py-2 pr-4 font-medium">Days</th>
                  <th className="py-2 font-medium">Removed</th>
                </tr>
              </thead>
              <tbody>
                {slab.recalibrations.map((r) => {
                  const age = recalibrationAgeing(r, now);
                  return (
                    <tr key={r.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-4 font-medium text-gray-900">#{r.attemptNumber}</td>
                      <td className="py-2 pr-4 text-gray-600">
                        {r.reason?.name ?? r.reasonNotes ?? "—"}
                      </td>
                      <td className="py-2 pr-4 text-gray-600">{dOnly(r.sentDate)}</td>
                      <td className="py-2 pr-4 text-gray-600">{dOnly(r.expectedReturnDate)}</td>
                      <td className="py-2 pr-4 text-gray-600">{dOnly(r.receivedDate)}</td>
                      <td className="py-2 pr-4">
                        {age.daysOut == null ? "—" : age.daysOut}
                        {age.overdue && <Badge tone="red">overdue</Badge>}
                      </td>
                      <td className="py-2 text-gray-600">
                        {r.materialRemovedMm == null ? "—" : `${r.materialRemovedMm} mm`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Event log · newest first
        </h2>
        {slab.events.length === 0 ? (
          <Empty>No events recorded.</Empty>
        ) : (
          <ol className="space-y-2">
            {slab.events.map((e) => (
              <li key={e.id} className="flex gap-3 text-sm">
                <span className="w-40 shrink-0 text-gray-400">{dt(e.occurredAt)}</span>
                <span className="w-44 shrink-0 font-medium text-gray-700">
                  {e.eventType.replace(/_/g, " ").toLowerCase()}
                </span>
                <span className="min-w-0 flex-1 text-gray-600">
                  {e.note ?? (e.stage ? STAGE_LABEL[e.stage as ProcessStage] : "")}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </Shell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 text-gray-500">{k}</dt>
      <dd className="min-w-0 flex-1 text-gray-900">{v}</dd>
    </div>
  );
}
