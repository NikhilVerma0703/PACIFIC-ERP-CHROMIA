"use client";
// Every packing list in the module, by status. The status strip is the point:
// "what is waiting for the dispatch team", "what is verified and not yet
// stuffed", "what has gone" are the three questions Commercial asks this
// screen, and each is one tap.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { PACKING_STATUSES, PACKING_STATUS_LABEL, type PackingStatus } from "@/lib/commercial/packing-rules";

interface Row {
  id: string;
  number: string;
  status: PackingStatus;
  orderId: string;
  containerNo: string | null;
  vehicleNo: string | null;
  packagesSummary: string | null;
  createdByName: string | null;
  createdAt: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  finalisedAt: string | null;
  dispatchedAt: string | null;
  order: { id: string; number: string; kind: string; status: string; client: { id: string; name: string; country: string | null } | null } | null;
  crateCount: number;
  slabCount: number;
  fit: { total: number; fit: number; unfit: number; pending: number };
  sqm: number;
}

interface Payload { items: Row[]; total: number; page: number; limit: number; counts: Record<string, number> }

const TONE: Record<PackingStatus, "brand" | "green" | "amber" | "red"> = {
  DRAFT: "brand", SUBMITTED: "amber", VERIFIED: "green", REJECTED: "red", FINAL: "green", DISPATCHED: "green",
};

const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
const chip = "rounded-lg border px-3 py-2 text-sm transition";
const when = (v: string | null): string => (v ? new Date(v).toLocaleDateString("en-IN") : "—");

export function PackingLists() {
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), limit: "50" });
    if (status) p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    const res = await readJson<Payload>(await fetch(`/api/office/commercial/packing-lists?${p}`, { cache: "no-store" }));
    setLoading(false);
    if (!res.ok) { setError(res.error ?? "Could not load the packing lists"); return; }
    setError(null); setData(res.data);
  }, [status, q, page]);

  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const counts = data?.counts ?? {};
  const totalAll = Object.values(counts).reduce((a, n) => a + n, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${chip} ${status === "" ? "border-brand text-brand" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}
          onClick={() => { setStatus(""); setPage(1); }}>
          All <span className="ml-1 font-semibold text-gray-900">{totalAll}</span>
        </button>
        {PACKING_STATUSES.map((s) => (
          <button key={s} type="button"
            className={`${chip} ${status === s ? "border-brand text-brand" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}
            onClick={() => { setStatus(s); setPage(1); }}>
            {PACKING_STATUS_LABEL[s]} <span className="ml-1 font-semibold text-gray-900">{counts[s] ?? 0}</span>
          </button>
        ))}
        <div className="ml-auto w-full sm:w-64">
          <input className={inp} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search list, order, client, container" aria-label="Search packing lists" />
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <Card>
        {loading && !data ? <Empty>Loading…</Empty> : !data || data.items.length === 0 ? (
          <Empty>No packing list here yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-3">Number</th>
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Slabs</th>
                  <th className="py-2 pr-3 text-right">Crates</th>
                  <th className="py-2 pr-3 text-right">Sqm</th>
                  <th className="py-2 pr-3">Container</th>
                  <th className="py-2 pr-3">Submitted</th>
                  <th className="py-2 pr-3">Dispatched</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="py-2 pr-3">
                      <Link href={`/office/commercial/packing-lists/${r.id}`} className="font-medium text-brand hover:underline">{r.number}</Link>
                    </td>
                    <td className="py-2 pr-3">
                      {r.order ? <Link href={`/office/commercial/orders/${r.order.id}?tab=packing`} className="text-gray-700 hover:underline">{r.order.number}</Link> : "—"}
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{r.order?.client?.name ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={TONE[r.status] ?? "brand"}>{PACKING_STATUS_LABEL[r.status] ?? r.status}</Badge>
                      {r.status === "SUBMITTED" && r.fit.pending > 0 && <span className="ml-2 text-xs text-gray-400">{r.fit.pending} to check</span>}
                    </td>
                    <td className="py-2 pr-3 text-right">{r.slabCount}</td>
                    <td className="py-2 pr-3 text-right">{r.crateCount}</td>
                    <td className="py-2 pr-3 text-right">{r.sqm ? r.sqm.toFixed(3) : "—"}</td>
                    <td className="py-2 pr-3 text-gray-600">{r.containerNo ?? "—"}</td>
                    <td className="py-2 pr-3 text-gray-600">{when(r.submittedAt)}</td>
                    <td className="py-2 pr-3 text-gray-600">{when(r.dispatchedAt)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <a href={`/api/office/commercial/packing-lists/${r.id}/pdf`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline">PL</a>
                      <span className="px-1 text-gray-300">·</span>
                      <a href={`/api/office/commercial/packing-lists/${r.id}/measurement-list.pdf`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline">Measmt</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.limit && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
            <span>{(data.page - 1) * data.limit + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total}</span>
            <div className="flex gap-2">
              <button type="button" className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-50" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <button type="button" className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-50" disabled={data.page * data.limit >= data.total} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
