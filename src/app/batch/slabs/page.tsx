import { Shell } from "@/components/Shell";
import { Card, H2, Empty, Badge, fmt } from "@/components/ui";
import { BackButton } from "@/components/BackButton";
import { getStationSlabs, getMissingSlabs, STATION_LABEL, type SlabStation } from "@/lib/erp";
import Link from "next/link";
import { RectifyButton, AddAllMissingButton, DeleteRowButton, MarkSkippedButton, UnskipButton } from "./SlabActions";
import { slabLabel } from "@/lib/slabLabel";
import { isManager, canRectify } from "@/lib/rbac";
import { currentBranchName, type BranchName } from "@/lib/branch";
import { UndoLastButton } from "../UndoLastButton";
import { getLastUndoable } from "../undo";
import { getStationParamLog, getMixerCycleLog } from "@/lib/stationParams";
import { StationParamLog } from "@/components/StationParamLog";
import { MixerCycleFlags } from "@/components/MixerCycleFlags";

export const dynamic = "force-dynamic";

const STATIONS: SlabStation[] = ["press", "distributor", "kreos", "oven", "jot", "polishEntry", "polishQc", "mixer"];
type FixStation = "press" | "distributor" | "kreos" | "oven" | "jot" | "polishEntry" | "polishQc";
const isFix = (s: SlabStation): s is FixStation => s !== "mixer";

