"use client";
// The order log, newest first — every stage move, every edit, every hold, PI,
// packing list and invoice, with who did it and when.
//
// The order detail already carries the last 100 events, so the tab paints
// immediately from those; the pager then reads GET …/events?page=&limit=, which
// is the only way to reach the ones beyond 100. That matters on an order that
// has been through a rejected dispatch check — the log is the record of what
// happened, and "the first hundred" is not a record.
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import type { OrderTabProps, OrderEventDto } from "@/lib/commercial/types";
import { BTN, INPUT, ErrorNote, dmyTime } from "../orders/fields";

interface EventsPage { items: OrderEventDto[]; total: number; page: number; limit: number }

const LIMIT = 50;

/** The kinds, grouped the way somebody reading the log thinks about them. */
const TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  created: "brand", edited: "brand", note: "brand",
  stage: "amber", checklist: "amber", approved: "green",
  hold_placed: "brand", hold_released: "amber", hold_expired: "red",
  production_requested: "amber", production_produced: "green",
  pi_drafted: "brand", pi_edited: "brand", pi_issued: "green", pi_accepted: "green", pi_superseded: "amber", pi_revised: "amber", pi_cancelled: "red",
  receipt_recorded: "green", receipt_deleted: "red",
  plan_changed: "amber", slab_swapped: "amber",
  packing_created: "brand", packing_submitted: "amber", packing_verified: "green",
  packing_rejected: "red", packing_final: "green",
  invoice_created: "brand", invoice_edited: "brand", invoice_issued: "green", invoice_cancelled: "red",
  challan_created: "brand", challan_issued: "green", challan_cancelled: "red", export_docs: "brand",
  dispatched: "green", cancelled: "red",
};

const KIND_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "Everything" },
  { value: "created,edited,note", label: "Edits" },
  { value: "stage,cancelled", label: "Stage moves" },
  { value: "checklist,approved", label: "Checklist" },
  { value: "hold_placed,hold_released,hold_expired", label: "Stock holds" },
  { value: "production_requested,production_produced,plan_changed", label: "Production" },
  { value: "pi_drafted,pi_edited,pi_issued,pi_accepted,pi_superseded,pi_revised,pi_cancelled", label: "Proforma" },
  { value: "receipt_recorded,receipt_deleted", label: "Receipts" },
  { value: "packing_created,packing_submitted,packing_verified,packing_rejected,packing_final,slab_swapped", label: "Packing" },
  { value: "invoice_created,invoice_edited,invoice_issued,invoice_cancelled,challan_created,challan_issued,challan_cancelled,export_docs,dispatched", label: "Invoice and dispatch" },
];

export default function LogTab({ order }: OrderTabProps) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState("");
  // Seeded from the detail so the tab is never blank while the first read runs.
  const [data, setData] = useState<EventsPage>({ items: order.events ?? [], total: (order.events ?? []).length, page: 1, limit: LIMIT });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const u = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (kind) u.set("kind", kind);
    const r = await fetch(`/api/office/commercial/orders/${order.id}/events?${u.toString()}`, { cache: "no-store" });
    const res = await readJson<EventsPage>(r);
    setLoading(false);
    if (!res.ok || !res.data) { setError(res.error ?? "Could not read the log."); return; }
    setError(null);
    setData(res.data);
  }, [order.id, page, kind]);

  useEffect(() => { void load(); }, [load]);

  const pages = Math.max(1, Math.ceil(data.total / (data.limit || LIMIT)));

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Order log</h2>
          <p className="mt-1 text-xs text-gray-400">{data.total} entr{data.total === 1 ? "y" : "ies"}, newest first.</p>
        </div>
        <div className="flex items-end gap-2">
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Show</span>
            <select className={INPUT} value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
              {KIND_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <button type="button" className={BTN} disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {data.items.length === 0 ? (
        <Empty>Nothing recorded under this filter.</Empty>
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.items.map((e) => (
            <li key={e.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[e.kind] ?? "brand"}>{e.kind.replace(/_/g, " ")}</Badge>
                <span className="text-sm text-gray-900">{e.note ?? "—"}</span>
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {e.byName ?? "system"} · {dmyTime(e.at)}
              </div>
              {e.payload !== null && e.payload !== undefined && (
                <details className="mt-1">
                  <summary className="cursor-pointer list-none text-xs text-gray-400 hover:text-brand">details</summary>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-600">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      {data.total > (data.limit || LIMIT) && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
          <span>Page {data.page} of {pages}</span>
          <div className="flex gap-2">
            <button type="button" className={BTN} disabled={data.page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <button type="button" className={BTN} disabled={data.page >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </Card>
  );
}
