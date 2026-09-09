/* eslint-disable @typescript-eslint/no-explicit-any */
// The delivery challan — FOUR A4 pages, one per copy, each carrying its own
// label top-right (open question 25: the reference sheet's four labels sit
// outside its print area and never printed; the owner's default is that each
// copy carries its label).
//
// Laid out like the PGI reference PESPL/DC/20/26:
//
//                                              Original - Buyer Copy
//                    DELIVERY CHALLAN
//   ┌ company block, TAN, GSTIN ────┬ DC No. & Dated, PO No. & Date,     ┐
//   │                               │ Commodity, Commissionerate /       │
//   │                               │ Division / Range / Location Code / │
//   │                               │ Registration No., Tariff Head      │
//   ├ Consignee (name bold, GSTIN) ─┼ Bank Details (Kotak) ──────────────┤
//   └───────────────────────────────┴────────────────────────────────────┘
//   Material Description │ NO OF Slabs │ Thickness/Unit │ Quantity SQFT │
//                                        Rate / SQFT (Rs.) │ Amount Approx (Rs.)
//   the two notes · TOTAL (sqft) · Grand Total · Rs. <words>
//   Time of removal of goods :        Lorry No : ...
//   declaration · signatory · footer
//
// A challan is a MOVEMENT, not a sale: the amounts are declared approximate
// values, which is what the second note says on the page.
import { buildPdf } from "@/lib/sales/pdf/common";
import { CHALLAN_COPIES, challanTotals, challanWords, challanTariffHead, challanNumberLines } from "@/lib/commercial/challan-rules";
import { fmtIndian } from "@/lib/commercial/invoice-rules";
import type { CommercialSettings } from "@/lib/commercial/settings-defaults";
import type { ChallanItem } from "@/lib/commercial/types";

const FS = 8;
const GREY = "#f2f2f2";

const t = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function cell(text: unknown, opts: Record<string, any> = {}): any {
  return { text: t(text), fontSize: FS, margin: [2, 2, 2, 2], ...opts };
}
function head(text: unknown, opts: Record<string, any> = {}): any {
  return cell(text, { bold: true, fillColor: GREY, alignment: "center", ...opts });
}

/** What generateChallanPdf needs of a commercial_delivery_challan row. */
export interface ChallanForPdf {
  number: string;
  challanDate: string | Date;
  consigneeName: string;
  consigneeAddress?: string | null;
  consigneeGstin?: string | null;
  poRef?: string | null;
  commodity?: string | null;
  purpose?: string | null;
  items: ChallanItem[];
  totalAmount?: number | null;
  amountInWords?: string | null;
  lorryNo?: string | null;
  notes?: string | null;
  status?: string | null;
}

