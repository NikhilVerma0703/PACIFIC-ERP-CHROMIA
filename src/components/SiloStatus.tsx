import Link from "next/link";
import { fmt } from "@/components/ui";
import type { SiloCard } from "@/lib/silo";

function tint(type: string | null): { card: string; bar: string } {
  const t = (type ?? "").toLowerCase();
  if (t.includes("cristobal")) return { card: "border-amber-200 bg-amber-50", bar: "bg-amber-400" };
  if (t.includes("quartz")) return { card: "border-sky-200 bg-sky-50", bar: "bg-sky-400" };
  return { card: "border-brand/20 bg-brand/[0.04]", bar: "bg-brand/50" };
}

function Material({ c }: { c: SiloCard }) {
  if (c.bags === 0) return <span className="text-[11px] text-gray-400">Empty</span>;
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] font-medium text-gray-800">{c.size ?? "—"}</div>
      <div className="text-[10px] text-gray-500">{[c.grade, c.type].filter(Boolean).join(" · ") || " "}</div>
      {c.supplier ? <div className="truncate text-[10px] text-gray-400" title={c.supplier}>{c.supplier}</div> : null}
    </div>
  );
}

export function SiloStatus({ grit, filler }: { grit: SiloCard[]; filler: SiloCard[] }) {
  const max = Math.max(1, ...grit.map((c) => c.remaining), ...filler.map((c) => c.remaining));
  const href = (s: string) => `/silo/${encodeURIComponent(s)}`;

  return (
    <div className="space-y-6">
      {/* Grit silos */}
      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Grit silos</h2>
          <span className="text-xs text-gray-400">{grit.filter((c) => c.bags > 0).length}/{grit.length} in use</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {grit.map((c) => {
            const t = c.remaining < 0
              ? { card: "border-red-300 bg-red-50", bar: "bg-red-400" }
              : c.active
                ? { card: "border-green-300 bg-green-50", bar: "bg-green-400" }
                : c.bags ? tint(c.type) : { card: "border-gray-200 bg-gray-50", bar: "bg-gray-300" };
            const pct = Math.round((c.remaining / max) * 100);
            return (
              <Link key={c.siloNo} href={href(c.siloNo)} className="group">
                <div className={`relative flex aspect-square flex-col overflow-hidden rounded-xl border p-2.5 transition group-hover:ring-2 group-hover:ring-brand/30 ${t.card}`}>
                  {c.bags > 0 && <div className={`pointer-events-none absolute inset-x-0 bottom-0 ${t.bar} opacity-20`} style={{ height: `${Math.max(5, pct)}%` }} />}
                  <div className="relative flex h-full flex-col">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-base font-bold text-gray-900">{c.siloNo}{c.active && <span title="running — activity in the last 30 min" className="h-2 w-2 animate-pulse rounded-full bg-green-500" />}</span>
                      {c.mixed && <span title="mixed material" className="rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-700">mix</span>}
                    </div>
                    <div className="mt-1 flex-1"><Material c={c} /></div>
                    {(c.bags > 0 || c.remaining < 0) && (
                      <div>
                        <div className={`text-xs font-semibold ${c.remaining < 0 ? "text-red-700" : "text-gray-900"}`}>{fmt(c.remaining)}<span className="text-[10px] font-normal text-gray-400"> kg</span></div>
                        <div className={`text-[10px] ${c.remaining < 0 ? "font-medium text-red-600" : "text-gray-400"}`}>{c.remaining < 0 ? "backfill needed" : `${c.bags} bag${c.bags > 1 ? "s" : ""}`}</div>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Filler buffer towers */}
      {filler.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Filler buffer silos</h2>
          <div className="flex flex-wrap gap-5">
            {filler.map((c) => {
              const t = c.remaining < 0
                ? { card: "border-red-300 bg-red-50", bar: "bg-red-400" }
                : c.active
                  ? { card: "border-green-300 bg-green-50", bar: "bg-green-400" }
                  : c.bags ? tint(c.type) : { card: "border-gray-200 bg-gray-50", bar: "bg-gray-300" };
              const pct = Math.max(c.bags ? 6 : 0, Math.round((c.remaining / max) * 100));
              return (
                <Link key={c.siloNo} href={href(c.siloNo)} className="group flex w-28 flex-col items-center">
                  <div className={`relative h-40 w-20 overflow-hidden rounded-[40px] border-2 transition group-hover:ring-2 group-hover:ring-brand/30 ${t.card}`}>
                    <div className={`absolute bottom-0 left-0 right-0 ${t.bar} opacity-70`} style={{ height: `${pct}%` }} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                      <span className="text-sm font-bold text-gray-900">{c.bags ? fmt(c.remaining) : "—"}</span>
                      {c.bags > 0 && <span className="text-[10px] text-gray-500">kg</span>}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] font-medium leading-tight text-gray-800">{c.siloNo}{c.active && <span title="running — activity in the last 30 min" className="h-2 w-2 animate-pulse rounded-full bg-green-500" />}</div>
                  <div className={`text-center text-[10px] ${c.remaining < 0 ? "font-medium text-red-600" : "text-gray-500"}`}>{c.remaining < 0 ? "backfill needed" : c.bags ? ([c.size, c.grade, c.type].filter(Boolean).join(" · ") || "Grit") : "Empty"}</div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
