"use client";
// The order book: a board of stage counts across the top (click one to filter)
// and the orders themselves underneath.
//
// The counts come from the same request as the rows and IGNORE the status
// filter — the route groups them over the other filters only — so clicking
// "Packing" narrows the table without emptying the board you clicked it from.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { ORDER_STAGES } from "@/lib/commercial/stages";
import { BTN, BTN_PRIMARY, INPUT, ErrorNote, STATUS_TONE, dmy } from "./fields";

interface OrderRow {
  id: string;
  number: string;
  kind: "DOMESTIC" | "EXPORT";
  status: string;
  customerPoNumber: string | null;
  customerPoDate: string | null;
  currency: string;
  incoterm: string | null;
  portOfDischarge: string | null;
  finalDestination: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  client: { id: string; name: string; country: string | null } | null;
  itemsCount: number;
  holdsCount: number;
  proformasCount: number;
  packingListsCount: number;
  invoicesCount: number;
}

interface OrdersPage {
  items: OrderRow[];
  total: number;
  page: number;
  limit: number;
  counts: Record<string, number>;
}

const LIMIT = 50;

export function OrdersBoard({ actions, initialStatus = "", initialKind = "", initialQ = "", initialClientId = "" }: {
  actions: string[];
  initialStatus?: string;
  initialKind?: string;
  initialQ?: string;
  initialClientId?: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [kind, setKind] = useState(initialKind);
  const [q, setQ] = useState(initialQ);
  const [typed, setTyped] = useState(initialQ);
  const [clientId] = useState(initialClientId);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OrdersPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mayWrite = actions.includes("write");

  // The search box waits for the typing to stop rather than firing a request
  // per keystroke at a list this wide.
  useEffect(() => {
    const t = setTimeout(() => { setQ(typed); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(async () => {
    setLoading(true);
    const u = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (status) u.set("status", status);
    if (kind) u.set("kind", kind);
    if (q.trim()) u.set("q", q.trim());
    if (clientId) u.set("clientId", clientId);
    const r = await fetch(`/api/office/commercial/orders?${u.toString()}`, { cache: "no-store" });
    const res = await readJson<OrdersPage>(r);
    setLoading(false);
    if (!res.ok || !res.data) { setError(res.error ?? "Could not load the orders."); return; }
    setError(null);
    setData(res.data);
  }, [page, status, kind, q, clientId]);

  useEffect(() => { void load(); }, [load]);

  // The board keeps the filter in the address bar, so a filtered view can be
  // sent to somebody and the browser's Back button still works.
  useEffect(() => {
    const u = new URLSearchParams();
    if (status) u.set("status", status);
    if (kind) u.set("kind", kind);
    if (q.trim()) u.set("q", q.trim());
    if (clientId) u.set("clientId", clientId);
    const qs = u.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [status, kind, q, clientId]);

  const counts = data?.counts ?? {};
  const totalOpen = ORDER_STAGES.filter((s) => s.step && s.status !== "CLOSED").reduce((a, s) => a + (counts[s.status] ?? 0), 0);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Stages</h2>
          {status && (
            <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => { setStatus(""); setPage(1); }}>
              Showing {ORDER_STAGES.find((s) => s.status === status)?.label ?? status} · clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {ORDER_STAGES.map((s) => {
            const n = counts[s.status] ?? 0;
            const on = status === s.status;
            return (
              <button
                key={s.status}
                type="button"
                onClick={() => { setStatus(on ? "" : s.status); setPage(1); }}
                className={`rounded-lg border px-3 py-2 text-sm transition ${on ? "border-brand bg-brand/5" : "border-gray-200 hover:border-brand"} ${n === 0 ? "opacity-60" : ""}`}
              >
                <span className="text-gray-500">{s.label}</span>
                <span className="ml-2 font-semibold text-gray-900">{n}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-gray-400">
          {totalOpen} order{totalOpen === 1 ? "" : "s"} short of Closed. Every move is stamped and logged; three are gated — the PI waits for the stock check, the invoice for the approval, dispatch for the advance.
        </p>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Search</span>
            <input className={INPUT} value={typed} placeholder="Order number, customer PO or client name"
              onChange={(e) => setTyped(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Kind</span>
            <select className={INPUT} value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
              <option value="">Both</option>
              <option value="EXPORT">Export</option>
              <option value="DOMESTIC">Domestic</option>
            </select>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={BTN} onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
            {mayWrite && <Link href="/office/commercial/orders/new" className={BTN_PRIMARY}>New order</Link>}
          </div>
        </div>

        {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

        {!data && !error ? <Empty>Loading…</Empty> : null}

        {data && data.items.length === 0 && !error ? (
          <Empty>
            No orders match this filter.
            {mayWrite ? <> <Link href="/office/commercial/orders/new" className="font-medium text-brand hover:underline">Start one</Link>.</> : null}
          </Empty>
        ) : null}

        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">Order</th>
                  <th className="py-2 pr-4 font-medium">Client</th>
                  <th className="py-2 pr-4 font-medium">Kind</th>
                  <th className="py-2 pr-4 font-medium">Stage</th>
                  <th className="py-2 pr-4 font-medium">Customer PO</th>
                  <th className="py-2 pr-4 font-medium">Currency</th>
                  <th className="py-2 pr-4 text-right font-medium">Lines</th>
                  <th className="py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50/70">
                    <td className="py-2 pr-4">
                      <Link href={`/office/commercial/orders/${o.id}`} className="font-medium text-brand hover:underline">{o.number}</Link>
                      {/* The order date under the number (answer 6). ORD/… is the order; the PI carries its own SAL-ORD/… number. */}
                      <div className="text-xs text-gray-400">{dmy(o.createdAt)}{o.createdByName ? ` · ${o.createdByName}` : ""}</div>
                    </td>
                    <td className="py-2 pr-4 text-gray-900">
                      {o.client?.name ?? "—"}
                      {o.client?.country && <div className="text-xs text-gray-400">{o.client.country}</div>}
                    </td>
                    <td className="py-2 pr-4"><Badge tone={o.kind === "EXPORT" ? "brand" : "green"}>{o.kind === "EXPORT" ? "Export" : "Domestic"}</Badge></td>
                    <td className="py-2 pr-4"><Badge tone={STATUS_TONE[o.status] ?? "brand"}>{ORDER_STAGES.find((s) => s.status === o.status)?.label ?? o.status}</Badge></td>
                    <td className="py-2 pr-4 text-gray-600">
                      {o.customerPoNumber ?? "—"}
                      {o.customerPoDate && <div className="text-xs text-gray-400">{dmy(o.customerPoDate)}</div>}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{o.currency}{o.incoterm ? ` · ${o.incoterm}` : ""}</td>
                    <td className="py-2 pr-4 text-right text-gray-900">
                      {o.itemsCount}
                      <div className="text-xs text-gray-400">
                        {[o.holdsCount ? `${o.holdsCount}H` : "", o.proformasCount ? `${o.proformasCount}PI` : "", o.packingListsCount ? `${o.packingListsCount}PL` : "", o.invoicesCount ? `${o.invoicesCount}INV` : ""].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="py-2 text-gray-600">{dmy(o.updatedAt)}</td>
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
              <button type="button" className={BTN} disabled={data.page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
              <button type="button" className={BTN} disabled={data.page >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
