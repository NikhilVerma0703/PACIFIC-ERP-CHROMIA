"use client";
// The order header, editable in place, and the SOP checklist under it.
//
// The checklist is the point of this screen. It is the "Checklist for Internal
// Sales Order" sheet, 22 points, and the rule printed at the bottom of the
// paper one is the rule here: where a detail is missing, Commercial goes back
// to the sender for it. So the outstanding points are highlighted rather than
// hidden, and the count of them sits next to the Check and Approve buttons —
// approving with points open is allowed, but it is never accidental.
//
// Two signatures, two people (answer 10): Commercial PREPARES the sheet and
// marks it checked; the Commercial Manager (or an admin) APPROVES it, and the
// final invoice waits for that approval. A Commercial login sees the Approve
// button, disabled, with the reason — the button is not hidden, because "why
// can't I approve" is a question the screen should answer.
import { useEffect, useMemo, useState } from "react";
import { Card, Badge, Empty } from "@/components/ui";
import { patchJson, postJson } from "@/lib/fab/postJson";
import { readJson } from "@/lib/readJson";
import { groupTasks, taskProgress, progressNote, statusFromTick } from "@/lib/commercial/tasks-rules";
import type { OrderTabProps, OrderTaskDto, Party } from "@/lib/commercial/types";
import { DEFAULT_SELLER_KEY } from "@/lib/commercial/settings-defaults";
import { partiesFromClient, clientDefaults, type ClientLike } from "@/lib/commercial/orders-rules";
import { advanceBadge, fmtPct } from "@/lib/commercial/receipts-rules";
import { ClientPicker, type ClientRow } from "../orders/ClientPicker";
import { ReceiptsCard } from "../orders/ReceiptsCard";
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
  advancePct: string;
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
  salespersonName: string;
  sellerKey: string;
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
    // Blank is a real answer: it hands the order back to the settings default
    // for its kind (round two, answer 11).
    advancePct: o.advancePct === null || o.advancePct === undefined ? "" : String(o.advancePct),
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
    salespersonName: t(o.salespersonName),
    // The default seller is the NULL column (scripts/0085), so the dropdown's
    // blank option IS Pacific and an order that happens to name it explicitly
    // reads back onto that same option rather than looking like a third
    // choice. Nothing else in this form has to know which key is the default.
    sellerKey: o.sellerKey === DEFAULT_SELLER_KEY ? "" : t(o.sellerKey),
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
  const mayApprove = actions.includes("approve");   // ADMIN / COMMERCIAL_MANAGER (canApprove, access-rules)
  const base = useMemo(() => draftOf(order), [order]);
  const baseParties = useMemo(() => partyDraftsOf(order), [order]);
  // The default seller's option carries the EMPTY value, which clears the
  // column back to NULL — the answer every order raised before this existed
  // gives, and the one the documents read as Pacific.
  const sellerOptions = useMemo(
    () => (order.sellerChoices ?? []).map((c) => ({ value: c.key === DEFAULT_SELLER_KEY ? "" : c.key, label: c.label })),
    [order.sellerChoices],
  );

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
    body.advancePct = h.advancePct.trim() === "" ? null : h.advancePct.trim();
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
          {/* Owner, 2026-09-15: the salesperson who asked for the PI for his
              customer. Beside the client because that is what it names — whose
              customer this is — and not the desk that typed the order. */}
          <TextField
            label="Salesperson"
            value={h.salespersonName}
            onChange={set("salespersonName")}
            hint="Who asked for the PI, for his customer. Prints on a domestic (DTA) proforma; an export order may still record one."
            disabled={!mayWrite}
          />
          {/* WHICH OF THE GROUP'S COMPANIES IS SELLING (owner, 2026-09-15;
              scripts/0085). It sits in the header, beside Kind and the client,
              because it is a fact about the DEAL and not about a piece of
              paper: every proforma of this order — a revision included — goes
              out under the company chosen here, and each one freezes it at the
              moment its draft is built. Change it and build a fresh draft; a
              proforma already drafted keeps the company it was drafted under.
              The options come from the server (order.sellerChoices) so a label
              corrected in Settings is the label read here. */}
          <SelectField
            label="Selling company"
            value={h.sellerKey}
            onChange={set("sellerKey")}
            options={sellerOptions}
            hint="Whose proforma this order raises. Monolith's is a US invoice — its own address and bank, and no GSTIN, RBI code, customs office or Indian-origin declaration on it."
            disabled={!mayWrite}
          />
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
          {/* Round two, answer 11: the share of the order that must be in
              before the truck leaves. Blank is not "none" — it is the
              settings default for this kind, and the hint names THAT default
              (advanceDefaultPct, resolved by the server) rather than the
              percentage in force: on an order that overrides the default, the
              effective figure is the order's own and calling it "the default"
              was simply wrong.
              Answer 12: 0, and any lowering, is the waiver's desk — the box
              says so rather than letting the save come back a 403. */}
          <TextField
            label="Advance required (%)"
            value={h.advancePct}
            onChange={set("advancePct")}
            placeholder={fmtPct(order.advanceDefaultPct).replace("%", "")}
            hint={h.advancePct.trim() === ""
              ? `Blank asks for the settings default for a ${order.kind === "EXPORT" ? "export" : "domestic"} order — ${fmtPct(order.advanceDefaultPct)} today. Lowering the advance below the ${fmtPct(order.advance.pct)} in force, or setting 0, is the Commercial Manager's, like a waiver.`
              : `0 to 100. Blank goes back to the settings default for this kind (${fmtPct(order.advanceDefaultPct)} today). Lowering it below the ${fmtPct(order.advance.pct)} in force, or setting 0, is the Commercial Manager's, like a waiver.`}
            disabled={!mayWrite}
          />
        </div>
        {/* The gate as a figure, beside the terms that set it (answer 11). */}
        <p className={`mt-4 rounded-lg border px-3 py-2 text-sm ${order.advance.satisfied ? "border-green-200 bg-green-50/60 text-green-800" : "border-amber-200 bg-amber-50/60 text-amber-800"}`}>
          {advanceBadge(order.advance, order.currency)}
          {order.advance.reason ? <span className="text-gray-600"> · {order.advance.reason}</span> : null}
        </p>
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

      <ReceiptsCard order={order} actions={actions} refresh={refresh} />

      <ChecklistCard order={order} refresh={refresh} mayWrite={mayWrite} mayApprove={mayApprove} />

      {/* Round three, answers 7 and 8: the outside work, as ticks. Below the
          SOP sheet because it is what happens AFTER the order is agreed. */}
      <TasksCard order={order} mayWrite={mayWrite} />
    </div>
  );
}

