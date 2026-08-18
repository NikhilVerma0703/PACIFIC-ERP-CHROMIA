import { Shell } from "@/components/Shell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Card, H2, Empty } from "@/components/ui";
import { SiloStatus } from "@/components/SiloStatus";
import { RunAllocator } from "@/components/RunAllocator";
import { isAdmin } from "@/lib/rbac";
import { getSiloOverview } from "@/lib/silo";
import { getLiveStatus, type StationLive } from "@/lib/live";
import { getRmStock } from "@/lib/rmStock";
import { RmStockPanel } from "@/components/RmStock";
import { listUnassignedPool } from "@/app/store/actions";
import { currentUser, canManageRm } from "@/lib/rbac";
import { liveWindow, LIVE_KEY } from "@/lib/stationAccess";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the admin allocator action can take a while

// Placeholder machine icons — swap the `d` paths (or replace with <img>) once
// the user provides the real machine icons.
const ICON: Record<string, string> = {
  mixer: "M12 3v6m0 0a4 4 0 100 8 4 4 0 000-8zM6 21h12l-1.5-6h-9z",
  distributor: "M4 7h16M6 7l2 12h8l2-12M9 11v4M15 11v4",
  kreos: "M3 12h4l2-7 4 14 2-7h6",
  press: "M6 4h12v5l-3 3 3 3v5H6v-5l3-3-3-3z",
  oven: "M4 4h16v16H4zM4 9h16M8 13h8",
  jot: "M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4",
  polishEntry: "M3 17l6-6 4 4 8-8M3 21h18",
  polishQc: "M9 12l2 2 4-4M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
};

function Icon({ k }: { k: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICON[k] ?? ICON.press} />
    </svg>
  );
}

function since(at: Date | null): string {
  if (!at) return "no recent activity";
  const mins = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(at).toLocaleDateString();
}

const ORDER = ["distributor", "kreos", "press", "oven", "jot", "polishEntry", "polishQc"];

function StationCard({ s }: { s: StationLive }) {
  return (
    <div className={`rounded-xl border p-3 ${s.active ? "border-green-200 bg-green-50" : "border-gray-200 bg-white"}`}>
      <div className="flex items-center justify-between">
        <div className={`flex items-center gap-2 ${s.active ? "text-green-700" : "text-gray-500"}`}>
          <Icon k={s.key} />
          <span className="text-sm font-semibold">{s.label}</span>
        </div>
        <span className={`h-2.5 w-2.5 rounded-full ${s.active ? "bg-green-500" : "bg-gray-300"}`} title={s.active ? "Running" : "Idle"} />
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-gray-900">{s.slab != null ? `#${s.slab}` : "—"}</div>
      <div className="text-xs text-gray-500">{s.batch ? `Batch ${s.batch}` : "—"}{s.operator ? ` · ${s.operator}` : ""}</div>
      <div className="text-[10px] text-gray-400">{since(s.at)}</div>
    </div>
  );
}

