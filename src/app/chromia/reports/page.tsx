import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, Empty, Kpi } from "@/components/ui";
import { chromiaGate, CHROMIA_MIN_TIER } from "@/lib/chromia/access";
import { summary } from "@/lib/chromia/store";
import { DISPOSITION_LABEL, GRADE_LABEL, type Disposition, type SlabGrade } from "@/lib/chromia/process";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chromia summary | Pacific ERP" };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The monthly output picture the workbook used to be — grades, outcomes, print
 * results and recalibration flow for a window.
 *
 * The figures come from the CYCLE, not the slab: a slab graded C on cycle 1 and
 * A on cycle 2 counts once in each month it finished in, which is what a
 * production output report means. Counting slabs instead would make a
 * recalibrated slab disappear from the month it was first rejected in.
 */
export default async function ChromiaReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const gate = await chromiaGate(CHROMIA_MIN_TIER.management);
  if (!gate.ok) redirect("/");

  const sp = await searchParams;
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1);

  const from = sp.from ? new Date(`${sp.from}T00:00:00`) : defaultFrom;
  // Inclusive of the end date: someone typing today's date means "up to and
  // including today", not "up to midnight this morning".
  const to = sp.to ? new Date(`${sp.to}T23:59:59.999`) : today;

  const s = await summary(from, to);
  const nothing = s.cyclesCompleted === 0 && s.recalibrationsSent === 0;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Summary</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          What the line produced in a window, by grade and outcome.
        </p>
      </div>

      <Card className="mb-5">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
            <input
              type="date" name="from" defaultValue={sp.from ?? iso(defaultFrom)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
            <input
              type="date" name="to" defaultValue={sp.to ?? iso(today)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand/90"
          >
            Show
          </button>
        </form>
      </Card>

      {nothing ? (
        <Card><Empty>Nothing finished in that window.</Empty></Card>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Passes completed" value={s.cyclesCompleted} sub="stamped out" />
            <Kpi
              label="Avg processing"
              value={s.avgProcessingMinutes == null ? "—" : `${Math.round(s.avgProcessingMinutes)}m`}
              sub="in-time to out-time"
            />
            <Kpi label="Sent to recalibration" value={s.recalibrationsSent} />
            <Kpi label="Came back" value={s.recalibrationsReturned} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Breakdown
              title="By grade"
              rows={s.grades.map((g) => ({
                label: GRADE_LABEL[g.label as SlabGrade] ?? g.label,
                value: g.value,
              }))}
            />
            <Breakdown
              title="By outcome"
              rows={s.dispositions.map((d) => ({
                label: DISPOSITION_LABEL[d.label as Disposition] ?? d.label,
                value: d.value,
              }))}
            />
            <Breakdown
              title="Print result"
              rows={s.prints.map((p) => ({
                label: p.label.replace(/_/g, " ").toLowerCase(),
                value: p.value,
              }))}
            />
          </div>
        </>
      )}
    </Shell>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; value: number }[] }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <Card>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h2>
      {rows.length === 0 ? (
        <Empty>Nothing recorded.</Empty>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate capitalize text-gray-600">{r.label}</span>
              <span className="font-medium text-gray-900">{r.value}</span>
              <span className="w-12 text-right text-xs text-gray-400">
                {total ? `${Math.round((r.value / total) * 100)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
