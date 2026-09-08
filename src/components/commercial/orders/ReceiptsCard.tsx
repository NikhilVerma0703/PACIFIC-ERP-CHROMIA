"use client";
// Money received against the order (answer 29): the list, a row to add one,
// and delete for the manager. The first ADVANCE is what lets the truck leave
// (answer 2), so the card says plainly whether that fact is in place — a clerk
// looking for why dispatch is refused should find the answer here, not in a
// 409.
import { useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { postJson, deleteJson } from "@/lib/fab/postJson";
import type { OrderTabProps, ReceiptDto } from "@/lib/commercial/types";
import { RECEIPT_KINDS, RECEIPT_KIND_LABEL, fmtReceiptAmount, receiptTotals, todayIst, canRecordReceipt } from "@/lib/commercial/receipts-rules";
import { BTN_DANGER, BTN_PRIMARY, INPUT, ErrorNote, OkNote, Field, dmy } from "./fields";

interface Draft { kind: string; amount: string; currency: string; receivedAt: string; mode: string; reference: string; notes: string }

const blank = (currency: string): Draft => ({ kind: "ADVANCE", amount: "", currency, receivedAt: todayIst(new Date()), mode: "", reference: "", notes: "" });

export function ReceiptsCard({ order, actions, refresh }: OrderTabProps) {
  const mayWrite = actions.includes("write");
  const mayDelete = actions.includes("approve");
  const receipts: ReceiptDto[] = order.receipts ?? [];
  const [d, setD] = useState<Draft>(() => blank(order.currency));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K) => (v: string) => { setD((x) => ({ ...x, [k]: v })); setSaved(null); };

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
  // The same rule the POST route runs (canRecordReceipt): a closed or
  // cancelled order takes no more money. Asked here too so the clerk reads it
  // before typing an amount rather than after, in a 409.
  const recordable = canRecordReceipt(order.status);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Receipts</h2>
          <p className="mt-1 text-xs text-gray-400">Advance, CAD, balance and other money received against this order. The first advance is what lets the truck leave.</p>
        </div>
        {order.advanceReceived ? <Badge tone="green">Advance received</Badge> : <Badge tone="amber">No advance yet</Badge>}
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
                  <td className="py-2 pr-3 text-right font-medium text-gray-900">{fmtReceiptAmount(r.amount, r.currency)}</td>
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
