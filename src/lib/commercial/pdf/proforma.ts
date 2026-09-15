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
// AND NOT EVERY PI IS AN INDIAN EXPORTER'S (owner, 2026-09-15; scripts/0085).
// A proforma from MONOLITH SURFACES INC, the group's US subsidiary, to a US
// buyer is a US invoice: the GSTIN, the RBI code number, the jurisdictional
// customs office, the AD code on the bank block and the "goods of Indian
// Origin" declaration are not blanked on it, they are NOT ON IT — a labelled
// box with nothing after the colon asks the customer a question about a
// country the sale never touched. printsIndianBlock(snapshot) is that one
// question, asked of the frozen snapshot the way printsParty is, so a
// proforma frozen as a US document keeps printing as one for ever and a
// proforma frozen before any of this existed prints as Pacific, unchanged.
//
// Its bank block is the other half: a US account is paid by WIRE or by ACH,
// the two routes carry DIFFERENT account numbers, and a payer who reads one
// line out of the wrong route has the money returned a week later. They print
// as two labelled blocks and are never merged into one.
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
import { piPrintFields, piRow, piTotalRow, piTableHeader, partyBlock, printsParty, printsIndianBlock, type PiSnapshot } from "@/lib/commercial/proforma-rules";

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
  // Asked once, of the snapshot, and never of whether a field came out blank:
  // an empty RBI code on a Pacific PI is a mistake somebody made in Settings
  // and should be visible as the empty box it is, while a US seller has no RBI
  // code to leave empty and its paper must not carry the label at all.
  const indian = printsIndianBlock(snapshot);
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
        // "Exporter" on an Indian exporter's paper and "Seller" on anyone
        // else's — decided in proforma-rules like every other string here.
        [partyCell(f.exporterLabel, exporter)],
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
        // RBI CODE AND GSTIN READ AS "label: value", ONE PER LINE (owner,
        // 2026-09-15). field() stacks a small grey label above its value, which
        // is right for a box somebody fills in and wrong for two registration
        // numbers that never change: it printed "RBI Code No." on one line and
        // then "678        GSTIN : 33AALCP2750N1Z3" run together on the next,
        // so the GSTIN had a label and the 678 appeared to have none. Their own
        // reference proforma prints them as "RBI Code No.:678" and
        // "GSTIN NO: 33AALCP2750N1Z3", each complete on its own line, and that
        // is what this is. The GSTIN line is dropped rather than left dangling
        // when there is none, the way every other conditional row here behaves.
        //
        // AND THE WHOLE PAIR IS AN INDIAN EXPORTER'S — both rows together or
        // neither (owner, 2026-09-15; scripts/0085). The RBI code number is
        // issued by the Reserve Bank, the GSTIN by an Indian state, and the
        // office named below is the customs division whose jurisdiction the
        // goods leave through. A US company selling inside the US has none of
        // the three, so the two rows are dropped whole rather than printed
        // with nothing in them. fullRow() carries its own filler cell, so
        // dropping them cannot leave a colSpan behind and shear every row
        // beneath it.
        ...(indian
          ? [
              fullRow({
                stack: [
                  { text: [{ text: "RBI Code No.: ", fontSize: FS.label, color: "#444" }, { text: f.rbiCode || " ", fontSize: FS.value }] },
                  ...(f.gstin ? [{ text: [{ text: "GSTIN : ", fontSize: FS.label, color: "#444" }, { text: f.gstin, fontSize: FS.value }] }] : []),
                ],
              }),
              fullRow({
                stack: [
                  { text: "Jurisdictional Central Excise Division Office Address", fontSize: FS.label, color: "#444" },
                  { text: f.customsOffice || " ", fontSize: 6.5 },
                ],
              }),
            ]
          : []),
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
        // NO VESSEL / FLIGHT NUMBER ON A PROFORMA (owner, 2026-09-15: "not
        // required in any PI"), and it is not merely blanked — the cell is
        // gone. A proforma is raised before anything is booked, so the vessel
        // is never known when this document is written; printing an empty box
        // for it invited somebody to treat the PI as the place that answer
        // belongs.
        //
        // AND NOTHING DOWNSTREAM LOSES A VESSEL BY THIS, which is worth stating
        // because the obvious worry is wrong in an unobvious way: there is no
        // vessel column on commercial_order at all. The PI's box was typed on
        // the PI and fed nothing. The one place this module records a vessel is
        // the INVOICE's frozen snapshot, and the packing list reads it from
        // there (packing-rules.vesselFromSnapshot, which says so in its own
        // header). Both are untouched. The PI snapshot keeps carrying `vessel`
        // so a proforma frozen before today still round-trips; it simply is not
        // drawn any more.
        //
        // The two ports pair up in its place rather than leaving Port of
        // Loading alone in a half-width cell, and Final Destination takes the
        // full width below them: loading, discharge, destination still read in
        // that order down the block.
        pairRow(field("Port of Loading", f.portOfLoading), field("Port of Discharge", f.portOfDischarge)),
        fullRow(field("Final Destination", f.finalDestination)),
      ],
    },
    layout: gridLayout,
    margin: [0, 0, 0, 0],
  };

  // ── payment terms and the banks ───────────────────────────────────────────
  // HOW THE ACCOUNT IS QUOTED. An Indian exporter's is quoted by its AD code,
  // its number and its IFSC across three columns, and that row prints whether
  // or not each cell has something in it — the ICICI account has never had an
  // AD code and has always printed the label empty, and that is the box the
  // owner is used to reading. An AD code is an authorised-dealer code issued
  // in India and an IFSC is an Indian branch code: a US account has neither,
  // so on its paper those cells are absent and the account number takes the
  // width they used to share.
  const accountRow: any = indian
    ? {
        columns: [
          { width: "34%", text: [{ text: "AD Code : ", bold: true }, f.adCode], fontSize: FS.body },
          { width: "33%", text: [{ text: "A/c No : ", bold: true }, f.accountNo], fontSize: FS.body },
          { width: "33%", text: [{ text: "IFSC : ", bold: true }, f.ifsc], fontSize: FS.body },
        ],
      }
    : { text: [{ text: "A/c No : ", bold: true }, f.accountNo], fontSize: FS.body };

  // WHERE THE MONEY IS ROUTED — two shapes, because two different things are
  // being told to the payer.
  //
  // An Indian exporter names ONE correspondent: "Routing Bank", its name, its
  // SWIFT. That is the block every Pacific proforma has carried and it is
  // reproduced here to the line.
  //
  // A US account is paid two ways and the two are NOT interchangeable: a wire
  // goes through the intermediary bank's SWIFT to the beneficiary's account
  // WITH that intermediary, and an ACH goes by routing number to an
  // ACH-ONLY account number that is a different number entirely. Printing them
  // as one run of lines is how a payer ends up wiring to the ACH number and
  // learning about it a week later when the money comes back, so each route is
  // its own labelled block. Every line is withheld when the sheet gives no
  // value for it — nothing here is invented and nothing prints an empty label.
  const routingLines: any[] = indian
    ? (f.routingBank || f.routingSwift
        ? [
            { text: "Routing Bank", fontSize: FS.body, bold: true, margin: [0, 2, 0, 0] },
            { text: f.routingBank, fontSize: FS.body },
            { text: [{ text: "Swift Code : ", bold: true }, f.routingSwift], fontSize: FS.body },
          ]
        : [])
    : [
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
    termLine("Payment Terms", f.paymentTerms),
    { text: "Our Bank Details", fontSize: FS.body, bold: true, margin: [0, 2, 0, 0] },
    { text: f.bankName, fontSize: FS.body },
    ...(f.bankAddress ? [{ text: f.bankAddress, fontSize: FS.body }] : []),
    accountRow,
    { text: [{ text: "Swift Code : ", bold: true }, f.swift], fontSize: FS.body },
    ...routingLines,
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
            // THE DISCOUNT LINE IS DRAWN ONLY WHEN THERE IS A DISCOUNT (owner,
            // 2026-09-15), for the same reason the Buyer-if-Not-Consignee cell
            // above it is conditional: a bold label with nothing after it reads
            // to a customer as a figure somebody forgot to fill in. Their own
            // earlier export PI (SAL-ORD/26-27/01642) does carry one — it is
            // how a total is rounded to a clean figure, the 24.657 remainder
            // sitting on this line — so the line is withheld, never removed.
            ...(f.discount ? [{ text: [{ text: "DISCOUNT AMOUNT : ", bold: true }, f.discount], fontSize: FS.body }] : []),
            // THE DECLARATION IS AN INDIAN EXPORTER'S CERTIFICATE — "we certify
            // that the above goods are of Indian Origin…" — and a US company
            // selling inside the US cannot certify it. The heading goes with
            // it: a bold "Declaration" over nothing is worse than no
            // declaration, and there is no US wording to put underneath
            // because the owner gave none and writing a certification for
            // somebody else to sign is not ours to do.
            ...(indian
              ? [
                  { text: "Declaration", fontSize: FS.label, bold: true, margin: [0, 3, 0, 0] },
                  { text: f.declaration, fontSize: 6.5, color: "#333" },
                ]
              : []),
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
