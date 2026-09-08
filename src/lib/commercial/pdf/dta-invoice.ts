/* eslint-disable @typescript-eslint/no-explicit-any */
// The DTA (domestic, GST) invoice — A4 portrait, laid out like the JB Homes
// reference sheet PESPL/0137/26-27:
//
//   DTA INVOICE                                     (large, centred)
//   ┌ company block ────────────┬ invoice no & date, PI no & date,       ┐
//   │ short name, 4 address     │ sales person, commodity,               │
//   │ lines, TAN, GSTIN         │ commissionerate / division / range /   │
//   │                           │ location code / registration no,       │
//   │                           │ tariff head                            │
//   ├ Consignee ────────────────┼ Bank Details ──────────────────────────┤
//   │ name (bold), address,     │ A/C, BANK, IFSC, BRANCH, Swift         │
//   │ state + STATE CODE, PIN,  │                                        │
//   │ GSTIN (bold)              │                                        │
//   └───────────────────────────┴────────────────────────────────────────┘
//   Material Description │ HSN │ NO OF Slabs │ Thickness │ Quantity │ Rate │ Amount
//     (a group heading row "Artificial Quartz Slabs" above the lines)
//   Delivery / Payment terms │ Total, IGST 18% (always, since answer 22 —
//                            │ the CGST 9 + SGST 9 rows stay for the switch),
//                            │ Round Off, Grand Total
//   Rs. <amount in words>
//   Time of removal of goods :        Vehicle No : ...
//   declaration · For <company> / (Authorised Signatory)
//   Goods once sold will not be taken back or exchanged.        E. & O. E
//
// Renders ONLY from the frozen snapshot — never from the live order. The
// snapshot says which GSTIN it was issued under and which bank it prints
// (answers 21, 23); a row frozen before those existed reads with its defaults.
import { buildPdf } from "@/lib/sales/pdf/common";
import {
  fmtIndian, fmtRateIndian, amountColumnDp, datedRef, datedLines, gstinWithLabel, snapshotExtras,
  DTA_GROUP_HEADING, type InvoiceSnapshotExtras,
} from "@/lib/commercial/invoice-rules";
import type { InvoiceSnapshot, Party } from "@/lib/commercial/types";

type Snap = InvoiceSnapshot & Partial<InvoiceSnapshotExtras>;

const FS = 7.5;                 // the reference sheet is dense; 7.5pt fits its 7 columns
const GREY = "#f2f2f2";

const t = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function cell(text: unknown, opts: Record<string, any> = {}): any {
  return { text: t(text), fontSize: FS, margin: [2, 1.5, 2, 1.5], ...opts };
}
function head(text: unknown, opts: Record<string, any> = {}): any {
  return cell(text, { bold: true, fillColor: GREY, alignment: "center", ...opts });
}
function label(text: unknown, opts: Record<string, any> = {}): any {
  return cell(text, { bold: true, ...opts });
}

/** A framed key/value stack — the way the reference prints its header blocks.
 *  A value may be a ready-made pdfmake node (a stack) instead of text. */
function kv(rows: Array<[string, string | Record<string, any>]>, widths: [string | number, string | number] = ["38%", "*"]): any {
  return {
    table: {
      widths,
      body: rows.map(([k, v]) => [cell(k, { bold: true }), typeof v === "string" ? cell(v) : v]),
    },
    layout: "noBorders",
  };
}

function partyStack(p: Party | null | undefined, opts: { title?: string } = {}): any[] {
  const out: any[] = [];
  if (opts.title) out.push({ text: opts.title, fontSize: FS, bold: true, decoration: "underline", margin: [0, 0, 0, 2] });
  if (!p) { out.push({ text: "—", fontSize: FS }); return out; }
  out.push({ text: t(p.name), fontSize: FS + 0.5, bold: true });
  for (const l of p.lines ?? []) out.push({ text: t(l), fontSize: FS });
  const stateBits = [p.stateCode ? `STATE CODE : ${p.stateCode}` : "", p.country && p.country !== "India" ? t(p.country) : ""].filter(Boolean).join("   ");
  if (stateBits) out.push({ text: stateBits, fontSize: FS });
  if (p.gstin) out.push({ text: `GSTIN NO : ${p.gstin}`, fontSize: FS, bold: true, margin: [0, 1, 0, 0] });
  if (p.tel) out.push({ text: `Tel : ${p.tel}`, fontSize: FS });
  if (p.email) out.push({ text: t(p.email), fontSize: FS });
  return out;
}

/** The seven-column item table, with the sheet's group heading above the lines.
 *  `dp` is the amount column's precision — the one at which the lines add up to
 *  the Total printed beneath them (see amountColumnDp). */
