import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { chromiaGate, CHROMIA_MIN_TIER } from "@/lib/chromia/access";
import { STAGE_LABEL, STAGE_ORDER, STATUS_LABEL } from "@/lib/chromia/process";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chromia downloads | Pacific ERP" };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Getting the data back out.
 *
 * Plain GET links rather than a generate-then-download dance: a download that
 * is a URL can be bookmarked, scheduled, or pasted to whoever asked for it, and
 * there is no server-side file to clean up afterwards.
 */
export default async function ChromiaDownloadsPage() {
  const gate = await chromiaGate(CHROMIA_MIN_TIER.management);
  if (!gate.ok) redirect("/");

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Downloads</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          The register as a spreadsheet, for anyone who still needs one.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Slab register</h2>
          <p className="mb-3 text-sm text-gray-500">
            Every slab with its batch, stage, state, grade, outcome and recalibration count — the
            columns the monthly workbook carried, as the system now holds them.
          </p>
          <form method="get" action="/api/chromia/export" className="space-y-3">
            <input type="hidden" name="kind" value="slabs" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">State</span>
                <select name="status" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                  <option value="">All</option>
                  {Object.entries(STATUS_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">Stage</span>
                <select name="stage" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                  <option value="">All</option>
                  {STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
              </label>
            </div>
            <button
              type="submit"
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand/90"
            >
              Download CSV
            </button>
          </form>
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Recalibration log</h2>
          <p className="mb-3 text-sm text-gray-500">
            Every send and return with days out, turnaround and attempt number — the history the
            remark column could never hold.
          </p>
          <form method="get" action="/api/chromia/export" className="space-y-3">
            <input type="hidden" name="kind" value="recalibrations" />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" name="outstanding" value="1" defaultChecked
                className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand/30" />
              Only what is still out
            </label>
            <button
              type="submit"
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand/90"
            >
              Download CSV
            </button>
          </form>
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Production output</h2>
          <p className="mb-3 text-sm text-gray-500">
            One row per completed pass through the line — in-time, out-time, minutes, design, print
            result, grade and outcome.
          </p>
          <form method="get" action="/api/chromia/export" className="space-y-3">
            <input type="hidden" name="kind" value="output" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
                <input type="date" name="from" defaultValue={iso(monthStart)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
                <input type="date" name="to" defaultValue={iso(today)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
              </label>
            </div>
            <button
              type="submit"
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand/90"
            >
              Download CSV
            </button>
          </form>
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-semibold text-gray-900">Event log</h2>
          <p className="mb-3 text-sm text-gray-500">
            The append-only audit trail: what happened, to which slab, by whom and when. Capped at
            the most recent 20,000 events.
          </p>
          <form method="get" action="/api/chromia/export">
            <input type="hidden" name="kind" value="events" />
            <button
              type="submit"
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand/90"
            >
              Download CSV
            </button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
