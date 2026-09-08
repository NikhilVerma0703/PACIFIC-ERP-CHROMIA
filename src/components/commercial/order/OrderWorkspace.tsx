"use client";
// The order workspace: one header, one fetch, eight tabs.
//
// THE ORDER DETAIL IS FETCHED ONCE, HERE, and handed to every tab as
// `OrderTabProps { order, actions, refresh }` (DESIGN.md §5). A tab that
// writes calls refresh() and the whole page re-reads — so the stage strip, the
// checklist and the stock tab can never disagree about the same order, which
// is what would happen if each tab fetched its own slice.
//
// The tabs are STATIC imports. Each one is a real file (a placeholder until
// its builder replaces it), and a static import means a typo in a tab's props
// is a compile error rather than a blank panel at runtime.
//
// A FAILED REFRESH DOES NOT TAKE THE SCREEN AWAY. refresh() runs after every
// write and on a tab's own say-so; if that read 500s or the session has
// lapsed, the last order that loaded stays on screen with a banner over it and
// a Try again button, so the open tab — and the draft the user is typing into
// it — is not unmounted. orderWorkspaceView (lib/commercial/orders-rules, run
// by tests/commercialOrders.test.ts) decides which of the three states this is.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { readJson } from "@/lib/readJson";
import { patchJson } from "@/lib/fab/postJson";
import { ORDER_STAGES, canEnter, isTerminal } from "@/lib/commercial/stages";
import { orderWorkspaceView, stageFactsOf } from "@/lib/commercial/orders-rules";
import type { OrderDetail, OrderTabProps } from "@/lib/commercial/types";
import { BTN, BTN_DANGER, INPUT, ErrorNote, STATUS_TONE, dmy, dmyTime } from "../orders/fields";
import OverviewTab from "./OverviewTab";
import ItemsTab from "./ItemsTab";
import StockTab from "./StockTab";
import PiTab from "./PiTab";
import PackingTab from "./PackingTab";
import InvoiceTab from "./InvoiceTab";
import DocumentsTab from "./DocumentsTab";
import LogTab from "./LogTab";

const CANCEL_HINT = "Only the Commercial Manager or an admin cancels an order";

const TABS: Array<{ key: string; label: string; render: (p: OrderTabProps) => React.ReactNode }> = [
  { key: "overview", label: "Overview", render: (p) => <OverviewTab {...p} /> },
  { key: "items", label: "Items", render: (p) => <ItemsTab {...p} /> },
  { key: "stock", label: "Stock", render: (p) => <StockTab {...p} /> },
  { key: "pi", label: "Proforma", render: (p) => <PiTab {...p} /> },
  { key: "packing", label: "Packing", render: (p) => <PackingTab {...p} /> },
  { key: "invoice", label: "Invoice", render: (p) => <InvoiceTab {...p} /> },
  { key: "documents", label: "Documents", render: (p) => <DocumentsTab {...p} /> },
  { key: "log", label: "Log", render: (p) => <LogTab {...p} /> },
];

