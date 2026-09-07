// Shapes stored in the module's JSON columns, and the order-detail contract
// every screen consumes. Kept in one place so the order form, the PI snapshot,
// the invoice snapshot and the workbook root variables all mean the same thing
// by "consignee".

/** A named party with an address — bill-to, consignee, notify party. */
export interface Party {
  name: string;
  lines: string[];          // address lines as printed
  country?: string | null;
  tel?: string | null;
  email?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  code?: string | null;     // customer code, e.g. USA-041
}

export const emptyParty = (): Party => ({ name: "", lines: [] });

/** One printed line on a PI or invoice. */
export interface DocLine {
  lineNo: number;
  itemCode: string | null;     // the customer's SKU, e.g. VGWT10301A-Polish-Super Jumbo-30mm-Premium
  description: string;         // CARRARA ROYALE-Polish-Super Jumbo-30mm-Premium
  design: string | null;
  thickness: string | null;    // printed as on the doc, e.g. 30mm or 2 CM
  slabs: number | null;
  hsn: string;
  unit: string;                // Square Foot / SQFT / NOS
  qty: number;
  rate: number;
  amount: number;
  isSample: boolean;
}

/** The PI snapshot — everything the PI PDF prints, frozen at issue time. */
export interface ProformaSnapshot {
  number: string;
  revision: number;
  date: string;                 // YYYY-MM-DD
  deliveryDate: string | null;
  validUntil: string | null;
  kind: "DOMESTIC" | "EXPORT";
  currency: string;
  buyerPoNo: string | null;
  exporter: Party;
  consignee: Party;
  notifyParty: Party | null;
  buyerIfNotConsignee: Party | null;
  countryOfOrigin: string;
  countryOfDestination: string | null;
  deliveryTerms: string | null;  // FOB / C&F ...
  paymentTerms: string | null;
  preCarriageBy: string | null;
  placeOfReceipt: string | null;
  vessel: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  finalDestination: string | null;
  lines: DocLine[];
  totalSlabs: number;
  totalAmount: number;
  amountInWords: string;
  grossWeight: string | null;
  netWeight: string | null;
  discount: number;
  bank: { name: string; address: string; accountNo: string; ifsc: string; swift: string; adCode?: string; routingBank?: string; routingSwift?: string };
  company: { legalName: string; addressLines: string[]; gstin: string; rbiCode: string; customsOffice: string };
  declaration: string;
  notes: string | null;
}

/** The invoice snapshot — DTA or export. */
export interface InvoiceSnapshot {
  kind: "DTA" | "EXPORT";
  number: string;
  date: string;
  piNumber: string | null;
  piDate: string | null;
  buyerPoRef: string | null;   // "PO-4068622 Dt: 03/07/2026"
  salesPerson: string | null;
  commodity: string;
  currency: string;
  exchangeRate: number | null;
  exporter: Party;
  buyer: Party;                // bill-to
  consignee: Party;
  notifyParty: Party | null;
  /** The export invoice prints a "Buyer (if other than Consignee)" block, as
   *  the proforma does. Optional: it was missing from the first cut, so the
   *  export PDF derived it by comparing the buyer's and consignee's names. */
  buyerIfNotConsignee?: Party | null;
  countryOfOrigin: string;
  countryOfDestination: string | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  preCarriageBy: string | null;
  placeOfReceipt: string | null;
  vessel: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  finalDestination: string | null;
  lines: DocLine[];
  subtotal: number;
  taxType: "IGST" | "CGST_SGST" | "NONE";
  taxRate: number;
  igst: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  grandTotal: number;
  amountInWords: string;
  marksAndNos: string | null;
  packages: string | null;     // "07 Wooden Crate(S) + 08 Sample Box"
  grossWeight: string | null;
  netWeight: string | null;
  containerNo: string | null;
  sealNo: string | null;
  linerOtlNo: string | null;
  vehicleNo: string | null;
  transporter: string | null;
  /** Optional for the same reason as buyerIfNotConsignee: both live on the
   *  invoice row and were not carried into the frozen snapshot, so a reissued
   *  PDF could not print the lorry receipt or the e-way bill it was issued with. */
  lrNo?: string | null;
  ewayBillNo?: string | null;
  lutText: string | null;
  bank: ProformaSnapshot["bank"];
  company: { legalName: string; shortName: string; addressLines: string[]; gstin: string; iec: string; pan: string; tan: string; stateCode: string; districtCode: string; customsOffice: string; commissionerate: string; division: string; range: string; locationCode: string; hsnQuartz: string };
  declaration: string;
  notes: string | null;
}

/** One line on a delivery challan. */
export interface ChallanItem {
  description: string;
  qty: number;
  unit: string;        // Nos / Box
  sqft: number | null;
  rate: number;
  amount: number;
  hsn: string | null;
}

// ─────────────────────────── the order detail contract ────────────────────────
// What GET /api/office/commercial/orders/[id] returns and what every order tab
// consumes. Produced by plain() over the Prisma row with the include named in
// docs/commercial-module/DESIGN.md — so Decimal is number and Date is an ISO
// string everywhere below. Nullable columns are `| null`.