function itemsTable(s: InvoiceSnapshot, dp: 2 | 3): any {
  const body: any[][] = [
    [
      head("Material Description", { alignment: "left" }),
      head("HSN CODE"),
      head("NO OF\nSlabs"),
      head("Thickness"),
      head(`Quantity\n${s.lines[0]?.unit ?? "SQFT"}`),
      head("Rate\n(Rs.)"),
      head("Amount\n(Rs.)"),
    ],
    [
      { ...cell(DTA_GROUP_HEADING, { bold: true, decoration: "underline" }), colSpan: 7 },
      {}, {}, {}, {}, {}, {},
    ],
  ];
  for (const l of s.lines) {
    body.push([
      cell(l.description),
      cell(l.hsn, { alignment: "center" }),
      cell(l.slabs === null ? "" : String(l.slabs), { alignment: "center" }),
      cell(l.thickness ?? "", { alignment: "center" }),
      cell(`${fmtIndian(l.qty, 3)} ${l.unit}`.trim(), { alignment: "right" }),
      cell(fmtRateIndian(l.rate), { alignment: "right" }),
      cell(fmtIndian(l.amount, dp), { alignment: "right" }),
    ]);
  }
  // keep the table a decent height on a one-line invoice, as the sheet does
  const filler = Math.max(0, 4 - s.lines.length);
  for (let i = 0; i < filler; i++) body.push([cell(" "), cell(""), cell(""), cell(""), cell(""), cell(""), cell("")]);
  return {
    table: { headerRows: 1, widths: ["*", 52, 34, 42, 66, 52, 66], body },
    margin: [0, 6, 0, 0],
  };
}

/** Total / tax / round-off / grand total, right-hand column of the totals band.
 *  Printed at the same precision as the amount column above it, so Total is
 *  literally the sum of the amounts a reader can add up by hand. */
function totalsRows(s: InvoiceSnapshot, dp: 2 | 3): Array<[string, string]> {
  const rows: Array<[string, string]> = [["Total", fmtIndian(s.subtotal, dp)]];
  if (s.taxType === "IGST") rows.push([`IGST @ ${fmtIndian(s.taxRate, 0)}%`, fmtIndian(s.igst, dp)]);
  if (s.taxType === "CGST_SGST") {
    rows.push([`CGST @ ${fmtIndian(s.taxRate / 2, 0)}%`, fmtIndian(s.cgst, dp)]);
    rows.push([`SGST @ ${fmtIndian(s.taxRate / 2, 0)}%`, fmtIndian(s.sgst, dp)]);
  }
  rows.push(["Round Off", fmtIndian(s.roundOff, dp)]);
  rows.push(["Grand Total", fmtIndian(s.grandTotal, dp)]);
  return rows;
}

