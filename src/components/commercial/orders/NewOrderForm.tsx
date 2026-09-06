"use client";
// A new internal sales order. Header only — the lines are added on the next
// screen, where the stock check sits beside them.
//
// Two rules this form follows carefully:
//
//  * A BLANK BOX IS NOT AN ANSWER. Only fields the user actually filled are
//    sent, because POST /orders reads a key that is present-but-null as "blank
//    this deliberately" and would otherwise wipe the settings default it was
//    about to apply (the port of loading, the domestic payment terms).
//  * The party blocks are prefilled HERE, from the same pure function the
//    server would use (partiesFromClient), so what will print on the PI is on
//    screen before the order exists rather than after.
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Card, Empty } from "@/components/ui";
import { postJson } from "@/lib/fab/postJson";
import { partiesFromClient, clientDefaults, type ClientLike } from "@/lib/commercial/orders-rules";
import type { Party } from "@/lib/commercial/types";
import { ClientPicker, type ClientRow } from "./ClientPicker";
import {
  INPUT, BTN, BTN_PRIMARY, ErrorNote, Field, TextField, AreaField, SelectField, PartyEditor,
  KIND_OPTIONS, PO_EVIDENCE_OPTIONS, emptyPartyDraft, partyToDraft, draftToParty, isBlankDraft, type PartyDraft,
} from "./fields";

/** Every text field on the header, with the label the SOP checklist uses. */
interface HeaderDraft {
  customerPoNumber: string;
  customerPoDate: string;
  poEvidence: string;
  currency: string;
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
  numberOverride: string;
}

const blankHeader = (): HeaderDraft => ({
  customerPoNumber: "", customerPoDate: "", poEvidence: "", currency: "", incoterm: "",
  deliveryTerms: "", paymentTerms: "", paymentMode: "", preCarriageBy: "", placeOfReceipt: "",
  portOfLoading: "", portOfDischarge: "", finalDestination: "", countryOfOrigin: "", countryOfDestination: "",
  deliverySchedule: "", specialPacking: "", forwarderDetails: "", receiverDetails: "", customerContact: "",
  notes: "", numberOverride: "",
});

