"use client";
// The order's stock tab: check what finished goods has for each line, hold the
// slabs you want for five days, and raise a production request for whatever is
// short. Below that, the holds already placed against this order and the
// requests already in the planning queue.
//
// Sample lines are left out of the "check stock" list on purpose. A free trade
// sample or a display stand is a free-text line (open question 28) with no
// design in finished goods; offering a stock check on it would always come back
// empty and teach the user to distrust the answer.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Card, Empty, H2, fmt } from "@/components/ui";
import { postJson } from "@/lib/fab/postJson";
import { StockPicker, type StockSearchResult } from "@/components/commercial/stock/StockPicker";
import { HoldsPanel } from "@/components/commercial/stock/HoldsPanel";
import { shortfallOffer } from "@/lib/commercial/holds-rules";
import { label as statusLabel } from "@/lib/commercial/production-rules";
import type { OrderTabProps, OrderItemDto } from "@/lib/commercial/types";

const btn = "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimary = "rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const input = "rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none";

const REQ_TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  QUEUED: "amber", SCHEDULED: "brand", IN_PRODUCTION: "brand", PRODUCED: "green", CANCELLED: "red",
};

export default function StockTab({ order, actions, refresh }: OrderTabProps) {
  const canWrite = actions.includes("write");
  const [lineId, setLineId] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [result, setResult] = useState<StockSearchResult | null>(null);
  const [reference, setReference] = useState(order.number);
  const [days, setDays] = useState("");
  const [holdNotes, setHoldNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqNotes, setReqNotes] = useState("");
  const [reqQty, setReqQty] = useState("");

  // THE REFERENCES THIS ORDER MAY HOLD STOCK UNDER — its own number and, when
  // it came from one, its enquiry's (holds placed before the conversion carry
  // that). This used to be a free-text box, and the server took whatever it
  // said: typing another team's PI number made this module treat that team's
  // reserved slabs as its own to release and to pack. The server now refuses
  // anything off this list, so the screen offers the list instead of inviting
  // a string it will reject.
  const allowedRefs = useMemo(
    () => [order.number, order.enquiry?.number].filter((v): v is string => typeof v === "string" && v.trim() !== ""),
    [order.number, order.enquiry?.number],
  );
  const stockLines = useMemo(() => order.items.filter((i) => !i.isSample), [order.items]);
  const line: OrderItemDto | null = useMemo(() => stockLines.find((i) => i.id === lineId) ?? null, [stockLines, lineId]);
  const holdDays = result?.holdDays ?? 5;
  const offer = shortfallOffer(line?.qtySlabs ?? null, result?.total ?? 0);

  function openLine(it: OrderItemDto) {
    setLineId(it.id);
    setSelected([]);
    setResult(null);
    setError(null); setNote(null);
    setReqOpen(false); setReqNotes(""); setReqQty("");
    setReference(order.number);
  }

  async function placeHold() {
    if (!selected.length) return;
    setBusy(true); setError(null); setNote(null);
    const r = await postJson(`/api/office/commercial/orders/${order.id}/holds`, {
      slabNumbers: selected,
      reference: reference.trim() || undefined,
      days: days.trim() ? Number(days) : undefined,
      notes: holdNotes.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Could not place the hold"); return; }
    const skipped: Array<{ slab: number; reason: string }> = r.data?.skipped ?? [];
    const missing: number[] = r.data?.missing ?? [];
    setNote(`${r.data?.updated ?? 0} slab(s) held under ${r.data?.hold?.reference ?? reference}`
      + (skipped.length ? ` — ${skipped.length} skipped (${skipped.slice(0, 3).map((s) => `${s.slab}: ${s.reason}`).join("; ")}${skipped.length > 3 ? "…" : ""})` : "")
      + (missing.length ? ` — not in stock: ${missing.join(", ")}` : "")
      + ".");
    setSelected([]); setHoldNotes("");
    refresh();
  }

  async function raiseRequest() {
    if (!line) return;
    setBusy(true); setError(null); setNote(null);
    const required = reqQty.trim() ? Number(reqQty) : (line.qtySlabs ?? 0);
    const r = await postJson(`/api/office/commercial/orders/${order.id}/production-requests`, {
      orderItemId: line.id,
      design: result?.design ?? line.design,
      thickness: line.thickness ?? result?.thickness,
      finish: line.finish ?? undefined,
      qtyRequired: required,
      qtyAvailable: result?.total ?? 0,
      notes: reqNotes.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Could not raise the request"); return; }
    setNote(`Production request raised for ${r.data?.qtyShort ?? "the"} slab(s) — position ${r.data?.priority ?? "?"} in the queue.`);
    setReqOpen(false); setReqNotes(""); setReqQty("");
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <H2>Lines to check</H2>
        {stockLines.length === 0 ? (
          <Empty>This order has no stock line yet — add items on the Items tab.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">Design</th>
                  <th className="px-2 py-2 text-left">Customer SKU</th>
                  <th className="px-2 py-2 text-left">Thickness</th>
                  <th className="px-2 py-2 text-left">Finish</th>
                  <th className="px-2 py-2 text-right">Slabs needed</th>
                  <th className="px-2 py-2 text-right">Held so far</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stockLines.map((it) => {
                  const heldForLine = order.holds
                    .filter((h) => h.status === "ACTIVE")
                    .reduce((n, h) => n + h.slabs.filter((s) => s.releasedAt == null
                      && (it.design ? (s.design ?? "").toLowerCase() === it.design.toLowerCase() : true)
                      && (it.thickness ? (s.thickness ?? "") === it.thickness : true)).length, 0);
                  return (
                    <tr key={it.id} className={lineId === it.id ? "bg-brand/5" : ""}>
                      <td className="px-2 py-2 text-gray-500">{it.lineNo}</td>
                      <td className="px-2 py-2 font-medium text-gray-900">{it.design ?? "—"}</td>
                      <td className="px-2 py-2 text-gray-500">{it.customerSku ?? "—"}</td>
                      <td className="px-2 py-2">{it.thickness ?? "—"}</td>
                      <td className="px-2 py-2">{it.finish ?? "—"}</td>
                      <td className="px-2 py-2 text-right">{it.qtySlabs ?? "—"}</td>
                      <td className="px-2 py-2 text-right">{heldForLine || "—"}</td>
                      <td className="px-2 py-2 text-right">
                        <button type="button" className={btn} disabled={!it.design} onClick={() => openLine(it)}>
                          {lineId === it.id ? "Checking" : "Check stock"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {line && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <H2>Stock for line {line.lineNo} — {line.design}{line.thickness ? ` ${line.thickness}` : ""}</H2>
            <button type="button" className={`${btn} ml-auto`} onClick={() => { setLineId(null); setSelected([]); setResult(null); }}>Close</button>
          </div>

          <StockPicker
            key={line.id}
            design={line.design ?? ""}
            thickness={line.thickness}
            required={line.qtySlabs}
            autoSearch
            selected={selected}
            onSelectedChange={setSelected}
            onResult={setResult}
          />

          {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {note && <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{note}</div>}

          {canWrite && (
            <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Hold reference</span>
                {allowedRefs.length > 1 ? (
                  <select className={`${input} w-64`} value={reference} onChange={(e) => setReference(e.target.value)}>
                    {allowedRefs.map((r) => (
                      <option key={r} value={r}>{r === order.number ? `${r} (this order)` : `${r} (enquiry)`}</option>
                    ))}
                  </select>
                ) : (
                  <input className={`${input} w-64 bg-gray-50`} value={reference} readOnly title="Stock is held against this order's own number" />
                )}
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Days ({holdDays} by default)</span>
                <input className={`${input} w-28`} type="number" min={1} max={60} value={days} placeholder={String(holdDays)} onChange={(e) => setDays(e.target.value)} />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Note</span>
                <input className={`${input} w-full`} value={holdNotes} onChange={(e) => setHoldNotes(e.target.value)} placeholder="Customer to confirm by Friday" />
              </label>
              <button type="button" className={btnPrimary} disabled={busy || selected.length === 0} onClick={() => void placeHold()}>
                Place hold on {selected.length} slab(s)
              </button>
            </div>
          )}

          {canWrite && offer.offer && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-amber-900">
                <span>
                  Stock has {result?.total ?? 0} slab(s); this line needs {line.qtySlabs}.
                  <strong className="ml-1">{offer.short} short.</strong>
                </span>
                {!reqOpen && (
                  <button type="button" className={`${btn} ml-auto bg-white`} onClick={() => { setReqOpen(true); setReqQty(String(line.qtySlabs ?? "")); }}>
                    Raise production request for the shortfall
                  </button>
                )}
              </div>
              {reqOpen && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-amber-700">Slabs needed</span>
                    <input className={`${input} w-28`} type="number" min={1} value={reqQty} onChange={(e) => setReqQty(e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-amber-700">In stock</span>
                    <input className={`${input} w-28 bg-gray-50`} value={result?.total ?? 0} readOnly />
                  </label>
                  <label className="flex flex-1 flex-col gap-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-amber-700">Note for the planner</span>
                    <input className={`${input} w-full`} value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} placeholder="Ship by 20 Sep; same batch preferred" />
                  </label>
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => void raiseRequest()}>Raise request</button>
                  <button type="button" className={btn} onClick={() => setReqOpen(false)}>Cancel</button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <Card>
        <H2>Holds on this order</H2>
        <HoldsPanel holds={order.holds} canWrite={canWrite} onChanged={refresh} defaultDays={holdDays} />
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <H2>Production requests</H2>
          <Link href="/office/commercial/production-planning" className="ml-auto text-sm text-brand hover:underline">Open the planning queue →</Link>
        </div>
        {order.productionRequests.length === 0 ? (
          <Empty>Nothing has been asked of production for this order.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-2 py-2 text-left">Design</th>
                  <th className="px-2 py-2 text-left">Thickness</th>
                  <th className="px-2 py-2 text-right">Needed</th>
                  <th className="px-2 py-2 text-right">In stock</th>
                  <th className="px-2 py-2 text-right">Short</th>
                  <th className="px-2 py-2 text-right">Queue</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left">Raised</th>
                  <th className="px-2 py-2 text-left">Planned batch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {order.productionRequests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-2 font-medium text-gray-900">{r.design}</td>
                    <td className="px-2 py-2">{r.thickness}</td>
                    <td className="px-2 py-2 text-right">{fmt(r.qtyRequired)}</td>
                    <td className="px-2 py-2 text-right">{fmt(r.qtyAvailable)}</td>
                    <td className="px-2 py-2 text-right font-semibold">{fmt(r.qtyShort)}</td>
                    <td className="px-2 py-2 text-right text-gray-500">#{r.priority}</td>
                    <td className="px-2 py-2"><Badge tone={REQ_TONE[r.status] ?? "brand"}>{statusLabel(r.status)}</Badge></td>
                    <td className="px-2 py-2 text-gray-500">{new Date(r.raisedAt).toLocaleDateString("en-IN")} · {r.raisedByName ?? "—"}</td>
                    <td className="px-2 py-2 text-gray-500">{r.plannedBatch ?? "—"}</td>
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
