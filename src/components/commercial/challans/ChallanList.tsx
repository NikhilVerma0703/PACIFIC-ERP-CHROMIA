"use client";
// The challan book: every delivery challan, filtered by status, a date window
// and a search over the number, the consignee and the PO reference.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty, Kpi } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { challanStatusTone } from "@/lib/commercial/challan-rules";
import { inp, lbl, btnPrimary, btnGhost, th, thead, errorBox, money, dmy } from "@/components/commercial/invoices/ui";

interface Row {
  id: string;
  number: string;
  challanDate: string;
  consigneeName: string;
  consigneeGstin: string | null;
  poRef: string | null;
  lorryNo: string | null;
  totalAmount: number | null;
  status: "DRAFT" | "ISSUED" | "CANCELLED";
  order: { id: string; number: string } | null;
}
interface Payload { items: Row[]; total: number; page: number; limit: number; totalValue: number }

const LIMIT = 50;

export function ChallanList() {
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (q.trim()) p.set("q", q.trim());
    p.set("page", String(page));
    p.set("limit", String(LIMIT));
    const r = await fetch(`/api/office/commercial/challans?${p.toString()}`, { cache: "no-store" });
    const res = await readJson<Payload>(r);
    setLoading(false);
    if (!res.ok) { setError(res.error ?? "Could not load the challan book"); return; }
    setError(null);
    setData(res.data);
  }, [status, from, to, q, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, from, to, q]);

  const rows = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Challans" value={data?.total ?? "—"} />
        <Kpi label="Declared value" value={data ? money(data.totalValue, "INR", 0) : "—"} sub="cancelled excluded" working="The sum of the declared (approximate) value of every challan matching the filter whose status is not CANCELLED. A challan is a movement, not a sale — this is not revenue." />
        <Kpi label="Drafts" value={rows.filter((r) => r.status === "DRAFT").length} sub="on this page" />
        <Kpi label="This page" value={`${rows.length} of ${data?.total ?? 0}`} sub={`page ${data?.page ?? 1} of ${pages}`} />
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <label className={lbl} htmlFor="dc-status">Status</label>
            <select id="dc-status" className={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="ISSUED">Issued</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="dc-from">From</label>
            <input id="dc-from" type="date" className={inp} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={lbl} htmlFor="dc-to">To</label>
            <input id="dc-to" type="date" className={inp} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className={lbl} htmlFor="dc-q">Search</label>
            <input id="dc-q" className={inp} placeholder="Number, consignee or PO ref" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Link href="/office/commercial/challans/new" className={btnPrimary}>New challan</Link>
          </div>
        </div>
      </Card>

      {error && <div className={errorBox}>{error}</div>}

      <Card>
        {loading && !data ? <Empty>Loading…</Empty> : rows.length === 0 ? (
          <Empty>No challan matches this filter.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={thead}>
                  <th className={th}>Challan</th>
                  <th className={th}>Date</th>
                  <th className={th}>Consignee</th>
                  <th className={th}>PO ref</th>
                  <th className={th}>Lorry</th>
                  <th className={th}>Order</th>
                  <th className={`${th} text-right`}>Declared value</th>
                  <th className={th}>Status</th>
                  <th className={th}>PDF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4"><Link href={`/office/commercial/challans/${r.id}`} className="font-medium text-brand hover:underline">{r.number}</Link></td>
                    <td className="py-2 pr-4 text-gray-600">{dmy(r.challanDate)}</td>
                    <td className="py-2 pr-4 text-gray-900">{r.consigneeName}{r.consigneeGstin ? <span className="block text-xs text-gray-400">{r.consigneeGstin}</span> : null}</td>
                    <td className="py-2 pr-4 text-gray-500">{r.poRef ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-500">{r.lorryNo ?? "—"}</td>
                    <td className="py-2 pr-4">{r.order ? <Link href={`/office/commercial/orders/${r.order.id}?tab=invoice`} className="text-brand hover:underline">{r.order.number}</Link> : "—"}</td>
                    <td className="py-2 pr-4 text-right text-gray-900">{money(r.totalAmount, "INR")}</td>
                    <td className="py-2 pr-4"><Badge tone={challanStatusTone(r.status)}>{r.status}</Badge></td>
                    <td className="py-2 pr-4"><a href={`/api/office/commercial/challans/${r.id}/pdf`} target="_blank" rel="noreferrer" className="text-brand hover:underline">Open</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
            <button type="button" className={btnGhost} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span>Page {data?.page ?? page} of {pages}</span>
            <button type="button" className={btnGhost} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </Card>
    </div>
  );
}