export function NewOrderForm() {
  const router = useRouter();
  const [kind, setKind] = useState("EXPORT");
  const [h, setH] = useState<HeaderDraft>(blankHeader());
  const [billTo, setBillTo] = useState<PartyDraft>(emptyPartyDraft());
  const [consignee, setConsignee] = useState<PartyDraft>(emptyPartyDraft());
  const [notifyParty, setNotifyParty] = useState<PartyDraft>(emptyPartyDraft());
  const [buyerIfNotConsignee, setBuyerIfNotConsignee] = useState<PartyDraft>(emptyPartyDraft());

  const [client, setClient] = useState<ClientRow | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof HeaderDraft>(k: K) => (v: string) => setH((x) => ({ ...x, [k]: v }));

  /** Picking a client fills what the client master already knows. Anything the
   *  user has already typed is left alone — the master is a default, not a
   *  correction. */
  const pick = useCallback((c: ClientRow) => {
    setClient(c);
    const ext = c.commercialExt ?? null;
    const parties = partiesFromClient(c as ClientLike, ext);
    const asDraft = (p: Party | null): PartyDraft => partyToDraft(p);
    setBillTo((d) => (isBlankDraft(d) ? asDraft(parties.billTo as Party) : d));
    setConsignee((d) => (isBlankDraft(d) ? asDraft(parties.consignee as Party) : d));
    setNotifyParty((d) => (isBlankDraft(d) ? asDraft(parties.notifyParty as Party | null) : d));
    const cd = clientDefaults(c as ClientLike, ext);
    setH((x) => ({
      ...x,
      currency: x.currency || (cd.currency ?? ""),
      incoterm: x.incoterm || (cd.incoterm ?? ""),
      paymentTerms: x.paymentTerms || (cd.paymentTerms ?? ""),
      deliveryTerms: x.deliveryTerms || (cd.deliveryTerms ?? ""),
      portOfDischarge: x.portOfDischarge || (cd.portOfDischarge ?? ""),
      customerContact: x.customerContact || (cd.customerContact ?? ""),
      countryOfDestination: x.countryOfDestination || (c.country ?? ""),
    }));
  }, []);

  // ── save ───────────────────────────────────────────────────────────────────
  async function save() {
    if (!client) { setError("Pick a client first."); return; }
    setSaving(true);
    setError(null);
    const body: Record<string, unknown> = { kind, clientId: client.id };
    // Only what was typed. A key that is present but blank means "blank this",
    // which would defeat the settings defaults the route is about to apply.
    for (const [k, v] of Object.entries(h)) {
      if (k === "numberOverride") continue;
      const s = String(v ?? "").trim();
      if (s) body[k] = s;
    }
    if (h.numberOverride.trim()) body.numberOverride = h.numberOverride.trim();
    const parties: Array<[string, PartyDraft]> = [
      ["billTo", billTo], ["consignee", consignee], ["notifyParty", notifyParty], ["buyerIfNotConsignee", buyerIfNotConsignee],
    ];
    for (const [k, d] of parties) { const p = draftToParty(d); if (p) body[k] = p; }

    const res = await postJson("/api/office/commercial/orders", body);
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "Could not create the order."); return; }
    const id = (res.data as { id?: string } | null)?.id;
    if (!id) { setError("The order was created but the server did not say which one — open the order book."); return; }
    router.push(`/office/commercial/orders/${id}`);
  }

  const isExport = kind === "EXPORT";

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Order</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SelectField label="Kind" value={kind} onChange={setKind} options={KIND_OPTIONS}
            hint={isExport ? "Priced in USD, ships from the settings' port of loading." : "Priced in INR, DTA invoice, GST by the buyer's state."} />
          <TextField label="Order number override" value={h.numberOverride} onChange={set("numberOverride")}
            hint="Leave blank to take the next number from the counter." />
          <div className="md:col-span-1">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Client</span>
            {client ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-gray-900">{client.name}</span>
                  {client.country && <span className="ml-2 text-gray-400">{client.country}</span>}
                </span>
                <button type="button" className="text-xs font-medium text-gray-400 hover:text-brand"
                  onClick={() => setClient(null)}>Change</button>
              </div>
            ) : (
              <ClientPicker onPick={pick} />
            )}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Customer purchase order</h2>
        <p className="mb-4 text-xs text-gray-400">Points 1, 1a–1c of the internal sales order checklist.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TextField label="PO number" value={h.customerPoNumber} onChange={set("customerPoNumber")} placeholder="PO-4068622" />
          <Field label="PO date">
            <input type="date" className={INPUT} value={h.customerPoDate} onChange={(e) => set("customerPoDate")(e.target.value)} />
          </Field>
          <SelectField label="Evidence of the order" value={h.poEvidence} onChange={set("poEvidence")} options={PO_EVIDENCE_OPTIONS}
            hint="What we hold: their PO, our PI acknowledged, or an email naming items, qty, rate, terms." />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Commercial terms</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TextField label="Currency" value={h.currency} onChange={set("currency")} placeholder={isExport ? "USD" : "INR"}
            hint="Blank takes the default for this kind." />
          <TextField label="Incoterm" value={h.incoterm} onChange={set("incoterm")} placeholder="FOB / C&F / CIF / Ex-Works" />
          <TextField label="Payment mode" value={h.paymentMode} onChange={set("paymentMode")} placeholder="CAD / DP / DA / LC / Clean Credit" />
          <TextField label="Delivery terms" value={h.deliveryTerms} onChange={set("deliveryTerms")} className="md:col-span-1" />
          <TextField label="Payment terms" value={h.paymentTerms} onChange={set("paymentTerms")} placeholder="Immediate / 30 days from BL" className="md:col-span-2" />
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Parties</h2>
        <p className="mb-4 text-xs text-gray-400">
          Prefilled from the client master. What is here is what prints on the proforma and the invoice — edit it now rather than on the document.
        </p>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PartyEditor title="Bill to" value={billTo} onChange={setBillTo} />
          <PartyEditor title="Consignee (ship to)" value={consignee} onChange={setConsignee} />
          <PartyEditor title="Notify party" hint="Leave empty when there is none — an empty block would print as a notify party." value={notifyParty} onChange={setNotifyParty} />
          <PartyEditor title="Buyer, if not the consignee" hint="Only when the goods go somewhere other than the buyer." value={buyerIfNotConsignee} onChange={setBuyerIfNotConsignee} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Routing</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TextField label="Pre-carriage by" value={h.preCarriageBy} onChange={set("preCarriageBy")} placeholder="By Road" />
          <TextField label="Place of receipt" value={h.placeOfReceipt} onChange={set("placeOfReceipt")} />
          <TextField label="Port of loading" value={h.portOfLoading} onChange={set("portOfLoading")} placeholder="Chennai" />
          <TextField label="Port of discharge" value={h.portOfDischarge} onChange={set("portOfDischarge")} hint="Checklist point 13." />
          <TextField label="Final destination" value={h.finalDestination} onChange={set("finalDestination")} />
          <TextField label="Country of destination" value={h.countryOfDestination} onChange={set("countryOfDestination")} />
          <TextField label="Country of origin" value={h.countryOfOrigin} onChange={set("countryOfOrigin")} placeholder="India" hint="Blank keeps the settings' value." />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Delivery, packing and contacts</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <AreaField label="Delivery schedule" value={h.deliverySchedule} onChange={set("deliverySchedule")} rows={2} hint="Checklist point 9." />
          <AreaField label="Special packing or markings" value={h.specialPacking} onChange={set("specialPacking")} rows={2} hint="Checklist point 14." />
          <AreaField label="Freight forwarder (FOB shipments)" value={h.forwarderDetails} onChange={set("forwarderDetails")} rows={2} hint="Checklist point 17." />
          <AreaField label="Nominated receiver (Ex-Works)" value={h.receiverDetails} onChange={set("receiverDetails")} rows={2} hint="Checklist point 18." />
          <AreaField label="Customer contact" value={h.customerContact} onChange={set("customerContact")} rows={2} hint="Checklist point 19." />
          <AreaField label="Internal notes" value={h.notes} onChange={set("notes")} rows={2} hint="Not printed on any document." />
        </div>
      </Card>

      {!client && <Empty>Pick a client to create the order.</Empty>}

      <div className="flex items-center gap-3">
        <button type="button" className={BTN_PRIMARY} onClick={() => void save()} disabled={saving || !client}>
          {saving ? "Creating…" : "Create order"}
        </button>
        <Link href="/office/commercial/orders" className={BTN}>Cancel</Link>
        <span className="text-xs text-gray-400">The 22-point checklist is filled from these answers as soon as the order exists.</span>
      </div>
    </div>
  );
}
