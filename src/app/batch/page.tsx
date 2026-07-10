import Link from "next/link";
import { batchHasUnbacked } from "@/lib/backfill";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Empty, Badge, fmt } from "@/components/ui";
import { HBars, gradeColor } from "@/components/charts";
import { WastagePill } from "@/components/WastagePill";
import { RangeControls } from "@/components/RangeControls";
import { getBatch, searchBatchesByDesign, getMixerCycles, getSiloBags } from "@/lib/erp";
import { UndoLastButton } from "./UndoLastButton";
import { getLastUndoable } from "./undo";
import { recentActions } from "@/lib/actionLog";
import { detectWrongBatch } from "@/lib/batchMismatch";
import { WrongBatchFix } from "@/components/WrongBatchFix";
import { SlabMismatchPill } from "./SlabMismatchPill";
import { MixerSection } from "./MixerSection";
import { canRectify, isManager } from "@/lib/rbac";
import { getQcParamSummary } from "@/lib/stationParams";
import { slabLabel } from "@/lib/slabLabel";

export const dynamic = "force-dynamic";

// Compact, capped list of slab numbers.
function listNums(ns: number[], cap = 50): string {
  const head = ns.slice(0, cap).map(slabLabel).join(", ");
  return ns.length > cap ? `${head}, +${ns.length - cap} more` : head;
}

// Audit label -> drill-down station key.
const STATION_KEY: Record<string, string> = {
  "Press": "press",
  "Distributor": "distributor",
  "Kreos": "kreos",
  "Oven": "oven",
  "Jot": "jot",
  "Polish Entry": "polishEntry",
  "Polish QC": "polishQc",
};

