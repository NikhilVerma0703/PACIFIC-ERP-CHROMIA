"use client";
// The order workspace's PI tab: every proforma revision of this order, and the
// five things anyone does with one — draft a new revision from the order as it
// stands, edit the draft's shipping facts, issue it, record the customer's
// acceptance, or withdraw it. The PDF opens in a new tab straight from the
// route, so what the customer gets is what the server rendered.
//
// Revisions come from the order detail (DESIGN.md §5 already includes them,
// snapshots and all), so a write here only has to call refresh().
//
// Nothing on this screen decides anything: the label, the badge tone, the
// warnings and the printed date all come from lib/commercial/proforma-rules,
// which the PI routes and the PDF use too and tests/commercialProforma.test.ts
// runs.
import { useMemo, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { postJson, patchJson } from "@/lib/fab/postJson";
import { statusTone, piLabel, orderWarnings, formatPiDate } from "@/lib/commercial/proforma-rules";
import type { OrderTabProps, ProformaDto, ProformaSnapshot } from "@/lib/commercial/types";
import {
  BTN, BTN_PRIMARY, BTN_DANGER, ErrorNote, OkNote, TextField, AreaField,
  dmy, dateInputValue, money, qty,
} from "../orders/fields";

interface DraftForm {
  deliveryDate: string;
  vessel: string;
  grossWeight: string;
  netWeight: string;
  discount: string;
  notes: string;
}

function formOf(s: ProformaSnapshot | null | undefined): DraftForm {
  return {
    deliveryDate: dateInputValue(s?.deliveryDate),
    vessel: s?.vessel ?? "",
    grossWeight: s?.grossWeight ?? "",
    netWeight: s?.netWeight ?? "",
    discount: s?.discount ? String(s.discount) : "",
    notes: s?.notes ?? "",
  };
}

export default function PiTab({ order, actions, refresh }: OrderTabProps) {
  const canWrite = actions.includes("write");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm>(formOf(null));
  const [open, setOpen] = useState<string | null>(null);

  const revisions = useMemo(
    () => [...(order.proformas ?? [])].sort((a, b) => b.revision - a.revision),
    [order.proformas],
  );
  const warnings = useMemo(
    () => orderWarnings({ items: order.items, consignee: order.consignee, client: order.client }),
    [order.items, order.consignee, order.client],
  );
  const live = revisions.find((p) => p.status === "ISSUED" || p.status === "ACCEPTED") ?? null;

  async function run(key: string, fn: () => Promise<{ ok: boolean; error: string | null }>, ok: string): Promise<boolean> {
    setBusy(key); setError(null); setDone(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "That did not work."); return false; }
    setDone(ok);
    refresh();
    return true;
  }

  const createDraft = () =>
    run("create", () => postJson(`/api/office/commercial/orders/${order.id}/proformas`, {}), "Draft revision built from the order.");

  const issue = (pi: ProformaDto) =>
    run(`issue:${pi.id}`, () => postJson(`/api/office/commercial/proformas/${pi.id}/issue`, {}),
      `${piLabel(pi.number, pi.revision)} issued — any earlier live revision is now superseded.`);

  const accept = (pi: ProformaDto) =>
    run(`accept:${pi.id}`, () => postJson(`/api/office/commercial/proformas/${pi.id}/accept`, {}),
      `${piLabel(pi.number, pi.revision)} recorded as accepted by the customer.`);

  function cancel(pi: ProformaDto) {
    const reason = window.prompt(`Cancel ${piLabel(pi.number, pi.revision)} — why?`, "");
    if (reason === null) return;
    void run(`cancel:${pi.id}`, () => postJson(`/api/office/commercial/proformas/${pi.id}/cancel`, { reason }),
      `${piLabel(pi.number, pi.revision)} cancelled.`);
  }

  async function saveDraft(pi: ProformaDto) {
    const ok = await run(`save:${pi.id}`, () => patchJson(`/api/office/commercial/proformas/${pi.id}`, {
      deliveryDate: form.deliveryDate || null,
      vessel: form.vessel || null,
      grossWeight: form.grossWeight || null,
      netWeight: form.netWeight || null,
      discount: form.discount.trim() === "" ? 0 : Number(form.discount),
      notes: form.notes || null,
    }), "Draft saved.");
    if (ok) setEditing(null);
  }

  function startEdit(pi: ProformaDto) {
    setForm(formOf(pi.snapshot));
    setEditing(pi.id);
    setOpen(pi.id);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-4">
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ul className="list-disc space-y-1 pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      <OkNote>{done}</OkNote>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500">
          The proforma carries the order&rsquo;s own number, <span className="font-medium text-gray-700">{order.number}</span>.
          Each rebuild is a new revision and only one may be live at a time — issuing supersedes the last.
          {live ? ` ${piLabel(live.number, live.revision)} is live.` : ""}
        </p>
        {canWrite && (
          <button className={BTN_PRIMARY} disabled={busy === "create"} onClick={() => void createDraft()}>
            {busy === "create" ? "Building…" : "Create draft from this order"}
          </button>
        )}
      </div>

      {revisions.length === 0 ? (
        <Empty>No proforma invoice yet. Build a draft from the order&rsquo;s items, check it, then issue it.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {revisions.map((pi) => {
            const s = pi.snapshot;
            const isOpen = open === pi.id;
            const isEditing = editing === pi.id;
            return (
              <Card key={pi.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-gray-900">{piLabel(pi.number, pi.revision)}</span>
                      <Badge tone={statusTone(pi.status)}>{pi.status.toLowerCase()}</Badge>
                      {s?.kind && <span className="text-xs uppercase tracking-wide text-gray-400">{s.kind}</span>}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Dated {formatPiDate(s?.date) || "—"} · Issued {dmy(pi.issuedAt)} · Valid until {dmy(pi.validUntil)} · Accepted {dmy(pi.acceptedAt)}
                      {pi.supersededAt ? ` · Superseded ${dmy(pi.supersededAt)}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-gray-900">{money(pi.totalAmount, pi.currency)}</div>
                    <div className="text-xs text-gray-500">{s?.totalSlabs ?? 0} slabs · {s?.lines?.length ?? 0} line(s)</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <a className={BTN} href={`/api/office/commercial/proformas/${pi.id}/pdf`} target="_blank" rel="noreferrer">Open PDF</a>
                  <button className={BTN} onClick={() => setOpen(isOpen ? null : pi.id)}>{isOpen ? "Hide detail" : "Show detail"}</button>
                  {canWrite && pi.status === "DRAFT" && (
                    <>
                      <button className={BTN} onClick={() => (isEditing ? setEditing(null) : startEdit(pi))}>
                        {isEditing ? "Stop editing" : "Edit draft"}
                      </button>
                      <button className={BTN_PRIMARY} disabled={busy === `issue:${pi.id}`} onClick={() => void issue(pi)}>
                        {busy === `issue:${pi.id}` ? "Issuing…" : "Issue"}
                      </button>
                    </>
                  )}
                  {canWrite && pi.status === "ISSUED" && (
                    <button className={BTN_PRIMARY} disabled={busy === `accept:${pi.id}`} onClick={() => void accept(pi)}>
                      {busy === `accept:${pi.id}` ? "Saving…" : "Customer accepted"}
                    </button>
                  )}
                  {canWrite && (pi.status === "DRAFT" || pi.status === "ISSUED" || pi.status === "ACCEPTED") && (
                    <button className={BTN_DANGER} disabled={busy === `cancel:${pi.id}`} onClick={() => cancel(pi)}>Cancel</button>
                  )}
                </div>

                {isEditing && (
                  <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <TextField label="Delivery date" type="date" value={form.deliveryDate} onChange={(v) => setForm({ ...form, deliveryDate: v })} />
                      <TextField label="Vessel / flight no" value={form.vessel} onChange={(v) => setForm({ ...form, vessel: v })} />
                      <TextField label={`Discount (${pi.currency})`} value={form.discount} onChange={(v) => setForm({ ...form, discount: v })}
                        hint="Comes off the total; the amount in words is rewritten." />
                      <TextField label="Gross weight" value={form.grossWeight} onChange={(v) => setForm({ ...form, grossWeight: v })} placeholder="e.g. 24,500 KGS" />
                      <TextField label="Net weight" value={form.netWeight} onChange={(v) => setForm({ ...form, netWeight: v })} placeholder="e.g. 23,100 KGS" />
                      <AreaField label={"Terms & conditions"} value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} rows={2}
                        hint={"Prints on the PI under Terms & Conditions."} className="sm:col-span-2 lg:col-span-1" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className={BTN_PRIMARY} disabled={busy === `save:${pi.id}`} onClick={() => void saveDraft(pi)}>
                        {busy === `save:${pi.id}` ? "Saving…" : "Save draft"}
                      </button>
                      <button className={BTN} onClick={() => setEditing(null)}>Discard changes</button>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      Parties, lines and rates are frozen from the order the moment a revision is built — to change those, edit the order and build a new revision.
                    </p>
                  </div>
                )}

                {isOpen && s && (
                  <div className="mt-4">
                    <div className="mb-3 grid grid-cols-1 gap-2 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
                      <div><span className="text-gray-400">Consignee: </span>{s.consignee?.name || "—"}</div>
                      <div><span className="text-gray-400">Notify: </span>{s.notifyParty?.name || "—"}</div>
                      <div><span className="text-gray-400">Delivery terms: </span>{s.deliveryTerms || "—"}</div>
                      <div><span className="text-gray-400">Payment terms: </span>{s.paymentTerms || "—"}</div>
                      <div><span className="text-gray-400">Port of loading: </span>{s.portOfLoading || "—"}</div>
                      <div><span className="text-gray-400">Port of discharge: </span>{s.portOfDischarge || "—"}</div>
                      <div><span className="text-gray-400">Vessel: </span>{s.vessel || "—"}</div>
                      <div><span className="text-gray-400">Gross / net: </span>{s.grossWeight || "—"} / {s.netWeight || "—"}</div>
                      <div><span className="text-gray-400">Bank: </span>{s.bank?.name || "—"}</div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                            <th className="py-2 pr-3">Item code</th>
                            <th className="py-2 pr-3">Description</th>
                            <th className="py-2 pr-3">Thick</th>
                            <th className="py-2 pr-3 text-right">Slabs</th>
                            <th className="py-2 pr-3">HSN</th>
                            <th className="py-2 pr-3">Unit</th>
                            <th className="py-2 pr-3 text-right">Quantity</th>
                            <th className="py-2 pr-3 text-right">Rate</th>
                            <th className="py-2 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(s.lines ?? []).map((l) => (
                            <tr key={l.lineNo} className="border-b border-gray-100">
                              <td className="py-1.5 pr-3">{l.itemCode ?? ""}</td>
                              <td className="py-1.5 pr-3">{l.description}{l.isSample ? " (sample)" : ""}</td>
                              <td className="py-1.5 pr-3">{l.thickness ?? ""}</td>
                              <td className="py-1.5 pr-3 text-right">{l.slabs ?? ""}</td>
                              <td className="py-1.5 pr-3">{l.hsn}</td>
                              <td className="py-1.5 pr-3">{l.unit}</td>
                              <td className="py-1.5 pr-3 text-right">{qty(l.qty)}</td>
                              <td className="py-1.5 pr-3 text-right">{l.rate}</td>
                              <td className="py-1.5 text-right">{money(l.amount)}</td>
                            </tr>
                          ))}
                          {s.discount ? (
                            <tr className="border-b border-gray-100 text-gray-600">
                              <td className="py-1.5 pr-3" colSpan={8}>Less: discount</td>
                              <td className="py-1.5 text-right">−{money(s.discount)}</td>
                            </tr>
                          ) : null}
                          <tr className="font-semibold">
                            <td className="py-2 pr-3">Total</td>
                            <td className="py-2 pr-3" colSpan={2} />
                            <td className="py-2 pr-3 text-right">{s.totalSlabs}</td>
                            <td className="py-2 pr-3" colSpan={4} />
                            <td className="py-2 text-right">{money(s.totalAmount)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-2 text-xs text-gray-500">{s.amountInWords}</p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
