// The Internal Sales Order checklist — PURE. This is the "SOP" sheet of the
// export workbook ("Checklist for Internal Sales Order (Customer's Purchase
// Order)"), transcribed point for point, with a Checked-by and an Approved-by
// line under it and the rule "In case any of the above relevant details are
// not available, Commercial to insist [the sender] to obtain same."
//
// Each point carries the value Commercial recorded and whether it is settled
// (ok). Points are prefilled from the order where the order already knows the
// answer, and left for a human where it does not (samples, delivery schedule,
// special packing, the forwarder).

export interface ChecklistItem {
  key: string;
  /** The SOP's own numbering, so the screen reads like the sheet. */
  no: string;
  label: string;
  value: string;
  ok: boolean;
}

export const CHECKLIST_POINTS: readonly { key: string; no: string; label: string }[] = [
  { key: "poReference",     no: "1",  label: "Customer Purchase Order Number & date from:" },
  { key: "evidencePo",      no: "1a", label: "Customer Purchase Order, or" },
  { key: "evidencePiAck",   no: "1b", label: "Our Proforma Invoice Acknowledged by Customer, or" },
  { key: "evidenceEmail",   no: "1c", label: "Email Communication from Customer specifying Items, Qty, Rate, Incoterms, Payment Terms, etc." },
  { key: "itemDescription", no: "2",  label: "Description of each Item" },
  { key: "uom",             no: "3",  label: "Unit of Measurement (UOM): SqFt / SqM / etc" },
  { key: "quantity",        no: "4",  label: "Quantity of each item" },
  { key: "specification",   no: "5",  label: "Specification (Size) of each item" },
  { key: "rate",            no: "6",  label: "Price / Rate of each item per UOM" },
  { key: "totalValue",      no: "7",  label: "Total Value of Purchase Order" },
  { key: "samples",         no: "8",  label: "Samples Quantities, if any, for each item" },
  { key: "deliverySchedule",no: "9",  label: "Delivery Schedule / s" },
  { key: "incoterm",        no: "10", label: "Incoterms: Ex-Works / FOB / C&F / CIF / DDP" },
  { key: "billTo",          no: "11", label: "Bill to entity full details" },
  { key: "shipTo",          no: "12", label: "Ship to / Notify entity full details" },
  { key: "portOfDischarge", no: "13", label: "Place / Port of Discharge" },
  { key: "specialPacking",  no: "14", label: "Special packing or Markings required by Customer, if any" },
  { key: "paymentTerms",    no: "15", label: "Payment Terms: credit period — Immediate / __ days from BL" },
  { key: "paymentMode",     no: "16", label: "Payment Mode: CAD / DP / DA / LC / Clean Credit" },
  { key: "forwarder",       no: "17", label: "For FOB shipments: Nominated Freight Forwarder details" },
  { key: "receiver",        no: "18", label: "For Ex-Works: Nominated Receiver details" },
  { key: "customerContact", no: "19", label: "Contact Details of Customer" },
];

/** A blank checklist. */
export function defaultChecklist(): ChecklistItem[] {
  return CHECKLIST_POINTS.map((p) => ({ ...p, value: "", ok: false }));
}

/** What the order already knows, in the shape prefill reads. Every field is
 *  optional: the function is total over partial orders. */
