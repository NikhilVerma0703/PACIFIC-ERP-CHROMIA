// The COMMERCIAL INVOICE of a group company that is not an Indian exporter —
// today that is MONOLITH SURFACES INC, the US subsidiary (the owner,
// 2026-09-15: "integrate these types on invoices too in the PI builder").
//
// WHY A THIRD DOCUMENT AND NOT A BRANCH IN THE EXISTING TWO. Two reasons, and
// the first is the stronger.
//
//  1. REPRINT IMMUTABILITY. pdf/export-invoice.ts and pdf/dta-invoice.ts print
//     every invoice this company has ever issued, and the PDF route exists to
//     make a reprint years later byte-for-byte what the customer received. An
//     `if (indian)` inside either file puts that guarantee in the hands of
//     whoever edits it next. Those two files get ZERO lines of this change,
//     which makes the guarantee structural rather than careful.
//  2. IT IS A DIFFERENT DOCUMENT. Strip the GSTIN, the IEC, the LUT bond, the
//     AD code, the jurisdictional customs office and the Indian-origin
//     certificate out of Pacific's export invoice and what is left is not a
//     thinner version of that sheet — it is the sheet the owner signed off on
//     2026-09-15 as the format, which is the proforma's. So this is built from
//     the SAME primitives as the proforma (pdf/format.ts) and prints as its
//     sibling, which is what he asked for.
//
// PURE, and importable by `node --test`: relative .ts imports only, no Next,
// no Prisma, no `@/` alias. Every string the PDF prints is decided here and
// asserted in tests/commercialSellerInvoice.test.ts, so "a blank field prints
// blank" is a tested property rather than a claim about a rendering nobody can
// inspect. The renderer in pdf/seller-invoice.ts makes no decisions at all.
import {
  printsIndianBlock, printable, fmtQty, fmtAmount, fmtSlabs, partyBlock,
  formatPiDate,
} from "./proforma-rules.ts";
import type { InvoiceSnapshot } from "./types.ts";

/**
 * Does this invoice render as the seller document rather than as one of
 * Pacific's two? Asked of the frozen SELLER, exactly as the proforma asks it,
 * so an invoice frozen before any of this existed — carrying no seller at all
 * — answers false and keeps its original renderer for ever.
 */
export function printsSellerInvoice(s: InvoiceSnapshot): boolean {
  return !printsIndianBlock(s);
}

export interface SellerInvoiceFields {
  title: string;
  sellerLabel: string;
  invoiceNo: string;
  invoiceDate: string;
  piNumber: string;
  piDate: string;
  buyerPoRef: string;
  countryOfOrigin: string;
  countryOfDestination: string;
  deliveryTerms: string;
  paymentTerms: string;
  preCarriageBy: string;
  placeOfReceipt: string;
  vessel: string;
  portOfLoading: string;
  portOfDischarge: string;
  finalDestination: string;
  marksAndNos: string;
  packages: string;
  containerNo: string;
  sealNo: string;
  grossWeight: string;
  netWeight: string;
  salesPerson: string;
  notes: string;
  currency: string;
  totalAmount: string;
  amountInWords: string;
  totalSlabs: string;
  bankName: string;
  bankAddress: string;
  accountNo: string;
  ifsc: string;
  swift: string;
  routingBank: string;
  routingSwift: string;
  routingAccountNo: string;
  achBank: string;
  achRoutingNo: string;
  achAccountNo: string;
  declaration: string;
}

/**
 * Everything the seller invoice prints, already formatted. A field with
 * nothing behind it is the EMPTY STRING and never "null" or "undefined": the
 * renderer withholds the whole box for an empty string, which is the rule the
 * owner asked for three times on 2026-09-15 and the reason this document has
 * no labelled boxes standing empty.
 */
export function siPrintFields(s: InvoiceSnapshot): SellerInvoiceFields {
  const b = s.bank ?? ({} as InvoiceSnapshot["bank"]);
  return {
    // "INVOICE", not "COMMERCIAL INVOICE" and not "TAX INVOICE": it is neither
    // an Indian customs document nor a GST one.
    title: "INVOICE",
    // The proforma renames its first cell "Seller" for a company that is not
    // an exporter, and the invoice follows it: a US company selling to a US
    // buyer exports nothing.
    sellerLabel: "Seller",
    invoiceNo: printable(s.number),
    invoiceDate: formatPiDate(s.date),
    piNumber: printable(s.piNumber),
    piDate: s.piDate ? formatPiDate(s.piDate) : "",
    buyerPoRef: printable(s.buyerPoRef),
    countryOfOrigin: printable(s.countryOfOrigin),
    countryOfDestination: printable(s.countryOfDestination),
    deliveryTerms: printable(s.deliveryTerms),
    paymentTerms: printable(s.paymentTerms),
    preCarriageBy: printable(s.preCarriageBy),
    placeOfReceipt: printable(s.placeOfReceipt),
    // THE INVOICE MAY NAME A VESSEL AND THE PROFORMA MAY NOT, and that is not
    // an inconsistency. A proforma is raised before anything is booked, so its
    // vessel box was always empty and was removed; an invoice is raised
    // against a real shipment, and the packing list reads the vessel off this
    // very snapshot.
    vessel: printable(s.vessel),
    portOfLoading: printable(s.portOfLoading),
    portOfDischarge: printable(s.portOfDischarge),
    finalDestination: printable(s.finalDestination),
    marksAndNos: printable(s.marksAndNos),
    packages: printable(s.packages),
    containerNo: printable(s.containerNo),
    sealNo: printable(s.sealNo),
    grossWeight: printable(s.grossWeight),
    netWeight: printable(s.netWeight),
    salesPerson: printable(s.salesPerson),
    notes: printable(s.notes),
    currency: printable(s.currency).toUpperCase() || "USD",
    totalAmount: fmtAmount(s.grandTotal),
    amountInWords: printable(s.amountInWords),
    totalSlabs: fmtSlabs(siTotalSlabs(s)),
    bankName: printable(b.name),
    bankAddress: printable(b.address),
    accountNo: printable(b.accountNo),
    ifsc: printable(b.ifsc),
    swift: printable(b.swift),
    routingBank: printable(b.routingBank),
    routingSwift: printable(b.routingSwift),
    routingAccountNo: printable(b.routingAccountNo),
    achBank: printable(b.ach?.bank),
    achRoutingNo: printable(b.ach?.routingNo),
    achAccountNo: printable(b.ach?.accountNo),
    // Empty for a non-Indian seller, by piDeclarationFor at draft time. The
    // renderer draws no heading over an empty declaration.
    declaration: printable(s.declaration),
  };
}

/** Slabs across every line — the figure the item table totals. */
export function siTotalSlabs(s: InvoiceSnapshot): number {
  return (s.lines ?? []).reduce((n, l) => n + (Number.isFinite(l.slabs) ? Number(l.slabs) : 0), 0);
}

/** The item table's total row, in the same nine columns piRow prints. */
export function siTotalRow(s: InvoiceSnapshot): string[] {
  return ["", "Total", "", fmtSlabs(siTotalSlabs(s)), "", "", "", "", fmtAmount(s.grandTotal)];
}

/** The parties, in the shape the shared partyCell draws. */
export function siParties(s: InvoiceSnapshot) {
  return {
    seller: partyBlock(s.exporter),
    consignee: partyBlock(s.consignee),
    notify: partyBlock(s.notifyParty),
    buyer: partyBlock(s.buyerIfNotConsignee),
  };
}

/** Quantity as the item table prints it — exported so a test can pin the
 *  two-decimals-or-three rule on this document too. */
export { fmtQty };