function fmtClock(secs: number): string {
  const s = Math.round(secs);
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function cell(v: unknown, kind?: "date" | "num" | "duration"): string {
  if (v == null || v === "") return "—";
  if (kind === "duration" && typeof v === "number" && Number.isFinite(v)) return fmtClock(v);
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
  if (kind === "num" && typeof v === "number") return fmt(v);
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default async function SlabsPage({
  searchParams,
}: {
  searchParams: Promise<{ b?: string; station?: string; only?: string; solo?: string }>;
}) {
  const { b, station: stationRaw, only, solo } = await searchParams;
  const batch = b?.trim();
  const station = (STATIONS.includes(stationRaw as SlabStation) ? stationRaw : "press") as SlabStation;
  const missingMode = only === "missing";
  const dupMode = only === "dup";
  // mirror the scope the batch page was showing, so the drill-down searches the same set
  const scope = { solo: solo === "1" };

  let lastAct = null;
  if (batch) { try { lastAct = await getLastUndoable(batch); } catch { /* action_log not migrated yet */ } }
  // The controls below call actions that gate on rank AND the Shop Floor branch, so
  // offering them to anyone failing either is a form that refuses on submit. FINANCE and
  // ACCOUNTS are who this actually hit: rank 2, OFFICE branch, never capped for /batch.
  //
  // Defaults to "" so a failed READ fails closed rather than assuming Shop Floor. Typed
  // (not plain string) so a typo in the branch literal below is a compile error — both
  // straight from /batch/page.tsx.
  //
  // Note what does NOT protect us here: currentBranchName() does not throw for a null
  // user, it RETURNS "SHOP_FLOOR" (branchOf falls through), and middleware only validates
  // the edge JWT — so a deactivated user or a bumped sessionVersion reaches this line and
  // gets onShopFloor === true. What actually stops them is the rank half: rankOf("") is 0,
  // so canRectify() and isManager() both fail. That is why neither gate may be dropped.
  let branch: BranchName | "" = "";
  try { branch = await currentBranchName(); } catch { /* "" matches no branch */ }
  const onShopFloor = branch === "SHOP_FLOOR";
  const mayRectifyHere = onShopFloor && (batch ? await canRectify() : false);
  // deleteSlabRow gates on isManager() AND Shop Floor; canDelete had only the rank half.
  const canDelete = onShopFloor && (batch ? await isManager() : false);
  // Someone who has the RANK for deleteSlabRow but not the branch would otherwise just
  // stop seeing Delete with no explanation — that is the silent removal this whole change
  // exists to stop. Distinguished from a plain non-manager, who never had the control and
  // needs no note about it. OFFICE-branch ADMIN is the real case: admins sign into either.
  const deleteNeedsShopFloor = !onShopFloor && (batch ? await isManager() : false);

  // Process-parameter change-log for the station (Press/Oven/Distributor/Kreos only)
  let paramLog = null;
  let mixerLog = null;
  if (batch) {
    try {
      if (station === "mixer") mixerLog = await getMixerCycleLog(batch);
      else paramLog = await getStationParamLog(batch, station);
    } catch { /* params optional */ }
  }

  let body = null;
  let error: string | null = null;

  if (!batch) {
    body = <Empty>No batch specified.</Empty>;
  } else {
    try {
      if (missingMode) {
        const m = await getMissingSlabs(batch, station);
        body = (m.rows.length === 0 && m.skipped.length === 0) ? (
          <Empty>Nothing missing at {STATION_LABEL[station]} for batch {m.key}.</Empty>
        ) : (
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <H2>Missing at {m.label} — Batch {m.key} · {m.rows.length} slab(s)</H2>
              {isFix(station) && <AddAllMissingButton batch={batch} station={station} may={mayRectifyHere} />}
            </div>
            <p className="mb-3 text-sm text-gray-600">
              Slabs present elsewhere in the batch but with no {m.label} record. <strong>Add &amp; verify</strong> creates the slab (weight = batch average); <strong>Mark as skipped</strong> records that the number was never produced so it stops showing as missing.
            </p>
            {/* One note for every per-row control hidden below — Add & verify, Mark as
                skipped, and the un-skip chips — rather than a refusal repeated on each row.
                Deliberately NOT gated on m.rows.length: the un-skip chips render off
                m.skipped, so a batch with nothing missing but something skipped would
                otherwise lose those controls with nothing to explain it. Inside this Card
                rows or skipped is always non-empty, so this covers every hidden control. */}
            {!mayRectifyHere && (
              <p className="mb-3 text-sm text-gray-500">
                Adding, skipping and un-skipping are done by an incharge on the Shop Floor
                branch.
              </p>
            )}
            {m.skipped.length > 0 && (
              <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                <span className="font-medium">Skipped (not counted as missing):</span>
                {m.skipped.map((n) => (
                  <span key={n} className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5">{slabLabel(n)}<UnskipButton batch={batch} slab={n} may={mayRectifyHere} /></span>
                ))}
              </p>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-4">Slab #</th>
                  <th className="py-2 pr-4">Present in</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.slab} className="border-t border-gray-100">
                    <td className="py-2 pr-4 font-medium text-amber-700">{slabLabel(r.slab)}</td>
                    <td className="py-2 pr-4 text-gray-700">{r.presentIn.join(", ") || "—"}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-3">
                        {isFix(station) && mayRectifyHere && <Link href={`/batch/slabs/add?b=${encodeURIComponent(batch)}&station=${station}&slab=${r.slab}`} className="rounded-md border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5">Add &amp; verify</Link>}
                        <MarkSkippedButton batch={batch} slab={r.slab} may={mayRectifyHere} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      } else {
        const list = await getStationSlabs(batch, station, dupMode, scope);
        const dupSet = new Set(list.dupSlabs);
        body = list.rows.length === 0 ? (
          <Empty>No {list.label} records for batch {list.key}{dupMode ? " entered more than once" : ""}.</Empty>
        ) : (
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <H2>{list.label} — Batch {list.key} · {list.rows.length} row(s)</H2>
                {dupMode && <Badge tone="red">Duplicates only</Badge>}
                {!dupMode && list.dupSlabs.length > 0 && <Badge tone="red">{list.dupSlabs.length} duplicated</Badge>}
              </div>
              {deleteNeedsShopFloor && (
                <span className="text-xs text-gray-500">
                  Removing a row is done by a production manager on the Shop Floor branch.
                </span>
              )}
              {dupMode && isFix(station) && list.dupSlabs.length > 0 && (
                <RectifyButton batch={batch} station={station} may={mayRectifyHere} />
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    {list.columns.map((c) => <th key={c.key} className="py-2 pr-4">{c.label}</th>)}
                    <th className="py-2">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((row, i) => {
                    const id = row[list.idKey];
                    const isDup = typeof id === "number" && dupSet.has(id);
                    return (
                      <tr key={i} className={`border-t border-gray-100 ${isDup ? "bg-red-50" : ""}`}>
                        {list.columns.map((c) => (
                          <td key={c.key} className={`py-2 pr-4 ${c.key === list.idKey && isDup ? "font-medium text-red-600" : "text-gray-800"}`}>
                            {c.key === "slabNumber" ? slabLabel(Number(row[c.key])) : cell(row[c.key], c.kind)}{c.key === list.idKey && isDup ? " ⚠" : ""}
                          </td>
                        ))}
                        <td className="py-2">
                          <div className="flex items-center gap-3">
                            <Link href={`/tables/${list.model}/${String(row.id)}`} className="text-brand hover:underline">Edit</Link>
                            {canDelete && (
                              <DeleteRowButton
                                model={list.model}
                                id={String(row.id)}
                                batch={batch}
                                slabLabel={row[list.idKey] != null ? `slab ${String(row[list.idKey])}` : "blank-slab row"}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      }
    } catch {
      error = "Could not read the database. Run the import first (see README).";
    }
  }

  return (
    <Shell>
      <BackButton fallback={batch ? `/batch?b=${encodeURIComponent(batch)}` : "/batch"} />
      {lastAct && <UndoLastButton batch={batch} label={lastAct.summary} by={lastAct.actor} at={lastAct.createdAt} mayUndo={mayRectifyHere} />}
      {!error && paramLog && <div className="mb-6"><StationParamLog log={paramLog} /></div>}
      {!error && mixerLog && <div className="mb-6"><MixerCycleFlags log={mixerLog} /></div>}
      {error ? <Empty>{error}</Empty> : body}
    </Shell>
  );
}
