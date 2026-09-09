/* eslint-disable @typescript-eslint/no-explicit-any */
// The export commercial invoice — A4 portrait, laid out like the CIOT
// workbook's "Invoice" sheet (PESPL/2780):
//
//   INVOICE                                          (centred)
//   ┌ Exporter (IEC, GSTIN, state & district code) ─┬ Invoice No & Date      ┐
//   │                                               │ Buyer's PO Ref (+ PI)  │
//   ├ Consignee ────────────────────────────────────┼ Terms & Conditions     ┤
//   ├ Notify Party ─────────────────────────────────┤ (delivery, payment)    │
//   ├ Buyer (if not consignee) ─────────────────────┼ Country of Origin /    ┤
//   │                                               │ Final Destination      │
//   ├ Pre-Carriage / Place of Receipt / Vessel ─────┴────────────────────────┤
//   │ Port of Loading / Port of Discharge / Final Destination                │
//   └────────────────────────────────────────────────────────────────────────┘
//   Marks & Nos │ Packages │ Item Code │ Description │ Thick │ No. of Slabs │ Quantity │ Unit │ Rate │ Amount
//   (the item code is the design master's, answer 20 — the design's name
//    where the master has no code yet; never a "no code" marker on paper)
//   totals · amount in words · container / seal / OTL / vehicle
//   LUT remark · bank (with AD code and routing bank) · declaration · signatory
//
// No GST: an export is a supply under LUT, so the snapshot's tax is NONE and
// the grand total keeps its three decimals. Renders ONLY from the snapshot,
// which says which GSTIN it was issued under and which bank it prints
// (answers 21, 23); a row frozen before those existed reads with its defaults.
import { buildPdf } from "@/lib/sales/pdf/common";
import {
  fmtWestern, fmtRateWestern, datedLines, gstinWithLabel, snapshotExtras, printedItemCode,
  type InvoiceSnapshotExtras,
} from "@/lib/commercial/invoice-rules";
import type { InvoiceSnapshot, Party } from "@/lib/commercial/types";

type Snap = InvoiceSnapshot & Partial<InvoiceSnapshotExtras>;

const FS = 7.5;
const GREY = "#f2f2f2";

const t = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function cell(text: unknown, opts: Record<string, any> = {}): any {
  return { text: t(text), fontSize: FS, margin: [2, 1.5, 2, 1.5], ...opts };
}
function head(text: unknown, opts: Record<string, any> = {}): any {
  return cell(text, { bold: true, fillColor: GREY, alignment: "center", ...opts });
}

/** A titled block, the way each cell of the export sheet's header grid reads. */
function block(title: string, lines: Array<string | null | undefined>, opts: { boldFirst?: boolean } = {}): any {
  const body = lines.map((l) => t(l)).filter((l) => l !== "");
  return {
    stack: [
      { text: title, fontSize: FS - 0.5, bold: true, color: "#444" },
      ...body.map((l, i) => ({ text: l, fontSize: FS, bold: Boolean(opts.boldFirst) && i === 0 })),
      ...(body.length === 0 ? [{ text: "—", fontSize: FS }] : []),
    ],
    margin: [3, 3, 3, 3],
  };
}

function partyLines(p: Party | null | undefined): string[] {
  if (!p) return [];
  return [
    p.name,
    ...(p.lines ?? []),
    p.country ?? "",
    p.tel ? `Tel : ${p.tel}` : "",
    p.email ?? "",
    p.gstin ? `GSTIN : ${p.gstin}` : "",
    p.code ? `Customer Code : ${p.code}` : "",
  ].map((l) => t(l)).filter(Boolean);
}