// ───────────────────────────── the SOP checklist ─────────────────────────────

const APPROVE_HINT = "Only the Commercial Manager or an admin approves";

function ChecklistCard({ order, refresh, mayWrite, mayApprove }: {
  order: OrderTabProps["order"]; refresh: () => void; mayWrite: boolean; mayApprove: boolean;
}) {
  const list = order.checklist ?? [];
  const [draft, setDraft] = useState(list);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // The signed-in name, for the "Prepared by" default before the sheet has
  // been checked. The order detail does not carry the viewer, so the
  // checklist's own GET says who is looking.
  const [viewer, setViewer] = useState<string | null>(null);

  useEffect(() => { setDraft(order.checklist ?? []); }, [order.checklist]);
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`/api/office/commercial/orders/${order.id}/checklist`, { cache: "no-store" });
      const res = await readJson<{ viewer?: { name: string | null } }>(r);
      if (live && res.ok && res.data?.viewer) setViewer(res.data.viewer.name ?? null);
    })();
    return () => { live = false; };
  }, [order.id]);

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
          {(mayWrite || mayApprove) && (
            <button type="button" className={BTN} disabled={!mayApprove || busy !== null} title={mayApprove ? undefined : APPROVE_HINT}
              onClick={() => void send({ approve: true }, "approve")}>
              {busy === "approve" ? "Stamping…" : order.approvedAt ? "Approve again" : "Approve"}
            </button>
          )}
        </div>
      </div>
      {mayWrite && !mayApprove && <p className="-mt-2 mb-3 text-right text-xs text-amber-700">{APPROVE_HINT}.</p>}

      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      {saved && <div className="mb-3"><OkNote>{saved}</OkNote></div>}

      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <div className="rounded-lg border border-gray-200 px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-gray-400">Prepared by</span>
          <div className="font-medium text-gray-900">{order.checkedByName ?? viewer ?? "—"}</div>
          <div className="text-xs text-gray-400">{order.checkedAt ? `checked ${dmy(order.checkedAt)}` : viewer ? "you — stamped on Mark checked" : "not yet checked"}</div>
        </div>
        <div className="rounded-lg border border-gray-200 px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-gray-400">Approved by (Commercial Manager)</span>
          <div className="font-medium text-gray-900">{order.approvedByName ?? "—"}</div>
          <div className="text-xs text-gray-400">{order.approvedAt ? dmy(order.approvedAt) : "not yet approved — the final invoice waits for this"}</div>
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

