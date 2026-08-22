import { Shell } from "@/components/Shell";
import { Card, Empty, Badge, fmt } from "@/components/ui";
import { getProductionReport } from "@/lib/erp";
import { getDetailedReport } from "@/lib/detailedReport";
import { DetailedReportView } from "@/components/DetailedReportView";
import { LookupTabs, showLookupTabs } from "@/components/LookupTabs";
import { currentUser } from "@/lib/rbac";
import { maySeeMaterialTrace } from "@/lib/routeCaps";

export const dynamic = "force-dynamic";

function dt(d: Date | null): string {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : "—";
}

function listNums(ns: number[], cap = 50): string {
  const head = ns.slice(0, cap).join(", ");
  return ns.length > cap ? `${head}, +${ns.length - cap} more` : head;
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ b?: string }>;
}) {
  const { b } = await searchParams;
  const query = b?.trim();
  // The production run is the report. The material-source trace under it is a
  // batch lookup by another name, and not every login granted this page was
  // granted that.
  const user = await currentUser();
  const trace = maySeeMaterialTrace(String((user as { role?: string } | null)?.role ?? ""));

  let r = null;
  let detailed = null;
  let error: string | null = null;
  if (query) {
    try {
      [r, detailed] = await Promise.all([
        getProductionReport(query),
        trace ? getDetailedReport(query) : Promise.resolve(null),
      ]);
    } catch {
      error = "Could not read the database. Run the import first (see README).";
    }
  }

  const tabs = showLookupTabs(
    String((user as { role?: string } | null)?.role ?? ""),
    String((user as { branch?: string } | null)?.branch ?? ""));

  return (
    <Shell>
      {tabs && <LookupTabs active="/report" />}
      <form method="GET" className="mb-6 flex gap-2">
        <input
          name="b"
          defaultValue={query ?? ""}
          placeholder="Enter batch (e.g. D1310)"
          className="w-72 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          Generate
        </button>
      </form>

      {error && <Empty>{error}</Empty>}
      {!error && !query && <Empty>Enter a batch number to generate its production report.</Empty>}
      {!error && r && !r.batch.found && <Empty>No records found for batch “{r.batch.key}”.</Empty>}

      {!error && detailed?.found && trace && (
        <Card className="mb-6">
          <DetailedReportView r={detailed} />
        </Card>
      )}

      {!error && r && r.batch.found && !trace && (
        <p className="mb-6 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
          The material-source trace for this batch (suppliers, invoice and bag numbers) is not
          part of your access. The production run is below.
        </p>
      )}

      {!error && r && r.batch.found && (
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">Production Report — Batch {r.batch.key}</h1>
            {r.batch.design.primary && !r.batch.design.discrepancy && (
              <Badge tone="brand">Design: {r.batch.design.primary}</Badge>
            )}
            {r.batch.design.discrepancy && <Badge tone="red">⚠ Design mismatch</Badge>}
            {r.batch.slabsProduced.discrepancy && <Badge tone="red">⚠ Slab count mismatch</Badge>}
            {r.batch.slabAudit.hasIssues && <Badge tone="red">⚠ Slab discrepancies</Badge>}
            {!r.batch.slabAudit.hasIssues && r.batch.slabAudit.stations.length > 0 && (
              <Badge tone="green">✓ Slabs reconciled</Badge>
            )}
            {r.batch.wastagePct != null && (
              <Badge tone={r.batch.wastagePct > 12 ? "red" : r.batch.wastagePct >= 8 ? "amber" : "green"}>
                Wastage {r.batch.wastagePct.toFixed(2)}%
              </Badge>
            )}
          </div>

          {r.batch.design.discrepancy && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <span className="font-medium">Design mismatch within this batch:</span>{" "}
              {Object.entries(r.batch.design.bySource).map(([src, ds]) => `${src} → ${ds.join(", ")}`).join("  ·  ")}
            </div>
          )}

          {r.batch.slabsProduced.discrepancy && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <span className="font-medium">Slab counts differ across stages:</span>{" "}
              Press {fmt(r.batch.slabsProduced.press)} · Oven {fmt(r.batch.slabsProduced.oven)} · Jot {fmt(r.batch.slabsProduced.jot)}
            </div>
          )}

          <table className="w-full text-sm">
            <tbody>
              {[
                ["Design name", r.batch.design.discrepancy ? `⚠ ${r.batch.design.designs.join(" / ")}` : (r.batch.design.primary ?? "—")],
                ["Opening (first mixer start)", dt(r.opening)],
                ["Closing (last mixer end)", dt(r.closing)],
                ["No. of cycles", fmt(r.cycles)],
                ["M1 / M2 / M3 / M4 weight (kg)", r.batch.perMixer.map((v) => fmt(Math.round(v))).join(" / ")],
                ["Slabs produced", r.batch.slabsProduced.discrepancy
                  ? `⚠ ${fmt(r.batch.slabsProduced.value)}  (Press ${fmt(r.batch.slabsProduced.press)} / Oven ${fmt(r.batch.slabsProduced.oven)} / Jot ${fmt(r.batch.slabsProduced.jot)})`
                  : `${fmt(r.batch.slabsProduced.value)}  (Press ${fmt(r.batch.slabsProduced.press)} / Oven ${fmt(r.batch.slabsProduced.oven)} / Jot ${fmt(r.batch.slabsProduced.jot)})`],
                ["Total slab weight (kg)", fmt(r.batch.totalSlabWeight)],
                ["Total mix weight (kg)", fmt(r.batch.totalMixWeight)],
                ["Wastage (kg)", fmt(r.batch.wastageKg)],
                ["Cleaning delay (min)", fmt(r.cleaningDelay)],
                ["Breakdown delay (min)", fmt(r.breakdownDelay)],
                ["Reason for deviation", r.reasons.length ? r.reasons.join(", ") : "—"],
                ["Total polish entries", fmt(r.batch.counts.polishEntry)],
                ["Total polish QC", fmt(r.batch.counts.polishQc)],
              ].map(([label, value]) => (
                <tr key={label} className="border-t border-gray-100">
                  <td className="w-1/2 py-2.5 pr-4 font-medium text-gray-600">{label}</td>
                  <td className="py-2.5 text-gray-900">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {r.batch.slabAudit.hasIssues && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-gray-700">Slab-level discrepancies</h2>
              {r.batch.slabAudit.notes.length > 0 && (
                <div className="mb-3 space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {r.batch.slabAudit.notes.map((n) => <div key={n}>⚠ {n}</div>)}
                </div>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-4">Station</th>
                    <th className="py-2 pr-4">Rows</th>
                    <th className="py-2 pr-4">Distinct</th>
                    <th className="py-2 pr-4">Entered twice</th>
                    <th className="py-2">Missing here</th>
                  </tr>
                </thead>
                <tbody>
                  {r.batch.slabAudit.stations.map((s) => (
                    <tr key={s.label} className="border-t border-gray-100 align-top">
                      <td className="py-2 pr-4 font-medium text-gray-700">{s.label}</td>
                      <td className="py-2 pr-4">{fmt(s.total)}</td>
                      <td className="py-2 pr-4">{fmt(s.distinct)}</td>
                      <td className="py-2 pr-4">{s.duplicates.length ? <span className="text-red-600">{s.duplicates.map((d) => `${d.slab}×${d.count}`).join(", ")}</span> : <span className="text-gray-400">—</span>}</td>
                      <td className="py-2">{s.missing.length ? <span className="text-amber-700">{listNums(s.missing)}</span> : <span className="text-gray-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.batch.slabAudit.globalMissing.length > 0 && r.batch.slabAudit.range && (
                <p className="mt-3 text-sm text-red-700">
                  <span className="font-medium">Missing from every station</span> (gaps in {r.batch.slabAudit.range.min}–{r.batch.slabAudit.range.max}):{" "}
                  {listNums(r.batch.slabAudit.globalMissing)}
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </Shell>
  );
}
