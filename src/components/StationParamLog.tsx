import { Card, H2, Badge } from "@/components/ui";
import { STATION_LABEL } from "@/lib/erp";
import type { StationParamLog as Log, ParamRow } from "@/lib/stationParams";

function changeNote(p: ParamRow): string {
  const xs = p.segments.slice(1).map((s) => s.fromSlab).filter((n): n is number => typeof n === "number");
  return xs.length ? `from slab ${xs.join(", ")}` : "changed mid-batch";
}

function ParamCell({ p }: { p: ParamRow }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${p.changed ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{p.label}</div>
      {p.changed ? (
        <>
          <div className="mt-0.5 text-sm font-semibold text-amber-700">{p.segments.map((s) => s.value).join("  →  ")}</div>
          <div className="mt-0.5 text-[11px] text-amber-600">{changeNote(p)}</div>
        </>
      ) : (
        <div className="mt-0.5 text-sm font-semibold text-gray-900">{p.segments[0].value}</div>
      )}
    </div>
  );
}

export function StationParamLog({ log }: { log: Log }) {
  const has = log.groups.length > 0;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <H2>Parameter changes · {STATION_LABEL[log.station]} · Batch {log.key}</H2>
        {log.changedCount > 0 ? (
          <Badge tone="amber">{log.changedCount} changed mid-batch</Badge>
        ) : has ? (
          <Badge tone="green">Steady across {log.slabs} slabs</Badge>
        ) : null}
      </div>
      <p className="mb-4 text-sm text-gray-600">
        Settings that should hold for the whole batch.{" "}
        <span className="font-medium text-amber-700">Amber</span> = a value changed partway through this batch (full timeline shown).
      </p>

      {!has && <p className="text-sm text-gray-400">No machine parameters recorded for this batch.</p>}

      <div className="space-y-4">
        {log.groups.map((g) => (
          <div key={g.title}>
            <div className="mb-2 flex items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">{g.title}</div>
              {g.changed > 0 && <Badge tone="amber">{g.changed} changed</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {g.params.map((p) => <ParamCell key={p.key} p={p} />)}
            </div>
          </div>
        ))}
      </div>

      {log.notRecorded.length > 0 && (
        <p className="mt-3 text-[11px] text-gray-400">{log.notRecorded.length} parameter(s) not recorded this batch.</p>
      )}
    </Card>
  );
}
