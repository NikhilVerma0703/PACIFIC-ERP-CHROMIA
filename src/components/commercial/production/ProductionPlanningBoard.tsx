"use client";
// The Production Planning queue.
//
// The owner's rule: a shortfall lands HERE first and nobody is messaged until
// the planner has seen it (notify channels are off in Settings). So this screen
// is the notification. It shows, in the order the plant should run them, what
// Commercial is short of, for whose order, how short, and how long it has been
// waiting — with the cleaning note between designs typed per run (open question
// 14: free text, not a fixed light-to-dark table) and a hint counting the slabs
// finished goods has actually received since each request was raised, because
// "produced" is marked by hand (open question 15).
//
// Reordering is drag-and-drop with ▲▼ beside it: the planner may be on a
// tablet, where a drag across a scrolling list is unreliable. Both send the
// same thing — the FULL ordered list of ids — so the server never has to guess
// what moved. Everything that changes the plan is gated on `plan`; a login
// without it reads the queue and nothing more.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Card, Empty, H2, Kpi, fmt } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { patchJson } from "@/lib/fab/postJson";
import {
  moveInList, reorderOnDrop, nextStatusButtons, canChangeStatus, label as statusLabel, OPEN_STATUSES,
} from "@/lib/commercial/production-rules";

const DRAG_TYPE = "application/x-commercial-production-request";

const btn = "rounded-lg border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-700 transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";
const input = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none";

const TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  QUEUED: "amber", SCHEDULED: "brand", IN_PRODUCTION: "brand", PRODUCED: "green", CANCELLED: "red",
};

interface QueueRow {
  id: string;
  design: string;
  thickness: string;
  finish: string | null;
  qtyRequired: number;
  qtyAvailable: number;
  qtyShort: number;
  priority: number;
  status: string;
  cleaningNote: string | null;
  plannedBatch: string | null;
  notes: string | null;
  raisedByName: string | null;
  raisedAt: string;
  scheduledAt: string | null;
  startedAt: string | null;
  producedAt: string | null;
  cancelledAt: string | null;
  producedBatchKeys: string[];
  notifiedVia: string | null;
  order: { id: string; number: string; status: string; client: { id: string; name: string } | null } | null;
}

interface ListReply { items: QueueRow[]; total: number; page: number; limit: number }