export default async function LivePage() {
  const me = await currentUser();
  const isOperator = String((me as { role?: string } | null)?.role ?? "") === "OPERATOR";
  const station = ((me as { station?: string | null } | null)?.station as string | null) ?? null;
  // operators see only their own slot, the previous one and the next one
  const win = isOperator ? liveWindow(station) : null;
  const winKeys = win ? new Set([...win].map((s) => LIVE_KEY[s]).filter(Boolean)) : null;
  const showMixer = !win || win.has("MIXER");
  const showSilos = !win || win.has("SILO") || win.has("MIXER");
  const showRm = !win || win.has("SILO");

  const [{ stations, mixer }, silos, rm, pool] = await Promise.all([
    getLiveStatus(),
    showSilos ? getSiloOverview() : Promise.resolve({ grit: [], filler: [] } as Awaited<ReturnType<typeof getSiloOverview>>),
    showRm ? getRmStock() : Promise.resolve(null),
    showRm ? listUnassignedPool(true) : Promise.resolve([]),
  ]);
  const ordered = (ORDER.map((k) => stations.find((s) => s.key === k)).filter(Boolean) as StationLive[])
    .filter((s) => !winKeys || winKeys.has(s.key));

  return (
    <Shell>
      <AutoRefresh seconds={60} />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Live status</h1>
        <p className="mt-1 text-sm text-gray-500">{isOperator
          ? "Your section of the line — your machine plus the one before and after it. A station lights green if it logged a record in the last 30 minutes."
          : "Current line snapshot — silos, the running mixer cycle, and the slab on each machine. A station lights green if it logged a record in the last 30 minutes."}</p>
      </div>

      <div className="space-y-6">
        {/* Mixer cycle */}
        {showMixer && <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className={`flex items-center gap-3 ${mixer?.active ? "text-green-700" : "text-gray-500"}`}>
              <Icon k="mixer" />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Current mixer cycle</div>
                {mixer ? (
                  <div className="text-lg font-semibold text-gray-900">
                    Batch {mixer.batch ?? "—"} · Cycle {mixer.cycle ?? "—"}
                    {mixer.mixers.length > 0 && <span className="ml-2 text-sm font-normal text-gray-500">Mixers {mixer.mixers.map((m) => `M${m}`).join(", ")}</span>}
                  </div>
                ) : <div className="text-sm text-gray-400">No mixer cycle recorded.</div>}
                {mixer && <div className="text-xs text-gray-400">{mixer.operator ? `${mixer.operator} · ` : ""}{since(mixer.at)}</div>}
              </div>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${mixer?.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
              {mixer?.active ? "Running" : "Idle"}
            </span>
          </div>
        </Card>}

        {/* Station flow */}
        <Card>
          <H2>Machines</H2>
          {ordered.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
              {ordered.map((s) => <StationCard key={s.key} s={s} />)}
            </div>
          ) : <Empty>No station activity yet.</Empty>}
          <p className="mt-3 text-[11px] text-gray-400">Distributor and Kreos are alternate machines — only the running one will be lit.</p>
        </Card>

        {/* Silos */}
        {showSilos && <Card>
          <H2>Silo status</H2>
          {await isAdmin() && <div className="mb-2 flex justify-end"><RunAllocator /></div>}
          <SiloStatus grit={silos.grit} filler={silos.filler} />
        </Card>}

        {/* Raw-material stock — split into assigned bags vs the unassigned bulk pool */}
        {showRm && rm && <>
        <div className="flex items-center gap-3 pt-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Raw material stock</h2>
          <span className="text-xs text-gray-400">assigned bags vs unassigned pool</span>
        </div>

        {/* RM stock — ASSIGNED bags in store */}
        <Card>
          <div className="mb-1 flex items-center gap-2"><H2>Assigned RM — bags in store</H2><span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">assigned</span></div>
          <p className="-mt-1 mb-4 text-xs text-gray-400">Bags assigned to an invoice and accepted, not yet dumped into a silo · resin daily &amp; storage tanks with remaining quantity.</p>
          <RmStockPanel grit={rm.grit} filler={rm.filler} other={rm.other} resin={rm.resin} daily={rm.daily} canDownload={await canManageRm()} />
        </Card>

        {/* RM stock — UNASSIGNED bulk pool, not yet broken into bags */}
        <Card>
          <div className="mb-1 flex items-center gap-2"><H2>Unassigned RM — pool</H2><span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">unassigned</span></div>
          <p className="-mt-1 mb-4 text-xs text-gray-400">Grit &amp; filler uploaded by the Store Incharge that still has kg waiting to be assigned into bags.</p>
          {pool.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500"><th className="py-2 pr-4">Invoice</th><th className="py-2 pr-4">Type</th><th className="py-2 pr-4">Size</th><th className="py-2 pr-4">Grade</th><th className="py-2 pr-4">Supplier</th><th className="py-2 pr-4 text-right">Remaining</th></tr></thead>
                <tbody>{pool.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="py-2 pr-4 font-medium text-gray-900">{p.invNo}</td><td className="py-2 pr-4">{p.type}</td><td className="py-2 pr-4">{p.size}</td><td className="py-2 pr-4">{p.grade}</td><td className="py-2 pr-4 text-gray-500">{p.supplier ?? "\u2014"}</td>
                    <td className="py-2 pr-4 text-right font-semibold text-amber-700">{p.remainingKg.toLocaleString("en-IN")} kg</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty>Nothing waiting to be assigned.</Empty>}
        </Card>
        </>}
      </div>
    </Shell>
  );
}
