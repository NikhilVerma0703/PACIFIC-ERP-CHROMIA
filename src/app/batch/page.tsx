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
import { detectWrongBatch, type WrongBatchGroup } from "@/lib/batchMismatch";
import { detectSharedMixRun } from "@/lib/mixerSharing";
import { confirmedSplitAllocation } from "@/lib/mixerFifo";
import { pendingRmAllocation } from "@/app/batch/rmHealActions";
import { AutoHealRm } from "./AutoHealRm";
import { thicknessMixByBatch, type BatchMix } from "@/lib/slabThickness";
import { WrongBatchFix } from "@/components/WrongBatchFix";
import { SlabMismatchPill } from "./SlabMismatchPill";
import { MixerSection } from "./MixerSection";
import { SharedMixNotice } from "./SharedMixNotice";
import { canRectify, isManager } from "@/lib/rbac";
import { currentBranchName, type BranchName } from "@/lib/branch";
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
  searchParams: Promise<{ b?: string; d?: string; solo?: string }>;
}) {
  const { b, d, solo: soloRaw } = await searchParams;
  const query = b?.trim();
  const designQuery = d?.trim();
  // ?solo=1 — show this batch on its own, excluding its design-switch sub-batches.
  const scope = { solo: soloRaw === "1" };

  let data = null;
  let matches = null;
  let error: string | null = null;
  if (query) {
    try {
      data = await getBatch(query, scope);
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
  let sharedMix: Awaited<ReturnType<typeof detectSharedMixRun>> = null;
  let split: Awaited<ReturnType<typeof confirmedSplitAllocation>> = null;
  let rmPending = 0;
  // Per-batch 2cm/3cm split for the family chips. Same resolver the production report and
  // the Telegram bot use, counted over each batch's PRESS slabs — so it adds up to the
  // slab count already shown on the chip.
  let thickByBatch = new Map<string, BatchMix>();
  let mayFix = false;
  let canManage = false;
  // Rectify actions carry TWO gates (rank AND branch); this page needs the branch as
  // well as the rank so it never offers an action the action itself would refuse.
  // Defaults to "" so a failed read fails closed rather than assuming Shop Floor.
  // Typed (not plain string) so a typo in the branch literal below is a compile error.
  let branch: BranchName | "" = "";
  if (query && data?.found) {
    // mixer cycles / silo bags follow the same call the totals made: when the mix is
    // only stamped on the parent key, a solo view still shows it family-wide (labelled).
    const mixScope = { solo: scope.solo && !data.family.mixFamilyWide };
    if (data.family.keys.length > 1) {
      try { thickByBatch = await thicknessMixByBatch(data.family.keys); } catch { /* chips degrade to slab count only */ }
    }
    try { [mixerCycles, silos, wrongBatch, mayFix, canManage, branch, sharedMix, split, rmPending] = await Promise.all([getMixerCycles(query, mixScope), getSiloBags(query, mixScope), detectWrongBatch(query), canRectify(), isManager(), currentBranchName(), detectSharedMixRun(query, data.family), confirmedSplitAllocation(query), pendingRmAllocation(query)]); } catch { /* ignore */ }
  }

  // The split view takes over ONLY when its own figure is computable — one provenance
  // everywhere. Half-switched pages (allocated Mix KPI beside a label-scoped pill)
  // would be worse than either view alone.
  const splitView = split && split.wastagePct != null ? split : null;

  // EVERY rectify control on this page drives a WRITE gated on incharge-and-above AND the
  // Shop Floor branch — RM heal, undo, blank-row removal, range edits, mix split, design
  // reconcile, wrong-batch moves. canRectify() alone is not that gate: Office
  // FINANCE/ACCOUNTS are rank INCHARGE, so they pass it and would be offered work the
  // action then refuses ("Production data can only be rectified from the Shop Floor
  // branch"). Mirror BOTH gates once, here, and gate every control on it. Where a control
  // is withheld the count or status behind it still renders, naming who can act.
  const mayRectifyHere = mayFix && branch === "SHOP_FLOOR";

  // "2 cm 589 · 3 cm 69" for a family chip — biggest first, unrecorded slabs shown last so
  // the parts always add up to the chip's slab count.
  const thickMix = (key: string): string => {
    const m = thickByBatch.get(key);
    if (!m || !m.total) return "";
    const parts = [...m.mix.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${fmt(n)}`);
    if (m.noThickness) parts.push(`no thk ${fmt(m.noThickness)}`);
    return parts.join(" · ");
  };

  // Wrong-batch groups whose counterpart is the CONFIRMED-alternating partner are
  // switch-boundary smear (expected from the constant switching) — shown calm, below the
  // shared-mix notice. Everything else keeps the red alarm.
  const partnerKeys = new Set(sharedMix?.partners ?? []);
  const isBoundary = (g: WrongBatchGroup) => partnerKeys.has(g.direction === "foreign" ? g.toBatchKey : (normalizeBatch(g.fromBatch) ?? ""));
  const alertGroups = (wrongBatch?.groups ?? []).filter((g) => !isBoundary(g));
  const boundaryGroups = (wrongBatch?.groups ?? []).filter(isBoundary);

  // Build a drill-down href for the current batch.
  const slab = (station: string, only?: string) =>
    `/batch/slabs?b=${encodeURIComponent(query ?? "")}&station=${station}${only ? `&only=${only}` : ""}${scope.solo ? "&solo=1" : ""}`;

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
          {lastAct && <UndoLastButton batch={query} label={lastAct.summary} by={lastAct.actor} at={lastAct.createdAt} mayUndo={mayRectifyHere} />}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">Batch {data.key}</h1>
            {data.design.primary && !data.design.discrepancy && (
              <Badge tone="brand">Design: {data.design.primary}</Badge>
            )}
            {data.design.discrepancy && <Badge tone="red">⚠ Design mismatch</Badge>}
            {data.slabsProduced.discrepancy && <SlabMismatchPill batch={query ?? ""} blankTotal={data.slabAudit.blankTotal} canManage={canManage && mayRectifyHere} />}
            {!data.slabAudit.hasIssues && data.slabAudit.stations.length > 0 && (
              <Badge tone="green">✓ Slabs reconciled</Badge>
            )}
            {data.slabAudit.hasIssues && <Badge tone="red">⚠ Slab discrepancies</Badge>}
            {unbacked && <Badge tone="red">⚠ Unbacked RM — silo/tank fill pending, auto-links on fill</Badge>}
            {rmPending > 0 && <Badge tone="amber">⚠ {rmPending} cycle(s) with grit/filler not yet deducted — {mayRectifyHere ? "re-linking now" : "an incharge can re-link this"}</Badge>}
            {splitView ? (
              <WastagePill pct={splitView.wastagePct as number} kg={splitView.wastageKg} mixWeight={splitView.allocKg} slabWeight={splitView.slabKg} />
            ) : (data.wastagePct != null && !data.family.mixFamilyWide && (
              <WastagePill pct={data.wastagePct} kg={data.wastageKg} mixWeight={data.totalMixWeight} slabWeight={data.totalSlabWeight} />
            ))}
          </div>

          {/* The batch report saw its own cycles with undeducted grit/filler: heal exactly
              those, automatically — the Live Status sweep stays the global admin backstop.
              Only for someone who can actually rectify FROM THIS BRANCH: healBatchRm refuses
              anyone else on both counts, so rendering it for an Office incharge would just
              announce a heal and then refuse it. Mirrors both of its gates — see mayRectifyHere. */}
          {rmPending > 0 && mayRectifyHere && <AutoHealRm batch={query ?? ""} pending={rmPending} />}

          {/* A confirmed split makes per-batch material knowable again: each shared cycle's
              kg divided by slab-mass share. Reads only what the confirm wrote; Undo removes
              the links and this line (and the figures above) fall back on their own. */}
          {splitView && (
            <p className="text-xs text-gray-500">
              Mix weight and wastage are this batch&apos;s share of the <b>confirmed shared-mix split</b> with{" "}
              {splitView.group.slice(1).join(", ")} ({splitView.cycles} shared cycles · {Math.round(splitView.coverage * 100)}% of this batch&apos;s line-head rows linked
              {splitView.perBatch.length > 1 ? `; ${splitView.perBatch.map((b) => `${b.key} ${b.wastagePct == null ? "n/a" : b.wastagePct.toFixed(1) + "%"}`).join(" · ")}` : ""}) —{" "}
              <a href="#rect-history" className="underline decoration-dotted underline-offset-2 hover:text-brand">rectification history</a> has the confirm and its Undo.
            </p>
          )}

          {data.family.keys.length > 1 && (
            <div className="rounded-xl border border-brand/20 bg-brand/[0.04] px-4 py-3 text-sm">
              <div className="mb-2 font-medium text-gray-700">
                {data.family.isSub ? (
                  <>
                    Showing <span className="font-semibold">{data.key}</span> only — a design-switch sub-batch of {data.family.parent}. Everything below is this sub-batch alone.{" "}
                    <Link href={`/batch?b=${encodeURIComponent(data.family.parent)}`} className="underline hover:text-brand">View the whole family →</Link>
                  </>
                ) : data.family.solo ? (
                  <>
                    Showing <span className="font-semibold">{data.key}</span> only — its {data.family.keys.length - 1} design-switch sub-batch{data.family.keys.length - 1 === 1 ? " is" : "es are"} excluded from the slab totals below.{" "}
                    {data.family.mixFamilyWide && <span className="text-gray-600">Mix weight, mixer cycles and silo bags are only logged against {data.family.parent}, so those stay family-wide and wastage % is hidden here. </span>}
                    <Link href={`/batch?b=${encodeURIComponent(data.family.parent)}`} className="underline hover:text-brand">View the whole family →</Link>
                  </>
                ) : (
                  <>Batch family — the totals below include {data.family.keys.length - 1} design-switch sub-batch{data.family.keys.length - 1 === 1 ? "" : "es"}. Click a batch to see it on its own:</>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {data.family.members.map((m) => {
                  // The parent chip opens the solo view (itself, sub-batches excluded);
                  // a sub-batch already stands alone.
                  const isParent = m.key === data.family.parent;
                  const href = `/batch?b=${encodeURIComponent(m.key)}${isParent ? "&solo=1" : ""}`;
                  const active = m.key === data.key && (isParent ? data.family.solo : data.family.isSub);
                  return (
                    <Link key={m.key} href={href} className={`rounded-lg border px-3 py-1.5 transition hover:border-brand/40 ${active ? "border-brand/40 bg-white ring-1 ring-brand/30" : "border-gray-200 bg-white"}`}>
                      <span className="font-semibold">{m.key}</span>{m.design ? <span className="text-gray-500"> · {m.design}</span> : ""}<span className="text-gray-400"> · {fmt(m.slabs)} slabs</span>
                      {thickMix(m.key) && <span className="text-gray-500"> · {thickMix(m.key)}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {data.slabAudit.range && (
            // Batches WITHOUT sub-batches have no family chip bar, so their 2cm/3cm split
            // shows here on the range card instead (same resolver, already computed).
            <RangeControls batch={query ?? ""} batchKey={data.key} min={data.slabAudit.range.min} max={data.slabAudit.range.max} missing={data.slabAudit.globalMissing.length} confirmed={data.slabAudit.confirmed} mayEdit={mayRectifyHere}
              thickness={data.family.keys.length <= 1 ? data.thickness.map((x) => `${x.label === "not recorded" ? "no thk" : x.label} ${fmt(x.count)}`).join(" · ") || undefined : undefined} />
          )}

          {data.design.discrepancy && (
            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <H2>⚠ Multiple design names in this batch</H2>
                {/* Worst case of the whole set: getDesignFix is rank-only, so an Office
                    incharge got a working form, picked a design, and was refused only on
                    submit. The link is gated here AND the page guards itself. */}
                {mayRectifyHere
                  ? <Link href={`/batch/design?b=${encodeURIComponent(query ?? "")}`} className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">Reconcile design →</Link>
                  : <span className="text-xs text-gray-500">An incharge on the Shop Floor branch can reconcile this.</span>}
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
          {alertGroups.length > 0 && (
            <WrongBatchFix groups={alertGroups} mayEdit={mayRectifyHere} viewedBatch={query ?? ""} />
          )}

          {/* One mixer run feeding several line batches — evidence only, needs confirming */}
          {sharedMix && <SharedMixNotice r={sharedMix} mayFix={mayRectifyHere} batch={query ?? ""} split={!!splitView} />}

          {boundaryGroups.length > 0 && (
            <WrongBatchFix groups={boundaryGroups} mayEdit={mayRectifyHere} viewedBatch={query ?? ""} expectedWith={sharedMix?.partners.join(", ") ?? ""} />
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
              <Kpi label="Mix weight (kg)" value={fmt(splitView ? splitView.allocKg : data.totalMixWeight)} sub={splitView ? `share of ${splitView.cycles} shared cycles — confirmed split` : data.family.mixFamilyWide ? `${data.counts.mixer} mixer cycles · whole family` : `${data.counts.mixer} mixer cycles`} />
            </Link>
            <Link href={slab("press")} className="block h-full rounded-xl transition hover:ring-2 hover:ring-brand/30">
              <Kpi label="Slab weight (kg)" value={fmt(data.totalSlabWeight)} sub={splitView ? `press-label total · wastage ${fmt(splitView.wastageKg)} kg from confirmed split` : data.family.mixFamilyWide ? "wastage n/a — mix is family-wide" : `wastage ${fmt(data.wastageKg)} kg`} />
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
              <H2>Thickness mix</H2>
              {data.thickness.length ? <HBars data={data.thickness} /> : <Empty>No slabs with a thickness.</Empty>}
            </Card>
          </div>

          <MixerSection cycles={mixerCycles} silos={silos} mixerListHref={slab("mixer")} />


          {history.length > 0 && (
            <div id="rect-history">
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
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}
