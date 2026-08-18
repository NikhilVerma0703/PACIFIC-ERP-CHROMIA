import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, H2, Kpi, Empty, Badge, fmt } from "@/components/ui";
import { HBars, gradeColor } from "@/components/charts";
import { getBatch, type BatchData } from "@/lib/erp";
import { getBatchQcSlabs, type BatchQcSlab } from "@/lib/batchQcList";
import { QcSlabsTable } from "./QcSlabsTable";
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
 *   totalMixWeight, wastageKg, wastagePct, perMixer, counts.mixer, totalSlabWeight
 *     -- RM consumption and yield. /batch shows these as the Mix weight, Slab
 *        weight and Per-mixer weight cards; they are omitted here on purpose,
 *        not by oversight. Mix weight together with wastage reveals material
 *        cost per slab and yield efficiency, and Commercial has no RM card
 *        anywhere in the app.
 *   slabsProduced.discrepancy
 *     -- the "mismatch" flag /batch appends to its Slabs-produced sub-line. It is
 *        a rectification signal, same class as slabAudit below, so this page's
 *        sub-line stops after Jot. Do not widen the projection to restore it.
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
  /** Per-slab QC rows. Not from BatchData -- getBatch() aggregates polish_qc into
   *  grade counts and keeps no slab numbers -- so this arrives from the separate
   *  narrow reader in lib/batchQcList.ts, which is itself a closed shape. */
  qcSlabs: BatchQcSlab[];
}

function project(data: BatchData, qcSlabs: BatchQcSlab[]): CommercialBatchView {
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
    qcSlabs,
  };
}

function stageCount(perStation: CommercialBatchView["perStation"], label: string): number {
  return perStation.find((s) => s.label === label)?.count ?? 0;
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
  let qcListFailed = false;
  if (query) {
    try {
      const data = await getBatch(query);
      found = data.found;
      // Only fetch the per-slab list once the batch is known to exist, and only for a
      // batch we are actually going to render. Its failure is caught separately: the
      // list is an addition to this page, so losing it must not cost the cards too.
      if (data.found) {
        let qcSlabs: BatchQcSlab[] = [];
        try {
          qcSlabs = await getBatchQcSlabs(query);
        } catch (e) {
          // Never break the page, but never fail silently either: the UI reports this
          // and the server trace is the only way to find out why.
          console.error("batch-lookup: getBatchQcSlabs failed", e);
          qcListFailed = true;
        }
        view = project(data, qcSlabs);
      }
    } catch (e) {
      console.error("batch-lookup: getBatch failed", e);
      error = "Could not read the database.";
    }
  }

  // Keyed by slab, not by row: a slab QC'd twice holds two rows, and counting rows would
  // report it as two dispatched slabs. Measured on the live DB (2026-07-21) there are
  // real duplicates, so this is not hypothetical.
  const statusBySlab = new Map<number, string | null>();
  if (view) for (const s of view.qcSlabs) statusBySlab.set(s.slab, s.status);
  const distinctSlabs = statusBySlab.size;
  const dispatched = [...statusBySlab.values()].filter((v) => v === "DISPATCHED").length;
  // fg_finished_slab is a stock LEDGER, not a history of every slab ever QC'd -- it holds
  // ~19% of QC'd slab numbers, and the gap is spread across the whole batch range rather
  // than sitting behind a date cutoff (measured: batches at >90% coverage span 845-1387,
  // batches at <10% span 370-1364). Count it so the column can explain itself instead of
  // looking broken, but do NOT explain it as a cutoff -- that is not what the data shows.
  const noLedger = [...statusBySlab.values()].filter((v) => v === null).length;

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
          {/* Mirrors the /batch KPI grid, minus the three RM/yield cards (Mix weight,
              Slab weight, Per-mixer weight). None of the cards below is a link: /batch,
              /batch/slabs and /tables are all blocked for COMMERCIAL in middleware, so
              the drill-downs /batch wraps around these same Kpis would only bounce. */}
          <div className="mb-6 grid grid-cols-2 items-stretch gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Batch" value={displayBatch(view.key)} />
            <Kpi
              label="Design"
              value={view.design ?? "—"}
              sub={view.designDiscrepancy ? `${view.designs.length} conflicting` : "single design"}
            />
            <Kpi
              label="Slabs produced"
              value={fmt(view.slabs)}
              sub={`Press ${fmt(stageCount(view.perStation, "Press"))} · Oven ${fmt(stageCount(view.perStation, "Oven"))} · Jot ${fmt(stageCount(view.perStation, "Jot"))}`}
            />
            <Kpi label="Polish entries" value={fmt(stageCount(view.perStation, "Polish Entry"))} />
            <Kpi label="Polish QC" value={fmt(stageCount(view.perStation, "Polish QC"))} />
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

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <H2>QC grade distribution</H2>
              {/* No `links` prop: /batch sends these bars to /tables/PolishQc, which is
                  blocked for COMMERCIAL by middleware AND by canSeeModel. */}
              {view.qcGrades.length ? (
                <HBars data={view.qcGrades} colorFor={gradeColor} />
              ) : (
                <Empty>No QC rows.</Empty>
              )}
            </Card>
            <Card>
              <H2>Thickness mix</H2>
              {view.thickness.length ? (
                <HBars data={view.thickness} />
              ) : (
                <Empty>No slabs with a thickness.</Empty>
              )}
            </Card>
          </div>

          {/* Gated on the Polish QC count OR a non-empty list: the KPI alone would drop the
              card if a QC row landed between the two reads, and the list alone would drop it
              for a batch whose QC rows carry no slab number. */}
          {(stageCount(view.perStation, "Polish QC") > 0 || view.qcSlabs.length > 0 || qcListFailed) && (
            <Card className="mb-6">
              <H2>QC slabs</H2>
              {qcListFailed ? (
                // The counts below are derived from the list, so on a failed read they are
                // NOT merely unaffected -- they would all read zero. Replace them outright
                // rather than print zeros next to a non-zero Polish QC card.
                <p className="text-sm text-amber-700">
                  The per-slab QC list could not be read just now. The Polish QC count above is
                  unaffected — reload to try again.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-gray-600">
                    {fmt(distinctSlabs)} slab{distinctSlabs === 1 ? "" : "s"} with a QC record
                    {view.qcSlabs.length !== distinctSlabs
                      ? ` · ${fmt(view.qcSlabs.length)} QC rows (some slabs were QC'd more than once)`
                      : ""}
                    {" · "}
                    {fmt(dispatched)} dispatched
                    {noLedger > 0 ? ` · ${fmt(noLedger)} not in the finished-goods ledger` : ""}.
                    Status is the live finished-goods record; dispatching is done from Inventory,
                    which records the PI, customer and invoice.
                    {noLedger > distinctSlabs / 2 && (
                      <> The ledger covers slabs tracked as finished stock, which is a subset of
                      everything ever produced — coverage of older batches is partial.</>
                    )}
                  </p>
                  {view.qcSlabs.length === 0 ? (
                    <Empty>No QC rows with a slab number.</Empty>
                  ) : (
                    // Filtering lives in the client component: every row is already in this
                    // payload, so it is pure state — no navigation, no round trip. It receives
                    // BatchQcSlab[], the closed shape projected above, and nothing else.
                    <QcSlabsTable rows={view.qcSlabs} />
                  )}
                </>
              )}
            </Card>
          )}

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
