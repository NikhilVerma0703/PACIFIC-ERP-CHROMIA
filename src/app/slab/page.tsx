import { Shell } from "@/components/Shell";
import { Card, Empty, Badge } from "@/components/ui";
import { getSlabReport, type StationStop } from "@/lib/slabReport";
import { currentRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/** The station line every role sees: date, operator, and the short summary fields —
 *  design, thickness, status/quality and the slab's own weight. Machine/dosing readings
 *  are filtered out of `fields` upstream for a basic read (BASIC_SKIP_FIELDS). */
function StationSummary({ st }: { st: StationStop }) {
  return (
    <>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-[11px] text-green-700">✓</span>
      <span className="w-28 shrink-0 text-sm font-medium text-gray-800">{st.label}</span>
      {st.date && <span className="text-xs text-gray-500">{st.date}</span>}
      {st.operator && <span className="text-xs text-gray-500">· {st.operator}</span>}
      {st.wrongBatch && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">⚠ wrong batch — entered {st.wrongBatch.entered}, belongs to {st.wrongBatch.lineHead} (fix in Batch Lookup)</span>}
      {st.fields.map((f, i) => <span key={i} className="text-xs text-gray-600"><span className="text-gray-400">{f.label}:</span> {f.value}</span>)}
    </>
  );
}

export default async function SlabLookup({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { s } = await searchParams;
  const query = s?.trim();
  // Commercial is a read-only finished-goods role: basic slab details only — no machine
  // settings / recipe, no RM. `basic` is passed into the report so none of it is even
  // fetched (see slabReport.ts), rather than fetched and then hidden here.
  const basic = (await currentRole()) === "COMMERCIAL";
  let r = null;
  let error: string | null = null;
  if (query) {
    try { r = await getSlabReport(query, { basic }); } catch { error = "Could not read the database."; }
  }

  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Slab Lookup</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          {basic
            ? <>Trace one slab end-to-end — its batch, design, thickness and weight, and its journey from the line through polishing.</>
            : <>Trace one slab end-to-end — its RM composition (FIFO, yield-adjusted), total weight, and its journey from the line through polishing. Click any station to see every parameter set for this slab.</>}
        </p>
      </div>

      <form method="GET" className="mb-6 flex gap-2">
        <input name="s" defaultValue={query ?? ""} placeholder="Enter slab number (e.g. 125443)" className="w-72 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
        <button className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">Look up</button>
      </form>

      {error && <Empty>{error}</Empty>}
      {!error && !query && <Empty>Enter a slab number to trace it.</Empty>}
      {!error && r && !r.found && <Empty>No slab “{r.slabNumber}” found at any station.</Empty>}

      {!error && r && r.found && (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold">Slab #{r.slabNumber}</h2>
              {r.batch && <Badge tone="brand">Batch {r.batch}</Badge>}
              {r.design && <Badge tone="brand">{r.design}</Badge>}
              {r.thickness && <Badge tone="amber">{r.thickness}</Badge>}
              {r.slabWeight != null && <Badge tone="green">{Math.round(r.slabWeight).toLocaleString("en-IN")} kg</Badge>}
              {r.unbacked && <Badge tone="red">⚠ unbacked RM — silo/tank fill pending, will auto-link</Badge>}
              {r.provisional
                ? <Badge tone="amber">⏳ provisional · batch still running</Badge>
                : <Badge tone="green">✓ final · batch closed</Badge>}
            </div>
            {r.closeReason && <p className="mt-2 text-xs text-gray-400">{r.closeReason}</p>}
          </Card>

          {/* RM composition — not shown to Commercial, and not fetched for them either:
              getSlabReport({ basic }) returns before any material query runs. */}
          {!basic && (
          <Card>
            <div className="mb-1 text-sm font-semibold text-gray-800">RM composition — what went into this slab</div>
            <p className="mb-3 text-xs text-gray-400">
              FIFO across mixer cycles, blended within each cycle (mixer output is mixed material), scaled by yield so the RM sums to the slab weight.
              {r.wastagePct != null && <> Batch wastage (mixer→distributor) {r.wastagePct}% spread evenly.</>}
            </p>
            {r.rm.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500">
                    <th className="py-2 pr-4">RM bag</th><th className="py-2 pr-4">Material</th><th className="py-2 pr-4">Supplier</th><th className="py-2 pr-4 text-right">kg into slab</th>
                  </tr></thead>
                  <tbody>
                    {r.rm.map((x, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-2 pr-4 font-medium text-gray-900">{x.label}</td>
                        <td className="py-2 pr-4 text-gray-600">{x.material}</td>
                        <td className="py-2 pr-4 text-gray-500">{x.supplier ?? "—"}</td>
                        <td className="py-2 pr-4 text-right font-medium">{x.kg.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-200 font-semibold">
                      <td className="py-2 pr-4" colSpan={3}>Total RM</td>
                      <td className="py-2 pr-4 text-right">{r.rmTotal.toLocaleString("en-IN")} kg</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : <Empty>{r.rmNote ?? "No RM consumption recorded for this batch’s cycles yet."}</Empty>}
          </Card>
          )}

          <Card>
            <div className="mb-3 text-sm font-semibold text-gray-800">Journey — RM → Silo → Mixer → line → polishing</div>
            <ol className="space-y-2">
              {r.journey.map((st) => (
                st.present ? (
                  <li key={st.key} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                    {basic ? (
                      // No expander for Commercial: there are no parameters on the payload
                      // to open, and the per-record drill-down goes to /tables, which is
                      // blocked for them by middleware AND by canSeeModel (branch.ts:69) —
                      // so the link would only bounce them to /inventory.
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                        <StationSummary st={st} />
                      </div>
                    ) : (
                      <details className="group">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 hover:bg-gray-50">
                          <StationSummary st={st} />
                          <span className="ml-auto text-xs font-medium text-brand group-open:hidden">View parameters ▾</span>
                          <span className="ml-auto hidden text-xs font-medium text-gray-400 group-open:inline">Hide ▴</span>
                        </summary>
                        <div className="border-t border-gray-100 bg-gray-50/50 px-3 py-3">
                          {st.allFields.length ? (
                            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                              {st.allFields.map((f, i) => (
                                <div key={i}>
                                  <dt className="text-[11px] uppercase tracking-wide text-gray-400">{f.label}</dt>
                                  <dd className="text-sm text-gray-800">{f.value}</dd>
                                </div>
                              ))}
                            </dl>
                          ) : <p className="text-xs text-gray-400">No additional parameters recorded for this slab at {st.label}.</p>}
                          {st.recordId && <a href={`/tables/${st.model}/${st.recordId}`} className="mt-3 inline-block text-xs font-medium text-brand hover:underline">Open full record →</a>}
                        </div>
                      </details>
                    )}
                  </li>
                ) : (
                  <li key={st.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-3 py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] text-gray-400">—</span>
                    <span className="w-28 shrink-0 text-sm font-medium text-gray-400">{st.label}</span>
                    <span className="text-xs text-gray-400">not recorded</span>
                  </li>
                )
              ))}
            </ol>
          </Card>
        </div>
      )}
    </Shell>
  );
}
