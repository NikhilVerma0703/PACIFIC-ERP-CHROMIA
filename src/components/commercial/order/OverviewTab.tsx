"use client";
// The order header, editable in place, and the SOP checklist under it.
//
// The checklist is the point of this screen. It is the "Checklist for Internal
// Sales Order" sheet, 22 points, and the rule printed at the bottom of the
// paper one is the rule here: where a detail is missing, Commercial goes back
// to the sender for it. So the outstanding points are highlighted rather than
// hidden, and the count of them sits next to the Check and Approve buttons —
// approving with points open is allowed (nothing in this module is gated), but
// it is never accidental.
import { useEffect, useMemo, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { patchJson } from "@/lib/fab/postJson";
import type { OrderTabProps, Party } from "@/lib/commercial/types";
import { partiesFromClient, clientDefaults, type ClientLike } from "@/lib/commercial/orders-rules";
import { ClientPicker, type ClientRow } from "../orders/ClientPicker";
import {
  INPUT, BTN, BTN_PRIMARY, ErrorNote, OkNote, Field, TextField, AreaField, SelectField, PartyEditor,
  KIND_OPTIONS, PO_EVIDENCE_OPTIONS, partyToDraft, draftToParty, dateInputValue, dmy,
  type PartyDraft,
} from "../orders/fields";

interface HeaderDraft {
  kind: string;
  customerPoNumber: string;
  customerPoDate: string;
  poEvidence: string;
  currency: string;
  exchangeRate: string;
  incoterm: string;
  deliveryTerms: string;
  paymentTerms: string;
  paymentMode: string;
  preCarriageBy: string;
  placeOfReceipt: string;
  portOfLoading: string;
  portOfDischarge: string;
  finalDestination: string;
  countryOfOrigin: string;
  countryOfDestination: string;
  deliverySchedule: string;
  specialPacking: string;
  forwarderDetails: string;
  receiverDetails: string;
  customerContact: string;
  notes: string;
}

const t = (v: string | null | undefined): string => v ?? "";

function draftOf(o: OrderTabProps["order"]): HeaderDraft {
  return {
    kind: o.kind,
    customerPoNumber: t(o.customerPoNumber),
    customerPoDate: dateInputValue(o.customerPoDate),
    poEvidence: t(o.poEvidence),
    currency: t(o.currency),
    exchangeRate: o.exchangeRate === null || o.exchangeRate === undefined ? "" : String(o.exchangeRate),
    incoterm: t(o.incoterm),
    deliveryTerms: t(o.deliveryTerms),
    paymentTerms: t(o.paymentTerms),
    paymentMode: t(o.paymentMode),
    preCarriageBy: t(o.preCarriageBy),
    placeOfReceipt: t(o.placeOfReceipt),
    portOfLoading: t(o.portOfLoading),
    portOfDischarge: t(o.portOfDischarge),
    finalDestination: t(o.finalDestination),
    countryOfOrigin: t(o.countryOfOrigin),
    countryOfDestination: t(o.countryOfDestination),
    deliverySchedule: t(o.deliverySchedule),
    specialPacking: t(o.specialPacking),
    forwarderDetails: t(o.forwarderDetails),
    receiverDetails: t(o.receiverDetails),
    customerContact: t(o.customerContact),
    notes: t(o.notes),
  };
}

interface PartyDrafts { billTo: PartyDraft; consignee: PartyDraft; notifyParty: PartyDraft; buyerIfNotConsignee: PartyDraft }

function partyDraftsOf(o: OrderTabProps["order"]): PartyDrafts {
  return {
    billTo: partyToDraft(o.billTo),
    consignee: partyToDraft(o.consignee),
    notifyParty: partyToDraft(o.notifyParty),
    buyerIfNotConsignee: partyToDraft(o.buyerIfNotConsignee),
  };
}

export default function OverviewTab({ order, actions, refresh }: OrderTabProps) {
  const mayWrite = actions.includes("write");
  const mayApprove = actions.includes("write");     // canApprove() on the server refuses the dispatch checker
  const base = useMemo(() => draftOf(order), [order]);
  const baseParties = useMemo(() => partyDraftsOf(order), [order]);

  const [h, setH] = useState<HeaderDraft>(base);
  const [p, setP] = useState<PartyDrafts>(baseParties);
  const [newClient, setNewClient] = useState<ClientRow | null>(null);
  const [changingClient, setChangingClient] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // The order re-arrives after every write anywhere on the page; the form
  // follows it rather than holding a stale copy.
  useEffect(() => { setH(base); setP(baseParties); setNewClient(null); setChangingClient(false); }, [base, baseParties]);

  const dirty = JSON.stringify(h) !== JSON.stringify(base)
    || JSON.stringify(p) !== JSON.stringify(baseParties)
    || (newClient !== null && newClient.id !== order.clientId);

  const set = <K extends keyof HeaderDraft>(k: K) => (v: string) => { setH((x) => ({ ...x, [k]: v })); setSaved(null); };
  const setParty = (k: keyof PartyDrafts) => (v: PartyDraft) => { setP((x) => ({ ...x, [k]: v })); setSaved(null); };

  /** A different client brings its own printed blocks and terms — the same
   *  prefill the new-order form does, so a correction lands the same way a
   *  first choice would. */
  function pickClient(c: ClientRow) {
    setNewClient(c);
    setChangingClient(false);
    const ext = c.commercialExt ?? null;
    const parties = partiesFromClient(c as ClientLike, ext);
    setP({
      billTo: partyToDraft(parties.billTo as Party),
      consignee: partyToDraft(parties.consignee as Party),
      notifyParty: partyToDraft(parties.notifyParty as Party | null),
      buyerIfNotConsignee: p.buyerIfNotConsignee,
    });
    const cd = clientDefaults(c as ClientLike, ext);
    setH((x) => ({
      ...x,
      currency: cd.currency ?? x.currency,
      incoterm: cd.incoterm ?? x.incoterm,
      paymentTerms: cd.paymentTerms ?? x.paymentTerms,
      deliveryTerms: cd.deliveryTerms ?? x.deliveryTerms,
      portOfDischarge: cd.portOfDischarge ?? x.portOfDischarge,
      customerContact: cd.customerContact ?? x.customerContact,
    }));
    setSaved(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(null);
    const body: Record<string, unknown> = { ...h };
    // The route treats a present key as "set this" — an empty box therefore
    // clears the column, which is what clearing a box means. Currency and
    // country of origin are NOT NULL; the route ignores a blank for those.
    body.exchangeRate = h.exchangeRate.trim() === "" ? null : h.exchangeRate.trim();
    body.billTo = draftToParty(p.billTo);
    body.consignee = draftToParty(p.consignee);
    body.notifyParty = draftToParty(p.notifyParty);
    body.buyerIfNotConsignee = draftToParty(p.buyerIfNotConsignee);
    if (newClient && newClient.id !== order.clientId) body.clientId = newClient.id;
    const res = await patchJson(`/api/office/commercial/orders/${order.id}`, body);
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "The order was not saved."); return; }
    setSaved("Saved. The checklist has been filled in again from the new answers.");
    refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNote>{error}</ErrorNote>}
      {saved && <OkNote>{saved}</OkNote>}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Order header</h2>
          {mayWrite && (
            <div className="flex items-center gap-2">
              {dirty && <button type="button" className={BTN} onClick={() => { setH(base); setP(baseParties); setNewClient(null); setSaved(null); }}>Discard changes</button>}
              <button type="button" className={BTN_PRIMARY} disabled={!dirty || saving} onClick={() => void save()}>
                {saving ? "Saving…" : dirty ? "Save header" : "Saved"}
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Order number"><input className={INPUT} value={order.number} disabled readOnly /></Field>
          <SelectField label="Kind" value={h.kind} onChange={set("kind")} options={KIND_OPTIONS} disabled={!mayWrite} />
          <div>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Client</span>
            {changingClient ? (
              <>
                <ClientPicker onPick={pickClient} autoFocus />
                <button type="button" className="mt-1 text-xs font-medium text-gray-400 hover:text-brand" onClick={() => setChangingClient(false)}>Keep {order.client?.name}</button>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-gray-900">{newClient?.name ?? order.client?.name ?? "—"}</span>
                  {newClient && <span className="ml-2 text-xs text-amber-700">unsaved</span>}
                </span>
                {mayWrite && <button type="button" className="text-xs font-medium text-gray-400 hover:text-brand" onClick={() => setChangingClient(true)}>Change</button>}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Customer purchase order</h2>
        <p className="mb-4 text-xs text-gray-400">Checklist points 1 and 1a–1c.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TextField label="PO number" value={h.customerPoNumber} onChange={set("customerPoNumber")} disabled={!mayWrite} />
          <Field label="PO date">
            <input type="date" className={INPUT} value={h.customerPoDate} disabled={!mayWrite} onChange={(e) => set("customerPoDate")(e.target.value)} />
          </Field>
          <SelectField label="Evidence of the order" value={h.poEvidence} onChange={set("poEvidence")} options={PO_EVIDENCE_OPTIONS} disabled={!mayWrite} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Commercial terms</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TextField label="Currency" value={h.currency} onChange={set("currency")} hint="Cannot be blank — a blank box keeps the current currency." disabled={!mayWrite} />
          <TextField label="Exchange rate" value={h.exchangeRate} onChange={set("exchangeRate")} hint="Only for an export invoice priced in INR terms." disabled={!mayWrite} />
          <TextField label="Incoterm" value={h.incoterm} onChange={set("incoterm")} hint="Checklist point 10." disabled={!mayWrite} />
          <TextField label="Delivery terms" value={h.deliveryTerms} onChange={set("deliveryTerms")} disabled={!mayWrite} />
          <TextField label="Payment terms" value={h.paymentTerms} onChange={set("paymentTerms")} hint="Checklist point 15." disabled={!mayWrite} />
          <TextField label="Payment mode" value={h.paymentMode} onChange={set("paymentMode")} hint="Checklist point 16 — CAD / DP / DA / LC / Clean Credit." disabled={!mayWrite} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Parties</h2>
        <p className="mb-4 text-xs text-gray-400">Checklist points 11 and 12. These blocks are what the proforma and the invoice print.</p>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PartyEditor title="Bill to" value={p.billTo} onChange={setParty("billTo")} disabled={!mayWrite} />
          <PartyEditor title="Consignee (ship to)" value={p.consignee} onChange={setParty("consignee")} disabled={!mayWrite} />
          <PartyEditor title="Notify party" value={p.notifyParty} onChange={setParty("notifyParty")} disabled={!mayWrite} />
          <PartyEditor title="Buyer, if not the consignee" value={p.buyerIfNotConsignee} onChange={setParty("buyerIfNotConsignee")} disabled={!mayWrite} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Routing</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TextField label="Pre-carriage by" value={h.preCarriageBy} onChange={set("preCarriageBy")} disabled={!mayWrite} />
          <TextField label="Place of receipt" value={h.placeOfReceipt} onChange={set("placeOfReceipt")} disabled={!mayWrite} />
          <TextField label="Port of loading" value={h.portOfLoading} onChange={set("portOfLoading")} disabled={!mayWrite} />
          <TextField label="Port of discharge" value={h.portOfDischarge} onChange={set("portOfDischarge")} hint="Checklist point 13." disabled={!mayWrite} />
          <TextField label="Final destination" value={h.finalDestination} onChange={set("finalDestination")} disabled={!mayWrite} />
          <TextField label="Country of destination" value={h.countryOfDestination} onChange={set("countryOfDestination")} disabled={!mayWrite} />
          <TextField label="Country of origin" value={h.countryOfOrigin} onChange={set("countryOfOrigin")} hint="Cannot be blank — a blank box keeps the current value." disabled={!mayWrite} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Delivery, packing and contacts</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <AreaField label="Delivery schedule" value={h.deliverySchedule} onChange={set("deliverySchedule")} rows={2} hint="Checklist point 9." disabled={!mayWrite} />
          <AreaField label="Special packing or markings" value={h.specialPacking} onChange={set("specialPacking")} rows={2} hint="Checklist point 14." disabled={!mayWrite} />
          <AreaField label="Freight forwarder (FOB shipments)" value={h.forwarderDetails} onChange={set("forwarderDetails")} rows={2} hint="Checklist point 17." disabled={!mayWrite} />
          <AreaField label="Nominated receiver (Ex-Works)" value={h.receiverDetails} onChange={set("receiverDetails")} rows={2} hint="Checklist point 18." disabled={!mayWrite} />
          <AreaField label="Customer contact" value={h.customerContact} onChange={set("customerContact")} rows={2} hint="Checklist point 19." disabled={!mayWrite} />
          <AreaField label="Internal notes" value={h.notes} onChange={set("notes")} rows={2} disabled={!mayWrite} />
        </div>
      </Card>

      <ChecklistCard order={order} refresh={refresh} mayWrite={mayWrite} mayApprove={mayApprove} />
    </div>
  );
}

// ───────────────────────────── the SOP checklist ─────────────────────────────

function ChecklistCard({ order, refresh, mayWrite, mayApprove }: {
  order: OrderTabProps["order"]; refresh: () => void; mayWrite: boolean; mayApprove: boolean;
}) {
  const list = order.checklist ?? [];
  const [draft, setDraft] = useState(list);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => { setDraft(order.checklist ?? []); }, [order.checklist]);

  const outstanding = draft.filter((i) => !i.ok).length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(list);

  async function send(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError(null);
    setSaved(null);
    const res = await patchJson(`/api/office/commercial/orders/${order.id}/checklist`, body);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "The checklist was not saved."); return; }
    setSaved(label === "save" ? "Checklist saved." : label === "check" ? "Checked." : "Approved.");
    refresh();
  }

  if (draft.length === 0) return <Empty>This order has no checklist — reload the page.</Empty>;

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Internal sales order checklist</h2>
          <p className="mt-1 text-xs text-gray-400">
            {outstanding === 0
              ? "Every point is settled."
              : `${outstanding} point${outstanding === 1 ? "" : "s"} outstanding — go back to the sender for these before the PI.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mayWrite && dirty && (
            <button type="button" className={BTN_PRIMARY} disabled={busy !== null}
              onClick={() => void send({ items: draft.map((i) => ({ key: i.key, value: i.value, ok: i.ok })) }, "save")}>
              {busy === "save" ? "Saving…" : "Save answers"}
            </button>
          )}
          {mayWrite && (
            <button type="button" className={BTN} disabled={busy !== null} onClick={() => void send({ check: true }, "check")}>
              {busy === "check" ? "Stamping…" : order.checkedAt ? "Check again" : "Mark checked"}
            </button>
          )}
          {mayApprove && (
            <button type="button" className={BTN} disabled={busy !== null} onClick={() => void send({ approve: true }, "approve")}>
              {busy === "approve" ? "Stamping…" : order.approvedAt ? "Approve again" : "Approve"}
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      {saved && <div className="mb-3"><OkNote>{saved}</OkNote></div>}

      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <div className="rounded-lg border border-gray-200 px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-gray-400">Checked by</span>
          <div className="font-medium text-gray-900">{order.checkedByName ?? "—"}</div>
          <div className="text-xs text-gray-400">{order.checkedAt ? dmy(order.checkedAt) : "not yet checked"}</div>
        </div>
        <div className="rounded-lg border border-gray-200 px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-gray-400">Approved by</span>
          <div className="font-medium text-gray-900">{order.approvedByName ?? "—"}</div>
          <div className="text-xs text-gray-400">{order.approvedAt ? dmy(order.approvedAt) : "not yet approved"}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="w-12 py-2 pr-3 font-medium">No</th>
              <th className="py-2 pr-3 font-medium">Point</th>
              <th className="py-2 pr-3 font-medium">Recorded</th>
              <th className="w-24 py-2 font-medium">Settled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {draft.map((item, i) => (
              <tr key={item.key} className={item.ok ? "" : "bg-amber-50/60"}>
                <td className="py-2 pr-3 align-top text-gray-400">{item.no}</td>
                <td className="py-2 pr-3 align-top text-gray-700">{item.label}</td>
                <td className="py-2 pr-3 align-top">
                  <input
                    className={INPUT}
                    value={item.value}
                    disabled={!mayWrite}
                    placeholder={item.ok ? "" : "Not available — ask the sender"}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraft((d) => d.map((x, j) => (j === i ? { ...x, value: v } : x)));
                      setSaved(null);
                    }}
                  />
                </td>
                <td className="py-2 align-top">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand/30"
                      checked={item.ok}
                      disabled={!mayWrite}
                      onChange={(e) => {
                        const ok = e.target.checked;
                        setDraft((d) => d.map((x, j) => (j === i ? { ...x, ok } : x)));
                        setSaved(null);
                      }}
                    />
                    {item.ok ? <Badge tone="green">ok</Badge> : <Badge tone="amber">open</Badge>}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Points the order can answer are filled in automatically and refilled after every edit — an answer typed here is never overwritten.
      </p>
    </Card>
  );
}