function isoOf(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function addressLines(addr: string | null | undefined): string[] {
  const raw = t(addr).trim();
  if (!raw) return [];
  const byLine = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return byLine.length > 1 ? byLine : raw.split(",").map((l) => l.trim()).filter(Boolean);
}

function itemsTable(items: ChallanItem[], totals: ReturnType<typeof challanTotals>): any {
  const body: any[][] = [[
    head("Material Description", { alignment: "left" }),
    head("NO OF\nSlabs"),
    head("Thickness /\nUnit"),
    head("Quantity\nSQFT"),
    head("Rate / SQFT\n(Rs.)"),
    head("Amount Approx\n(Rs.)"),
  ]];
  for (const i of totals.items) {
    body.push([
      cell(i.description),
      cell(i.qty ? String(i.qty) : "", { alignment: "center" }),
      cell(i.unit, { alignment: "center" }),
      cell(i.sqft === null || i.sqft === undefined ? "" : fmtIndian(i.sqft, 2), { alignment: "right" }),
      cell(fmtIndian(i.rate, 2), { alignment: "right" }),
      cell(fmtIndian(i.amount, 2), { alignment: "right" }),
    ]);
  }
  const filler = Math.max(0, 4 - items.length);
  for (let i = 0; i < filler; i++) body.push([cell(" "), cell(""), cell(""), cell(""), cell(""), cell("")]);
  body.push([
    { ...cell("TOTAL", { bold: true, alignment: "right" }), colSpan: 2 }, {},
    cell("", {}),
    cell(totals.totalSqft ? fmtIndian(totals.totalSqft, 2) : "", { bold: true, alignment: "right" }),
    cell("", {}),
    cell(fmtIndian(totals.totalAmount, 2), { bold: true, alignment: "right" }),
  ]);
  body.push([
    { ...cell("Grand Total", { bold: true, alignment: "right" }), colSpan: 5 }, {}, {}, {}, {},
    cell(fmtIndian(totals.totalAmount, 2), { bold: true, alignment: "right" }),
  ]);
  return { table: { headerRows: 1, widths: ["*", 40, 56, 62, 62, 74], body }, margin: [0, 6, 0, 0] };
}

/** One copy's page. `first` decides whether a page break precedes it. */
function copyPage(ch: ChallanForPdf, settings: CommercialSettings, copyLabel: string, first: boolean): any[] {
  const c = settings.company;
  const b = settings.banks.export;              // Kotak, per the reference challan
  const totals = challanTotals(ch.items ?? []);
  const words = ch.amountInWords || challanWords(totals.totalAmount);
  const tariff = challanTariffHead(ch.items ?? [], c.hsnQuartz);
  // the date DIRECTLY UNDER the number (answer 6) — the same pair the invoice
  // header prints, so a reader finds it in one place on every document
  const numberStack: any = { stack: challanNumberLines(ch.number, isoOf(ch.challanDate)).map((l, i) => ({ text: l, fontSize: FS, bold: i === 0 })), margin: [2, 2, 2, 2] };
  const rightRows: Array<[string, string | Record<string, any>]> = [
    ["DC No. :", numberStack],
    ["PO No. & Date :", t(ch.poRef) || "Verbal"],
    ["Commodity :", t(ch.commodity) || "Artificial Quartz Slabs"],
    ["Commissionerate :", t(c.commissionerate)],
    ["Division :", t(c.division)],
    ["Range :", t(c.range)],
    ["Location Code :", t(c.locationCode)],
    ["Registration No. :", t(c.iec)],
    ["Tariff Head :", t(tariff)],
  ];

  const consigneeStack: any[] = [
    { text: "Consignee", fontSize: FS, bold: true, decoration: "underline", margin: [0, 0, 0, 2] },
    { text: t(ch.consigneeName), fontSize: FS + 0.5, bold: true },
    ...addressLines(ch.consigneeAddress).map((l) => ({ text: l, fontSize: FS })),
    ...(ch.consigneeGstin ? [{ text: `GSTIN NO : ${t(ch.consigneeGstin)}`, fontSize: FS, bold: true, margin: [0, 1, 0, 0] }] : []),
  ];

  const bankStack: any[] = [
    { text: "Bank Details", fontSize: FS, bold: true, decoration: "underline", margin: [0, 0, 0, 2] },
    { text: `A/C NO : ${t(b.accountNo)}`, fontSize: FS },
    { text: `BANK : ${t(b.name)}`, fontSize: FS },
    { text: `IFSC CODE : ${t(b.ifsc)}`, fontSize: FS },
    { text: `BRANCH : ${t(b.branch)}`, fontSize: FS },
    ...(b.swift ? [{ text: `Swift Code : ${t(b.swift)}`, fontSize: FS }] : []),
  ];

  return [
    {
      text: copyLabel,
      fontSize: FS + 0.5,
      bold: true,
      alignment: "right",
      margin: [0, 0, 0, 2],
      ...(first ? {} : { pageBreak: "before" }),
    },
    { text: "DELIVERY CHALLAN", fontSize: 16, bold: true, alignment: "center", margin: [0, 0, 0, 6] },
    ...(ch.status === "CANCELLED" ? [{ text: "CANCELLED", fontSize: 12, bold: true, color: "#b91c1c", alignment: "center", margin: [0, 0, 0, 4] }] : []),
    ...(ch.status === "DRAFT" ? [{ text: "DRAFT — not issued", fontSize: 10, bold: true, color: "#b45309", alignment: "center", margin: [0, 0, 0, 4] }] : []),

    {
      table: {
        widths: ["44%", "*"],
        body: [[
          { stack: [
            { text: c.shortName, fontSize: FS + 3, bold: true },
            ...c.addressLines.map((l) => ({ text: l, fontSize: FS })),
            { text: " ", fontSize: 3 },
            { text: `TAN NO : ${t(c.tan)}`, fontSize: FS, bold: true },
            { text: `GSTIN NO : ${t(c.gstin)}`, fontSize: FS, bold: true },
          ], margin: [3, 3, 3, 3] },
          { stack: [{
            table: { widths: ["36%", "*"], body: rightRows.map(([k, v]) => [cell(k, { bold: true }), typeof v === "string" ? cell(v) : v]) },
            layout: "noBorders",
          }], margin: [3, 3, 3, 3] },
        ]],
      },
    },

    {
      table: { widths: ["44%", "*"], body: [[{ stack: consigneeStack, margin: [3, 3, 3, 3] }, { stack: bankStack, margin: [3, 3, 3, 3] }]] },
      margin: [0, -1, 0, 0],
    },

    itemsTable(ch.items ?? [], totals),

    {
      table: {
        widths: ["*"],
        body: [[{
          stack: [
            { text: t(ch.purpose) || t(settings.texts.challanNote), fontSize: FS, bold: true },
            { text: t(settings.texts.challanApprox), fontSize: FS },
          ],
          margin: [3, 3, 3, 3],
        }]],
      },
      margin: [0, -1, 0, 0],
    },

    {
      table: { widths: ["*"], body: [[cell(`Rs. ${t(words)}`, { bold: true, margin: [3, 3, 3, 3] })]] },
      margin: [0, -1, 0, 0],
    },

    {
      table: {
        widths: ["50%", "*"],
        body: [[
          cell("Time of removal of goods :", { margin: [3, 3, 3, 3] }),
          cell(`Lorry No : ${t(ch.lorryNo)}`, { margin: [3, 3, 3, 3] }),
        ]],
      },
      margin: [0, -1, 0, 0],
    },

    {
      table: {
        widths: ["*", "34%"],
        body: [[
          { stack: [
            { text: "Declaration :", fontSize: FS, bold: true },
            { text: t(settings.texts.dtaDeclaration), fontSize: FS - 0.5, margin: [0, 1, 0, 0] },
            ...(ch.notes ? [{ text: t(ch.notes), fontSize: FS - 0.5, margin: [0, 3, 0, 0] }] : []),
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
        { text: t(settings.texts.noReturn), fontSize: FS, italics: true },
        { text: t(settings.texts.eoe), fontSize: FS, alignment: "right" },
      ],
      margin: [2, 4, 2, 0],
    },
  ];
}

export function challanDocDef(ch: ChallanForPdf, settings: CommercialSettings): any {
  const content: any[] = [];
  CHALLAN_COPIES.forEach((label, i) => { content.push(...copyPage(ch, settings, label, i === 0)); });
  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [22, 22, 22, 26],
    defaultStyle: { font: "Roboto", fontSize: FS },
    content,
  };
}

export async function generateChallanPdf(ch: ChallanForPdf, settings: CommercialSettings): Promise<Buffer> {
  return buildPdf(challanDocDef(ch, settings));
}
