import Link from "next/link";
import type { RmGroup, ResinLot, DailyTank } from "@/lib/rmStock";
import { RmStockTable } from "@/components/RmStockTable";

function fmtKg(n: number): string {
  return n.toLocaleString("en-IN");
}

export function RmStockPanel({ grit, filler, other, resin, daily, canDownload = false }: { grit: RmGroup[]; filler: RmGroup[]; other: RmGroup[]; resin: ResinLot[]; daily: DailyTank[]; canDownload?: boolean }) {
  const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
  return (
    <div className="space-y-5">
      {canDownload && (
        <div className="flex justify-end">
          <a href="/api/store/rm-stock" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
            Download stock (Excel)
          </a>
        </div>
      )}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Quartz grit</div>
        {grit.length ? <RmStockTable groups={grit} /> : <div className="text-sm text-gray-400">No grit bags in store.</div>}
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Filler</div>
        {filler.length ? <RmStockTable groups={filler} /> : <div className="text-sm text-gray-400">No filler bags in store.</div>}
      </div>
      {other.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Other grits</div>
          <RmStockTable groups={other} showType />
        </div>
      )}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Resin — daily tanks</div>
        {daily.length ? (
          <div className={grid}>
            {daily.map((t) => {
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
                <div className="flex items-start justify-between gap-2">
                  <div className={`flex shrink-0 items-center gap-1.5 text-sm font-semibold ${r.active ? "text-green-700" : "text-gray-900"}`}>Tank {r.tankNo}{r.active && <span title="delivery logged in the last 30 min" className="h-2 w-2 animate-pulse rounded-full bg-green-500" />}</div>
                  <div className="min-w-0 break-words text-right text-xs leading-tight text-gray-500" title={r.supplier ?? ""}>{r.supplier}</div>
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
