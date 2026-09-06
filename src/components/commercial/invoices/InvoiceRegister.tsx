"use client";
// The invoice register: every DTA and export invoice, filtered by kind,
// status, a date window and a free-text search over the invoice number, the
// order number and the client's name. Each row links to the invoice and to its
// PDF. The value column sums what is not cancelled, so the figure at the top
// is what was actually billed.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty, Kpi } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { statusTone, displayGrandTotal } from "@/lib/commercial/invoice-rules";
import { inp, lbl, btnGhost, th, thead, errorBox, money, dmy } from "./ui";

interface Row {
  id: string;
  number: string;
  kind: "DTA" | "EXPORT";
  status: "DRAFT" | "ISSUED" | "CANCELLED";
  invoiceDate: string;
  currency: string;
  grandTotal: number | null;
  /** The snapshot's own grand total. commercial_invoice.grand_total is
   *  NUMERIC(16,2) and an export document carries three decimals, so the column
   *  is the rounded one and this is what the PDF actually prints. */
  grandTotalExact: number | null;
  subtotalExact: number | null;
  /** How many printed lines carry a quantity but no rate. */
  unpricedLines: number;
  vehicleNo: string | null;
  transporter: string | null;
  lrNo: string | null;
  ewayBillNo: string | null;
  issuedAt: string | null;
  order: { id: string; number: string; kind: string; client: { id: string; name: string; country: string } | null } | null;
  packingList: { id: string; number: string; status: string } | null;
  exportDocSet: { id: string; generatedAt: string | null } | null;
}
interface Payload { items: Row[]; total: number; page: number; limit: number; totalValue: number }

const LIMIT = 50;

export function InvoiceRegister() {
  const [kind, setKind] = useState("");
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
    if (kind) p.set("kind", kind);
    if (status) p.set("status", status);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (q.trim()) p.set("q", q.trim());
    p.set("page", String(page));
    p.set("limit", String(LIMIT));
    const r = await fetch(`/api/office/commercial/invoices?${p.toString()}`, { cache: "no-store" });
    const res = await readJson<Payload>(r);
    setLoading(false);
    if (!res.ok) { setError(res.error ?? "Could not load the register"); return; }
    setError(null);
    setData(res.data);
  }, [kind, status, from, to, q, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [kind, status, from, to, q]);

  const rows = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Invoices" value={data?.total ?? "—"} sub={kind || status ? "matching the filter" : "in all"} />
        <Kpi label="Billed value" value={data ? money(data.totalValue, "INR", 0) : "—"} sub="cancelled invoices excluded" working="The sum of grand totals of every invoice matching the filter whose status is not CANCELLED. Export invoices are counted at their own currency's figure, so a mixed list adds unlike units — filter by kind for a meaningful total." />
        <Kpi label="Drafts" value={rows.filter((r) => r.status === "DRAFT").length} sub="on this page" />
        <Kpi label="This page" value={`${rows.length} of ${data?.total ?? 0}`} sub={`page ${data?.page ?? 1} of ${pages}`} />
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div>
            <label className={lbl} htmlFor="inv-kind">Kind</label>
            <select id="inv-kind" className={inp} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All</option>
              <option value="DTA">DTA (domestic)</option>
              <option value="EXPORT">Export</option>
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="inv-status">Status</label>
            <select id="inv-status" className={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="DRAFT">Draft</option>
              <option value="ISSUED">Issued</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="inv-from">From</label>
            <input id="inv-from" type="date" className={inp} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className={lbl} htmlFor="inv-to">To</label>
            <input id="inv-to" type="date" className={inp} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className={lbl} htmlFor="inv-q">Search</label>
            <input id="inv-q" className={inp} placeholder="Invoice, order or client" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      {error && <div className={errorBox}>{error}</div>}

      <Card>
        {loading && !data ? <Empty>Loading…</Empty> : rows.length === 0 ? (
          <Empty>No invoice matches this filter. Invoices are raised from an order&apos;s Invoice tab.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={thead}>
                  <th className={th}>Invoice</th>
                  <th className={th}>Kind</th>
                  <th className={th}>Date</th>
                  <th className={th}>Order</th>
                  <th className={th}>Client</th>
                  <th className={th}>Packing list</th>
                  <th className={th}>Vehicle / LR</th>
                  <th className={`${th} text-right`}>Grand total</th>
                  <th className={th}>Status</th>
                  <th className={th}>PDF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/office/commercial/invoices/${r.id}`} className="font-medium text-brand hover:underline">{r.number}</Link>
                      {r.unpricedLines > 0 && (
                        <span className="mt-0.5 block text-xs font-medium text-amber-700" title="A line came off the packing list with no order line to price it">
                          {r.unpricedLines} line{r.unpricedLines === 1 ? "" : "s"} without a rate
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{r.kind}</td>
                    <td className="py-2 pr-4 text-gray-600">{dmy(r.invoiceDate)}</td>
                    <td className="py-2 pr-4">
                      {r.order ? <Link href={`/office/commercial/orders/${r.order.id}?tab=invoice`} className="text-brand hover:underline">{r.order.number}</Link> : "—"}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{r.order?.client?.name ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-500">{r.packingList?.number ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-500">{[r.vehicleNo, r.lrNo].filter(Boolean).join(" · ") || "—"}</td>
                    {/* the snapshot's figure, not the NUMERIC(16,2) column — an
                        export invoice's third decimal only survives in the snapshot */}
                    <td className="py-2 pr-4 text-right text-gray-900">{money(displayGrandTotal(r), r.currency, r.kind === "DTA" ? 2 : 3)}</td>
                    <td className="py-2 pr-4"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="py-2 pr-4">
                      <a href={`/api/office/commercial/invoices/${r.id}/pdf`} target="_blank" rel="noreferrer" className="text-brand hover:underline">Open</a>
                    </td>
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
