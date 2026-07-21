import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Empty, Badge, fmt } from "@/components/ui";
import { getBatch, type BatchData } from "@/lib/erp";
import { currentBranchName } from "@/lib/branch";
import { displayBatch } from "@/lib/batchDisplay";
import { slabLabel } from "@/lib/slabLabel";

export const dynamic = "force-dynamic";

/** The ONLY fields of BatchData this page is allowed to render.
 *
 * This page exists because /batch is not safe to hand to Commercial. That page
 * grew process detail over time -- StationParamLog (every machine setting per
 * station, plus the mid-batch change timeline), MixerCycleFlags and MixerSection
 * (silo numbers, bag and invoice numbers, suppliers, grades, per-cycle
 * grit/filler/resin kg) -- and each addition was visible to anyone the route
 * allowed. Gating those component-by-component is opt-OUT: the next block added
 * to /batch leaks until somebody remembers to gate it, which is exactly how the
 * process detail got there in the first place.
 *
 * So this view projects an explicit allowlist instead. Nothing reaches the JSX
 * that is not named here, which makes the safe set opt-IN: a new field on
 * BatchData cannot appear on this page by being added upstream. Keep it that
 * way -- widen this projection deliberately, never render `data` directly.
 *
 * Deliberately excluded, and why:
 *   totalMixWeight, wastageKg, wastagePct, perMixer, counts.mixer
 *     -- RM and yield. Commercial has no RM card anywhere in the app.
 *   slabAudit.stations, .globalMissing, .notes, .blankRows, .hasIssues, .added, .skipped
 *     -- rectification signals. Commercial cannot rectify (rank 1 fails
 *        canRectify()), so these are noise they cannot act on.
 *   design.bySource
 *     -- which table stamped which design is a data-quality detail.
 */
interface CommercialBatchView {
  key: string;
  design: string | null;
  designs: string[];
  designDiscrepancy: boolean;
  thickness: { label: string; count: number }[];
  qcGrades: { label: string; count: number }[];
  slabs: number;
  perStation: { label: string; count: number }[];
  range: { min: number; max: number } | null;
  family: { key: string; design: string | null; slabs: number }[];
}

function project(data: BatchData): CommercialBatchView {
  return {
    key: data.key,
    design: data.design.primary,
    designs: data.design.designs,
    designDiscrepancy: data.design.discrepancy,
    thickness: data.thickness,
    qcGrades: data.qcGrades,
    slabs: data.slabsProduced.value,
    // Station presence only -- how far the batch got. No machine parameters.
    perStation: [
      { label: "Press", count: data.slabsProduced.press },
      { label: "Oven", count: data.slabsProduced.oven },
      { label: "Jot", count: data.slabsProduced.jot },
      { label: "Polish Entry", count: data.counts.polishEntry },
      { label: "Polish QC", count: data.counts.polishQc },
    ],
    range: data.slabAudit.range,
    family: data.family.members.map((m) => ({ key: m.key, design: m.design, slabs: m.slabs })),
  };
}

export default async function OfficeBatchLookup({
  searchParams,
}: {
  searchParams: Promise<{ b?: string }>;
}) {
  // Office branch only. Shop Floor keeps the full /batch page; this view exists
  // to be the Office-side substitute for it, not a second way in.
  if ((await currentBranchName()) !== "OFFICE") redirect("/");

  const { b } = await searchParams;
  const query = b?.trim();

  let view: CommercialBatchView | null = null;
  let found = false;
  let error: string | null = null;
  if (query) {
    try {
      const data = await getBatch(query);
      found = data.found;
      if (data.found) view = project(data);
    } catch {
      error = "Could not read the database.";
    }
  }

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Batch Lookup</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Read-only. Design, thickness, quality and slab counts for a finished batch. Process
          parameters and raw-material composition are recorded on the shop floor.
        </p>
      </div>

      <Card className="mb-6">
        <form method="GET" className="flex gap-2">
          <input
            name="b"
            defaultValue={query ?? ""}
            placeholder="Batch (e.g. D1310 or 1310)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
            Look up
          </button>
        </form>
      </Card>

      {error && <Empty>{error}</Empty>}
      {!error && query && !found && <Empty>No batch matches “{displayBatch(query)}”.</Empty>}

      {view && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Batch" value={displayBatch(view.key)} />
            <Kpi label="Design" value={view.design ?? "—"} />
            <Kpi label="Slabs" value={fmt(view.slabs)} />
            <Kpi
              label="Slab range"
              value={view.range ? `${slabLabel(view.range.min)}–${slabLabel(view.range.max)}` : "—"}
            />
          </div>

          {/* getBatch() defaults to the whole family, so a parent's totals include its
              design-switch sub-batches. Say so next to the numbers rather than leaving it
              to be inferred from the Related batches card at the bottom — these are the
              figures Commercial quotes outward. /batch carries the same caveat. */}
          {view.family.length > 1 && (
            <p className="-mt-3 mb-6 text-sm text-gray-500">
              Totals above cover the whole run — this batch plus its{" "}
              {view.family.length - 1} design-switch sub-batch
              {view.family.length - 1 === 1 ? "" : "es"}, listed below.
            </p>
          )}

          {view.designDiscrepancy && (
            <div className="mb-6">
              <Badge tone="amber">
                ⚠ More than one design recorded on this batch: {view.designs.join(", ")}
              </Badge>
            </div>
          )}

          {view.qcGrades.length > 0 && (
            <Card className="mb-6">
              <H2>Quality</H2>
              <div className="mt-3 flex flex-wrap gap-2">
                {view.qcGrades.map((g) => (
                  <span key={g.label} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700">
                    {g.label} · <span className="font-medium">{fmt(g.count)}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}

          {view.thickness.length > 0 && (
            <Card className="mb-6">
              <H2>Thickness</H2>
              <div className="mt-3 flex flex-wrap gap-2">
                {view.thickness.map((t) => (
                  <span key={t.label} className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700">
                    {t.label} · <span className="font-medium">{fmt(t.count)}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}

          <Card className="mb-6">
            <H2>Progress</H2>
            <p className="mb-3 text-sm text-gray-600">Slabs recorded at each stage.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-4">Stage</th>
                    <th className="py-2">Slabs</th>
                  </tr>
                </thead>
                <tbody>
                  {view.perStation.map((s) => (
                    <tr key={s.label} className="border-t border-gray-100">
                      <td className="py-2 pr-4">{s.label}</td>
                      <td className="py-2">{fmt(s.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {view.family.length > 1 && (
            <Card>
              <H2>Related batches</H2>
              <p className="mb-3 text-sm text-gray-600">Design-switch sub-batches of the same run.</p>
              <div className="flex flex-wrap gap-2">
                {view.family.map((m) => (
                  <Link
                    key={m.key}
                    href={`/office/batch-lookup?b=${encodeURIComponent(m.key)}`}
                    className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-200"
                  >
                    {displayBatch(m.key)}
                    {m.design ? ` · ${m.design}` : ""} · {fmt(m.slabs)} slab(s)
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </Shell>
  );
}