export function dtaInvoiceDocDef(s: Snap): any {
  const c = s.company;
  const b = s.bank;
  const x = snapshotExtras(s);
  const hsn = s.lines.find((l) => l.hsn)?.hsn ?? c.hsnQuartz;
  const dp = amountColumnDp(s.lines, s.subtotal);

  const companyBlock: any[] = [
    { text: c.shortName, fontSize: FS + 2.5, bold: true },
    ...c.addressLines.map((l) => ({ text: l, fontSize: FS })),
    { text: " ", fontSize: 3 },
    { text: `TAN NO : ${t(c.tan)}`, fontSize: FS, bold: true },
    // the chosen registration, with the sister company's name beside it when
    // it is not the company's own (answer 21)
    { text: `GSTIN NO : ${gstinWithLabel(x.gstin, x.gstinLabel)}`, fontSize: FS, bold: true },
    { text: `PAN : ${t(c.pan)}`, fontSize: FS },
  ];

  // the date DIRECTLY UNDER the number (answer 6)
  const numberStack = { stack: datedLines(s.number, s.date).map((l, i) => ({ text: l, fontSize: FS, bold: i === 0 })), margin: [2, 1.5, 2, 1.5] };
  const rightBlock = kv([
    ["DTA Invoice No. :", numberStack],
    ["PI No. & Date :", datedRef(s.piNumber, s.piDate)],
    ["Sales Person :", t(s.salesPerson)],
    ["Commodity :", t(s.commodity)],
    ["Commissionerate :", t(c.commissionerate)],
    ["Division :", t(c.division)],
    ["Range :", t(c.range)],
    ["Location Code :", t(c.locationCode)],
    ["Registration No. :", t(c.iec)],
    ["Tariff Head :", t(hsn)],
  ], ["34%", "*"]);

  const bankBlock: any[] = [
    { text: "Bank Details", fontSize: FS, bold: true, decoration: "underline", margin: [0, 0, 0, 2] },
    { text: `A/C NO : ${t(b.accountNo)}`, fontSize: FS },
    { text: `BANK : ${t(b.name)}`, fontSize: FS },
    { text: `IFSC CODE : ${t(b.ifsc)}`, fontSize: FS },
    { text: `BRANCH : ${t(b.address)}`, fontSize: FS },
    ...(b.swift ? [{ text: `Swift Code : ${t(b.swift)}`, fontSize: FS }] : []),
  ];

  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [22, 22, 22, 26],
    defaultStyle: { font: "Roboto", fontSize: FS },
    content: [
      { text: "DTA INVOICE", fontSize: 16, bold: true, alignment: "center", margin: [0, 0, 0, 6] },

      // company | invoice particulars
      {
        table: { widths: ["44%", "*"], body: [[{ stack: companyBlock, margin: [3, 3, 3, 3] }, { stack: [rightBlock], margin: [3, 3, 3, 3] }]] },
      },

      // consignee | bank
      {
        table: {
          widths: ["44%", "*"],
          body: [[
            { stack: partyStack(s.consignee ?? s.buyer, { title: "Consignee" }), margin: [3, 3, 3, 3] },
            { stack: bankBlock, margin: [3, 3, 3, 3] },
          ]],
        },
        margin: [0, -1, 0, 0],
      },

      // billed to, when the invoice is billed somewhere other than the consignee
      ...(s.buyer && s.consignee && s.buyer.name.trim().toLowerCase() !== s.consignee.name.trim().toLowerCase()
        ? [{
            table: { widths: ["*"], body: [[{ stack: partyStack(s.buyer, { title: "Buyer (Bill To)" }), margin: [3, 3, 3, 3] }]] },
            margin: [0, -1, 0, 0],
          }]
        : []),

      itemsTable(s, dp),

      // terms on the left, the money on the right
      {
        table: {
          widths: ["*", "38%"],
          body: [[
            {
              stack: [
                { text: `Delivery Terms : ${t(s.deliveryTerms)}`, fontSize: FS, bold: true },
                { text: `Payment Terms : ${t(s.paymentTerms)}`, fontSize: FS, bold: true, margin: [0, 2, 0, 0] },
                ...(s.buyerPoRef ? [{ text: `Buyer's PO Ref : ${t(s.buyerPoRef)}`, fontSize: FS, margin: [0, 2, 0, 0] }] : []),
              ],
              margin: [3, 3, 3, 3],
            },
            {
              table: {
                widths: ["*", 70],
                body: totalsRows(s, dp).map(([k, v], i, arr) => [
                  cell(k, { bold: i === arr.length - 1, alignment: "right" }),
                  cell(v, { bold: i === arr.length - 1, alignment: "right" }),
                ]),
              },
              layout: "noBorders",
              margin: [0, 0, 0, 0],
            },
          ]],
        },
        margin: [0, -1, 0, 0],
      },

      // amount in words
      {
        table: { widths: ["*"], body: [[label(`Rs. ${t(s.amountInWords)}`, { margin: [3, 3, 3, 3] })]] },
        margin: [0, -1, 0, 0],
      },

      // removal / vehicle
      {
        table: {
          widths: ["50%", "*"],
          body: [[
            cell("Time of removal of goods :", { margin: [3, 3, 3, 3] }),
            cell(`Vehicle No : ${t(s.vehicleNo)}${s.transporter ? `    Transporter : ${t(s.transporter)}` : ""}`, { margin: [3, 3, 3, 3] }),
          ]],
        },
        margin: [0, -1, 0, 0],
      },

      // declaration + signatory
      {
        table: {
          widths: ["*", "34%"],
          body: [[
            { stack: [
              { text: "Declaration :", fontSize: FS, bold: true },
              { text: t(s.declaration), fontSize: FS - 0.5, margin: [0, 1, 0, 0] },
              ...(s.notes ? [{ text: t(s.notes), fontSize: FS - 0.5, margin: [0, 3, 0, 0] }] : []),
            ], margin: [3, 3, 3, 3] },
            { stack: [
              { text: `For ${t(c.shortName)}`, fontSize: FS, bold: true, alignment: "center" },
              { text: " ", fontSize: 20 },
              { text: "(Authorised Signatory)", fontSize: FS, alignment: "center" },
            ], margin: [3, 3, 3, 3] },
          ]],
        },
        margin: [0, -1, 0, 0],
      },

      {
        columns: [
          { text: "Goods once sold will not be taken back or exchanged.", fontSize: FS, italics: true },
          { text: "E. & O. E", fontSize: FS, alignment: "right" },
        ],
        margin: [2, 4, 2, 0],
      },
    ],
  };
}

export async function generateDtaInvoicePdf(snapshot: Snap): Promise<Buffer> {
  return buildPdf(dtaInvoiceDocDef(snapshot));
}
