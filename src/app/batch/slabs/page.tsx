import { Shell } from "@/components/Shell";
import { Card, H2, Empty, Badge, fmt } from "@/components/ui";
import { BackButton } from "@/components/BackButton";
import { getStationSlabs, getMissingSlabs, STATION_LABEL, type SlabStation } from "@/lib/erp";
import Link from "next/link";
import { RectifyButton, AddAllMissingButton, DeleteRowButton, MarkSkippedButton, UnskipButton } from "./SlabActions";
import { slabLabel } from "@/lib/slabLabel";
import { isManager } from "@/lib/rbac";
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
  searchParams: Promise<{ b?: string; station?: string; only?: string }>;
}) {
  const { b, station: stationRaw, only } = await searchParams;
  const batch = b?.trim();
  const station = (STATIONS.includes(stationRaw as SlabStation) ? stationRaw : "press") as SlabStation;
  const missingMode = only === "missing";
  const dupMode = only === "dup";

  let lastAct = null;
  if (batch) { try { lastAct = await getLastUndoable(batch); } catch { /* action_log not migrated yet */ } }
  const canDelete = batch ? await isManager() : false;

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
              {isFix(station) && <AddAllMissingButton batch={batch} station={station} />}
            </div>
            <p className="mb-3 text-sm text-gray-600">
              Slabs present elsewhere in the batch but with no {m.label} record. <strong>Add &amp; verify</strong> creates the slab (weight = batch average); <strong>Mark as skipped</strong> records that the number was never produced so it stops showing as missing.
            </p>
            {m.skipped.length > 0 && (
              <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-500">
                <span className="font-medium">Skipped (not counted as missing):</span>
                {m.skipped.map((n) => (
                  <span key={n} className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5">{slabLabel(n)}<UnskipButton batch={batch} slab={n} /></span>
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
                        {isFix(station) && <Link href={`/batch/slabs/add?b=${encodeURIComponent(batch)}&station=${station}&slab=${r.slab}`} className="rounded-md border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/5">Add &amp; verify</Link>}
                        <MarkSkippedButton batch={batch} slab={r.slab} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        );
      } else {
        const list = await getStationSlabs(batch, station, dupMode);
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
              {dupMode && isFix(station) && list.dupSlabs.length > 0 && (
                <RectifyButton batch={batch} station={station} />
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
      {lastAct && <UndoLastButton batch={batch} label={lastAct.summary} by={lastAct.actor} at={lastAct.createdAt} />}
      {!error && paramLog && <div className="mb-6"><StationParamLog log={paramLog} /></div>}
      {!error && mixerLog && <div className="mb-6"><MixerCycleFlags log={mixerLog} /></div>}
      {error ? <Empty>{error}</Empty> : body}
    </Shell>
  );
}