export interface ChecklistSource {
  customerPoNumber?: string | null;
  customerPoDate?: string | null;
  poEvidence?: string | null;              // PO | PI_ACKNOWLEDGED | EMAIL
  items?: Array<{ description?: string | null; design?: string | null; thickness?: string | null; sizeLabel?: string | null; qtySlabs?: number | null; qty?: number | string | null; uom?: string | null; rate?: number | string | null; amount?: number | string | null; isSample?: boolean | null }>;
  currency?: string | null;
  incoterm?: string | null;
  billTo?: { name?: string | null } | null;
  consignee?: { name?: string | null } | null;
  notifyParty?: { name?: string | null } | null;
  portOfDischarge?: string | null;
  finalDestination?: string | null;
  paymentTerms?: string | null;
  paymentMode?: string | null;
  forwarderDetails?: string | null;
  receiverDetails?: string | null;
  customerContact?: string | null;
  deliverySchedule?: string | null;
  specialPacking?: string | null;
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const n = (v: unknown): number => { const x = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(x) ? x : 0; };

/**
 * Prefill from the order. A point already answered by hand keeps its value
 * and its ok flag — prefill only fills blanks, so re-running it after an edit
 * never overwrites what Commercial typed. A point the order can answer is
 * marked ok when the answer is non-empty.
 */
export function prefillChecklist(existing: ChecklistItem[] | null | undefined, src: ChecklistSource): ChecklistItem[] {
  const base = existing && existing.length ? existing.map((i) => ({ ...i })) : defaultChecklist();
  const items = src.items ?? [];
  const goods = items.filter((i) => !i.isSample);
  const samples = items.filter((i) => i.isSample);
  const total = items.reduce((a, i) => a + n(i.amount), 0);
  // A ZERO IS NOT AN ANSWER. n() turns a null rate, quantity or amount into 0,
  // and "0" is a non-empty string, so an order whose lines carry no prices yet
  // came back with points 4, 6 and 7 (Quantity, Price / Rate, Total Value)
  // PREFILLED AND TICKED — the SOP checklist reporting that Commercial had
  // confirmed a rate nobody has typed. The checklist exists to say what is
  // still missing, so a figure nobody supplied has to read as missing.
  //
  // Asked per figure, not per order: a line may legitimately be free (the
  // sample lines on the 1404 PI are 0.0 by design), so the test is "did ANY
  // priced line carry one", not "is every line non-zero".
  const anyQty = goods.some((i) => n(i.qty) > 0 || (i.qtySlabs ?? 0) > 0);
  const anyRate = goods.some((i) => n(i.rate) > 0);
  const anyAmount = items.some((i) => n(i.amount) > 0);
  const derived: Record<string, string> = {
    poReference:     [s(src.customerPoNumber), s(src.customerPoDate) ? `Dt: ${s(src.customerPoDate)}` : ""].filter(Boolean).join(" "),
    evidencePo:      src.poEvidence === "PO" ? "YES" : src.poEvidence ? "N/A" : "",
    evidencePiAck:   src.poEvidence === "PI_ACKNOWLEDGED" ? "YES" : src.poEvidence ? "N/A" : "",
    evidenceEmail:   src.poEvidence === "EMAIL" ? "YES" : src.poEvidence ? "N/A" : "",
    itemDescription: goods.map((i) => s(i.description) || [s(i.design), s(i.thickness)].filter(Boolean).join(" ")).filter(Boolean).join("; "),
    uom:             Array.from(new Set(goods.map((i) => s(i.uom)).filter(Boolean))).join(", "),
    quantity:        anyQty ? goods.map((i) => `${n(i.qty)} ${s(i.uom)}${i.qtySlabs ? ` (${i.qtySlabs} slabs)` : ""}`.trim()).join("; ") : "",
    specification:   Array.from(new Set(goods.map((i) => [s(i.sizeLabel), s(i.thickness)].filter(Boolean).join(" ")).filter(Boolean))).join(", "),
    rate:            anyRate ? goods.map((i) => `${n(i.rate)}`).join("; ") : "",
    totalValue:      anyAmount ? `${s(src.currency) || ""} ${total.toFixed(3)}`.trim() : "",
    samples:         samples.length ? samples.map((i) => `${i.qtySlabs ?? n(i.qty)} × ${s(i.description) || s(i.design)}`).join("; ") : "",
    deliverySchedule: s(src.deliverySchedule),
    incoterm:        s(src.incoterm),
    billTo:          s(src.billTo?.name),
    shipTo:          [s(src.consignee?.name), s(src.notifyParty?.name)].filter(Boolean).join(" / "),
    portOfDischarge: s(src.portOfDischarge) || s(src.finalDestination),
    specialPacking:  s(src.specialPacking),
    paymentTerms:    s(src.paymentTerms),
    paymentMode:     s(src.paymentMode),
    forwarder:       s(src.forwarderDetails),
    receiver:        s(src.receiverDetails),
    customerContact: s(src.customerContact),
  };
  for (const item of base) {
    if (item.value.trim()) continue;                 // a human answer stands
    const d = derived[item.key];
    if (d) { item.value = d; item.ok = true; }
  }
  return base;
}

/** The points still open — the list Commercial goes back to the sender with. */
export function outstandingPoints(list: ChecklistItem[]): ChecklistItem[] {
  return list.filter((i) => !i.ok);
}

/** Read a JSON column safely: anything not shaped like a checklist becomes a
 *  blank one, so a bad row cannot crash the order page. */
export function parseChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return defaultChecklist();
  const byKey = new Map<string, ChecklistItem>();
  for (const r of raw) {
    if (r && typeof r === "object" && typeof (r as ChecklistItem).key === "string") {
      const x = r as ChecklistItem;
      byKey.set(x.key, { key: x.key, no: String(x.no ?? ""), label: String(x.label ?? ""), value: String(x.value ?? ""), ok: Boolean(x.ok) });
    }
  }
  // Always the full point list, in SOP order, with labels from here (so a
  // relabelled point updates everywhere) and answers from the row.
  return CHECKLIST_POINTS.map((p) => {
    const have = byKey.get(p.key);
    return { ...p, value: have?.value ?? "", ok: have?.ok ?? false };
  });
}