function itemsTable(s: Snap): any {
  const body: any[][] = [[
    head("Marks &\nNos"),
    head("No. &\nKind of Pkgs"),
    head("Item Code", { alignment: "left" }),
    head("Description of Goods", { alignment: "left" }),
    head("Thick"),
    head("No. of\nSlabs"),
    head("Quantity"),
    head("Unit"),
    head("Rate"),
    head(`Amount\n(${t(s.currency)})`),
  ]];
  s.lines.forEach((l, i) => {
    const code = printedItemCode(l);
    // the description, then the design when neither the code nor the
    // description already says it
    const descLines = [l.description, l.design && l.design.toUpperCase() !== l.description.toUpperCase() && l.design.toUpperCase() !== code.toUpperCase() ? l.design : ""].filter(Boolean);
    body.push([
      cell(i === 0 ? (s.marksAndNos ?? "") : "", { alignment: "center" }),
      cell(i === 0 ? (s.packages ?? "") : "", { alignment: "center" }),
      cell(code),
      cell(descLines.join("\n")),
      cell(l.thickness ?? "", { alignment: "center" }),
      cell(l.slabs === null ? "" : String(l.slabs), { alignment: "center" }),
      cell(fmtWestern(l.qty, 3), { alignment: "right" }),
      cell(l.unit, { alignment: "center" }),
      cell(fmtRateWestern(l.rate), { alignment: "right" }),
      cell(fmtWestern(l.amount, 3), { alignment: "right" }),
    ]);
  });
  const totalSlabs = s.lines.reduce((a, l) => a + (l.slabs ?? 0), 0);
  body.push([
    { ...cell("TOTAL", { bold: true, alignment: "right" }), colSpan: 5 }, {}, {}, {}, {},
    cell(String(totalSlabs), { bold: true, alignment: "center" }),
    cell("", {}), cell("", {}), cell("", {}),
    cell(fmtWestern(s.subtotal, 3), { bold: true, alignment: "right" }),
  ]);
  return { table: { headerRows: 1, widths: [36, 46, 60, "*", 30, 30, 48, 30, 40, 56], body }, margin: [0, 6, 0, 0] };
}

