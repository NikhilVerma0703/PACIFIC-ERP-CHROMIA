/* eslint-disable @typescript-eslint/no-explicit-any */
// The Packing List sheet — pdfmake, A4 portrait, laid out like the CIOT
// workbook's "Packing List" tab: the exporter/consignee grid at the top, one
// line per (description, thickness) across the crates, a Free Trade Samples
// line when there are sample boxes, then the stuffing details, the LUT remark
// on an export, the summary and the declaration.
//
// Every DECISION here (which lines, which totals, which unit, how the packages
// are worded) comes from ../packing-rules, which is pure and tested; this file
// only places the results on the page.
import { buildPdf } from "@/lib/sales/pdf/common";
import type { CommercialSettings } from "@/lib/commercial/settings-defaults";
import {
  crateGroups, printableSamplesRow, plTotals, marksAndNos, partyLines, fallbackParty,
  docDate, quantityUnit, kgToMt, pad2, packagesSummary,
  type SlabLike, type CrateLike, type PartyLike,
} from "@/lib/commercial/packing-rules";
import { parseMeasurementUnit, type MeasurementUnit } from "@/lib/commercial/measure";

export interface PackingListPdfInput {
  list: {
    number: string;
    createdAt?: string | Date | null;
    status?: string;
    containerNo?: string | null;
    sealNo?: string | null;
    linerOtlNo?: string | null;
    vehicleNo?: string | null;
    grossWeightKg?: number | null;
    netWeightKg?: number | null;
    packagesSummary?: string | null;
    /** cm or in (answer 17). This sheet has no size column of its own — the
     *  sizes are on the Measurement List issued with it — so the unit prints
     *  as a remark when it is not the centimetre default, and the two sheets
     *  in the envelope cannot be read in different units. */
    measurementUnit?: MeasurementUnit | string | null;
    notes?: string | null;
    crates: CrateLike[];
    slabs: SlabLike[];
  };
  order: {
    number: string;
    kind: "DOMESTIC" | "EXPORT" | string;
    customerPoNumber?: string | null;
    customerPoDate?: string | Date | null;
    consignee?: PartyLike | null;
    notifyParty?: PartyLike | null;
    buyerIfNotConsignee?: PartyLike | null;
    countryOfOrigin?: string | null;
    countryOfDestination?: string | null;
    deliveryTerms?: string | null;
    paymentTerms?: string | null;
    preCarriageBy?: string | null;
    placeOfReceipt?: string | null;
    portOfLoading?: string | null;
    portOfDischarge?: string | null;
    finalDestination?: string | null;
    items?: Array<{ isSample?: boolean | null; qtySlabs?: number | null; qty?: number | null; description?: string | null }>;
  };
  client?: { name: string; address?: string | null; city?: string | null; country?: string | null } | null;
  ext?: { shippingAddress?: PartyLike | null; billingAddress?: PartyLike | null; notifyParty?: PartyLike | null; gstin?: string | null; customerCode?: string | null } | null;
  settings: CommercialSettings;
  invoice?: { number: string; invoiceDate?: string | Date | null } | null;
  /** From the linked invoice's snapshot, which is the only place the module
   *  records it (InvoiceSnapshot.vessel). */
  vessel?: string | null;
  /** The bill of lading and shipping bill numbers. NOTHING IN THE MODULE HOLDS
   *  THEM: a packing list has no column for either, and both are issued by the
   *  line and by customs after the container has gone. The boxes print, labelled
   *  and empty, to be written in by hand — which is what the reference sheets
   *  do — and these inputs are here so that a column, once there is one, feeds
   *  straight in. See the foundation request in the build notes. */
  blNo?: string | null;
  sbNo?: string | null;
}

const GREY = "#f2f2f2";
const B = "#000000";

function fmt(n: number | null | undefined, dp: number): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** A labelled box: the small grey caption over the value, as the sheets print. */
function field(label: string, value: string | string[], opts: Record<string, any> = {}): any {
  const lines = Array.isArray(value) ? value : [value];
  return {
    stack: [
      { text: label, fontSize: 6, color: "#555", bold: true },
      ...(lines.length && lines.some((l) => (l ?? "").trim()) ? lines.map((l) => ({ text: l, fontSize: 7.5 })) : [{ text: " ", fontSize: 7.5 }]),
    ],
    margin: [3, 2, 3, 2],
    ...opts,
  };
}

const th = (text: string, alignment: "left" | "center" | "right" = "center"): any =>
  ({ text, fontSize: 6.5, bold: true, alignment, fillColor: GREY, margin: [2, 3, 2, 3] });

const td = (text: string, alignment: "left" | "center" | "right" = "left", bold = false): any =>
  ({ text, fontSize: 7, bold, alignment, margin: [2, 2, 2, 2] });

