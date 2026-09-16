/* eslint-disable @typescript-eslint/no-explicit-any */
// The COMMERCIAL INVOICE of a group company that is not an Indian exporter.
// Built entirely from ./format, so it prints as the sibling of the proforma
// the owner signed off on 2026-09-15 — same type scale, same hairline grid,
// same header where the two columns meet in the middle and close on one line.
//
// NOTHING IS DECIDED HERE. Every string comes from seller-invoice-rules, which
// is pure and is run by tests/commercialSellerInvoice.test.ts. This file only
// places boxes.
//
// pdf/export-invoice.ts and pdf/dta-invoice.ts are NOT touched by any of this,
// and a test asserts they stay free of the word `seller`: that is what makes
// "every already-issued invoice reprints byte-for-byte" a structural fact
// rather than a promise somebody has to keep.
import { buildPdf } from "@/lib/sales/pdf/common";
import { piTableHeader, piRow, printsParty, printable } from "@/lib/commercial/proforma-rules";
import { siPrintFields, siTotalRow, siParties } from "@/lib/commercial/seller-invoice-rules";
import type { InvoiceSnapshot } from "@/lib/commercial/types";
import {
  FS, GREY, gridLayout, outerGrid, innerGrid,
  field, fieldOrNull, fullRow, pairRow, partyCell, termLine,
} from "./format";

