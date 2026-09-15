/* eslint-disable @typescript-eslint/no-explicit-any */
// The proforma invoice PDF — the paper the customer sees.
//
// Laid out to match the reference (1404, "Surfaces by Pacific", 10-07-2026)
// described in DESIGN.md §6: title, exporter / consignee / notify down the
// left, the invoice's own facts down the right, the carriage grid, payment
// terms and the two banks, the item table with its two-row header, the total
// and the amount in words, then weights, discount, declaration and the three
// signature blocks.
//
// NOTHING is decided here. Every string in every cell comes from
// lib/commercial/proforma-rules (piPrintFields / piRow / piTotalRow /
// partyBlock), which is pure and is run by tests/commercialProforma.test.ts —
// so "a blank field prints blank, never None" and "dates are DD-MM-YYYY" are
// tested properties of the document, not of a rendering nobody can assert on.
//
// The bank block is the one the snapshot froze for its bankKey (answer 23:
// Kotak on export, ICICI on domestic, changeable before issue) and the GSTIN
// is the registration chosen for it (answer 21) — the PDF prints the paper as
// issued, never today's settings. A PI with no validUntil (answer 24: valid
// forever) prints no validity line at all.
//
// THREE ROWS OF THE RIGHT-HAND COLUMN ARE NOT ON EVERY PI (owner, 2026-09-15):
//
//  * "Buyer if Not Consignee" is printed only when that party has something on
//    it (printsParty). One customer — Surfaces by Pacific — buys through a
//    second party; every other PI used to print an empty labelled box.
//  * "Sales Person" is printed only when piSalesperson names one, which it does
//    on a DOMESTIC PI and never on an export one.
//  * "Terms & Conditions" is the opposite case and must STAY UNCONDITIONAL: the
//    box is labelled and prints empty, exactly as the customer's reference PI
//    shows it. It carries snapshot.notes — what a human typed — and nothing
//    derived; do not "tidy" it away for being blank, and do not fill it.
//
// Every one of those rows spans both columns, which in pdfmake means a cell
// carrying colSpan: 2 followed by an empty filler cell. fullRow() below builds
// the pair, so a row can be added or dropped whole and there is no way to leave
// a colSpan without its filler and shear every row beneath it.
//
// pdfmake, Roboto (the only font installed), A4 portrait. Do NOT reach for
// puppeteer: it is not installed and the deployment has no Chrome.
import { buildPdf } from "@/lib/sales/pdf/common";
import { piPrintFields, piRow, piTotalRow, piTableHeader, partyBlock, printsParty, type PiSnapshot } from "@/lib/commercial/proforma-rules";

// ── the reference's type scale ───────────────────────────────────────────────
const FS = { body: 7.5, label: 7, value: 8, head: 8, title: 12, big: 9 } as const;
const GREY = "#f2f2f2";

/** A hairline box round every cell — the reference is a grid of boxes. */
const gridLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => "#000000",
  vLineColor: () => "#000000",
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 2,
  paddingBottom: () => 2,
};

const noBorder = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  paddingLeft: () => 0,
  paddingRight: () => 0,
  paddingTop: () => 1,
  paddingBottom: () => 1,
};

/** "Label" over its value — the shape every box on this document has. */
function field(label: string, value: string, opts: { bold?: boolean; upper?: boolean } = {}): any {
  return {
    stack: [
      { text: label, fontSize: FS.label, color: "#444" },
      { text: value || " ", fontSize: FS.value, bold: Boolean(opts.bold), characterSpacing: 0 },
    ],
  };
}

/** Two fields side by side inside one row of a bordered table. */
function pairRow(a: any, b: any): any[] {
  return [a, b];
}

/** One cell across both columns of a two-column table: the colSpan and the
 *  filler cell pdfmake needs behind it, built together so neither can be left
 *  behind when a row is added or dropped. */
function fullRow(cell: any): any[] {
  return [{ colSpan: 2, ...cell }, {}];
}

/** A named party: bold name, then its printed lines. */
function partyCell(label: string, p: ReturnType<typeof partyBlock>): any {
  return {
    stack: [
      { text: label, fontSize: FS.label, color: "#444" },
      { text: p.name || " ", fontSize: FS.value, bold: true },
      ...p.lines.map((l) => ({ text: l, fontSize: FS.body })),
    ],
  };
}

/** One bold "Label : value" line in the terms / bank block. */
function termLine(label: string, value: string): any {
  return {
    text: [
      { text: `${label} : `, fontSize: FS.body, bold: true },
      { text: value, fontSize: FS.body },
    ],
    margin: [0, 0, 0, 1],
  };
}

