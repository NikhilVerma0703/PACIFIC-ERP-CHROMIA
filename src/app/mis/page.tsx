import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Empty, fmt } from "@/components/ui";
import { getDowntimeReport, fmtDur } from "@/lib/downtime";

export const dynamic = "force-dynamic";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default async function MisPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; b?: string }> }) {
  const sp = await searchParams;
  const from = sp.from?.trim() || ymd(new Date(Date.now() - 30 * 864e5));
  const to = sp.to?.trim() || ymd(new Date());
  const batch = sp.b?.trim() || "";

  let r: Awaited<ReturnType<typeof getDowntimeReport>> | null = null;
  let error: string | null = null;
  try { r = await getDowntimeReport({ from, to, batch: batch || undefined }); }
  catch { error = "Could not read the MIS log."; }

  const maxReason = r ? Math.max(1, ...r.byReason.map((x) => x.minutes)) : 1;
  const maxTrend = r ? Math.max(1, ...r.trend.map((x) => x.minutes)) : 1;

  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">Production downtime</h1>
      <p className="mb-5 max-w-3xl text-sm text-gray-500">
        From the MIS hourly log — total stoppage time by type and reason, the daily trend, and the breakdown/RCA log.{" "}
        {batch ? `Showing batch ${r?.batch}.` : `Range ${from} to ${to}.`}
      </p>

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">From</span><input type="date" name="from" defaultValue={from} className="rounded-md border border-gray-300 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">To</span><input type="date" name="to" defaultValue={to} className="rounded-md border border-gray-300 px-3 py-2 text-sm" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">Batch (optional)</span><input name="b" defaultValue={batch} placeholder="e.g. 1347" className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm" /></label>
        <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Apply</button>
        {batch && <Link href="/mis" className="text-sm text-brand hover:underline">clear batch</Link>}
      </form>

      {error && <Empty>{error}</Empty>}
      {!error && r && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Total downtime" value={fmtDur(r.totalMinutes)} sub={`${fmt(Math.round(r.totalMinutes / 60))} h · ${r.hoursLogged} logged hour(s)`} />
            {r.byType.map((t) => <Kpi key={t.key} label={t.label} value={fmtDur(t.minutes)} sub={`${t.incidents} incident(s)`} />)}
          </div>

          <Card>
            <H2>Downtime by reason</H2>
            {r.byReason.length === 0 ? <p className="text-sm text-gray-400">No deviations logged in this range.</p> : (
              <div className="space-y-1.5">
                {r.byReason.slice(0, 20).map((x) => (
                  <div key={x.reason} className="flex items-center gap-3 text-sm">
                    <div className="w-56 shrink-0 truncate text-gray-700" title={x.reason}>{x.reason}</div>
                    <div className="h-4 flex-1 rounded bg-gray-100"><div className="h-4 rounded bg-brand" style={{ width: `${Math.max(2, Math.round((100 * x.minutes) / maxReason))}%` }} /></div>
                    <div className="w-28 shrink-0 text-right text-gray-600">{fmtDur(x.minutes)} · {x.incidents}&times;</div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] text-gray-400">Minutes = downtime of the hours that cited each reason (an hour with two reasons counts toward both); incident count is exact.</p>
          </Card>

          <Card>
            <H2>Daily downtime</H2>
            {r.trend.length === 0 ? <p className="text-sm text-gray-400">No downtime in this range.</p> : (
              <div className="space-y-1.5">
                {r.trend.map((x) => (
                  <div key={x.day} className="flex items-center gap-3 text-sm">
                    <div className="w-24 shrink-0 text-gray-500">{x.day}</div>
                    <div className="h-4 flex-1 rounded bg-gray-100"><div className="h-4 rounded bg-amber-400" style={{ width: `${Math.max(2, Math.round((100 * x.minutes) / maxTrend))}%` }} /></div>
                    <div className="w-20 shrink-0 text-right text-gray-600">{fmtDur(x.minutes)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <H2>Breakdown &amp; deviation log · {r.incidents.length}</H2>
            {r.incidents.length === 0 ? <p className="text-sm text-gray-400">No incidents logged in this range.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500">
                    <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Hour</th><th className="py-2 pr-3">Batch</th>
                    <th className="py-2 pr-3">Down</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Reason(s)</th><th className="py-2">Details / RCA / action</th>
                  </tr></thead>
                  <tbody>
                    {r.incidents.map((i, k) => (
                      <tr key={k} className="border-t border-gray-100 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{i.date ?? "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{i.hour ?? "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{i.batch ?? "—"}</td>
                        <td className="py-2 pr-3 whitespace-nowrap font-medium text-gray-900">{i.minutes > 0 ? fmtDur(i.minutes) : "—"}</td>
                        <td className="py-2 pr-3 text-gray-600">{i.types.join(", ") || "—"}</td>
                        <td className="py-2 pr-3 text-gray-600">{i.reasons.join(", ") || "—"}</td>
                        <td className="py-2 text-gray-600">{[i.details, i.rca ? `RCA ${i.rca}` : null, i.action, i.spares ? `spares: ${i.spares}` : null].filter(Boolean).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
