/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { buildPdf, docStyles, COMPANY_DEFAULTS } from "./common";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TDocumentDefinitions = any;

export async function generateStuffingListPdf(orderId: string): Promise<Buffer> {
  const db = prisma as any;
  const [order, config] = await Promise.all([
    db.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        client: true,
        proformaInvoices: { where: { status: "ACCEPTED" }, take: 1, orderBy: { acceptedAt: "desc" } },
        shipmentDocs: true,
      },
    }),
    db.salesConfig.findUnique({ where: { id: "global" } }).catch(() => null),
  ]);
  if (!order) throw new Error("Order not found");

  const pi   = order.proformaInvoices?.[0];
  const ship = order.shipmentDocs;
  const items: any[] = pi && Array.isArray(pi.items) ? pi.items : [];

  const invoiceNo   = order.invoiceNumber || order.orderNumber;
  const invoiceDate = ship?.blDate
    ? new Date(ship.blDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const pol = pi?.portOfLoading   || ship?.portOfLoading   || COMPANY_DEFAULTS.portOfLoading;
  const pod = pi?.portOfDischarge || ship?.portOfDischarge || "";

  // Build summary rows (colour-level — crate number allocated sequentially)
  let crateCounter = 1;
  const summaryRows: any[][] = [];
  let totalSlabs = 0;
  let totalSqft  = 0;
  let totalNetWt = 0;
  let totalCrates= 0;

  for (const item of items) {
    const colour   = item.colour || item.description || "—";
    const thick    = item.thickness || "2CM";
    const slabs    = Number(item.noOfSlabs ?? 0);
    const sqft     = Number(item.sqft ?? item.sqFt ?? 0);
    const netWt    = Number(item.netWeight ?? 0);
    const batchNo  = item.batchNo || "—";
    // Estimate crates: ~10-11 slabs per crate
    const cratesForItem = Math.ceil(slabs / 10) || (slabs > 0 ? 1 : 0);
    const crateRange = cratesForItem > 0
      ? crateCounter === crateCounter + cratesForItem - 1
        ? String(crateCounter).padStart(2, "0")
        : `${String(crateCounter).padStart(2, "0")}–${String(crateCounter + cratesForItem - 1).padStart(2, "0")}`
      : "—";

    summaryRows.push([
      { text: colour, style: "tableCell", bold: true },
      { text: thick, style: "tableCell", alignment: "center" },
      { text: slabs > 0 ? String(slabs) : "—", style: "tableCell", alignment: "center" },
      { text: batchNo, style: "tableCell", alignment: "center" },
      { text: sqft > 0 ? sqft.toFixed(3) : "—", style: "tableCell", alignment: "right" },
      { text: netWt > 0 ? netWt.toFixed(0) : "—", style: "tableCell", alignment: "right" },
      { text: sqft > 0 ? (sqft / 10.764).toFixed(3) : "—", style: "tableCell", alignment: "right" },
      { text: cratesForItem > 0 ? String(cratesForItem) : "—", style: "tableCell", alignment: "center" },
    ]);

    totalSlabs  += slabs;
    totalSqft   += sqft;
    totalNetWt  += netWt;
    totalCrates += cratesForItem;
    crateCounter += cratesForItem;
  }

  const totalSqmt = totalSqft / 10.764;

  const docDef: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: "Roboto", fontSize: 8.5 },
    styles: {
      ...docStyles as any,
      heading: { fontSize: 20, bold: true, alignment: "center" },
      label: { fontSize: 7.5, bold: true, color: "#333" },
      small: { fontSize: 7.5, color: "#555" },
      tableHeader: { fontSize: 7.5, bold: true, fillColor: "#f5f5f5" },
      tableCell: { fontSize: 8 },
    },
    content: [
      // ── Header ──
      { text: "Detailed Measurement List", style: "heading", marginBottom: 6 },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 0.5 }], marginBottom: 8 },

      // ── Reference block ──
      {
        table: {
          widths: ["auto", "*", "auto", "*"],
          body: [
            [
              { text: "FY 2026-27", style: "label", border: [false,false,false,false] },
              { text: ship?.portOfDischarge || pod, border: [false,false,false,false], fontSize: 8 },
              { text: "POD", style: "label", border: [false,false,false,false] },
              { text: ship?.portOfDischarge || pod, border: [false,false,false,false], fontSize: 8 },
            ],
            [
              { text: "PO Ref", style: "label", border: [false,false,false,false] },
              { text: pi?.buyerPoNo || pi?.piNumber || "—", border: [false,false,false,false], fontSize: 8 },
              { text: "Final Destn", style: "label", border: [false,false,false,false] },
              { text: pi?.finalDestination || `${pod}, USA`, border: [false,false,false,false], fontSize: 8 },
            ],
            [
              { text: "Inv Ref", style: "label", border: [false,false,false,false] },
              { text: `${invoiceNo}    ${invoiceDate}`, border: [false,false,false,false], fontSize: 8 },
              { text: "Country", style: "label", border: [false,false,false,false] },
              { text: pi?.countryOfDestination || order.client.country || "—", border: [false,false,false,false], fontSize: 8 },
            ],
          ],
        },
        layout: "noBorders",
        marginBottom: 10,
      },

      // ── Summary Table (colour level) ──
      {
        table: {
          headerRows: 2,
          widths: ["*", "auto", "auto", "auto", "auto", "auto", "auto", "auto"],
          body: [
            // Sub-header for measurements
            [
              { text: "", style: "tableHeader", border: [false,false,false,false] },
              { text: "", style: "tableHeader", border: [false,false,false,false] },
              { text: "", style: "tableHeader", border: [false,false,false,false] },
              { text: "", style: "tableHeader", border: [false,false,false,false] },
              { text: "", style: "tableHeader", border: [false,false,false,false] },
              { text: "Net Weight", style: "tableHeader", alignment: "right", border: [false,false,false,false] },
              { text: "SQMT", style: "tableHeader", alignment: "right", border: [false,false,false,false] },
              { text: "Crate(S)", style: "tableHeader", alignment: "center", border: [false,false,false,false] },
            ],
            [
              { text: "Colour", style: "tableHeader" },
              { text: "Thick", style: "tableHeader", alignment: "center" },
              { text: "Slabs/Pcs", style: "tableHeader", alignment: "center" },
              { text: "Batch No.", style: "tableHeader", alignment: "center" },
              { text: "SQFT", style: "tableHeader", alignment: "right" },
              { text: "(Kgs)", style: "tableHeader", alignment: "right" },
              { text: "", style: "tableHeader", alignment: "right" },
              { text: "", style: "tableHeader", alignment: "center" },
            ],
            ...summaryRows,
            // Total row
            [
              { text: "Total", bold: true, fontSize: 8, colSpan: 2 }, {},
              { text: String(totalSlabs), bold: true, fontSize: 8, alignment: "center" },
              { text: "", fontSize: 8 },
              { text: totalSqft.toFixed(3), bold: true, fontSize: 8, alignment: "right" },
              { text: totalNetWt > 0 ? totalNetWt.toFixed(0) : "—", bold: true, fontSize: 8, alignment: "right" },
              { text: totalSqmt.toFixed(3), bold: true, fontSize: 8, alignment: "right" },
              { text: `{${totalCrates}}`, bold: true, fontSize: 8, alignment: "center" },
            ],
          ],
        },
        layout: "lightHorizontalLines",
        marginBottom: 16,
      },

      // ── Container / Vehicle footer ──
      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: `Container No. ${ship?.containerNo || "—"}`, bold: true, fontSize: 14, marginBottom: 4 },
              { text: `Vehicle No. ${ship?.vehicleNo || "—"}`, bold: true, fontSize: 12 },
            ],
          },
          {
            width: "50%",
            alignment: "right",
            stack: [
              { text: `Port of Loading: ${pol}`, fontSize: 8 },
              { text: `Port of Discharge: ${pod}`, fontSize: 8 },
              { text: `Vessel: ${ship?.vesselName || "—"}`, fontSize: 8 },
              { text: `BL No: ${ship?.blNo || "—"}`, fontSize: 8 },
              { text: `Liner OTL No: ${ship?.linerOtlNo || "—"}`, fontSize: 8 },
              { text: `E-Seal No: ${ship?.eSealNo || "—"}`, fontSize: 8 },
              { text: `ETA: ${ship?.etaDate ? new Date(ship.etaDate).toLocaleDateString("en-GB") : "—"}`, fontSize: 8 },
            ],
          },
        ],
      },

      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 0.5 }], marginTop: 12, marginBottom: 4 },
      {
        text: `For ${config?.companyName || COMPANY_DEFAULTS.name}`,
        bold: true, fontSize: 8, alignment: "right",
      },
    ],
  };

  return buildPdf(docDef);
}