export function exportInvoiceDocDef(s: Snap): any {
  const c = s.company;
  const b = s.bank;
  const x = snapshotExtras(s);
  const differentBuyer = s.buyer && s.consignee && s.buyer.name.trim().toLowerCase() !== s.consignee.name.trim().toLowerCase();

  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [22, 22, 22, 26],
    defaultStyle: { font: "Roboto", fontSize: FS },
    content: [
      { text: "INVOICE", fontSize: 15, bold: true, alignment: "center", margin: [0, 0, 0, 6] },

      {
        table: {
          widths: ["52%", "*"],
          body: [
            [
              block("Exporter", [
                c.legalName, ...c.addressLines,
                `IEC No : ${t(c.iec)}`,
                // the chosen registration, labelled with the sister company's
                // name where the CIOT sheets carried PGI's (answer 21)
                `GSTIN : ${gstinWithLabel(x.gstin, x.gstinLabel)}`,
                `State Code : ${t(c.stateCode)}    District Code : ${t(c.districtCode)}`,
                `PAN : ${t(c.pan)}`,
              ], { boldFirst: true }),
              {
                stack: [
                  // the date DIRECTLY UNDER the number (answer 6): PESPL/N{seq}
                  // runs on across years, so the date is what places it
                  { text: "Invoice No. & Date", fontSize: FS - 0.5, bold: true, color: "#444" },
                  ...datedLines(s.number, s.date).map((l, i) => ({ text: l, fontSize: FS, bold: i === 0 })),
                  { text: "Buyer's Order / PO Ref.", fontSize: FS - 0.5, bold: true, color: "#444", margin: [0, 4, 0, 0] },
                  { text: t(s.buyerPoRef), fontSize: FS },
                  ...(s.salesPerson ? [{ text: `Sales Person : ${t(s.salesPerson)}`, fontSize: FS, margin: [0, 3, 0, 0] }] : []),
                  { text: `Commodity : ${t(s.commodity)}`, fontSize: FS },
                  ...(s.exchangeRate ? [{ text: `Exchange Rate : ${t(s.exchangeRate)}`, fontSize: FS }] : []),
                ],
                margin: [3, 3, 3, 3],
              },
            ],
            [
              block("Consignee", partyLines(s.consignee), { boldFirst: true }),
              block("Terms & Conditions", [
                s.deliveryTerms ? `Delivery : ${s.deliveryTerms}` : "",
                s.paymentTerms ? `Payment : ${s.paymentTerms}` : "",
              ]),
            ],
            [
              block("Notify Party", partyLines(s.notifyParty), { boldFirst: true }),
              block("Country of Origin / Final Destination", [
                `Origin : ${t(s.countryOfOrigin)}`,
                `Destination : ${t(s.countryOfDestination)}`,
              ]),
            ],
            ...(differentBuyer ? [[
              block("Buyer (if other than Consignee)", partyLines(s.buyer), { boldFirst: true }),
              block("Vessel / Flight No.", [s.vessel]),
            ]] : []),
            [
              block("Pre-Carriage By / Place of Receipt", [
                `Pre-Carriage : ${t(s.preCarriageBy)}`,
                `Place of Receipt : ${t(s.placeOfReceipt)}`,
                ...(differentBuyer ? [] : [`Vessel / Flight : ${t(s.vessel)}`]),
              ]),
              block("Ports", [
                `Port of Loading : ${t(s.portOfLoading)}`,
                `Port of Discharge : ${t(s.portOfDischarge)}`,
                `Final Destination : ${t(s.finalDestination)}`,
              ]),
            ],
          ],
        },
      },

      itemsTable(s),

      // words + weights
      {
        table: {
          widths: ["*", "34%"],
          body: [[
            { stack: [
              { text: `Amount in words : ${t(s.amountInWords)}`, fontSize: FS, bold: true },
              ...(s.marksAndNos ? [{ text: `Marks & Nos : ${t(s.marksAndNos)}`, fontSize: FS, margin: [0, 2, 0, 0] }] : []),
              ...(s.packages ? [{ text: `Packages : ${t(s.packages)}`, fontSize: FS }] : []),
            ], margin: [3, 3, 3, 3] },
            { stack: [
              { text: `Gross Weight : ${t(s.grossWeight)}`, fontSize: FS },
              { text: `Net Weight : ${t(s.netWeight)}`, fontSize: FS },
              { text: `Total : ${t(s.currency)} ${fmtWestern(s.grandTotal, 3)}`, fontSize: FS, bold: true, margin: [0, 2, 0, 0] },
            ], margin: [3, 3, 3, 3] },
          ]],
        },
        margin: [0, -1, 0, 0],
      },

      // container / seal / OTL / vehicle
      {
        table: {
          widths: ["25%", "25%", "25%", "*"],
          body: [[
            cell(`Container No : ${t(s.containerNo)}`, { margin: [3, 3, 3, 3] }),
            cell(`Seal No : ${t(s.sealNo)}`, { margin: [3, 3, 3, 3] }),
            cell(`Liner / OTL No : ${t(s.linerOtlNo)}`, { margin: [3, 3, 3, 3] }),
            cell(`Vehicle No : ${t(s.vehicleNo)}`, { margin: [3, 3, 3, 3] }),
          ]],
        },
        margin: [0, -1, 0, 0],
      },

      // LUT remark
      ...(s.lutText ? [{
        table: { widths: ["*"], body: [[cell(s.lutText, { bold: true, margin: [3, 3, 3, 3] })]] },
        margin: [0, -1, 0, 0],
      }] : []),

      // bank
      {
        table: {
          widths: ["*"],
          body: [[{
            stack: [
              { text: "Bank Details", fontSize: FS, bold: true, decoration: "underline" },
              { text: `${t(b.name)} — ${t(b.address)}`, fontSize: FS },
              { text: `A/C No : ${t(b.accountNo)}    IFSC : ${t(b.ifsc)}    Swift : ${t(b.swift)}`, fontSize: FS },
              ...(b.adCode ? [{ text: `AD Code : ${t(b.adCode)}`, fontSize: FS }] : []),
              ...(b.routingBank ? [{ text: `Routing Bank : ${t(b.routingBank)}${b.routingSwift ? `  (Swift ${t(b.routingSwift)})` : ""}`, fontSize: FS }] : []),
            ],
            margin: [3, 3, 3, 3],
          }]],
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
              { text: `Customs Office : ${t(c.customsOffice)}`, fontSize: FS - 1, color: "#555", margin: [0, 3, 0, 0] },
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

      { text: "E. & O. E", fontSize: FS, alignment: "right", margin: [2, 4, 2, 0] },
    ],
  };
}

export async function generateExportInvoicePdf(snapshot: Snap): Promise<Buffer> {
  return buildPdf(exportInvoiceDocDef(snapshot));
}