// ───────────────────────── the tasks (answers 7 and 8) ───────────────────────
//
// Container booking, CHA, the BL draft, COO, CEFA, fumigation, TiO2, the RFID
// lock, container pictures, the shipping documents, the Daltile upload and the
// ETA sheet — and on a domestic order transport booking, the transporter bills
// and the e-way bill. The owner's answer was "for now if we cannot add
// anything we'll add a tickbox, or if we can add more then we'll add more", so
// this is a tick, a date and a note, and it does not pretend to do the work.
//
// EXPORTED because the Documents tab shows the same card: most of these lines
// are Raghav's, and Documents is the tab he lives on. One component, two
// mounts, each with its own copy of the list — a tick on one is seen by the
// other when that tab is next opened, which is how tabs already behave here.
//
// The card owns its own data rather than reading order.tasks: the GET is what
// SEEDS an order that has never been opened, and re-fetching the whole order
// after every checkbox would reload eight relations to change one row.
// order.tasks is the initial paint, so the card is never blank on arrival.
//
// WHAT `mayWrite` HAS TO MEAN. The routes behind this card gate on the
// CHECKLIST area (answers 7 and 8: these lines are the work around the order,
// and most of them are COMMERCIAL_DOCS's own), while the prop it is given is
// the login's `write` ACTION. Those two answer the same set of logins — every
// actor holding checklist: write is exactly every actor holding the write
// action — which is why the controls below can be enabled from the action
// without offering a tick the server will refuse. It is not a coincidence
// worth trusting silently, so tests/commercialOrders.test.ts pins the two
// columns of access-rules against each other and fails if they ever diverge.

const TASKS_READONLY = "This login may read this order but not change it";