export async function generatePackingListPdf(input: PackingListPdfInput): Promise<Buffer> {
  const { list, order, settings } = input;
  const company = settings.company;
  const isExport = String(order.kind).toUpperCase() === "EXPORT";

  const consignee = (order.consignee && (order.consignee.name || (order.consignee.lines ?? []).length))
    ? order.consignee
    : fallbackParty(input.client ?? null, input.ext ?? null);
  const notify = order.notifyParty ?? input.ext?.notifyParty ?? null;

  const groups = crateGroups(list.slabs, list.crates);
  // Free trade samples are an EXPORT line, and only when the order actually
  // sells samples: a domestic list with a sample box was printing the row with
  // no pieces and no quantity against it (printableSamplesRow).
  const sampleItems = (order.items ?? []).filter((i) => i.isSample);
  const samples = printableSamplesRow(order.kind, list.crates, sampleItems);
  const totals = plTotals(groups, samples, list.crates);
  const q = quantityUnit(order.kind);
  const marks = marksAndNos(list.crates);
  const packages = (list.packagesSummary ?? "").trim() || packagesSummary(list.crates) || `${pad2(list.crates.length)} Package(s)`;

  const invoiceNo = input.invoice?.number ?? list.number;
  const invoiceDate = docDate(input.invoice?.invoiceDate ?? list.createdAt ?? null);

  // ── the item table ────────────────────────────────────────────────────────
  const itemRows: any[][] = [[
    th("Marks & Nos"), th("No. of W/Crt\nBdl / Box"), th("Description of Goods", "left"), th("Thick"),
    th("Net Weight\n(Kgs)"), th("No. of\nSlabs / Pcs"), th(`Quantity\n(${q.unit})`), th("Unit"),
  ]];
  groups.forEach((grp, i) => {
    // OURS ALWAYS, THEIRS BESIDE IT (OPEN-QUESTIONS §16). The customer's batch
    // used to replace ours, which left the sheet with no way back to the batch
    // the slabs were actually made in.
    const batches = [
      grp.batches.length ? `\nBatch: ${grp.batches.join(", ")}` : "",
      grp.customerBatches.length ? `\nCust. batch: ${grp.customerBatches.join(", ")}` : "",
    ].join("");
    itemRows.push([
      td(i === 0 ? marks : "", "center"),
      td(grp.crateNos.length ? pad2(grp.crateNos.length) : "", "center"),
      td(`${grp.description}${batches}`),
      td(grp.thickness, "center"),
      td(grp.netKg != null ? fmt(grp.netKg, 0) : "", "right"),
      td(String(grp.slabs), "center"),
      td(fmt(q.field === "sqm" ? grp.sqm : grp.sqft, q.dp), "right"),
      td(q.unit, "center"),
    ]);
  });
  if (samples) {
    itemRows.push([
      td("", "center"),
      td(pad2(samples.boxes), "center"),
      td(`${samples.description}${samples.remarks ? `\n${samples.remarks}` : ""}`),
      td("", "center"),
      td(samples.netKg != null ? fmt(samples.netKg, 0) : "", "right"),
      td(samples.pcs != null ? String(samples.pcs) : "", "center"),
      td("", "right"),
      td(samples.pcs != null ? "NOS" : "", "center"),
    ]);
  }
  itemRows.push([
    { text: "TOTAL", fontSize: 7.5, bold: true, alignment: "right", colSpan: 4, margin: [2, 3, 2, 3] }, {}, {}, {},
    td(totals.netKg != null ? fmt(totals.netKg, 0) : "", "right", true),
    td(String(totals.slabs), "center", true),
    td(fmt(q.field === "sqm" ? totals.sqm : totals.sqft, q.dp), "right", true),
    td(q.unit, "center", true),
  ]);

  const exporterLines = [company.legalName, ...company.addressLines, `IEC: ${company.iec}   GSTIN: ${company.gstin}`, `State Code: ${company.stateCode}   District Code: ${company.districtCode}`];

  // The LUT declaration prints on an export sheet only — a domestic packing
  // list has no export under bond to declare.
  const unit = parseMeasurementUnit(list.measurementUnit) ?? "cm";
  const remarks = [
    isExport ? company.lutText : "",
    (list.notes ?? "").trim(),
    unit === "in" ? "Slab sizes on the Measurement List are in inches." : "",
  ].filter(Boolean);
  if (!remarks.length) remarks.push("—");

  const docDef: any = {
    pageSize: "A4",
    pageMargins: [20, 20, 20, 28],
    defaultStyle: { font: "Roboto", fontSize: 7.5 },
    footer: (page: number, count: number) => ({
      columns: [
        { text: `${list.number}${input.invoice ? ` · Invoice ${input.invoice.number}` : ""}`, fontSize: 6, color: "#777", margin: [20, 0, 0, 0] },
        { text: `Page ${page} of ${count}`, fontSize: 6, color: "#777", alignment: "right", margin: [0, 0, 20, 0] },
      ],
    }),
    content: [
      { text: "Packing List (Under Rule 46 CGST 2017)", fontSize: 12, bold: true, alignment: "center", margin: [0, 0, 0, 6] },

      // exporter / invoice refs
      {
        table: {
          widths: ["55%", "45%"],
          body: [
            [
              field("Exporter", exporterLines),
              {
                stack: [
                  { columns: [field("Invoice No.", invoiceNo, { width: "60%" }), field("Date", invoiceDate, { width: "40%" })] },
                  field("Buyer's PO / Order Ref.", [order.customerPoNumber ? `${order.customerPoNumber}${order.customerPoDate ? ` dt ${docDate(order.customerPoDate)}` : ""}` : "—", `PI / Order: ${order.number}`]),
                ],
                margin: [0, 0, 0, 0],
              },
            ],
            [
              field("Consignee", partyLines(consignee)),
              field("Notify Party", notify ? partyLines(notify) : ["Same as consignee"]),
            ],
            [
              field("Buyer (if other than Consignee)", order.buyerIfNotConsignee ? partyLines(order.buyerIfNotConsignee) : ["Same as consignee"]),
              {
                columns: [
                  field("Country of Origin of Goods", order.countryOfOrigin ?? settings.defaults.countryOfOrigin, { width: "50%" }),
                  field("Country of Final Destination", order.countryOfDestination ?? "", { width: "50%" }),
                ],
              },
            ],
            [
              {
                columns: [
                  field("Terms of Delivery", order.deliveryTerms ?? "", { width: "50%" }),
                  field("Terms of Payment", order.paymentTerms ?? "", { width: "50%" }),
                ],
              },
              {
                columns: [
                  field("Pre-Carriage by", order.preCarriageBy ?? settings.defaults.preCarriageBy, { width: "50%" }),
                  field("Place of Receipt", order.placeOfReceipt ?? "", { width: "50%" }),
                ],
              },
            ],
            [
              {
                columns: [
                  field("Vessel / Flight No.", input.vessel ?? "", { width: "50%" }),
                  field("Port of Loading", order.portOfLoading ?? settings.defaults.portOfLoading, { width: "50%" }),
                ],
              },
              {
                columns: [
                  field("Port of Discharge", order.portOfDischarge ?? "", { width: "50%" }),
                  field("Final Destination", order.finalDestination ?? "", { width: "50%" }),
                ],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.6, vLineWidth: () => 0.6,
          hLineColor: () => B, vLineColor: () => B,
        },
      },

      { text: " ", fontSize: 3 },

      // the goods
      {
        table: { headerRows: 1, widths: [46, 40, "*", 30, 40, 36, 52, 30], body: itemRows },
        layout: {
          hLineWidth: () => 0.6, vLineWidth: () => 0.6,
          hLineColor: () => B, vLineColor: () => B,
        },
      },

      { text: " ", fontSize: 3 },

      // stuffing
      {
        table: {
          widths: ["*", "*", "*"],
          body: [
            [field("Container No.", list.containerNo ?? ""), field("Liner's OTL No.", list.linerOtlNo ?? ""), field("E-Seal No.", list.sealNo ?? "")],
            [field("Vehicle No.", list.vehicleNo ?? ""), field("B/L No.", input.blNo ?? ""), field("S/B No.", input.sbNo ?? "")],
          ],
        },
        layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => B, vLineColor: () => B },
      },

      { text: " ", fontSize: 3 },

      // summary + remarks
      {
        table: {
          widths: ["55%", "45%"],
          body: [
            [
              field("Remarks", remarks),
              {
                stack: [
                  { columns: [{ text: "Total Packages", fontSize: 7 }, { text: packages, fontSize: 7, bold: true, alignment: "right" }] },
                  { columns: [{ text: "Total Slabs / Pcs", fontSize: 7 }, { text: String(totals.slabs), fontSize: 7, bold: true, alignment: "right" }] },
                  { columns: [{ text: `Total Area (${q.unit})`, fontSize: 7 }, { text: fmt(q.field === "sqm" ? totals.sqm : totals.sqft, q.dp), fontSize: 7, bold: true, alignment: "right" }] },
                  { columns: [{ text: "Gross Weight", fontSize: 7 }, { text: list.grossWeightKg != null ? `${fmt(list.grossWeightKg, 0)} Kgs (${kgToMt(list.grossWeightKg)})` : "—", fontSize: 7, bold: true, alignment: "right" }] },
                  { columns: [{ text: "Net Weight", fontSize: 7 }, { text: list.netWeightKg != null ? `${fmt(list.netWeightKg, 0)} Kgs (${kgToMt(list.netWeightKg)})` : (totals.netKg != null ? `${fmt(totals.netKg, 0)} Kgs` : "—"), fontSize: 7, bold: true, alignment: "right" }] },
                ],
                margin: [4, 3, 4, 3],
              },
            ],
          ],
        },
        layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => B, vLineColor: () => B },
      },

      { text: settings.texts.piDeclaration, fontSize: 6.5, italics: true, margin: [0, 6, 0, 0] },
      {
        columns: [
          { text: `Packing list ${list.number}`, fontSize: 6.5, color: "#555" },
          {
            stack: [
              { text: `For ${company.legalName}`, fontSize: 7.5, bold: true, alignment: "right" },
              { text: " ", fontSize: 16 },
              { text: "Authorised Signatory", fontSize: 7.5, alignment: "right" },
            ],
          },
        ],
        margin: [0, 8, 0, 0],
      },
    ],
  };

  return buildPdf(docDef);
}
