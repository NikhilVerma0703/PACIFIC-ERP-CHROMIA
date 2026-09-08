"use client";
// Money received against the order (answer 29): the list, a row to add one,
// and delete for the manager.
//
// THE ADVANCE IS A FIGURE HERE, NOT A TICK (round two, answer 11). What the
// order asks for, what has arrived in the order's own currency, and what is
// still short are all on the card, because "why is dispatch refused" is asked
// at this card and must be answerable without reading a 409. Advance money in
// another currency is listed in the table like any other receipt and said, in
// words, not to count — this module has no exchange table.
//
// And the waiver (answer 12): who lifted the gate, when, and why, with the
// button to set or lift it. A login without `cancel` sees that button
// disabled with the reason beside it rather than not at all.
import { useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { postJson, deleteJson } from "@/lib/fab/postJson";
import type { OrderTabProps, ReceiptDto } from "@/lib/commercial/types";
import {
  RECEIPT_KINDS, RECEIPT_KIND_LABEL, fmtReceiptAmount, receiptTotals, todayIst, canRecordReceipt,
  advanceBadge, advanceShortfall, fmtPct, countsTowardAdvance,
} from "@/lib/commercial/receipts-rules";
import { orderTotals } from "@/lib/commercial/orders-rules";
import { BTN, BTN_DANGER, BTN_PRIMARY, INPUT, ErrorNote, OkNote, Field, StatBox, dmy, dmyTime } from "./fields";

const WAIVE_HINT = "Only the Commercial Manager or an admin waives the advance";

interface Draft { kind: string; amount: string; currency: string; receivedAt: string; mode: string; reference: string; notes: string }

const blank = (currency: string): Draft => ({ kind: "ADVANCE", amount: "", currency, receivedAt: todayIst(new Date()), mode: "", reference: "", notes: "" });

export function ReceiptsCard({ order, actions, refresh }: OrderTabProps) {
  const mayWrite = actions.includes("write");
  const mayDelete = actions.includes("approve");
  // Waiving is the same desk that cancels an order or a PI (answer 12).
  const mayWaive = actions.includes("cancel");
  const receipts: ReceiptDto[] = order.receipts ?? [];
  const [d, setD] = useState<Draft>(() => blank(order.currency));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [waiving, setWaiving] = useState(false);
  const [waiverReason, setWaiverReason] = useState("");
  const set = <K extends keyof Draft>(k: K) => (v: string) => { setD((x) => ({ ...x, [k]: v })); setSaved(null); };

  async function waive() {
    setBusy("waive");
    setError(null);
    setSaved(null);
    const res = await postJson(`/api/office/commercial/orders/${order.id}/advance-waiver`, { reason: waiverReason.trim() });
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "The advance was not waived."); return; }
    setWaiving(false);
    setWaiverReason("");
    setSaved("The advance is waived — this order may be dispatched without it.");
    refresh();
  }

  async function liftWaiver() {
    setBusy("lift");
    setError(null);
    setSaved(null);
    const res = await deleteJson(`/api/office/commercial/orders/${order.id}/advance-waiver`);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "The waiver was not lifted."); return; }
    setSaved("The waiver is lifted — the advance is asked for again.");
    refresh();
  }

  async function add() {
    setBusy("add");
    setError(null);
    setSaved(null);
    const res = await postJson(`/api/office/commercial/orders/${order.id}/receipts`, {
      kind: d.kind, amount: d.amount.trim(), currency: d.currency.trim() || order.currency, receivedAt: d.receivedAt,
      mode: d.mode.trim() || null, reference: d.reference.trim() || null, notes: d.notes.trim() || null,
    });
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "The receipt was not recorded."); return; }
    setD(blank(order.currency));
    setSaved("Receipt recorded.");
    refresh();
  }

  async function remove(r: ReceiptDto) {
    if (!window.confirm(`Delete the ${RECEIPT_KIND_LABEL[r.kind]} receipt of ${fmtReceiptAmount(r.amount, r.currency)}? The log keeps a record of it.`)) return;
    setBusy(r.id);
    setError(null);
    setSaved(null);
    const res = await deleteJson(`/api/office/commercial/orders/${order.id}/receipts/${r.id}`);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "The receipt was not deleted."); return; }
    setSaved("Receipt deleted.");
    refresh();
  }

  const totals = receiptTotals(receipts);
  const advance = order.advance;
  // The order has no total column — it is the sum of the priced lines, the
  // same sum the server took the percentage of, so the card and the gate
  // cannot drift.
  const orderTotal = orderTotals(order.items ?? []).amount;
  const short = advanceShortfall(advance);
  // The same rule the POST route runs (canRecordReceipt): a closed or
  // cancelled order takes no more money. Asked here too so the clerk reads it
  // before typing an amount rather than after, in a 409.
  const recordable = canRecordReceipt(order.status);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Receipts</h2>
          <p className="mt-1 text-xs text-gray-400">Advance, CAD, balance and other money received against this order. The advance is what lets the truck leave.</p>
        </div>
        <Badge tone={advance.waived ? "brand" : advance.satisfied ? "green" : "amber"}>{advanceBadge(advance, order.currency)}</Badge>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatBox
          label="Advance asked"
          value={advance.required > 0 ? fmtReceiptAmount(advance.required, order.currency) : "—"}
          hint={orderTotal > 0
            ? `${fmtPct(advance.pct)} of ${fmtReceiptAmount(orderTotal, order.currency)}`
            : `${fmtPct(advance.pct)} — the order has no priced lines yet`}
        />
        <StatBox
          label={`Received (advance, ${order.currency})`}
          value={fmtReceiptAmount(advance.receivedAdvance, order.currency)}
          hint="Only ADVANCE receipts in the order's own currency count."
        />
        <StatBox
          label="Still short"
          value={short > 0 ? fmtReceiptAmount(short, order.currency) : "Nothing"}
          tone={advance.satisfied ? "good" : "warn"}
          hint={advance.satisfied ? "Dispatch is open." : "Dispatch is refused until this is in, or waived."}
        />
      </div>

      {advance.reason && (
        <p className={`mb-4 rounded-xl border px-4 py-3 text-sm ${advance.satisfied ? "border-gray-200 bg-gray-50 text-gray-600" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {advance.reason}
        </p>
      )}

      {/* Answer 12: the waiver, by name, with its reason — and the way to
          set or lift it. Refused rather than hidden for a login without cancel. */}
      <div className="mb-4 rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{order.advanceWaivedAt ? "The advance is waived" : "Advance waiver"}</h3>
            {order.advanceWaivedAt ? (
              <p className="mt-1 text-sm text-gray-600">
                Waived by <span className="font-medium text-gray-900">{order.advanceWaivedByName ?? "—"}</span> on {dmyTime(order.advanceWaivedAt)}
                {order.advanceWaivedReason ? <> — {order.advanceWaivedReason}</> : null}
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">The Commercial Manager may let a truck go without the advance, with a reason. Nothing is waived on this order.</p>
            )}
          </div>
          {order.advanceWaivedAt ? (
            <button type="button" className={BTN} disabled={!mayWaive || busy !== null} title={mayWaive ? undefined : WAIVE_HINT} onClick={() => void liftWaiver()}>
              {busy === "lift" ? "Lifting…" : "Lift the waiver"}
            </button>
          ) : !waiving ? (
            <button type="button" className={BTN} disabled={!mayWaive || busy !== null} title={mayWaive ? undefined : WAIVE_HINT} onClick={() => setWaiving(true)}>
              Waive the advance…
            </button>
          ) : null}
        </div>
        {!mayWaive && <p className="mt-2 text-xs text-amber-700">{WAIVE_HINT}.</p>}
        {waiving && !order.advanceWaivedAt && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <label className="min-w-[18rem] flex-1">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-amber-800">Reason for waiving (required)</span>
              <input className={INPUT} value={waiverReason} placeholder="Customer is on 30-day terms this once, approved by the owner"
                onChange={(e) => setWaiverReason(e.target.value)} />
            </label>
            <button type="button" className={BTN_PRIMARY} disabled={!waiverReason.trim() || busy !== null} onClick={() => void waive()}>
              {busy === "waive" ? "Waiving…" : "Waive the advance"}
            </button>
            <button type="button" className={BTN} disabled={busy !== null} onClick={() => { setWaiving(false); setWaiverReason(""); }}>Keep the gate</button>
          </div>
        )}
      </div>

      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      {saved && <div className="mb-3"><OkNote>{saved}</OkNote></div>}

      {receipts.length === 0 ? (
        <Empty>Nothing received yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2 pr-3 font-medium">Kind</th>
                <th className="py-2 pr-3 text-right font-medium">Amount</th>
                <th className="py-2 pr-3 font-medium">Received on</th>
                <th className="py-2 pr-3 font-medium">Mode</th>
                <th className="py-2 pr-3 font-medium">Reference</th>
                <th className="py-2 pr-3 font-medium">Recorded by</th>
                {mayDelete && <th className="py-2 font-medium" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3"><Badge tone={r.kind === "ADVANCE" ? "green" : "brand"}>{RECEIPT_KIND_LABEL[r.kind] ?? r.kind}</Badge></td>
                  <td className="py-2 pr-3 text-right font-medium text-gray-900">
                    {fmtReceiptAmount(r.amount, r.currency)}
                    {/* Listed, never converted: an advance in another currency
                        is money that arrived and does not open the gate. The
                        flag asks the RULE (countsTowardAdvance), not the two
                        strings: advanceStatus compares currencies case-blind,
                        and a card that compared them exactly would call a
                        receipt typed "usd" uncounted while the gate counted it. */}
                    {r.kind === "ADVANCE" && !countsTowardAdvance(r, order.currency) && (
                      <div className="text-xs font-normal text-amber-700">not counted — not {order.currency}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-gray-600">{dmy(r.receivedAt)}</td>
                  <td className="py-2 pr-3 text-gray-600">{r.mode ?? "—"}</td>
                  <td className="py-2 pr-3 text-gray-600">
                    {r.reference ?? "—"}
                    {r.notes && <div className="text-xs text-gray-400">{r.notes}</div>}
                  </td>
                  <td className="py-2 pr-3 text-gray-600">{r.recordedByName ?? "—"}</td>
                  {mayDelete && (
                    <td className="py-2 text-right">
                      <button type="button" className={BTN_DANGER} disabled={busy !== null} onClick={() => void remove(r)}>
                        {busy === r.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              {totals.map((t) => (
                <tr key={t.currency} className="border-t border-gray-200 text-xs text-gray-500">
                  <td className="py-2 pr-3">Total {t.currency}</td>
                  <td className="py-2 pr-3 text-right font-medium text-gray-900">{fmtReceiptAmount(t.total, t.currency)}</td>
                  <td className="py-2 pr-3" colSpan={mayDelete ? 5 : 4}>
                    {RECEIPT_KINDS.filter((k) => t.byKind[k]).map((k) => `${RECEIPT_KIND_LABEL[k].split(" ")[0]} ${fmtReceiptAmount(t.byKind[k] ?? 0, t.currency)}`).join(" · ")}
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}

      {mayWrite && recordable.ok && (
        <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 p-4 md:grid-cols-4">
          <Field label="Kind">
            <select className={INPUT} value={d.kind} onChange={(e) => set("kind")(e.target.value)}>
              {RECEIPT_KINDS.map((k) => <option key={k} value={k}>{RECEIPT_KIND_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Amount" hint="At most 2 decimals.">
            <input className={INPUT} inputMode="decimal" value={d.amount} placeholder="5000.00" onChange={(e) => set("amount")(e.target.value)} />
          </Field>
          <Field label="Currency" hint={`Blank means ${order.currency}.`}>
            <input className={INPUT} value={d.currency} onChange={(e) => set("currency")(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Received on">
            <input type="date" className={INPUT} value={d.receivedAt} max={todayIst(new Date())} onChange={(e) => set("receivedAt")(e.target.value)} />
          </Field>
          <Field label="Mode" hint="TT / NEFT / RTGS / cheque / LC.">
            <input className={INPUT} value={d.mode} onChange={(e) => set("mode")(e.target.value)} />
          </Field>
          <Field label="Reference" hint="UTR, swift or cheque number.">
            <input className={INPUT} value={d.reference} onChange={(e) => set("reference")(e.target.value)} />
          </Field>
          <Field label="Notes">
            <input className={INPUT} value={d.notes} onChange={(e) => set("notes")(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <button type="button" className={BTN_PRIMARY} disabled={busy !== null || !d.amount.trim() || !d.receivedAt} onClick={() => void add()}>
              {busy === "add" ? "Recording…" : "Record receipt"}
            </button>
          </div>
        </div>
      )}
      {mayWrite && !recordable.ok && (
        <p className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">{recordable.reason}</p>
      )}
      {!mayDelete && receipts.length > 0 && (
        <p className="mt-3 text-xs text-gray-400">Only the Commercial Manager or an admin deletes a receipt.</p>
      )}
    </Card>
  );
}