export function TasksCard({ order, mayWrite }: { order: OrderTabProps["order"]; mayWrite: boolean }) {
  const [tasks, setTasks] = useState<OrderTaskDto[]>(order.tasks ?? []);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  // Typed but not yet sent: a note is saved on blur, so the box has to hold
  // what is in it without the list underneath overwriting each keystroke.
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => { setTasks(order.tasks ?? []); }, [order.tasks]);

  // First read seeds the defaults for the order's kind, server-side.
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`/api/office/commercial/orders/${order.id}/tasks`, { cache: "no-store" });
      const res = await readJson<{ tasks?: OrderTaskDto[] }>(r);
      if (!live) return;
      if (res.ok && Array.isArray(res.data?.tasks)) setTasks(res.data.tasks);
      setLoaded(true);
    })();
    return () => { live = false; };
  }, [order.id]);

  const progress = taskProgress(tasks);
  const groups = groupTasks(tasks);

  async function patch(t: OrderTaskDto, body: Record<string, unknown>) {
    setBusy(t.id);
    setError(null);
    const res = await patchJson(`/api/office/commercial/orders/${order.id}/tasks/${t.id}`, body);
    setBusy(null);
    if (!res.ok) { setError(res.error ?? `"${t.label}" was not saved.`); return; }
    if (Array.isArray(res.data?.tasks)) setTasks(res.data.tasks as OrderTaskDto[]);
    setNotes((n) => { const { [t.id]: _drop, ...rest } = n; return rest; });
  }

  async function add() {
    const label = adding.trim();
    if (!label) return;
    setBusy("add");
    setError(null);
    const res = await postJson(`/api/office/commercial/orders/${order.id}/tasks`, { label });
    setBusy(null);
    if (!res.ok) { setError(res.error ?? "The task was not added."); return; }
    if (Array.isArray(res.data?.tasks)) setTasks(res.data.tasks as OrderTaskDto[]);
    setAdding("");
  }

  function row(t: OrderTaskDto) {
    const waived = t.status === "NOT_REQUIRED";
    const done = t.status === "DONE";
    const noteValue = notes[t.id] ?? t.note ?? "";
    return (
      <div key={t.id} className={`flex flex-col gap-2 border-b border-gray-100 py-2 last:border-0 md:flex-row md:items-center ${waived ? "opacity-70" : ""}`}>
        <label className="flex min-w-0 flex-1 items-center gap-2" title={mayWrite ? undefined : TASKS_READONLY}>
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 rounded border-gray-300 text-brand focus:ring-brand/30"
            checked={done}
            disabled={!mayWrite || busy !== null}
            onChange={(e) => void patch(t, { status: statusFromTick(e.target.checked) })}
          />
          <span className={`truncate text-sm ${done ? "text-gray-500 line-through" : "text-gray-800"}`}>{t.label}</span>
          {waived && <Badge tone="amber">not required</Badge>}
        </label>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <input
            type="date"
            className={`${INPUT} w-40`}
            value={dateInputValue(t.doneAt)}
            disabled={!mayWrite || !done || busy !== null}
            title={done ? undefined : "The date is the day the task was done — tick it first"}
            onChange={(e) => void patch(t, { doneAt: e.target.value })}
          />
          <input
            className={`${INPUT} w-full md:w-64`}
            placeholder="Note"
            value={noteValue}
            disabled={!mayWrite || busy !== null}
            title={mayWrite ? undefined : TASKS_READONLY}
            onChange={(e) => setNotes((n) => ({ ...n, [t.id]: e.target.value }))}
            onBlur={() => { if ((notes[t.id] ?? null) !== null && notes[t.id] !== (t.note ?? "")) void patch(t, { note: notes[t.id] }); }}
          />
          {/* A refusal is disabled with its reason, never hidden — a login that
              may only read still sees what the desk can do here. */}
          <button
            type="button"
            className={BTN}
            disabled={!mayWrite || busy !== null}
            title={mayWrite ? "The customer or the shipment does not need this one" : TASKS_READONLY}
            onClick={() => void patch(t, { status: waived ? "PENDING" : "NOT_REQUIRED" })}
          >
            {waived ? "Needed after all" : "Not required"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Order tasks</h2>
          <p className="mt-1 text-xs text-gray-400">
            {loaded || tasks.length ? progressNote(progress) : "Loading…"}
          </p>
        </div>
        {!mayWrite && <span className="text-xs text-amber-700">{TASKS_READONLY}.</span>}
      </div>

      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}

      {loaded && tasks.length === 0 ? (
        <Empty>No tasks on this order.</Empty>
      ) : (
        <>
          <div className="mb-4">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
              Outstanding{groups.outstanding.length ? ` (${groups.outstanding.length})` : ""}
            </h3>
            {groups.outstanding.length === 0
              ? <p className="py-2 text-sm text-gray-500">Nothing outstanding.</p>
              : groups.outstanding.map(row)}
          </div>
          {groups.done.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                Done and not required ({groups.done.length})
              </h3>
              {groups.done.map(row)}
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <input
          className={`${INPUT} w-full md:w-80`}
          placeholder="Add a task this order needs"
          value={adding}
          disabled={!mayWrite || busy !== null}
          title={mayWrite ? undefined : TASKS_READONLY}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
        />
        <button type="button" className={BTN} disabled={!mayWrite || busy !== null || adding.trim() === ""} onClick={() => void add()}>
          {busy === "add" ? "Adding…" : "Add task"}
        </button>
      </div>
      <p className="mt-3 text-xs text-gray-400">
        Booking, CHA, the documents and the portals are done outside the ERP — this is the record that they were, with the date and a note.
        Ticks are kept against the order, so a task that becomes a screen here later keeps its line.
      </p>
    </Card>
  );
}
