import Link from "next/link";
import type { RmGroup, ResinLot, DailyTank } from "@/lib/rmStock";

const INV_SHOWN = 3;

const gradeRank = (g: string) => (g === "Premium" ? 0 : g === "Supreme" ? 1 : 2);
const sizeKey = (s: string) => { const m = s.match(/[\d.]+/); return m ? parseFloat(m[0]) : 9999; };

/** Group by size (sub-heading), ordered fine→coarse; grades Premium → Supreme → rest within. */
function bySize(groups: RmGroup[]): [string, RmGroup[]][] {
  const m = new Map<string, RmGroup[]>();
  for (const g of groups) {
    const arr = m.get(g.size) ?? [];
    arr.push(g); m.set(g.size, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.grade.localeCompare(b.grade));
  return [...m.entries()].sort((a, b) => sizeKey(a[0]) - sizeKey(b[0]) || a[0].localeCompare(b[0]));
}

function fmtKg(n: number): string {
  return n.toLocaleString("en-IN");
}

function InvLine({ invNo, bags, minBag, maxBag }: { invNo: string; bags: number; minBag: number | null; maxBag: number | null }) {
  const range = minBag != null && maxBag != null ? (minBag === maxBag ? `#${minBag}` : `#${minBag}–${maxBag}`) : "";
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px] text-gray-500">
      <span className="truncate">inv <span className="font-medium text-gray-700">{invNo}</span>{range && <span className="ml-1">{range}</span>}</span>
      <span className="shrink-0">{bags} bag{bags === 1 ? "" : "s"}</span>
    </div>
  );
}

function GroupCard({ g, showType, title }: { g: RmGroup; showType?: boolean; title?: string }) {
  const extra = g.invoices.length - INV_SHOWN;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-gray-900">{title ?? `${showType ? `${g.type} · ` : ""}${g.size} · ${g.grade}`}</div>
        <div className="shrink-0 text-xs text-gray-500">{g.bags} bag{g.bags === 1 ? "" : "s"}</div>
      </div>
      <div className="text-xs font-medium text-brand">{fmtKg(g.kg)} kg in store</div>
      <div className="mt-2 space-y-0.5">
        {g.invoices.slice(0, INV_SHOWN).map((i) => <InvLine key={i.invNo} {...i} />)}
        {extra > 0 && <div className="text-[11px] text-gray-400">+{extra} more invoice{extra === 1 ? "" : "s"}</div>}
      </div>
    </div>
  );
}

function SizeSections({ groups, grid }: { groups: RmGroup[]; grid: string }) {
  return (
    <div className="space-y-4">
      {bySize(groups).map(([size, arr]) => (
        <div key={size}>
          <div className="mb-1.5 border-b border-gray-100 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Size {size}</div>
          <div className={grid}>{arr.map((g) => <GroupCard key={`${g.size}|${g.grade}`} g={g} title={g.grade} />)}</div>
        </div>
      ))}
    </div>
  );
}

export function RmStockPanel({ grit, filler, other, resin, daily }: { grit: RmGroup[]; filler: RmGroup[]; other: RmGroup[]; resin: ResinLot[]; daily: DailyTank[] }) {
  const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Quartz grit</div>
        {grit.length ? <SizeSections groups={grit} grid={grid} /> : <div className="text-sm text-gray-400">No grit bags in store.</div>}
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Filler</div>
        {filler.length ? <SizeSections groups={filler} grid={grid} /> : <div className="text-sm text-gray-400">No filler bags in store.</div>}
      </div>
      {other.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Other grits</div>
          <div className={grid}>{other.map((g) => <GroupCard key={`${g.type}|${g.size}|${g.grade}`} g={g} showType />)}</div>
        </div>
      )}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Resin — daily tanks</div>
        {daily.length ? (
          <div className={grid}>
            {daily.map((t) => {
              // "active" = used/prepped in the last 30 min (FIFO-derived); the old
              // stored usageStatus is deprecated and no longer drives the colour.
              const inUse = t.active;
              return (
                <Link key={t.tankNo} href={`/resin/${encodeURIComponent(t.tankNo)}`} className={`block rounded-xl border p-3 transition hover:ring-2 hover:ring-brand/30 ${t.deficit < 0 ? "border-red-300 bg-red-50" : inUse ? "border-green-200 bg-green-50" : "border-gray-200 bg-white"}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className={`flex items-center gap-1.5 text-sm font-semibold ${inUse ? "text-green-700" : "text-gray-900"}`}>Tank {t.tankNo}{t.active && <span title="used in the last 30 min" className="h-2 w-2 animate-pulse rounded-full bg-green-500" />}</div>
                    <div className="shrink-0 text-xs text-gray-500">{t.active ? "Running" : t.incharge ?? ""}</div>
                  </div>
                  <div className="text-xs font-medium text-brand">{fmtKg(t.remaining)} kg remaining{t.quantity ? ` of ${fmtKg(t.quantity)}` : ""}</div>
                  {t.deficit < 0 && <div className="text-xs font-semibold text-red-600">{fmtKg(t.deficit)} kg unbacked — fill the tank to auto-link</div>}
                  <div className="mt-1 text-[11px] text-gray-500">
                    {t.silane != null && <span>silane {t.silane}</span>}
                    {t.cobalt != null && <span>{t.silane != null ? " · " : ""}cobalt {t.cobalt}</span>}
                    {t.at && <span> · {new Date(t.at).toLocaleDateString()}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : <div className="text-sm text-gray-400">No daily tank preparations.</div>}
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Resin — storage tanks</div>
        {resin.length ? (
          <div className={grid}>
            {resin.map((r, i) => (
              <div key={i} className={`rounded-xl border p-3 ${r.active ? "border-green-200 bg-green-50" : "border-gray-200 bg-white"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className={`flex items-center gap-1.5 text-sm font-semibold ${r.active ? "text-green-700" : "text-gray-900"}`}>Tank {r.tankNo}{r.active && <span title="delivery logged in the last 30 min" className="h-2 w-2 animate-pulse rounded-full bg-green-500" />}</div>
                  <div className="shrink-0 text-xs text-gray-500">{r.supplier}</div>
                </div>
                <div className="text-xs font-medium text-brand">{fmtKg(r.remaining)} kg remaining{r.quantity ? ` of ${fmtKg(r.quantity)}` : ""}</div>
                <div className="mt-1 text-[11px] text-gray-500">inv <span className="font-medium text-gray-700">{r.invNo}</span></div>
              </div>
            ))}
          </div>
        ) : <div className="text-sm text-gray-400">No resin lots with remaining quantity.</div>}
      </div>
    </div>
  );
}