export interface ClientExtDto {
  clientId: string;
  customerCode: string | null;
  gstin: string | null;
  pan: string | null;
  stateCode: string | null;
  billingAddress: Party | null;
  shippingAddress: Party | null;
  notifyParty: Party | null;
  defaultIncoterm: string | null;
  defaultCurrency: string | null;
  notes: string | null;
}

export interface ClientDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  contactPerson: string | null;
  defaultCurrency: string | null;
  defaultPaymentTerms: string | null;
  defaultDeliveryTerms: string | null;
  defaultPortOfDischarge: string | null;
  commercialExt: ClientExtDto | null;
}

export interface OrderItemDto {
  id: string;
  orderId: string;
  lineNo: number;
  design: string | null;
  customerSku: string | null;
  description: string | null;
  thickness: string | null;
  finish: string | null;
  sizeLabel: string | null;
  gradeLabel: string | null;
  qtySlabs: number | null;
  qty: number | null;
  uom: string;
  rate: number | null;
  amount: number | null;
  hsn: string;
  isSample: boolean;
  notes: string | null;
}

export interface HoldSlabDto {
  id: string;
  slabNumber: number;
  design: string | null;
  thickness: string | null;
  batchKey: string | null;
  batchNumber: string | null;
  grade: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  sqft: number | null;
  releasedAt: string | null;
  packedAt: string | null;
}

export interface HoldDto {
  id: string;
  orderId: string | null;
  enquiryId: string | null;
  reference: string;
  customer: string | null;
  status: "ACTIVE" | "RELEASED" | "EXPIRED" | "CONSUMED";
  placedByName: string | null;
  placedAt: string;
  expiresAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
  notes: string | null;
  slabs: HoldSlabDto[];
}

export interface ProductionRequestDto {
  id: string;
  orderId: string | null;
  orderItemId: string | null;
  design: string;
  thickness: string;
  finish: string | null;
  qtyRequired: number;
  qtyAvailable: number;
  qtyShort: number;
  priority: number;
  status: "QUEUED" | "SCHEDULED" | "IN_PRODUCTION" | "PRODUCED" | "CANCELLED";
  cleaningNote: string | null;
  plannedBatch: string | null;
  notes: string | null;
  raisedByName: string | null;
  raisedAt: string;
  scheduledAt: string | null;
  startedAt: string | null;
  producedAt: string | null;
  producedBatchKeys: string[];
  notifiedAt: string | null;
  notifiedVia: string | null;
  /** The plan's own figures (answer 13; scripts/0079). plannedSlabs starts
   *  equal to qtyShort; cleaningHours is 3, or 6 after a DARK → LIGHT jump;
   *  shade is the design master's LIGHT / MEDIUM / DARK, null when unknown. */
  plannedSlabs: number | null;
  plannedHours: number | null;
  cleaningHours: number | null;
  shade: string | null;
  /** Every edit to those figures, newest first. */
  changes: PlanChangeDto[];
}

/** One row of commercial_production_plan_change: what was planned and then
 *  changed, so a reduction is "never simply gone" (answer 13). */
export interface PlanChangeDto {
  id: string;
  requestId: string;
  field: "plannedSlabs" | "plannedHours" | "cleaningHours";
  fromValue: number | null;
  toValue: number | null;
  delta: number;
  reason: string | null;
  status: "OPEN" | "ADDED_BACK" | "REMOVED";
  changedByName: string | null;
  changedAt: string;
  resolvedAt: string | null;
}

/** One row of commercial_design_code (answer 20): the customer-facing item
 *  code the owner supplies per design, and the shade the queue orders by. */
export interface DesignCodeDto {
  design: string;
  code: string | null;
  shade: "LIGHT" | "MEDIUM" | "DARK" | null;
  shadeConfirmed: boolean;
  notes: string | null;
  updatedAt: string;
}

/** Money received against an order (answer 29). The first ADVANCE is the
 *  one fact that lets a truck leave (answer 2, stages.canEnter). */
export interface ReceiptDto {
  id: string;
  orderId: string;
  kind: "ADVANCE" | "CAD" | "BALANCE" | "OTHER";
  amount: number;
  currency: string;
  receivedAt: string;
  mode: string | null;
  reference: string | null;
  notes: string | null;
  recordedByName: string | null;
  createdAt: string;
}

export interface ProformaDto {
  id: string;
  orderId: string;
  number: string;
  revision: number;
  status: "DRAFT" | "ISSUED" | "ACCEPTED" | "SUPERSEDED" | "CANCELLED";
  issuedAt: string | null;
  validUntil: string | null;
  acceptedAt: string | null;
  supersededAt: string | null;
  snapshot: ProformaSnapshot;
  currency: string;
  totalAmount: number | null;
  notes: string | null;
  createdAt: string;
}

export interface CrateDto {
  id: string;
  crateNo: number;
  kind: string;
  grossKg: number | null;
  netKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  remarks: string | null;
}

