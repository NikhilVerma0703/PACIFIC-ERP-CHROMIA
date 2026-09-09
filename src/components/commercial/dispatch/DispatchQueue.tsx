"use client";
// The dispatch team's queue — a floor screen, so: big rows, big type, no
// table. Oldest first, because the container that has been waiting longest is
// the one holding up a shipment.
//
// This screen and the one behind it are the ONLY things a verify-only login
// reaches (access-rules isDispatchCheckPath), so it shows the order number and
// the customer and nothing else about the order.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { PACKING_STATUS_LABEL, type PackingStatus } from "@/lib/commercial/packing-rules";

interface Row {
  id: string; number: string; status: PackingStatus;
  submittedAt: string | null; verifiedAt: string | null; verifiedByName: string | null; verificationNote: string | null;
  finalisedAt: string | null;
  containerNo: string | null; vehicleNo: string | null; packagesSummary: string | null;
  orderNumber: string; kind: string; clientName: string;
  crateCount: number; slabCount: number;
  fit: { total: number; fit: number; unfit: number; pending: number };
}
interface Payload { items: Row[]; total: number; page: number; limit: number; counts: Record<string, number> }

// FINAL is the loading bay (answer 30): a slab found cracked while the
// container is stuffed is marked unfit from there, and Commercial swaps it.
const TABS: Array<{ key: PackingStatus; label: string }> = [
  { key: "SUBMITTED", label: "To check" },
  { key: "FINAL", label: "At loading" },
  { key: "VERIFIED", label: "Verified" },
  { key: "REJECTED", label: "Rejected" },
];

const ago = (v: string | null): string => {
  if (!v) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

export function DispatchQueue() {
  const [tab, setTab] = useState<PackingStatus>("SUBMITTED");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await readJson<Payload>(await fetch(`/api/office/commercial/dispatch-check?status=${tab}&limit=50`, { cache: "no-store" }));
    setLoading(false);
    if (!res.ok) { setError(res.error ?? "Could not load the queue"); return; }
    setError(null); setData(res.data);
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button"
            className={`rounded-xl border px-5 py-3 text-base font-medium transition ${tab === t.key ? "border-brand bg-brand/5 text-brand" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}
            onClick={() => setTab(t.key)}>
            {t.label} <span className="ml-1 font-semibold text-gray-900">{data?.counts?.[t.key] ?? 0}</span>
          </button>
        ))}
        <button type="button" className="ml-auto rounded-xl border border-gray-200 px-5 py-3 text-base font-medium text-gray-600 transition hover:border-gray-300" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700">{error}</div>}

      {loading && !data ? <Empty>Loading…</Empty> : !data || data.items.length === 0 ? (
        <Empty>{tab === "SUBMITTED" ? "Nothing is waiting to be checked." : tab === "FINAL" ? "No list is at the loading bay." : "Nothing here."}</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((r) => (
            <Link key={r.id} href={`/office/commercial/dispatch-check/${r.id}`} className="block">
              <Card hover>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-semibold text-gray-900">{r.number}</span>
                      <Badge tone={r.status === "SUBMITTED" ? "amber" : r.status === "REJECTED" ? "red" : "green"}>
                        {PACKING_STATUS_LABEL[r.status] ?? r.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-base text-gray-600">
                      {r.orderNumber} · {r.clientName || "—"} · {r.kind === "EXPORT" ? "Export" : "Domestic"}
                    </div>
                    <div className="mt-1 text-sm text-gray-400">
                      {r.packagesSummary ?? `${r.crateCount} package(s)`}
                      {r.containerNo ? ` · container ${r.containerNo}` : ""}
                      {r.vehicleNo ? ` · vehicle ${r.vehicleNo}` : ""}
                      {r.status === "SUBMITTED" ? ` · waiting ${ago(r.submittedAt)}` : r.status === "FINAL" ? ` · final ${ago(r.finalisedAt)}${r.fit.unfit > 0 ? ` · ${r.fit.unfit} unfit — awaiting a swap` : ""}` : r.verifiedAt ? ` · checked ${ago(r.verifiedAt)}${r.verifiedByName ? ` by ${r.verifiedByName}` : ""}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-semibold tracking-tight text-gray-900">{r.slabCount}</div>
                    <div className="text-sm text-gray-400">slabs</div>
                    {r.status === "SUBMITTED" && (
                      <div className="mt-1 text-sm">
                        <span className="text-green-700">{r.fit.fit} fit</span>
                        {r.fit.unfit > 0 && <span className="text-red-700"> · {r.fit.unfit} unfit</span>}
                        {r.fit.pending > 0 && <span className="text-gray-500"> · {r.fit.pending} to do</span>}
                      </div>
                    )}
                  </div>
                </div>
                {r.verificationNote && r.status !== "SUBMITTED" && (
                  <p className="mt-3 text-sm text-gray-500">{r.verificationNote}</p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