function ageDays(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function ProductionPlanningBoard({ actions }: { actions: string[] }) {
  const mayPlan = canChangeStatus(actions);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [history, setHistory] = useState<QueueRow[]>([]);
  const [order, setOrder] = useState<string[]>([]);          // the ids in screen order
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [received, setReceived] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, { cleaningNote: string; plannedBatch: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [qr, hr] = await Promise.all([
      fetch(`/api/office/commercial/production-requests?status=${OPEN_STATUSES.join(",")}&limit=200`, { cache: "no-store" }),
      fetch("/api/office/commercial/production-requests?status=PRODUCED,CANCELLED&limit=30", { cache: "no-store" }),
    ]);
    const queue = await readJson<ListReply>(qr);
    const hist = await readJson<ListReply>(hr);
    setLoading(false);
    if (!queue.ok || !queue.data) { setError(queue.error ?? "Could not read the queue"); return; }
    setError(null);
    setRows(queue.data.items);
    setOrder(queue.data.items.map((r) => r.id));
    setDrafts(Object.fromEntries(queue.data.items.map((r) => [r.id, { cleaningNote: r.cleaningNote ?? "", plannedBatch: r.plannedBatch ?? "" }])));
    if (hist.ok && hist.data) setHistory(hist.data.items);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The "has production run?" hint, one call per queued row after the list is
  // in. Deliberately separate: it reads finished goods and must never hold the
  // queue itself up.
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const r of rows) {
        if (seen.current.has(r.id)) continue;
        seen.current.add(r.id);
        const res = await fetch(`/api/office/commercial/production-requests/${r.id}/suggest`, { cache: "no-store" });
        const j = await readJson<{ received: number }>(res);
        if (!alive) return;
        if (j.ok && j.data) setReceived((m) => ({ ...m, [r.id]: j.data!.received }));
      }
    })();
    return () => { alive = false; };
  }, [rows]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const ordered = useMemo(() => order.map((id) => byId.get(id)).filter((r): r is QueueRow => !!r), [order, byId]);

  async function commitOrder(ids: string[]) {
    setOrder(ids);                       // optimistic: the list must not jump under the cursor
    setBusy("reorder"); setError(null); setNote(null);
    const r = await patchJson("/api/office/commercial/production-requests/reorder", { ids });
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Could not save the new order"); void load(); return; }
    setNote(`Queue re-ordered — ${r.data?.updated ?? ids.length} request(s) renumbered.`);
    if (Array.isArray(r.data?.items)) {
      setRows(r.data.items as QueueRow[]);
      setOrder((r.data.items as QueueRow[]).map((x) => x.id));
    }
  }

  async function patchRow(id: string, body: Record<string, unknown>, said: string) {
    setBusy(id); setError(null); setNote(null);
    const r = await patchJson(`/api/office/commercial/production-requests/${id}`, body);
    setBusy(null);
    if (!r.ok) { setError(r.error ?? "Could not save"); return; }
    setNote(said);
    await load();
  }

  const kpis = useMemo(() => ({
    queued: rows.filter((r) => r.status === "QUEUED").length,
    scheduled: rows.filter((r) => r.status === "SCHEDULED").length,
    running: rows.filter((r) => r.status === "IN_PRODUCTION").length,
    slabs: rows.reduce((n, r) => n + r.qtyShort, 0),
  }), [rows]);

  if (loading && !rows.length) return <Empty>Loading the queue…</Empty>;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Queued" value={kpis.queued} />
        <Kpi label="Scheduled" value={kpis.scheduled} />
        <Kpi label="In production" value={kpis.running} />
        <Kpi label="Slabs short" value={fmt(kpis.slabs)} sub="across every open request" />
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {note && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{note}</div>}
      {!mayPlan && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          You can read the queue. Re-ordering, scheduling and marking produced belong to production planning.
        </div>
      )}

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <H2>The queue — lowest number runs first</H2>
          <button type="button" className={`${btn} ml-auto`} onClick={() => void load()}>Refresh</button>
        </div>

        {ordered.length === 0 ? (
          <Empty>Nothing is waiting on production.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {ordered.map((r, i) => {
              const d = drafts[r.id] ?? { cleaningNote: r.cleaningNote ?? "", plannedBatch: r.plannedBatch ?? "" };
              const hint = received[r.id];
              return (
                <li
                  key={r.id}
                  draggable={mayPlan && !busy}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, r.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(r.id);
                  }}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  onDragOver={(e) => { if (!mayPlan || !dragId) return; e.preventDefault(); setOverId(r.id); }}
                  onDragLeave={() => setOverId((o) => (o === r.id ? null : o))}
                  onDrop={(e) => {
                    if (!mayPlan) return;
                    e.preventDefault();
                    const id = e.dataTransfer.getData(DRAG_TYPE) || dragId;
                    setDragId(null); setOverId(null);
                    if (!id || id === r.id) return;
                    void commitOrder(reorderOnDrop(order, id, r.id));
                  }}
                  className={`rounded-xl border bg-white p-3 ${overId === r.id ? "border-brand ring-2 ring-brand/20" : "border-gray-200"} ${dragId === r.id ? "opacity-50" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">{i + 1}</span>
                    <div className="min-w-[180px]">
                      <div className="font-medium text-gray-900">{r.design}</div>
                      <div className="text-xs text-gray-500">{r.thickness}{r.finish ? ` · ${r.finish}` : ""}</div>
                    </div>
                    <div className="min-w-[110px] text-sm">
                      <div><span className="font-semibold text-gray-900">{fmt(r.qtyShort)}</span> slab(s) short</div>
                      <div className="text-xs text-gray-500">needed {fmt(r.qtyRequired)} · had {fmt(r.qtyAvailable)}</div>
                    </div>
                    <div className="min-w-[180px] text-sm">
                      {r.order ? (
                        <Link href={`/office/commercial/orders/${r.order.id}?tab=stock`} className="font-medium text-brand hover:underline">{r.order.number}</Link>
                      ) : <span className="text-gray-400">no order</span>}
                      <div className="text-xs text-gray-500">{r.order?.client?.name ?? "—"}</div>
                    </div>
                    <div className="min-w-[130px] text-xs text-gray-500">
                      raised {new Date(r.raisedAt).toLocaleDateString("en-IN")}
                      <div>{ageDays(r.raisedAt)} day(s) ago · {r.raisedByName ?? "—"}</div>
                    </div>
                    <Badge tone={TONE[r.status] ?? "brand"}>{statusLabel(r.status)}</Badge>
                    {hint !== undefined && (
                      <Badge tone={hint >= r.qtyShort ? "green" : hint > 0 ? "amber" : "brand"}>
                        {hint} received since
                      </Badge>
                    )}
                    {mayPlan && (
                      <span className="ml-auto flex items-center gap-1">
                        <button type="button" className={btn} disabled={i === 0 || !!busy} aria-label="Move up"
                          onClick={() => void commitOrder(moveInList(order, i, -1))}>▲</button>
                        <button type="button" className={btn} disabled={i === ordered.length - 1 || !!busy} aria-label="Move down"
                          onClick={() => void commitOrder(moveInList(order, i, 1))}>▼</button>
                      </span>
                    )}
                  </div>

                  {(r.notes || r.notifiedVia) && (
                    <div className="mt-2 text-xs text-gray-500">
                      {r.notes}
                      {r.notifiedVia && <span className="ml-2 text-gray-400">· told via {r.notifiedVia}</span>}
                    </div>
                  )}

                  {mayPlan ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
                      <label className="flex flex-1 flex-col gap-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Cleaning note</span>
                        <input
                          className={`${input} w-full`} value={d.cleaningNote}
                          placeholder="After Midnight Black — long flush, two idle passes"
                          onChange={(e) => setDrafts((m) => ({ ...m, [r.id]: { ...d, cleaningNote: e.target.value } }))}
                          onBlur={() => { if ((r.cleaningNote ?? "") !== d.cleaningNote) void patchRow(r.id, { cleaningNote: d.cleaningNote }, "Cleaning note saved."); }}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Planned batch</span>
                        <input
                          className={`${input} w-40`} value={d.plannedBatch} placeholder="B-2609"
                          onChange={(e) => setDrafts((m) => ({ ...m, [r.id]: { ...d, plannedBatch: e.target.value } }))}
                          onBlur={() => { if ((r.plannedBatch ?? "") !== d.plannedBatch) void patchRow(r.id, { plannedBatch: d.plannedBatch }, "Planned batch saved."); }}
                        />
                      </label>
                      <span className="flex flex-wrap items-center gap-1">
                        {nextStatusButtons(r.status).map((b) => (
                          <button key={b.to} type="button" className={btn} disabled={busy === r.id}
                            onClick={() => void patchRow(r.id, { status: b.to }, `${r.design} ${r.thickness} → ${statusLabel(b.to)}.`)}>
                            {b.label}
                          </button>
                        ))}
                      </span>
                    </div>
                  ) : (
                    (r.cleaningNote || r.plannedBatch) && (
                      <div className="mt-2 flex flex-wrap gap-4 border-t border-gray-100 pt-2 text-xs text-gray-500">
                        {r.cleaningNote && <span>Cleaning: {r.cleaningNote}</span>}
                        {r.plannedBatch && <span>Planned batch: {r.plannedBatch}</span>}
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <H2>Last 30 produced or cancelled</H2>
        {history.length === 0 ? (
          <Empty>Nothing has been produced or cancelled yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2 py-2 text-left">Design</th>
                  <th className="px-2 py-2 text-left">Thickness</th>
                  <th className="px-2 py-2 text-right">Short</th>
                  <th className="px-2 py-2 text-left">Order</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left">Ended</th>
                  <th className="px-2 py-2 text-left">Batches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-2 font-medium text-gray-900">{r.design}</td>
                    <td className="px-2 py-2">{r.thickness}</td>
                    <td className="px-2 py-2 text-right">{fmt(r.qtyShort)}</td>
                    <td className="px-2 py-2">
                      {r.order ? <Link href={`/office/commercial/orders/${r.order.id}?tab=stock`} className="text-brand hover:underline">{r.order.number}</Link> : "—"}
                    </td>
                    <td className="px-2 py-2"><Badge tone={TONE[r.status] ?? "brand"}>{statusLabel(r.status)}</Badge></td>
                    <td className="px-2 py-2 text-gray-500">
                      {r.producedAt ? new Date(r.producedAt).toLocaleDateString("en-IN")
                        : r.cancelledAt ? new Date(r.cancelledAt).toLocaleDateString("en-IN") : "—"}
                    </td>
                    <td className="px-2 py-2 text-gray-500">{r.producedBatchKeys?.length ? r.producedBatchKeys.join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