export default async function BatchPage({
  searchParams,
}: {
  searchParams: Promise<{ b?: string; d?: string }>;
}) {
  const { b, d } = await searchParams;
  const query = b?.trim();
  const designQuery = d?.trim();

  let data = null;
  let matches = null;
  let error: string | null = null;
  if (query) {
    try {
      data = await getBatch(query);
    } catch {
      error = "Could not read the database. Run the import first (see README).";
    }
  } else if (designQuery) {
    try {
      matches = await searchBatchesByDesign(designQuery);
    } catch {
      error = "Could not read the database. Run the import first (see README).";
    }
  }

  let lastAct = null;
  let history: Awaited<ReturnType<typeof recentActions>> = [];
  if (query) { try { [lastAct, history] = await Promise.all([getLastUndoable(query), recentActions(query)]); } catch { /* action_log not migrated yet */ } }
  let qcSummary: string | null = null;
  if (query && data) { try { qcSummary = await getQcParamSummary(query); } catch { /* qc summary optional */ } }

  let mixerCycles: Awaited<ReturnType<typeof getMixerCycles>> = [];
  let silos: Awaited<ReturnType<typeof getSiloBags>> = [];
  let unbacked = false;
  if (query) { try { unbacked = await batchHasUnbacked(normalizeBatch(query) ?? ""); } catch { /* ignore */ } }
  let wrongBatch: Awaited<ReturnType<typeof detectWrongBatch>> | null = null;
  let mayFix = false;
  let canManage = false;
  if (query && data?.found) {
    try { [mixerCycles, silos, wrongBatch, mayFix, canManage] = await Promise.all([getMixerCycles(query), getSiloBags(query), detectWrongBatch(query), canRectify(), isManager()]); } catch { /* ignore */ }
  }

  // Build a drill-down href for the current batch.
  const slab = (station: string, only?: string) =>
    `/batch/slabs?b=${encodeURIComponent(query ?? "")}&station=${station}${only ? `&only=${only}` : ""}`;

  return (
    <Shell>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center">
        <form method="GET" className="flex gap-2">
          <input
            name="b"
            defaultValue={query ?? ""}
            placeholder="Batch (e.g. D1310 or 1310)"
            className="w-60 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
            Look up
          </button>
        </form>
        <span className="text-xs text-gray-400 sm:px-1">or</span>
        <form method="GET" className="flex gap-2">
          <input
            name="d"
            defaultValue={designQuery ?? ""}
            placeholder="Search by design name"
            className="w-60 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <button className="rounded-md border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand/5">
            Find
          </button>
        </form>
      </div>

      {error && <Empty>{error}</Empty>}
      {!error && !query && !designQuery && <Empty>Enter a batch number, or search by design name.</Empty>}

      {!error && matches && (
        matches.length === 0 ? (
          <Empty>No batches found with a design matching “{designQuery}”.</Empty>
        ) : (
          <Card>
            <H2>Batches with design “{designQuery}” · {matches.length}</H2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2">Batch</th>
                  <th className="py-2">Design</th>
                  <th className="py-2">Slabs</th>
                  <th className="py-2">Last date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.batch} className="border-t border-gray-100">
                    <td className="py-2 font-medium">{m.batch}</td>
                    <td className="py-2">
                      {m.discrepancy ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge tone="red">⚠ mismatch</Badge>
                          <span className="text-gray-600">{m.designs.join(" · ")}</span>
                        </span>
                      ) : (
                        m.designs[0] ?? "—"
                      )}
                    </td>
                    <td className="py-2">{fmt(m.slabs)}</td>
                    <td className="py-2 text-gray-500">{m.lastDate ?? "—"}</td>
                    <td className="py-2 text-right">
                      <a href={`/batch?b=${encodeURIComponent(m.batch)}`} className="text-brand hover:underline">View →</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}

      {!error && query && data && !data.found && (
        <Empty>No records found for batch “{data.key}”.</Empty>
      )}

      {!error && data && data.found && (
        <div className="space-y-6">
          {lastAct && <UndoLastButton batch={query} label={lastAct.summary} by={lastAct.actor} at={lastAct.createdAt} />}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">Batch {data.key}</h1>
            {data.design.primary && !data.design.discrepancy && (
              <Badge tone="brand">Design: {data.design.primary}</Badge>
            )}
            {data.design.discrepancy && <Badge tone="red">⚠ Design mismatch</Badge>}
            {data.slabsProduced.discrepancy && <SlabMismatchPill batch={query ?? ""} blankTotal={data.slabAudit.blankTotal} canManage={canManage} />}
            {!data.slabAudit.hasIssues && data.slabAudit.stations.length > 0 && (
              <Badge tone="green">✓ Slabs reconciled</Badge>
            )}
            {data.slabAudit.hasIssues && <Badge tone="red">⚠ Slab discrepancies</Badge>}
            {unbacked && <Badge tone="red">⚠ Unbacked RM — silo/tank fill pending, auto-links on fill</Badge>}
            {data.wastagePct != null && (
              <WastagePill pct={data.wastagePct} kg={data.wastageKg} mixWeight={data.totalMixWeight} slabWeight={data.totalSlabWeight} />
            )}
          </div>

          {data.family.isSub && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              Sub-batch of a mid-batch design switch — part of{" "}
              <Link href={`/batch?b=${encodeURIComponent(data.family.parent)}`} className="font-semibold underline hover:text-amber-900">{data.family.parent}</Link>. Open the parent to see the whole run rolled up.
            </div>
          )}
          {!data.family.isSub && data.family.keys.length > 1 && (
            <div className="rounded-xl border border-brand/20 bg-brand/[0.04] px-4 py-3 text-sm">
              <div className="mb-2 font-medium text-gray-700">Batch family — the totals below include {data.family.keys.length - 1} design-switch sub-batch{data.family.keys.length - 1 === 1 ? "" : "es"}:</div>
              <div className="flex flex-wrap gap-2">
                {data.family.members.map((m) => (
                  <Link key={m.key} href={`/batch?b=${encodeURIComponent(m.key)}`} className={`rounded-lg border px-3 py-1.5 transition hover:border-brand/40 ${m.key === data.key ? "border-brand/40 bg-white" : "border-gray-200 bg-white"}`}>
                    <span className="font-semibold">{m.key}</span>{m.design ? <span className="text-gray-500"> · {m.design}</span> : ""}<span className="text-gray-400"> · {fmt(m.slabs)} slabs</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {data.slabAudit.range && (
            <RangeControls batch={query ?? ""} batchKey={data.key} min={data.slabAudit.range.min} max={data.slabAudit.range.max} missing={data.slabAudit.globalMissing.length} confirmed={data.slabAudit.confirmed} />
          )}

          {data.design.discrepancy && (
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <H2>⚠ Multiple design names in this batch</H2>
                <Link href={`/batch/design?b=${encodeURIComponent(query ?? "")}`} className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">Reconcile design →</Link>
              </div>
              <p className="mb-3 text-sm text-gray-600">
                This batch has more than one design stamped on its records — pick the correct one to apply across the batch.
              </p>
              <table className="w-full max-w-lg text-sm">
                <tbody>
                  {Object.entries(data.design.bySource).map(([src, designs]) => (
                    <tr key={src} className="border-t border-gray-100">
                      <td className="w-32 py-2 font-medium text-gray-600">{src}</td>
                      <td className="py-2 text-gray-900">{designs.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Wrong-batch entries: station rows that disagree with the line head */}
          {wrongBatch && wrongBatch.groups.length > 0 && (
            <WrongBatchFix groups={wrongBatch.groups} mayEdit={mayFix} viewedBatch={query ?? ""} />
          )}

          {/* Slab-level audit: duplicates and missing slabs per station (clickable) */}
          {data.slabAudit.stations.length > 0 && (
            <Card>
              <H2>{data.slabAudit.hasIssues
                ? <span className="text-red-600">⚠ Slab-level discrepancies</span>
                : <span className="text-green-600">✓ Slab-level check — all reconciled</span>}</H2>
              <p className="mb-3 text-sm text-gray-600">
                {data.slabAudit.hasIssues
                  ? "Per station — slabs entered more than once, and slabs present elsewhere in the batch but missing here. Click any row or value to see the slabs."
                  : "Every slab is present at each station — no duplicates, nothing missing. Click any row or value to see the slabs."}
              </p>
              <p className="mb-3 -mt-1 text-xs text-gray-500">
                Tip — <span className="font-medium text-brand">Press, Oven, Distributor, Kreos and Mixer</span> rows open the full list of slabs (cycles for Mixer) <span className="font-medium">plus a parameter change log</span>: machine settings &amp; recipe with any mid-batch changes flagged (Mixer flags grit/filler/resin moves of ≥3&nbsp;kg).
              </p>
              {data.slabAudit.notes.length > 0 && (
                <div className="mb-3 space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {data.slabAudit.notes.map((n) => <div key={n}>⚠ {n}</div>)}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-2 pr-4">Station</th>
                      <th className="py-2 pr-4">Rows</th>
                      <th className="py-2 pr-4">Distinct</th>
                      <th className="py-2 pr-4">Entered twice</th>
                      <th className="py-2 pr-4">Missing here</th>
                      <th className="py-2">Auto-added <span className="font-normal text-gray-400">(params missing)</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.slabAudit.stations.map((s) => {
                      const sk = STATION_KEY[s.label];
                      return (
                        <tr key={s.label} className="border-t border-gray-100 align-top hover:bg-gray-50">
                          <td className="py-2 pr-4 font-medium">
                            {sk ? <Link href={slab(sk)} className="text-brand hover:underline">{s.label} →</Link> : s.label}
                          </td>
                          <td className="py-2 pr-4">{fmt(s.total)}</td>
                          <td className="py-2 pr-4">{fmt(s.distinct)}</td>
                          <td className="py-2 pr-4">
                            {s.duplicates.length ? (
                              <Link href={slab(sk, "dup")} className="text-red-600 hover:underline">
                                {s.duplicates.map((d) => `${slabLabel(d.slab)}×${d.count}`).join(", ")}
                              </Link>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            {s.missing.length ? (
                              <Link href={slab(sk, "missing")} className="text-amber-700 hover:underline">
                                {listNums(s.missing)}
                              </Link>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-2">
                            {s.autoAdded.length ? (
                              sk ? <Link href={slab(sk)} title="Placeholder rows created by range rectify — fill in their parameters" className="text-amber-800 hover:underline">⚙ {listNums(s.autoAdded)}</Link> : <span className="text-amber-800">⚙ {listNums(s.autoAdded)}</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {data.slabAudit.globalMissing.length > 0 && data.slabAudit.range && (
                <p className="mt-3 text-sm text-red-700">
                  <span className="font-medium">Missing from every station</span> (gaps in {data.slabAudit.range.min}–{data.slabAudit.range.max}):{" "}
                  {listNums(data.slabAudit.globalMissing)}
                </p>
              )}
              {data.slabAudit.skipped.length > 0 && (
                <p className="mt-3 text-sm text-gray-500">
                  <span className="font-medium">Skipped (not counted as missing):</span> {listNums(data.slabAudit.skipped)}
                </p>
              )}
            </Card>
          )}

          {qcSummary && (
            <p className="-mt-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-700">
              <span className="font-medium text-gray-500">QC vs. parameters — </span>{qcSummary}
            </p>
          )}

          <div className="grid grid-cols-2 items-stretch gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Link href={slab("press")} className="block h-full rounded-xl transition hover:ring-2 hover:ring-brand/30">
              <Kpi
                label="Slabs produced"
                value={fmt(data.slabsProduced.value)}
                sub={`Press ${fmt(data.slabsProduced.press)} · Oven ${fmt(data.slabsProduced.oven)} · Jot ${fmt(data.slabsProduced.jot)}${data.slabsProduced.discrepancy ? " · ⚠ mismatch" : ""}`}
              />
            </Link>
            <Link href={slab("polishEntry")} className="block h-full rounded-xl transition hover:ring-2 hover:ring-brand/30">
              <Kpi label="Polish entries" value={fmt(data.counts.polishEntry)} sub="view slabs" />
            </Link>
            <Link href={slab("polishQc")} className="block h-full rounded-xl transition hover:ring-2 hover:ring-brand/30">
              <Kpi label="Polish QC" value={fmt(data.counts.polishQc)} sub="view slabs" />
            </Link>
            <Link href={slab("press")} className="block h-full rounded-xl transition hover:ring-2 hover:ring-brand/30">
              <Kpi label="Design" value={data.design.primary ?? "—"} sub={data.design.discrepancy ? `${data.design.designs.length} conflicting` : "single design"} />
            </Link>
            <Link href={slab("mixer")} className="block h-full rounded-xl transition hover:ring-2 hover:ring-brand/30">
              <Kpi label="Mix weight (kg)" value={fmt(data.totalMixWeight)} sub={`${data.counts.mixer} mixer cycles`} />
            </Link>
            <Link href={slab("press")} className="block h-full rounded-xl transition hover:ring-2 hover:ring-brand/30">
              <Kpi label="Slab weight (kg)" value={fmt(data.totalSlabWeight)} sub={`wastage ${fmt(data.wastageKg)} kg`} />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <H2>Per-mixer weight (kg)</H2>
              <HBars
                data={data.perMixer.map((v, i) => ({ label: `Mixer ${i + 1}`, count: Math.round(v) }))}
                links={Object.fromEntries(data.perMixer.map((_v, i) => [`Mixer ${i + 1}`, slab("mixer")]))}
              />
            </Card>
            <Card>
              <H2>QC grade distribution</H2>
              {data.qcGrades.length ? <HBars data={data.qcGrades} colorFor={gradeColor} links={Object.fromEntries(data.qcGrades.map((g) => [g.label, g.label === "—" ? `/tables/PolishQc?b=${encodeURIComponent(data.key)}&empty=qualityGrade` : `/tables/PolishQc?b=${encodeURIComponent(data.key)}&q=${encodeURIComponent(g.label)}`]))} /> : <Empty>No QC rows.</Empty>}
            </Card>
            <Card>
              <H2>Thickness mix (QC)</H2>
              {data.thickness.length ? <HBars data={data.thickness} links={Object.fromEntries(data.thickness.map((t) => [t.label, t.label === "—" ? `/tables/PolishQc?b=${encodeURIComponent(data.key)}&empty=slabThickness` : `/tables/PolishQc?b=${encodeURIComponent(data.key)}&q=${encodeURIComponent(t.label)}`]))} /> : <Empty>No QC rows.</Empty>}
            </Card>
          </div>

          <MixerSection cycles={mixerCycles} silos={silos} mixerListHref={slab("mixer")} />


          {history.length > 0 && (
            <Card>
              <H2>Rectification history · {history.length}</H2>
              <p className="mb-3 text-sm text-gray-600">Who changed what on this batch, and when.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-2 pr-4">When</th>
                      <th className="py-2 pr-4">Who</th>
                      <th className="py-2 pr-4">Action</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-2 pr-4 whitespace-nowrap text-gray-500">{h.createdAt.slice(0, 16).replace("T", " ")}</td>
                        <td className="py-2 pr-4 font-medium text-gray-800">{h.actor ?? "—"}</td>
                        <td className="py-2 pr-4 text-gray-900">{h.summary}</td>
                        <td className="py-2">{h.undone ? <span className="text-gray-400">undone</span> : <span className="text-green-600">applied</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </Shell>
  );
}
