import { Card, H2, Badge } from "@/components/ui";
import type { MixerCycleLog } from "@/lib/stationParams";

export function MixerCycleFlags({ log }: { log: MixerCycleLog }) {
  const n = log.flagged.length;
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <H2>Mix composition · Batch {log.key}</H2>
        {n > 0 ? (
          <Badge tone="amber">{n} cycle{n === 1 ? "" : "s"} shifted ≥3 kg</Badge>
        ) : (
          <Badge tone="green">Steady across {log.totalCycles} cycles</Badge>
        )}
      </div>
      <p className="mb-4 text-sm text-gray-600">
        Cycles where grit, filler or resin moved <span className="font-medium">≥3 kg</span> from the previous cycle — a recipe/composition change worth noting.
      </p>

      {n === 0 ? (
        <p className="text-sm text-gray-500">No ≥3 kg composition change across {log.totalCycles} cycles.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {log.flagged.map((f) => (
            <div key={f.cycle} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <div className="text-sm font-semibold text-amber-800">Cycle {f.cycle}</div>
              <div className="mt-0.5 text-sm text-amber-700">
                {f.changes.map((c) => `${c.what} ${c.delta > 0 ? "+" : ""}${c.delta} kg`).join("  ·  ")}
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500">now: grit {f.grit} · filler {f.filler} · resin {f.resin} kg</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
