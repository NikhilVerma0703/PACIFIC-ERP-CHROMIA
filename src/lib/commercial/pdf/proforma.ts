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
import { piPrintFields, piRow, piTotalRow, piTableHeader, partyBlock, printsParty, printsIndianBlock, printable, type PiSnapshot } from "@/lib/commercial/proforma-rules";

// ── the reference's type scale ───────────────────────────────────────────────
// THE TYPE SCALE, sized up on 2026-09-15 — the owner, looking at an invoice
// that had lost its empty boxes and with them half its height: "make the boxes
// bigger in the table to take up more space in the page ... and text size
// maybe". The old scale was set against a reference document that filled an A4
// with boxes whether or not they said anything; once only the boxes that say
// something print, 7pt labels on a third of a page read as a fragment rather
// than as a document.
//
// EVERY VALUE HERE IS BOUNDED BY ONE THING: the page, and the true bound is
// FIVE item lines, not the ten this comment claimed until it was measured. A
// full Pacific export proforma — delivery terms, both ports, final destination,
// the Indian registration rows and the declaration — fits five lines on one
// sheet and goes to two at six. A Monolith US proforma, which drops the whole
// Indian block, is far lighter and fits more.
//
// The ten was never rendered; it was asserted. It is recorded here because the
// next person to raise these sizes needs the real number to trade against, and
// because the same comment went on to say a stranded signature block is worse
// than small type — which was true, and was happening at six lines. The layout
// now keeps the total and the signatures together (see the end of this file),
// so a long order breaks in the item table, under repeated column headings,
// instead of through the footer.
// THE FORMAT ITSELF NOW LIVES IN ./format — the type scale, the hairline grid,
// the header's outer/inner pair and the empty-box rules. It was lifted out of
// this file unchanged on 2026-09-15 so the seller invoice could be built from
// the very same primitives rather than a copy of them, which is how two
// documents that are meant to match start to diverge. This file keeps every
// decision about WHAT a proforma prints; format.ts knows only how a box looks.
import {
  FS, GREY, gridLayout, outerGrid, innerGrid,
  field, fieldOrNull, fullRow, pairRow, partyCell, termLine,
} from "./format";

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
        ...(printsParty(snapshot.notifyParty) ? [[partyCell("Notify Party", notify)]] : []),
      ].filter(Boolean) as any[],
    },
    layout: innerGrid,
  };

  // ── right column: the invoice's own facts ─────────────────────────────────
  const rightStack: any = {
    table: {
      widths: ["50%", "50%"],
      body: [
        pairRow(field("Invoice No", f.invoiceNo, { bold: true }), field("Invoice Date", f.invoiceDate, { bold: true })),
        pairRow(fieldOrNull("Buyer's PO No", f.buyerPoNo), fieldOrNull("Delivery Date", f.deliveryDate)),
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
                  { text: f.customsOffice || " ", fontSize: 7.5 },
                ],
              }),
            ]
          : []),
        // Only where there IS a second buyer — SBP's PI prints its customer code
        // and US address here; every other PI has this row absent, not empty.
        ...(printsParty(snapshot.buyerIfNotConsignee) ? [fullRow(partyCell("Buyer if Not Consignee", buyer))] : []),
        pairRow(fieldOrNull("Country of Origin of goods", f.countryOfOrigin), fieldOrNull("Country of Final Destination", f.countryOfDestination)),
        // TERMS & CONDITIONS IS NOW WITHHELD WHEN BLANK, and that reverses an
        // earlier decision on purpose. It used to print as a labelled empty box
        // because the customer's reference proforma shows one; then the owner,
        // 2026-09-15, first emptied it ("terms and conditions me tonnage nahi
        // dikhana — make it empty unless stated clearly to fill in it") and
        // then took the empty boxes off the page ("remove empty boxes like port
        // of loading etc"). The two together leave a labelled box that is empty
        // by instruction, which is the exact thing the second instruction
        // removes. It still carries snapshot.notes and nothing derived: when a
        // human types terms, they print.
        fullRow(fieldOrNull("Terms & Conditions", f.termsAndConditions)),
        fullRow(fieldOrNull("Delivery Terms", f.deliveryTerms, { bold: true })),
        // The DTA salesperson (owner, 2026-09-15): who asked for this PI for
        // his customer. piSalesperson blanks it on an export PI, so the row is
        // not on that paper at all.
        ...(f.salesperson ? [fullRow(field("Sales Person", f.salesperson, { bold: true }))] : []),
      ].filter(Boolean) as any[],
    },
    layout: innerGrid,
  };

  // ── the carriage grid ─────────────────────────────────────────────────────
  // AND THE WHOLE GRID GOES WHEN EVERY ROW IN IT DOES. On a US proforma none of
  // these five is known — no Indian port of loading, no pre-carriage leg — so
  // the body came out empty, and an empty table is not a small table: pdfmake
  // reads the first row to size its columns and throws on `undefined.length`.
  // The document simply has no carriage block on that paper.
  const carriageRows: any[] = [
        pairRow(fieldOrNull("Pre-Carriage By", f.preCarriageBy), fieldOrNull("Place of Receipt By Pre-Carrier", f.placeOfReceipt)),
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
        pairRow(fieldOrNull("Port of Loading", f.portOfLoading), fieldOrNull("Port of Discharge", f.portOfDischarge)),
        fullRow(fieldOrNull("Final Destination", f.finalDestination)),
  ].filter(Boolean) as any[];
  const carriage: any | null = carriageRows.length
    ? { table: { widths: ["50%", "50%"], body: carriageRows }, layout: gridLayout, margin: [0, 0, 0, 0] }
    : null;

  // ── payment terms and the banks ───────────────────────────────────────────
  // HOW THE ACCOUNT IS QUOTED. An Indian exporter's is quoted by its AD code,
  // its number and its IFSC across three columns, and that row prints whether
  // or not each cell has something in it — the ICICI account has never had an
  // AD code and has always printed the label empty, and that is the box the
  // owner is used to reading. An AD code is an authorised-dealer code issued
  // in India and an IFSC is an Indian branch code: a US account has neither,
  // so on its paper those cells are absent and the account number takes the
  // width they used to share.
  // ASKED OF THE BANK, NOT OF THE SELLER, and that correction came off a real
  // document: a Pacific proforma paid into MONOLITH's New York account (the
  // owner, 2026-09-15, "bank details should be monolith only") printed the
  // Indian three-column row round a US account, so "AD Code :" and "IFSC :"
  // stood there with nothing after them — the very empty labels he had just
  // had taken off this page. Whose paper it is decides the GSTIN block; which
  // ACCOUNT it is decides how that account is quoted, and the two are not the
  // same question the moment one company is paid into another's bank.
  //
  // An IFSC is an Indian branch code, so its presence is what marks an Indian
  // account. Pacific's two both carry one and are untouched: Kotak keeps its AD
  // code, and the domestic ICICI keeps the empty AD-code box it has always
  // printed, because that account IS Indian and simply has no code.
  const indianAccount = Boolean(printable(f.ifsc));
  const accountRow: any = indianAccount
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
  // The route follows the account for the same reason: a US account is paid by
  // wire or ACH whoever is selling.
  const routingLines: any[] = indianAccount
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

  // THE ITEM TABLE PAYS ITS PADDING NINE TIMES OVER, which is why it gets its
  // own, tighter horizontal figure. Every other block on this page has two or
  // three columns; this one has nine, so the 6pt sides that give the rest of
  // the document room cost it 108pt of the 539pt it has — enough to squeeze the
  // description column below the width of the words in it. pdfmake does not
  // shrink a column past its longest unbreakable word: it widens the TABLE, and
  // the item grid then ran 24pt past the right margin while every block above
  // it stopped square on it. Measured off the rendered page, not guessed at.
  //
  // At 4pt sides the fixed columns and their padding come to 466 of 539, the
  // description column takes the 73 that are left, and the star column ends
  // exactly on the margin with everything else.
  const itemLayout = { ...gridLayout, paddingLeft: () => 4, paddingRight: () => 4 };

  const itemTable: any = {
    table: {
      headerRows: 2,
      dontBreakRows: true,
      widths: [72, "*", 30, 36, 44, 44, 52, 54, 62],
      body: [headerRow1, headerRow2, ...(bodyRows.length ? bodyRows : [[{ text: " ", colSpan: 9, fontSize: FS.body }, {}, {}, {}, {}, {}, {}, {}, {}]]), totalRow],
    },
    layout: itemLayout,
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
  // dontBreakRows, because this whole block is ONE table row and pdfmake will
  // otherwise slice it horizontally when it runs out of page. Measured on a
  // six-line Pacific export PI: the declaration split mid-sentence and
  // "Authorised Signatory & Stamp" was left standing alone at the top of page
  // two, under nothing. A signature block that has been cut in half is worse
  // than one that starts a fresh page whole.
  const footer: any = {
    table: {
      dontBreakRows: true,
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
                  { text: f.declaration, fontSize: 7.5, color: "#333" },
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
    ? [{ text: `This proforma invoice is valid until ${f.validUntil}.`, fontSize: 7.5, color: "#555", margin: [0, 3, 0, 0] }]
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
        table: { widths: ["50%", "50%"], body: [[leftStack, rightStack]] },
        layout: outerGrid,
        margin: [0, 0, 0, 0],
      },
      ...(carriage ? [carriage] : []),
      bankBlock,
      itemTable,
      // THE TOTAL AND THE SIGNATURES TRAVEL TOGETHER. The type scale keeps a
      // FIVE-line proforma on one sheet — measured, not assumed, and less than
      // the ten this file used to claim. Past that the document legitimately
      // runs to a second page, and the only question is where it breaks. A
      // total stranded above a page break, with the amount in words and the
      // signatures overleaf, reads as an unfinished document; kept together
      // they read as a footer. The item table carries headerRows: 2, so its
      // continuation on page two arrives under its own column headings.
      { stack: [totalLine, footer, ...validity], unbreakable: true },
    ],
  };

  return buildPdf(docDef);
}