export function sellerInvoiceDocDef(snapshot: InvoiceSnapshot): any {
  const f = siPrintFields(snapshot);
  const p = siParties(snapshot);
  const header = piTableHeader(f.currency);

  // ── left column: who sells, who receives, who is told ─────────────────────
  const leftStack: any = {
    table: {
      widths: ["*"],
      body: [
        [partyCell(f.sellerLabel, p.seller)],
        [partyCell("Consignee", p.consignee)],
        ...(printsParty(snapshot.notifyParty) ? [[partyCell("Notify Party", p.notify)]] : []),
      ],
    },
    layout: innerGrid,
  };

  // ── right column: the invoice's own facts ─────────────────────────────────
  const rightStack: any = {
    table: {
      widths: ["50%", "50%"],
      body: [
        pairRow(field("Invoice No", f.invoiceNo, { bold: true }), field("Invoice Date", f.invoiceDate, { bold: true })),
        pairRow(fieldOrNull("Proforma No", f.piNumber), fieldOrNull("Proforma Date", f.piDate)),
        fullRow(fieldOrNull("Buyer's PO", f.buyerPoRef)),
        // Only where the party billed is not the party shipped to. The field is
        // populated at draft time now; before 2026-09-15 it never was, so a
        // renderer reading it would have printed nothing for every order.
        ...(printsParty(snapshot.buyerIfNotConsignee) ? [fullRow(partyCell("Buyer if Not Consignee", p.buyer))] : []),
        pairRow(fieldOrNull("Country of Origin of goods", f.countryOfOrigin), fieldOrNull("Country of Final Destination", f.countryOfDestination)),
        fullRow(fieldOrNull("Delivery Terms", f.deliveryTerms, { bold: true })),
        fullRow(fieldOrNull("Sales Person", f.salesPerson, { bold: true })),
      ].filter(Boolean) as any[],
    },
    layout: innerGrid,
  };

  // ── the carriage grid, and the whole block goes when every row does ───────
  const carriageRows: any[] = [
    pairRow(fieldOrNull("Pre-Carriage By", f.preCarriageBy), fieldOrNull("Place of Receipt By Pre-Carrier", f.placeOfReceipt)),
    // THE INVOICE MAY NAME A VESSEL WHERE THE PROFORMA MAY NOT, and that is
    // not an inconsistency between the two documents. A proforma is raised
    // before anything is booked, so its vessel box was always empty and was
    // removed; an invoice is raised against a real shipment, and the packing
    // list reads the vessel off this very snapshot.
    fullRow(fieldOrNull("Vessel / Flight No", f.vessel)),
    pairRow(fieldOrNull("Port of Loading", f.portOfLoading), fieldOrNull("Port of Discharge", f.portOfDischarge)),
    fullRow(fieldOrNull("Final Destination", f.finalDestination)),
  ].filter(Boolean) as any[];
  const carriage: any | null = carriageRows.length
    ? { table: { widths: ["50%", "50%"], body: carriageRows }, layout: gridLayout, margin: [0, 0, 0, 0] }
    : null;

  // ── what is actually in the container ────────────────────────────────────
  const shipRows: any[] = [
    pairRow(fieldOrNull("Marks & Nos", f.marksAndNos), fieldOrNull("No. & Kind of Packages", f.packages)),
    pairRow(fieldOrNull("Container No", f.containerNo), fieldOrNull("Seal No", f.sealNo)),
  ].filter(Boolean) as any[];
  const shipment: any | null = shipRows.length
    ? { table: { widths: ["50%", "50%"], body: shipRows }, layout: gridLayout, margin: [0, 0, 0, 0] }
    : null;

  // ── payment terms and the bank ───────────────────────────────────────────
  // ASKED OF THE ACCOUNT, NOT OF THE SELLER, exactly as on the proforma and
  // for the same reason a real document taught us there: an IFSC is an Indian
  // branch code, so its presence is what marks an Indian account. Keying this
  // on the seller instead printed "AD Code :" and "IFSC :" standing empty
  // around a New York account, the day one company was paid into another's
  // bank. Whose paper it is and whose ACCOUNT it is are two questions.
  const indianAccount = Boolean(printable(f.ifsc));
  const accountRow: any = indianAccount
    ? { text: [{ text: "A/c No : ", bold: true }, f.accountNo, { text: "        IFSC : ", bold: true }, f.ifsc], fontSize: FS.body }
    : { text: [{ text: "A/c No : ", bold: true }, f.accountNo], fontSize: FS.body };

  // TWO ROUTES, NEVER MERGED. A wire and an ACH carry DIFFERENT account
  // numbers, and a payer who reads one line out of the wrong route has the
  // money returned a week later.
  const routingLines: any[] = [
    ...(f.routingBank || f.routingSwift || f.routingAccountNo
      ? [
          { text: "Wire Transfer", fontSize: FS.body, bold: true, margin: [0, 2, 0, 0] },
          ...(f.routingBank ? [{ text: [{ text: "Intermediary Bank : ", bold: true }, f.routingBank], fontSize: FS.body }] : []),
          ...(f.routingAccountNo ? [{ text: [{ text: "Beneficiary's Correspondent A/c : ", bold: true }, f.routingAccountNo], fontSize: FS.body }] : []),
          ...(f.routingSwift ? [{ text: [{ text: "Correspondent Swift Code : ", bold: true }, f.routingSwift], fontSize: FS.body }] : []),
        ]
      : []),
    ...(f.achRoutingNo || f.achAccountNo
      ? [
          { text: "ACH Transfer", fontSize: FS.body, bold: true, margin: [0, 2, 0, 0] },
          ...(f.achBank ? [{ text: [{ text: "Intermediary Bank : ", bold: true }, f.achBank], fontSize: FS.body }] : []),
          ...(f.achRoutingNo ? [{ text: [{ text: "Routing No : ", bold: true }, f.achRoutingNo], fontSize: FS.body }] : []),
          ...(f.achAccountNo ? [{ text: [{ text: "A/c No (ACH only) : ", bold: true }, f.achAccountNo], fontSize: FS.body }] : []),
        ]
      : []),
  ];

  const bankLines: any[] = [
    ...(f.paymentTerms ? [termLine("Payment Terms", f.paymentTerms)] : []),
    { text: "Our Bank Details", fontSize: FS.body, bold: true, margin: [0, 2, 0, 0] },
    { text: f.bankName, fontSize: FS.body },
    ...(f.bankAddress ? [{ text: f.bankAddress, fontSize: FS.body }] : []),
    accountRow,
    ...(f.swift ? [{ text: [{ text: "Swift Code : ", bold: true }, f.swift], fontSize: FS.body }] : []),
    ...routingLines,
  ];
  const bankBlock: any = {
    table: { widths: ["*"], body: [[{ stack: bankLines }]] },
    layout: gridLayout,
    margin: [0, 0, 0, 0],
  };

  // ── the goods, in the accepted format's nine columns ──────────────────────
  const headCell = (t: string, opts: Record<string, any> = {}): any => ({
    text: t, fontSize: FS.head, bold: true, alignment: "center", fillColor: GREY, ...opts,
  });
  const headerRow1: any[] = [
    headCell(header.top[0], { rowSpan: 2 }),
    headCell(header.top[1], { colSpan: 3 }), {}, {},
    headCell(header.top[4], { rowSpan: 2 }),
    headCell(header.top[5], { rowSpan: 2 }),
    headCell(header.top[6], { rowSpan: 2 }),
    headCell(header.top[7], { rowSpan: 2 }),
    headCell(header.top[8], { rowSpan: 2 }),
  ];
  const headerRow2: any[] = [
    {}, headCell(header.sub[0]), headCell(header.sub[1]), headCell(header.sub[2]), {}, {}, {}, {}, {},
  ];
  const bodyRows: any[][] = (snapshot.lines ?? []).map((l) =>
    piRow(l).map((v, i) => ({
      text: v,
      fontSize: FS.body,
      alignment: i >= 6 ? "right" : i >= 2 && i <= 5 ? "center" : "left",
    })),
  );
  const totalRow: any[] = siTotalRow(snapshot).map((v, i) => ({
    text: v, fontSize: FS.body, bold: true, alignment: i >= 6 ? "right" : i === 3 ? "center" : "left",
  }));
  const itemLayout = { ...gridLayout, paddingLeft: () => 4, paddingRight: () => 4 };
  const itemTable: any = {
    table: {
      headerRows: 2,
      dontBreakRows: true,
      widths: [72, "*", 30, 36, 44, 44, 52, 54, 62],
      body: [
        headerRow1,
        headerRow2,
        ...(bodyRows.length ? bodyRows : [[{ text: " ", colSpan: 9, fontSize: FS.body }, {}, {}, {}, {}, {}, {}, {}, {}]]),
        totalRow,
      ],
    },
    layout: itemLayout,
  };

  const totalLine: any = {
    table: {
      widths: ["*"],
      body: [[{
        text: [
          { text: "Total Amount : ", bold: true, fontSize: FS.big },
          { text: f.currency + " " + f.totalAmount, bold: true, fontSize: FS.big },
          { text: "        IN WORDS : ", bold: true, fontSize: FS.body },
          { text: f.amountInWords, fontSize: FS.body },
        ],
      }]],
    },
    layout: gridLayout,
  };

  const weightLines: any[] = [
    ...(f.grossWeight ? [{ text: [{ text: "Gross Wt : ", bold: true }, f.grossWeight], fontSize: FS.body }] : []),
    ...(f.netWeight ? [{ text: [{ text: "Net Wt : ", bold: true }, f.netWeight], fontSize: FS.body }] : []),
    // WHAT A HUMAN TYPED ON THIS INVOICE. Both existing renderers print it
    // (export-invoice.ts and dta-invoice.ts, in this same block) and the
    // proforma prints the same string as its Terms & Conditions box. This file
    // computed the field and then never drew it, which would have thrown away
    // remarks somebody deliberately put on a customer's invoice — the one
    // document type here that is new was the only one losing them.
    ...(f.notes ? [{ text: f.notes, fontSize: FS.body, margin: [0, 3, 0, 0] }] : []),
    // NO HEADING OVER AN EMPTY DECLARATION. The Indian-origin certificate is a
    // statement only an Indian exporter can make; there is no US wording to
    // put in its place, and writing a certification for somebody else to sign
    // is not ours to do. So the block is absent, not blank.
    ...(f.declaration
      ? [
          { text: "Declaration", fontSize: FS.body, bold: true, margin: [0, 3, 0, 0] },
          { text: f.declaration, fontSize: 7.5 },
        ]
      : []),
  ];

  const footer: any = {
    table: {
      dontBreakRows: true,
      widths: ["44%", "28%", "28%"],
      body: [[
        { stack: weightLines.length ? weightLines : [{ text: " ", fontSize: FS.body }] },
        {
          stack: [
            { text: "Accept By Customer", fontSize: FS.body, bold: true, alignment: "center" },
            { text: " ", margin: [0, 16, 0, 0] },
            { text: "Customer Signatory", fontSize: FS.body, alignment: "center" },
          ],
        },
        {
          stack: [
            { text: "For " + snapshot.company.legalName, fontSize: FS.body, bold: true, alignment: "center" },
            { text: " ", margin: [0, 16, 0, 0] },
            { text: "Authorised Signatory & Stamp", fontSize: FS.body, alignment: "center" },
          ],
        },
      ]],
    },
    layout: gridLayout,
  };

  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [28, 28, 28, 28],
    defaultStyle: { font: "Roboto", fontSize: FS.body },
    info: { title: f.invoiceNo + " — Invoice", author: snapshot.company.legalName },
    content: [
      { text: f.title, fontSize: FS.title, bold: true, alignment: "center", margin: [0, 0, 0, 5] },
      {
        table: { widths: ["50%", "50%"], body: [[leftStack, rightStack]] },
        layout: outerGrid,
        margin: [0, 0, 0, 0],
      },
      ...(carriage ? [carriage] : []),
      ...(shipment ? [shipment] : []),
      bankBlock,
      itemTable,
      // The total and the signatures travel together, so a long order breaks
      // in the item table under its repeated column headings rather than
      // through the footer — the same rule the proforma follows, after a
      // six-line PI split its declaration across a page break.
      { stack: [totalLine, footer], unbreakable: true },
    ],
  };
}

export async function generateSellerInvoicePdf(snapshot: InvoiceSnapshot): Promise<Buffer> {
  return buildPdf(sellerInvoiceDocDef(snapshot));
}
