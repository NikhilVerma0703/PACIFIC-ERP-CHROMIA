import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Badge, Card, Empty, Kpi } from "@/components/ui";
import { chromiaGate } from "@/lib/chromia/access";
import { listRecalibrations } from "@/lib/chromia/store";
import { RECALIBRATION_OVERDUE_DAYS } from "@/lib/chromia/process";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Recalibration tracking | Pacific ERP" };

const dOnly = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—";

/**
 * THE screen this module was built for.
 *
 * "The single biggest challenge in the Chromia line today is tracking slabs
 * after they have been sent for recalibration" (CHROMIA_PROCESS.md section 3).
 * The register recorded that a slab was sent and the trail went cold: no
 * committed return date, no way to know which slabs were overdue, no way to
 * chase. Longest-out first, so the top of this list is the morning's call list.
 */
export default async function ChromiaRecalibrationTracking({
  searchParams,
}: {
  searchParams: Promise<{ history?: string }>;
}) {
  const gate = await chromiaGate();
  if (!gate.ok) redirect("/");

  const sp = await searchParams;
  const history = sp.history === "1";
  const rows = await listRecalibrations({ includeReturned: history, limit: 300 });

  const outstanding = rows.filter((r) => r.ageing.outstanding);
  const overdue = outstanding.filter((r) => r.ageing.overdue);
  const longest = outstanding.reduce((m, r) => Math.max(m, r.ageing.daysOut ?? 0), 0);
  const returned = rows.filter((r) => r.receivedDate);
  const avgTurnaround = returned.length
    ? Math.round(returned.reduce((s, r) => s + (r.ageing.daysOut ?? 0), 0) / returned.length)
    : null;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          Recalibration tracking
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Which slabs are out, where, and how long they have been gone. Anything past{" "}
          {RECALIBRATION_OVERDUE_DAYS} days with no committed return date is flagged.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Out now" value={outstanding.length} sub="not yet back" />
        <Kpi
          label="Overdue"
          value={overdue.length}
          sub={overdue.length ? "chase these" : "all within time"}
          className={overdue.length ? "ring-1 ring-red-200" : ""}
        />
        <Kpi label="Longest out" value={longest ? `${longest}d` : "—"} sub="oldest outstanding" />
        <Kpi
          label="Avg turnaround"
          value={avgTurnaround == null ? "—" : `${avgTurnaround}d`}
          sub={history ? "of those returned" : "switch to history for more"}
        />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            {history ? "Every recalibration" : "Currently out"} · {rows.length}
          </h2>
          <Link
            href={history ? "/chromia/recalibration-tracking" : "/chromia/recalibration-tracking?history=1"}
            className="text-xs text-brand hover:underline"
          >
            {history ? "Show only what is out" : "Show history"}
          </Link>
        </div>

        {rows.length === 0 ? (
          <Empty>
            {history
              ? "No recalibration has ever been recorded."
              : "Nothing is out for recalibration. Every slab is accounted for on site."}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">Slab</th>
                  <th className="py-2 pr-4 font-medium">Batch</th>
                  <th className="py-2 pr-4 font-medium">Attempt</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Facility</th>
                  <th className="py-2 pr-4 font-medium">Sent</th>
                  <th className="py-2 pr-4 font-medium">Expected</th>
                  <th className="py-2 pr-4 font-medium">Days out</th>
                  <th className="py-2 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-gray-50 last:border-0 ${
                      r.ageing.overdue ? "bg-red-50/40" : ""
                    }`}
                  >
                    <td className="py-2 pr-4">
                      <Link
                        href={`/chromia/slabs/${encodeURIComponent(r.slabNo)}`}
                        className="font-medium text-gray-900 hover:text-brand hover:underline"
                      >
                        {r.slabNo}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{r.batchNo}</td>
                    <td className="py-2 pr-4 text-gray-600">#{r.attemptNumber}</td>
                    <td className="py-2 pr-4 text-gray-600">{r.reason ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-600">
                      {/* An unrecorded facility is called out rather than left
                          blank: a slab nobody can name a location for is the
                          exact problem this screen exists to end. */}
                      {r.facilityName ?? <span className="text-amber-700">not recorded</span>}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{dOnly(r.sentDate)}</td>
                    <td className="py-2 pr-4 text-gray-600">
                      {r.expectedReturnDate
                        ? dOnly(r.expectedReturnDate)
                        : <span className="text-amber-700">none given</span>}
                    </td>
                    <td className="py-2 pr-4 font-medium text-gray-900">
                      {r.ageing.daysOut == null ? "—" : r.ageing.daysOut}
                      {r.ageing.daysLate > 0 && (
                        <span className="ml-1 text-xs font-normal text-red-600">
                          ({r.ageing.daysLate}d late)
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      {r.receivedDate ? (
                        <Badge tone="green">back {dOnly(r.receivedDate)}</Badge>
                      ) : r.ageing.overdue ? (
                        <Badge tone="red">overdue</Badge>
                      ) : (
                        <Badge tone="amber">{r.status.replace(/_/g, " ").toLowerCase()}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}
