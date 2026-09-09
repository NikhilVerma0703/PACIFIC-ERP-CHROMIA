"use client";
// The enquiry book. Open ones first by default, because an enquiry nobody has
// answered is the only thing on this screen that costs money.
//
// Enquiries are logged by hand from the mail that brought them (owner,
// 2026-09-05), so the list's job is to make the next one quick to log and the
// open ones impossible to lose.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";

export interface EnquiryListRow {
  id: string;
  number: string;
  clientId: string | null;
  prospectName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  receivedAt: string;
  source: string;
  subject: string | null;
  status: string;
  orderId: string | null;
  lostReason: string | null;
  itemsCount: number;
  client: { id: string; name: string; country: string } | null;
}

interface ListResponse {
  items: EnquiryListRow[];
  total: number;
  page: number;
  limit: number;
  counts: Record<string, number>;
}

const LIMIT = 50;

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "OPEN", label: "Open" },
  { key: "NEW", label: "New" },
  { key: "QUOTED", label: "Quoted" },
  { key: "ORDERED", label: "Ordered" },
  { key: "LOST", label: "Lost" },
  { key: "CLOSED", label: "Closed" },
  { key: "", label: "All" },
];

export const STATUS_TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  NEW: "brand", QUOTED: "amber", ORDERED: "green", LOST: "red", CLOSED: "brand",
};

const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function EnquiriesList({ initialStatus = "OPEN", initialQ = "", clientId = "" }: {
  initialStatus?: string;
  initialQ?: string;
  clientId?: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [q, setQ] = useState(initialQ);
  const [search, setSearch] = useState(initialQ);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) params.set("status", status);
    if (search.trim()) params.set("q", search.trim());
    if (clientId) params.set("clientId", clientId);
    const r = await fetch(`/api/office/commercial/enquiries?${params}`, { cache: "no-store" });
    const res = await readJson<ListResponse>(r);
    setLoading(false);
    if (!res.ok || !res.data) { setError(res.error ?? "Could not load the enquiries"); return; }
    setError(null);
    setData(res.data);
  }, [page, status, search, clientId]);

  useEffect(() => { void load(); }, [load]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const counts = data?.counts ?? {};
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const countFor = (key: string) =>
    key === "" ? Object.values(counts).reduce((a, b) => a + b, 0)
      : key === "OPEN" ? (counts.NEW ?? 0) + (counts.QUOTED ?? 0)
        : counts[key] ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => { setStatus(f.key); setPage(1); }}
                className={`rounded-lg border px-3 py-2 text-sm transition ${status === f.key ? "border-brand bg-brand/5 text-brand" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}
              >
                {f.label}<span className="ml-2 font-semibold">{countFor(f.key)}</span>
              </button>
            ))}
          </div>
          <Link href="/office/commercial/enquiries/new" className="rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90">
            Log an enquiry
          </Link>
        </div>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q); }}>
          <label className="min-w-[240px] flex-1">
            <span className="mb-1 block text-xs font-medium text-gray-600">Search</span>
            <input className={inp} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, customer, prospect, subject or contact" />
          </label>
          <button type="submit" className={btnGhost}>Search</button>
          {search && <button type="button" className={btnGhost} onClick={() => { setQ(""); setSearch(""); setPage(1); }}>Clear</button>}
          {clientId && (
            <Link href="/office/commercial/enquiries" className={btnGhost}>Show every customer</Link>
          )}
        </form>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3 font-medium">Enquiry</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">From</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 text-right font-medium">Lines</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50/70">
                  <td className="px-4 py-3">
                    <Link href={`/office/commercial/enquiries/${e.id}`} className="font-medium text-brand hover:underline">{e.number}</Link>
                    <div className="text-xs text-gray-400">{e.source}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{new Date(e.receivedAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-3">
                    {e.client
                      ? <Link href={`/office/commercial/clients/${e.client.id}`} className="text-gray-900 hover:underline">{e.client.name}</Link>
                      : <span className="text-gray-900">{e.prospectName ?? "—"}<span className="ml-2 text-xs text-amber-700">prospect</span></span>}
                    {e.contactName && <div className="text-xs text-gray-400">{e.contactName}</div>}
                  </td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-gray-600">{e.subject ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{e.itemsCount}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[e.status] ?? "brand"}>{e.status}</Badge>
                    {e.status === "LOST" && e.lostReason && <div className="mt-1 max-w-[180px] truncate text-xs text-gray-400">{e.lostReason}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {e.orderId
                      ? <Link href={`/office/commercial/orders/${e.orderId}`} className="text-brand hover:underline">open order</Link>
                      : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && items.length === 0 && (
          <div className="p-6"><Empty>{search ? `Nothing matches “${search}”.` : "No enquiries here yet."}</Empty></div>
        )}
        {loading && <div className="p-6 text-sm text-gray-500">Loading…</div>}
      </Card>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{total} enquir{total === 1 ? "y" : "ies"}</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <button className={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button className={btnGhost} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