export function OrderWorkspace({ orderId, actions, initialTab = "overview" }: { orderId: string; actions: string[]; initialTab?: string }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(TABS.some((t) => t.key === initialTab) ? initialTab : "overview");
  const [note, setNote] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const mayWrite = actions.includes("write");
  // Cancelling is the manager's (answer 24); the button stays visible to a
  // Commercial login, disabled, so the screen says who can rather than hiding it.
  const mayCancel = actions.includes("cancel");

  const load = useCallback(async () => {
    setReloading(true);
    try {
      const r = await fetch(`/api/office/commercial/orders/${orderId}`, { cache: "no-store" });
      const res = await readJson<OrderDetail>(r);
      // The order already on screen is NOT cleared: a failed refresh leaves the
      // last good copy up (with the banner below) rather than unmounting the tab.
      if (!res.ok || !res.data) { setError(res.error ?? "Could not read this order."); return; }
      setError(null);
      setOrder(res.data);
    } finally {
      setReloading(false);
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  const selectTab = useCallback((key: string) => {
    setTab(key);
    const u = new URLSearchParams(window.location.search);
    u.set("tab", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${u.toString()}`);
  }, []);

  async function moveTo(to: string, why?: string) {
    setMoving(to);
    setStageError(null);
    const body: Record<string, unknown> = { to };
    if (note.trim()) body.note = note.trim();
    if (why) body.reason = why;
    const res = await patchJson(`/api/office/commercial/orders/${orderId}/stage`, body);
    setMoving(null);
    if (!res.ok) { setStageError(res.error ?? "The stage did not change."); return; }
    setNote("");
    setReason("");
    setCancelling(false);
    await load();
  }

  const view = orderWorkspaceView({ order, error });
  // Only a first read that never landed owns the whole page.
  if (!view.showWorkspace || !order) {
    return view.fatal ? <ErrorNote>{view.fatal}</ErrorNote> : <Empty>Loading the order…</Empty>;
  }

  const stamps = order as unknown as Record<string, string | null>;
  const terminal = isTerminal(order.status);
  const strip = ORDER_STAGES.filter((s) => s.step);
  // The same facts the server hands canEnter (order-stage.loadStageFacts), read
  // off the detail, so a disabled stage carries the reason the route would 409
  // with — and a stage never disappears because a gate is shut (answers 1, 2, 10).
  const facts = stageFactsOf(order);
  const tabDef = TABS.find((t) => t.key === tab) ?? TABS[0];
  const tabProps: OrderTabProps = { order, actions, refresh: () => { void load(); } };

  return (
    <div className="flex flex-col gap-6">
      {view.stale && (
        <ErrorNote>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {view.stale} This is the last copy that loaded — anything you have typed is still here, but the order may have moved on since.
            </span>
            <button type="button" className={BTN} disabled={reloading} onClick={() => void load()}>
              {reloading ? "Trying…" : "Try again"}
            </button>
          </div>
        </ErrorNote>
      )}
      <div>
        <Link href="/office/commercial/orders" className="text-sm text-gray-400 hover:text-brand">← All orders</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{order.number}</h1>
          <Badge tone={order.kind === "EXPORT" ? "brand" : "green"}>{order.kind === "EXPORT" ? "Export" : "Domestic"}</Badge>
          <Badge tone={STATUS_TONE[order.status] ?? "brand"}>{ORDER_STAGES.find((s) => s.status === order.status)?.label ?? order.status}</Badge>
        </div>
        {/* The date under the number (answer 6). ORD/… is the order's own number; the PI carries SAL-ORD/…. */}
        <p className="text-xs text-gray-400">Order date {dmy(order.createdAt)}</p>
        <p className="mt-1 text-sm text-gray-500">
          <span className="font-medium text-gray-700">{order.client?.name ?? "—"}</span>
          {order.client?.country ? ` · ${order.client.country}` : ""}
          {order.customerPoNumber ? ` · PO ${order.customerPoNumber}` : ""}
          {order.customerPoDate ? ` (${dmy(order.customerPoDate)})` : ""}
          {order.enquiry ? <> · from enquiry <Link href={`/office/commercial/enquiries/${order.enquiry.id}`} className="text-brand hover:underline">{order.enquiry.number}</Link></> : null}
          {` · ${order.currency}`}
          {order.createdByName ? ` · raised by ${order.createdByName}` : ""}
        </p>
        {order.status === "CANCELLED" && order.cancelReason && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Cancelled: {order.cancelReason}</p>
        )}
      </div>

      <Card>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Pipeline</h2>
          <span className="text-xs text-gray-400">
            {terminal ? "This order has finished its pipeline." : mayWrite ? "Click a stage to move the order there. Every move is stamped and logged; a greyed stage says what it is waiting for." : "Read-only for this login."}
          </span>
        </div>
        {stageError && <div className="mb-3"><ErrorNote>{stageError}</ErrorNote></div>}
        {/* The three facts the gates read, beside the strip, so "why is PI issued greyed" is answered before it is asked. */}
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge tone={facts.stockChecked ? "green" : "amber"}>{facts.stockChecked ? "Stock checked · hold active" : "Stock not held"}</Badge>
          <Badge tone={facts.approved ? "green" : "amber"}>{facts.approved ? `Approved by ${order.approvedByName ?? "—"}` : "Not yet approved"}</Badge>
          <Badge tone={facts.advanceReceived ? "green" : "amber"}>{facts.advanceReceived ? "Advance received" : "No advance yet"}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {strip.map((s) => {
            const at = s.stamp ? stamps[s.stamp] : null;
            const here = order.status === s.status;
            const gate = here || terminal ? null : canEnter(order.status, s.status, facts);
            const refused = gate && !gate.ok ? gate.reason : null;
            const clickable = mayWrite && !terminal && !here && !refused;
            return (
              <button
                key={s.status}
                type="button"
                disabled={!clickable || moving !== null}
                title={refused ?? undefined}
                onClick={() => void moveTo(s.status)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${here ? "border-brand bg-brand/5" : at ? "border-green-200 bg-green-50/60" : refused ? "border-amber-200 bg-amber-50/40" : "border-gray-200"} ${clickable ? "hover:border-brand" : "cursor-default"} disabled:opacity-70`}
              >
                <span className={`block font-medium ${here ? "text-brand" : "text-gray-700"}`}>{s.label}</span>
                <span className="block text-xs text-gray-400">{moving === s.status ? "moving…" : at ? dmy(at) : "—"}</span>
                {refused && <span className="mt-1 block max-w-[14rem] text-xs text-amber-700">{refused}</span>}
              </button>
            );
          })}
        </div>
        {mayWrite && !terminal && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-[18rem] flex-1">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Note for the next move (optional)</span>
              <input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the order is moving" />
            </label>
            {!cancelling ? (
              <div className="flex flex-col items-end gap-1">
                <button type="button" className={BTN_DANGER} disabled={!mayCancel} title={mayCancel ? undefined : CANCEL_HINT} onClick={() => setCancelling(true)}>Cancel order…</button>
                {!mayCancel && <span className="text-xs text-gray-400">{CANCEL_HINT}</span>}
              </div>
            ) : (
              <div className="flex w-full flex-wrap items-end gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
                <label className="min-w-[18rem] flex-1">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-red-700">Reason for cancelling (required)</span>
                  <input className={INPUT} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer withdrew the PO" />
                </label>
                <button type="button" className={BTN_DANGER} disabled={!reason.trim() || moving !== null}
                  onClick={() => void moveTo("CANCELLED", reason.trim())}>
                  {moving === "CANCELLED" ? "Cancelling…" : "Cancel this order"}
                </button>
                <button type="button" className={BTN} onClick={() => { setCancelling(false); setReason(""); }}>Keep it</button>
              </div>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-gray-400">
          Created {dmyTime(order.createdAt)} · last change {dmyTime(order.updatedAt)}
          {order.checkedAt ? ` · checklist checked by ${order.checkedByName ?? "—"} on ${dmy(order.checkedAt)}` : ""}
          {order.approvedAt ? ` · approved by ${order.approvedByName ?? "—"} on ${dmy(order.approvedAt)}` : ""}
        </p>
      </Card>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex flex-wrap gap-1">
          {TABS.map((t) => {
            const on = t.key === tabDef.key;
            const count = t.key === "items" ? order.items.length
              : t.key === "stock" ? order.holds.length
              : t.key === "pi" ? order.proformas.length
              : t.key === "packing" ? order.packingLists.length
              : t.key === "invoice" ? order.invoices.length + order.challans.length
              : t.key === "log" ? order.events.length
              : 0;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => selectTab(t.key)}
                className={`border-b-2 px-4 py-2 text-sm font-medium transition ${on ? "border-brand text-brand" : "border-transparent text-gray-500 hover:text-gray-800"}`}
              >
                {t.label}
                {count > 0 && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{count}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      <div>{tabDef.render(tabProps)}</div>

      {!mayWrite && (
        <p className="text-xs text-gray-400">
          This login may read the module but not change it. <Link href="/office/commercial" className="text-brand hover:underline">Back to the overview</Link>.
        </p>
      )}
    </div>
  );
}