export interface PackedSlabDto {
  id: string;
  crateId: string | null;
  slabNumber: number;
  customerSlabNo: string | null;
  customerBatchNo: string | null;
  design: string | null;
  customerSku: string | null;
  thickness: string | null;
  batchKey: string | null;
  batchNumber: string | null;
  grade: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  sqm: number | null;
  sqft: number | null;
  fit: "PENDING" | "FIT" | "UNFIT";
  unfitReason: string | null;
  checkedAt: string | null;
  sortOrder: number;
}

export interface PackingListDto {
  id: string;
  orderId: string;
  number: string;
  status: "DRAFT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "FINAL" | "DISPATCHED";
  containerNo: string | null;
  sealNo: string | null;
  linerOtlNo: string | null;
  vehicleNo: string | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  packagesSummary: string | null;
  /** The unit the packing and measurement lists print in (answer 17):
   *  "cm" (the default, 347 × 201) or "in" (137 × 79). */
  measurementUnit: "cm" | "in";
  notes: string | null;
  createdByName: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  verificationNote: string | null;
  finalisedAt: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  crates: CrateDto[];
  slabs: PackedSlabDto[];
}

export interface InvoiceDto {
  id: string;
  orderId: string;
  packingListId: string | null;
  kind: "DTA" | "EXPORT";
  number: string;
  invoiceDate: string;
  status: "DRAFT" | "ISSUED" | "CANCELLED";
  currency: string;
  exchangeRate: number | null;
  snapshot: InvoiceSnapshot;
  subtotal: number | null;
  taxType: string | null;
  taxRate: number | null;
  igst: number | null;
  cgst: number | null;
  sgst: number | null;
  roundOff: number | null;
  grandTotal: number | null;
  amountInWords: string | null;
  vehicleNo: string | null;
  transporter: string | null;
  lrNo: string | null;
  containerNo: string | null;
  sealNo: string | null;
  ewayBillNo: string | null;
  notes: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  exportDocSet: { id: string; rootVariables: Record<string, unknown>; generatedAt: string | null } | null;
}

export interface ChallanDto {
  id: string;
  number: string;
  challanDate: string;
  orderId: string | null;
  consigneeClientId: string | null;
  consigneeName: string;
  consigneeAddress: string | null;
  consigneeGstin: string | null;
  poRef: string | null;
  commodity: string | null;
  purpose: string | null;
  items: ChallanItem[];
  totalAmount: number | null;
  amountInWords: string | null;
  lorryNo: string | null;
  notes: string | null;
  status: "DRAFT" | "ISSUED" | "CANCELLED";
  issuedAt: string | null;
  createdAt: string;
}

export interface OrderEventDto {
  id: string;
  kind: string;
  note: string | null;
  payload: unknown;
  byName: string | null;
  at: string;
}

export interface OrderDetail {
  id: string;
  number: string;
  kind: "DOMESTIC" | "EXPORT";
  status: string;
  clientId: string;
  enquiryId: string | null;
  customerPoNumber: string | null;
  customerPoDate: string | null;
  poEvidence: "PO" | "PI_ACKNOWLEDGED" | "EMAIL" | null;
  currency: string;
  exchangeRate: number | null;
  incoterm: string | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  paymentMode: string | null;
  billTo: Party | null;
  consignee: Party | null;
  notifyParty: Party | null;
  buyerIfNotConsignee: Party | null;
  preCarriageBy: string | null;
  placeOfReceipt: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  finalDestination: string | null;
  countryOfOrigin: string;
  countryOfDestination: string | null;
  deliverySchedule: string | null;
  specialPacking: string | null;
  forwarderDetails: string | null;
  receiverDetails: string | null;
  customerContact: string | null;
  /** Always the full 22-point list (parseChecklist), never raw JSON. */
  checklist: Array<{ key: string; no: string; label: string; value: string; ok: boolean }>;
  checkedByName: string | null;
  checkedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  notes: string | null;
  confirmedAt: string | null;
  stockCheckedAt: string | null;
  piIssuedAt: string | null;
  packingAt: string | null;
  dispatchCheckedAt: string | null;
  readyAt: string | null;
  invoicedAt: string | null;
  dispatchedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  client: ClientDto;
  enquiry: { id: string; number: string } | null;
  items: OrderItemDto[];
  holds: HoldDto[];
  productionRequests: ProductionRequestDto[];
  /** Newest first. */
  receipts: ReceiptDto[];
  /** Derived: at least one ADVANCE receipt is recorded — the dispatch gate. */
  advanceReceived: boolean;
  proformas: ProformaDto[];
  packingLists: PackingListDto[];
  invoices: InvoiceDto[];
  challans: ChallanDto[];
  events: OrderEventDto[];
}

/** Props every order tab receives from the order workspace. */
export interface OrderTabProps {
  order: OrderDetail;
  /** The signed-in user's Commercial actions: view / write / verify / plan /
   *  approve / cancel / admin (lib/commercial/access-rules.ts). */
  actions: string[];
  /** Re-fetch the order after a write. */
  refresh: () => void;
}
