import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Empty, fmt } from "@/components/ui";
import { DailyBars, HBars } from "@/components/charts";
import { getOverview } from "@/lib/erp";

export const dynamic = "force-dynamic";

const cardLink = "block h-full rounded-2xl transition hover:ring-2 hover:ring-brand/30";

export default async function OverviewPage() {
  let data;
  let error: string | null = null;
  try {
    data = await getOverview();
  } catch {
    error = "Could not read the database. Run the local Postgres + import first (see README).";
  }

  return (
    <Shell>
      {error || !data ? (
        <Empty>{error ?? "No data yet."}</Empty>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-3">
            <Link href="/records?model=PolishEntry" className={cardLink}>
              <Kpi label="Slabs polished · 7d" value={fmt(data.polished7d)} sub="view polish entries" />
            </Link>
            <Link href="/records?model=PolishEntry" className={cardLink}>
              <Kpi label="Slabs polished · 30d" value={fmt(data.polished30d)} sub="view polish entries" />
            </Link>
            <Link href="/records?model=Press" className={cardLink}>
              <Kpi label="Pressed today" value={fmt(data.pressedToday)} sub="view press records" />
            </Link>
          </div>

          <Link href="/records?model=PolishEntry" className={cardLink}>
            <Card className="h-full">
              <H2>Slabs polished · last 30 days</H2>
              {data.daily.length ? <DailyBars data={data.daily} /> : <Empty>No polish entries in range.</Empty>}
            </Card>
          </Link>

          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
            <Link href="/records?model=PolishEntry" className={cardLink}>
              <Card className="h-full">
                <H2>Polishing status mix</H2>
                {data.statusMix.length ? <HBars data={data.statusMix} /> : <Empty>No data.</Empty>}
              </Card>
            </Link>
            <Link href="/records?model=Press" className={cardLink}>
              <Card className="h-full">
                <H2>Pressed slabs by thickness (30d)</H2>
                {data.thicknessMix.length ? <HBars data={data.thicknessMix} /> : <Empty>No data.</Empty>}
              </Card>
            </Link>
          </div>

          <Card>
            <H2>Recent batches (from Press)</H2>
            {data.recentBatches.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2">Batch</th>
                    <th className="py-2">Design</th>
                    <th className="py-2">Slabs pressed</th>
                    <th className="py-2">Last date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentBatches.map((b) => (
                    <tr key={b.batch} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="py-2 font-medium">
                        <Link href={`/batch?b=${encodeURIComponent(b.batch)}`} className="text-brand hover:underline">{b.batch}</Link>
                      </td>
                      <td className="py-2">
                        {b.designDiscrepancy ? (
                          <span className="text-red-600" title="Multiple design names in this batch">⚠ {b.design ?? "mismatch"}</span>
                        ) : (
                          <span className="text-gray-700">{b.design ?? "—"}</span>
                        )}
                      </td>
                      <td className="py-2">{fmt(b.slabs)}</td>
                      <td className="py-2 text-gray-500">{b.lastDate ?? "—"}</td>
                      <td className="py-2 text-right">
                        <Link href={`/batch?b=${encodeURIComponent(b.batch)}`} className="text-brand hover:underline">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No batches found.</Empty>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