export async function generateProformaPdf(snapshot: PiSnapshot): Promise<Buffer> {
  const f = piPrintFields(snapshot);
  const header = piTableHeader(snapshot.currency);
  const exporter = partyBlock(snapshot.exporter);
  const consignee = partyBlock(snapshot.consignee);
  const notify = partyBlock(snapshot.notifyParty);
  const buyer = partyBlock(snapshot.buyerIfNotConsignee);

  // ── left column: who ships, who receives, who is told ──────────────────────
  const leftStack: any = {
    table: {
      widths: ["*"],
      body: [
        [partyCell("Exporter", exporter)],
        [partyCell("Consignee", consignee)],
        [partyCell("Notify Party", notify)],
      ],
    },
    layout: gridLayout,
  };

  // ── right column: the invoice's own facts ─────────────────────────────────
  const rightStack: any = {
    table: {
      widths: ["50%", "50%"],
      body: [
        pairRow(field("Invoice No", f.invoiceNo, { bold: true }), field("Invoice Date", f.invoiceDate, { bold: true })),
        pairRow(field("Buyer's PO No", f.buyerPoNo), field("Delivery Date", f.deliveryDate)),
        fullRow(field("RBI Code No.", `${f.rbiCode}${f.gstin ? `        GSTIN : ${f.gstin}` : ""}`)),
        fullRow({
          stack: [
            { text: "Jurisdictional Central Excise Division Office Address", fontSize: FS.label, color: "#444" },
            { text: f.customsOffice || " ", fontSize: 6.5 },
          ],
        }),
        // Only where there IS a second buyer — SBP's PI prints its customer code
        // and US address here; every other PI has this row absent, not empty.
        ...(printsParty(snapshot.buyerIfNotConsignee) ? [fullRow(partyCell("Buyer if Not Consignee", buyer))] : []),
        pairRow(field("Country of Origin of goods", f.countryOfOrigin), field("Country of Final Destination", f.countryOfDestination)),
        // Whatever was typed into the box, or an empty box. Never conditional.
        fullRow(field("Terms & Conditions", f.termsAndConditions)),
        fullRow(field("Delivery Terms", f.deliveryTerms, { bold: true })),
        // The DTA salesperson (owner, 2026-09-15): who asked for this PI for
        // his customer. piSalesperson blanks it on an export PI, so the row is
        // not on that paper at all.
        ...(f.salesperson ? [fullRow(field("Sales Person", f.salesperson, { bold: true }))] : []),
      ],
    },
    layout: gridLayout,
  };

  // ── the carriage grid ─────────────────────────────────────────────────────
  const carriage: any = {
    table: {
      widths: ["50%", "50%"],
      body: [
        pairRow(field("Pre-Carriage By", f.preCarriageBy), field("Place of Receipt By Pre-Carrier", f.placeOfReceipt)),
        pairRow(field("Vessel / Flight No", f.vessel), field("Port of Loading", f.portOfLoading)),
        pairRow(field("Port of Discharge", f.portOfDischarge), field("Final Destination", f.finalDestination)),
      ],
    },
    layout: gridLayout,
    margin: [0, 0, 0, 0],
  };

  // ── payment terms and the banks ───────────────────────────────────────────
  const bankLines: any[] = [
    termLine("Payment Terms", f.paymentTerms),
    { text: "Our Bank Details", fontSize: FS.body, bold: true, margin: [0, 2, 0, 0] },
    { text: f.bankName, fontSize: FS.body },
    ...(f.bankAddress ? [{ text: f.bankAddress, fontSize: FS.body }] : []),
    {
      columns: [
        { width: "34%", text: [{ text: "AD Code : ", bold: true }, f.adCode], fontSize: FS.body },
        { width: "33%", text: [{ text: "A/c No : ", bold: true }, f.accountNo], fontSize: FS.body },
        { width: "33%", text: [{ text: "IFSC : ", bold: true }, f.ifsc], fontSize: FS.body },
      ],
    },
    { text: [{ text: "Swift Code : ", bold: true }, f.swift], fontSize: FS.body },
    ...(f.routingBank || f.routingSwift
      ? [
          { text: "Routing Bank", fontSize: FS.body, bold: true, margin: [0, 2, 0, 0] },
          { text: f.routingBank, fontSize: FS.body },
          { text: [{ text: "Swift Code : ", bold: true }, f.routingSwift], fontSize: FS.body },
        ]
      : []),
  ];

  const bankBlock: any = {
    table: { widths: ["*"], body: [[{ stack: bankLines }]] },
    layout: gridLayout,
  };

  // ── the item table ────────────────────────────────────────────────────────
  const h = (text: string, extra: Record<string, unknown> = {}): any => ({
    text, fontSize: FS.head, bold: true, alignment: "center", fillColor: GREY, ...extra,
  });
  const headerRow1: any[] = [
    h(header.top[0], { rowSpan: 2 }),
    h(header.top[1], { colSpan: 3 }), {}, {},
    h(header.top[4], { rowSpan: 2 }),
    h(header.top[5], { rowSpan: 2 }),
    h(header.top[6], { rowSpan: 2 }),
    h(header.top[7], { rowSpan: 2 }),
    h(header.top[8], { rowSpan: 2 }),
  ];
  const headerRow2: any[] = [{}, h(header.sub[0]), h(header.sub[1]), h(header.sub[2]), {}, {}, {}, {}, {}];

  const ALIGN = ["left", "left", "center", "center", "center", "center", "right", "right", "right"] as const;
  const bodyRows: any[][] = snapshot.lines.map((line) => {
    const cells = piRow(line);
    return cells.map((text, i) => ({ text, fontSize: FS.body, alignment: ALIGN[i] }));
  });

  const totals = piTotalRow(snapshot);
  const totalRow: any[] = totals.map((text, i) => ({
    text, fontSize: FS.head, bold: true, alignment: ALIGN[i], fillColor: GREY,
  }));

  const itemTable: any = {
    table: {
      headerRows: 2,
      dontBreakRows: true,
      widths: [72, "*", 30, 36, 44, 44, 52, 54, 62],
      body: [headerRow1, headerRow2, ...(bodyRows.length ? bodyRows : [[{ text: " ", colSpan: 9, fontSize: FS.body }, {}, {}, {}, {}, {}, {}, {}, {}]]), totalRow],
    },
    layout: gridLayout,
  };

  // ── total in figures and words ────────────────────────────────────────────
  const totalLine: any = {
    table: {
      widths: ["*"],
      body: [[{
        text: [
          { text: "Total Amount : ", bold: true, fontSize: FS.big },
          { text: `${f.currency} ${f.totalAmount}`, bold: true, fontSize: FS.big },
          { text: "        IN WORDS : ", bold: true, fontSize: FS.body },
          { text: f.amountInWords, fontSize: FS.body },
        ],
      }]],
    },
    layout: gridLayout,
  };

  // ── weights, discount, declaration and the signatures ─────────────────────
  const footer: any = {
    table: {
      widths: ["44%", "28%", "28%"],
      body: [[
        {
          stack: [
            { text: [{ text: "Gross Wt : ", bold: true }, f.grossWeight], fontSize: FS.body },
            { text: [{ text: "Net Wt : ", bold: true }, f.netWeight], fontSize: FS.body },
            { text: [{ text: "DISCOUNT AMOUNT : ", bold: true }, f.discount], fontSize: FS.body },
            { text: "Declaration", fontSize: FS.label, bold: true, margin: [0, 3, 0, 0] },
            { text: f.declaration, fontSize: 6.5, color: "#333" },
          ],
        },
        {
          stack: [
            { text: "Accept By Customer", fontSize: FS.body, bold: true, alignment: "center" },
            { text: " ", margin: [0, 16, 0, 0] },
            { text: "Customer Signatory", fontSize: FS.body, alignment: "center" },
          ],
        },
        {
          stack: [
            { text: `For ${snapshot.company.legalName}`, fontSize: FS.body, bold: true, alignment: "center" },
            { text: " ", margin: [0, 16, 0, 0] },
            { text: "Authorised Signatory & Stamp", fontSize: FS.body, alignment: "center" },
          ],
        },
      ]],
    },
    layout: gridLayout,
  };

  // Blank validUntil = valid forever (answer 24): no line, rather than a line
  // that says so — the reference PI carries no validity text either.
  const validity = f.validUntil
    ? [{ text: `This proforma invoice is valid until ${f.validUntil}.`, fontSize: 6.5, color: "#555", margin: [0, 3, 0, 0] }]
    : [];

  const docDef: any = {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [28, 28, 28, 28],
    defaultStyle: { font: "Roboto", fontSize: FS.body },
    info: { title: `${f.invoiceNo} — Proforma Invoice`, author: snapshot.company.legalName },
    content: [
      { text: f.title, fontSize: FS.title, bold: true, alignment: "center", margin: [0, 0, 0, 5] },
      {
        table: { widths: ["50%", "50%"], body: [[{ stack: [leftStack] }, { stack: [rightStack] }]] },
        layout: noBorder,
        margin: [0, 0, 0, 0],
      },
      carriage,
      bankBlock,
      itemTable,
      totalLine,
      footer,
      ...validity,
    ],
  };

  return buildPdf(docDef);
}
