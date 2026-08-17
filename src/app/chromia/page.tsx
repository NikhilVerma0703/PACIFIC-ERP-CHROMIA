import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Badge, Card, Empty, Kpi } from "@/components/ui";
import { chromiaGate } from "@/lib/chromia/access";
import { dashboardCounts, listRecalibrations } from "@/lib/chromia/store";
import { STAGE_LABEL, STATUS_LABEL } from "@/lib/chromia/process";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chromia | Pacific ERP" };

/**
 * The question this screen exists to answer, from CHROMIA_PROCESS.md section
 * 3.6: "how many slabs are out for recalibration right now and how long have
 * they been out?" — which the monthly workbook could only reconstruct after
 * the fact, approximately.
 *
 * The gate below is the page's own check. Middleware stops the request at the
 * path prefix, this stops a direct render, and each is useless on its own the
 * day the other is edited.
 */
export default async function ChromiaDashboard() {
  const gate = await chromiaGate();
  if (!gate.ok) redirect("/");

  const [counts, outstanding] = await Promise.all([
    dashboardCounts(),
    listRecalibrations({ limit: 10 }),
  ]);

  const overdue = outstanding.filter((r) => r.ageing.overdue);
  const empty = counts.totalSlabs === 0;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Chromia</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Where every slab on the line is, right now — and which ones are overdue back from
          recalibration.
        </p>
      </div>

      {empty && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">No slabs yet.</span> Bring the production register across
          from Excel on the <Link href="/chromia/import" className="underline">Import</Link> screen,
          or start recording slabs as they arrive.
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="On the line" value={counts.onLine} sub="in processing" />
        <Kpi label="Awaiting QC" value={counts.awaitingQc} sub="stamped out, ungraded" />
        <Kpi
          label="Out for recalibration"
          value={counts.outForRecalibration}
          sub={counts.overdueRecalibrations > 0
            ? `${counts.overdueRecalibrations} overdue`
            : "none overdue"}
          className={counts.overdueRecalibrations > 0 ? "ring-1 ring-red-200" : ""}
        />
        <Kpi label="Received today" value={counts.receivedToday} sub={`${counts.completedToday} finished`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Work in progress, by stage
          </h2>
          {/* Every stage is listed, including the empty ones — a board with gaps
              where nothing is sitting reads as a broken query, not an idle stage. */}
          <div className="space-y-1.5">
            {counts.byStage.map(({ stage, count }) => (
              <div key={stage} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-sm text-gray-600">{STAGE_LABEL[stage]}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{
                      width: `${counts.onLine > 0 ? Math.round((count / Math.max(...counts.byStage.map((s) => s.count), 1)) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm font-medium text-gray-900">
                  {count || "—"}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Out for recalibration
            </h2>
            <Link href="/chromia/recalibration-tracking" className="text-xs text-brand hover:underline">
              Tracking →
            </Link>
          </div>
          {outstanding.length === 0 ? (
            <Empty>Nothing is out. Every slab is accounted for on site.</Empty>
          ) : (
            <div className="space-y-2">
              {outstanding.slice(0, 8).map((r) => (
                <div key={r.id} className="flex items-center gap-3 text-sm">
                  <Link
                    href={`/chromia/slabs/${encodeURIComponent(r.slabNo)}`}
                    className="w-28 shrink-0 truncate font-medium text-gray-900 hover:text-brand hover:underline"
                  >
                    {r.slabNo}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-gray-500">
                    {r.facilityName || "facility not recorded"}
                  </span>
                  <span className="shrink-0 text-gray-600">
                    {r.ageing.daysOut == null ? "not sent" : `${r.ageing.daysOut}d`}
                  </span>
                  {r.ageing.overdue && (
                    <Badge tone="red">
                      {r.ageing.daysLate > 0 ? `${r.ageing.daysLate}d late` : "overdue"}
                    </Badge>
                  )}
                </div>
              ))}
              {overdue.length > 0 && (
                <p className="pt-1 text-xs text-red-600">
                  {overdue.length} slab{overdue.length === 1 ? "" : "s"} overdue — worth a call to
                  the facility.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Every slab, by state
        </h2>
        {Object.keys(counts.byStatus).length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(counts.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([status, n]) => (
                <Link
                  key={status}
                  href={`/chromia/slabs?status=${encodeURIComponent(status)}`}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 transition hover:border-brand hover:bg-brand/5"
                >
                  {STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}
                  <span className="ml-2 font-semibold text-gray-900">{n}</span>
                </Link>
              ))}
          </div>
        )}
      </Card>
    </Shell>
  );
}
