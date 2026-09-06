"use client";
// The client form, shared by the create panel on the list and the edit page.
//
// One form writes TWO tables: the shared sales_clients master and this
// module's commercial_client_ext (GSTIN, PAN, state code, customer code and
// the printed address blocks). The API takes one body and splits it
// (lib/commercial/clients-rules parseClientBody), so the form is flat and
// every column a Commercial user should set is on it.
//
// The three address blocks are textareas: the first line is the party's name
// as printed, the rest are the address lines. That is exactly what
// normalizeParty() accepts, and it is how somebody with the customer's e-mail
// open in the next window actually works — paste, then fix.
import type { ReactNode } from "react";

export interface PartyLike {
  name?: string | null;
  lines?: string[] | null;
  country?: string | null;
  tel?: string | null;
  email?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  code?: string | null;
}

export interface ClientExtRow {
  clientId: string;
  customerCode: string | null;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  billingAddress: PartyLike | null;
  shippingAddress: PartyLike | null;
  notifyParty: PartyLike | null;
  defaultIncoterm: string | null;
  defaultCurrency: string | null;
  notes: string | null;
}

export interface ClientRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  contactPerson: string | null;
  isActive: boolean;
  defaultCurrency: string | null;
  defaultPaymentTerms: string | null;
  defaultDeliveryTerms: string | null;
  defaultPortOfDischarge: string | null;
  ccEmails: string[];
  createdAt: string;
  updatedAt: string;
  commercialExt: ClientExtRow | null;
  ordersCount: number;
  enquiriesCount: number;
}

export const inp = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-gray-50 disabled:text-gray-400";
export const lbl = "mb-1 block text-xs font-medium text-gray-600";
export const btnPrimary = "rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand/90 disabled:opacity-60";
export const btnGhost = "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
export const errBox = "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";
export const warnBox = "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800";
export const okBox = "rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700";

export const CLIENT_FORM_KEYS = [
  "name", "email", "phone", "address", "city", "country", "contactPerson", "ccEmails",
  "defaultCurrency", "defaultPaymentTerms", "defaultDeliveryTerms", "defaultPortOfDischarge",
  "customerCode", "gstin", "pan", "stateCode", "defaultIncoterm", "notes",
  "billingAddress", "shippingAddress", "notifyParty",
] as const;

export type ClientForm = Record<(typeof CLIENT_FORM_KEYS)[number], string>;

export function emptyClientForm(): ClientForm {
  const f = {} as ClientForm;
  for (const k of CLIENT_FORM_KEYS) f[k] = "";
  return f;
}

/** A stored Party block back to the textarea it was typed in. */
export function partyToText(p: PartyLike | null | undefined): string {
  if (!p) return "";
  return [p.name ?? "", ...(p.lines ?? [])].filter((l) => String(l).trim()).join("\n");
}

export function clientFormFrom(row: ClientRow): ClientForm {
  const e = row.commercialExt;
  return {
    name: row.name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    address: row.address ?? "",
    city: row.city ?? "",
    country: row.country ?? "",
    contactPerson: row.contactPerson ?? "",
    ccEmails: (row.ccEmails ?? []).join(", "),
    // The ext's currency was set for this module, so it is the one shown; the
    // API writes the value to both columns from this one field.
    defaultCurrency: e?.defaultCurrency ?? row.defaultCurrency ?? "",
    defaultPaymentTerms: row.defaultPaymentTerms ?? "",
    defaultDeliveryTerms: row.defaultDeliveryTerms ?? "",
    defaultPortOfDischarge: row.defaultPortOfDischarge ?? "",
    customerCode: e?.customerCode ?? "",
    gstin: e?.gstin ?? "",
    pan: e?.pan ?? "",
    stateCode: e?.stateCode ?? "",
    defaultIncoterm: e?.defaultIncoterm ?? "",
    notes: e?.notes ?? "",
    billingAddress: partyToText(e?.billingAddress),
    shippingAddress: partyToText(e?.shippingAddress),
    notifyParty: partyToText(e?.notifyParty),
  };
}

/** The body both POST and PATCH take. Every key is sent: the form shows every
 *  column, so a field cleared on screen is a field cleared in the database. */
export function clientFormBody(f: ClientForm): Record<string, string> {
  const body = {} as Record<string, string>;
  for (const k of CLIENT_FORM_KEYS) body[k] = f[k];
  return body;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={lbl}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-gray-400">{hint}</span>}
    </label>
  );
}

export function ClientFields({ value, onChange, disabled = false }: {
  value: ClientForm;
  onChange: (next: ClientForm) => void;
  disabled?: boolean;
}) {
  const set = (k: keyof ClientForm) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const text = (k: keyof ClientForm, ph?: string) => (
    <input className={inp} value={value[k]} onChange={set(k)} placeholder={ph} disabled={disabled} />
  );

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Customer</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Name *">{text("name", "JB Homes Pvt Ltd")}</Field>
          <Field label="Customer code" hint="Prints on the export workbook's Cust-Inv / Cust-PL copies, e.g. USA-041.">{text("customerCode", "USA-041")}</Field>
          <Field label="Contact person">{text("contactPerson", "Priya")}</Field>
          <Field label="E-mail">{text("email", "po@customer.example")}</Field>
          <Field label="Phone">{text("phone", "+91 44 2345 6789")}</Field>
          <Field label="CC e-mails" hint="Commas, semicolons or new lines.">{text("ccEmails", "ap@customer.example; logistics@customer.example")}</Field>
          <Field label="City">{text("city", "Chennai")}</Field>
          <Field label="Country" hint="An Indian country makes the Convert dialog offer a domestic order.">{text("country", "India")}</Field>
          <Field label="State code" hint="Two digits (Tamil Nadu 33). Filled from the GSTIN when left blank.">{text("stateCode", "33")}</Field>
          <div className="md:col-span-3">
            <Field label="Address" hint="One line per line; used to print a party block when none is set below.">
              <textarea className={`${inp} min-h-[72px]`} value={value.address} onChange={set("address")} disabled={disabled} placeholder={"12 MG Road\nShivajinagar"} />
            </Field>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Tax and defaults</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="GSTIN" hint="15 characters. Checked for shape, then the state code is taken from it.">{text("gstin", "33AALCP2750N1Z3")}</Field>
          <Field label="PAN" hint="5 letters, 4 digits, 1 letter.">{text("pan", "AALCP2750N")}</Field>
          <Field label="Default currency" hint="Copied onto a new order for this customer.">{text("defaultCurrency", "USD")}</Field>
          <Field label="Default incoterm">{text("defaultIncoterm", "FOB Chennai")}</Field>
          <Field label="Default delivery terms">{text("defaultDeliveryTerms", "C&F Houston")}</Field>
          <Field label="Default payment terms">{text("defaultPaymentTerms", "30 days from BL")}</Field>
          <Field label="Default port of discharge">{text("defaultPortOfDischarge", "Houston")}</Field>
          <div className="md:col-span-2">
            <Field label="Notes">
              <textarea className={`${inp} min-h-[64px]`} value={value.notes} onChange={set("notes")} disabled={disabled} placeholder="Anything the next person should know." />
            </Field>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Printed address blocks</h3>
        <p className="mb-3 text-xs text-gray-500">
          What the PI, the invoice and the packing list print. First line is the name, the rest are the address lines.
          Leave a block empty and the module prints the customer address above instead.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Bill to">
            <textarea className={`${inp} min-h-[112px] font-mono text-xs`} value={value.billingAddress} onChange={set("billingAddress")} disabled={disabled}
              placeholder={"JB Homes Pvt Ltd\n12 MG Road\nPune 411005"} />
          </Field>
          <Field label="Ship to / consignee">
            <textarea className={`${inp} min-h-[112px] font-mono text-xs`} value={value.shippingAddress} onChange={set("shippingAddress")} disabled={disabled}
              placeholder={"Same as bill to when left blank"} />
          </Field>
          <Field label="Notify party">
            <textarea className={`${inp} min-h-[112px] font-mono text-xs`} value={value.notifyParty} onChange={set("notifyParty")} disabled={disabled}
              placeholder={"Freight forwarder or agent"} />
          </Field>
        </div>
      </section>
    </div>
  );
}
