/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Combined Shipment PDF = Invoice + Packing List + Detailed Measurement List
 * Matches the PESPL-XXXX format sent with every dispatch.
 */
import { prisma } from "@/lib/prisma";
import { buildPdf, docStyles, amountToWords, COMPANY_DEFAULTS } from "./common";
type TDocumentDefinitions = any;

export async function generateCombinedShipmentPdf(orderId: string): Promise<Buffer> {
  const db = prisma as any;
  const [order, config] = await Promise.all([
    db.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        client: true,
        sp: { select: { name: true, email: true } },
        proformaInvoices: {
          where: { status: "ACCEPTED" },
          take: 1,
          orderBy: { acceptedAt: "desc" },
        },
        shipmentDocs: true,
        packages: { orderBy: { createdAt: "asc" } },
      },
    }),
    db.salesConfig.findUnique({ where: { id: "global" } }).catch(() => null),
  ]);
  if (!order) throw new Error("Order not found");

  const pi = order.proformaInvoices?.[0];
  const ship = order.shipmentDocs;
  // Merge per-item net weights entered by commercial into PI items
  const rawItems: any[] = pi && Array.isArray(pi.items) ? pi.items : [];
  const packingOverrides: { index: number; netWeight: number | null }[] =
    Array.isArray(ship?.packingItems) ? (ship.packingItems as any[]) : [];
  const items: any[] = rawItems.map((item, idx) => {
    const override = packingOverrides.find(o => o.index === idx);
    return override ? { ...item, netWeight: override.netWeight } : item;
  });
  const currency = order.currency || pi?.currency || "USD";
  const totalAmount = Number(order.totalAmount || pi?.totalAmount || 0);

  const C = {
    name:      config?.companyName    || COMPANY_DEFAULTS.name,
    address:   config?.companyAddress || COMPANY_DEFAULTS.address,
    iec:       config?.iecCode        || COMPANY_DEFAULTS.iec,
    gstin:     config?.gstNo          || COMPANY_DEFAULTS.gstin,
    bankName:  config?.bankName       || COMPANY_DEFAULTS.bankName,
    bankAddr:  config?.bankBranch     || COMPANY_DEFAULTS.bankAddr,
    accountNo: config?.accountNo      || COMPANY_DEFAULTS.accountNo,
    swift:     config?.swiftCode      || COMPANY_DEFAULTS.swift,
    adCode:    config?.adCode         || COMPANY_DEFAULTS.adCode,
  };

  const invoiceNo   = order.invoiceNumber || order.orderNumber;
  const invoiceDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  const pol     = pi?.portOfLoading   || ship?.portOfLoading   || COMPANY_DEFAULTS.portOfLoading;
  const pod     = pi?.portOfDischarge || ship?.portOfDischarge || "";
  const podFull = pi?.finalDestination || (pod ? `${pod}` : "");

  // ── Shared header fields ─────────────────────────────────────────────────
  const sharedRightMeta = (label: string) => [
    [{ text: "Invoice No.", style: "label", border: [false,false,false,false] }, { text: invoiceNo, bold: true, border: [false,false,false,false] }],
    [{ text: "Dated", style: "label", border: [false,false,false,false] }, { text: invoiceDate, border: [false,false,false,false] }],
    [{ text: "Buyer's PO Ref.", style: "label", border: [false,false,false,false] }, { text: pi?.buyerPoNo || pi?.piNumber || "---", border: [false,false,false,false] }],
    [{ text: "IEC Code No.", style: "label", border: [false,false,false,false] }, { text: `IEC ${C.iec}`, bold: true, border: [false,false,false,false] }],
    [{ text: "GSTIN No.", style: "label", border: [false,false,false,false] }, { text: C.gstin, border: [false,false,false,false] }],
  ];

  const pageHeader = (title: string) => ([
    { text: "Sree Hari Om", italics: true, alignment: "center", fontSize: 9, marginBottom: 2 },
    { text: title, bold: true, fontSize: 22, alignment: "center", marginBottom: 2 },
    { text: "(Under Rule 46 CGST 2017)", alignment: "center", fontSize: 9, color: "#555", marginBottom: 4 },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 0.5 }], marginBottom: 4 },
    {
      columns: [
        {
          width: "55%",
          stack: [
            { text: "Exporter:", style: "label" },
            { text: C.name, bold: true, fontSize: 11, marginBottom: 2 },
            { text: C.address, style: "small" },
          ],
        },
        {
          width: "45%",
          stack: [{
            table: { widths: ["45%", "55%"], body: sharedRightMeta(title) },
            layout: "noBorders",
            fontSize: 8,
          }],
        },
      ],
      marginBottom: 4,
    },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 0.5 }], marginBottom: 4 },
    {
      table: {
        widths: ["50%", "50%"],
        body: [[
          {
            stack: [
              { text: "Consignee:", style: "label" },
              { text: pi?.consigneeDetails || (order.client.name + "\n" + (order.client.address || "")), fontSize: 8, marginTop: 2 },
            ],
            border: [true,true,true,true],
          },
          {
            stack: [
              { text: "Notify Party:", style: "label" },
              { text: pi?.notifyPartyDetails || "---", fontSize: 8, marginTop: 2 },
              { text: "Terms & Conditions:", style: "label", marginTop: 6 },
              { text: [{ text: "Delivery Terms: ", bold: true }, (order.deliveryTerms || pi?.deliveryTerms || "---")], fontSize: 7.5 },
              { text: [{ text: "Payment Terms: ", bold: true }, (pi?.paymentTermsSummary || "---")], fontSize: 7.5 },
            ],
            border: [true,true,true,true],
          },
        ]],
      },
      marginBottom: 4,
      fontSize: 8,
    },
    {
      table: {
        widths: ["34%", "34%", "32%"],
        body: [
          [
            { text: [{ text: "Pre-Carriage By:\n", style: "label" }, "By Road"], border:[true,true,true,true], fontSize: 7.5 },
            { text: [{ text: "Place of Receipt:\n", style: "label" }, pol], border:[true,true,true,true], fontSize: 7.5 },
            { text: [{ text: "Vessel/Flight No.:\n", style: "label" }, ship?.vesselName || "---"], border:[true,true,true,true], fontSize: 7.5 },
          ],
          [
            { text: [{ text: "Port of Discharge:\n", style: "label" }, pod], border:[true,true,true,true], fontSize: 7.5 },
            { text: [{ text: "Port of Loading:\n", style: "label" }, pol], border:[true,true,true,true], fontSize: 7.5 },
            { text: [{ text: "Final Destination:\n", style: "label" }, podFull], border:[true,true,true,true], fontSize: 7.5 },
          ],
        ],
      },
      marginBottom: 4,
    },
  ]);

  const containerBlock = () => ({
    stack: [
      { text: `Container No. ${ship?.containerNo || "---"}`, bold: true, fontSize: 8, marginBottom: 1 },
      { text: `Liner's OTL No. ${ship?.linerOtlNo || "---"}`, fontSize: 7.5 },
      { text: `E-Seal No. ${ship?.eSealNo || "---"}`, fontSize: 7.5 },
      { text: `Vehicle No. ${ship?.vehicleNo || "---"}`, fontSize: 7.5 },
      { text: `BL No. ${ship?.blNo || ""}`, fontSize: 7.5 },
      { text: `SB No. ${ship?.sbNo || ""}`, fontSize: 7.5 },
    ],
    marginBottom: 6,
  });

  // ── INVOICE ITEMS ─────────────────────────────────────────────────────────
  const totalSlabs = items.reduce((s: number, r: any) => s + (r.noOfSlabs ?? 0), 0);
  const totalSqft  = items.reduce((s: number, r: any) => s + Number(r.sqft ?? r.sqFt ?? 0), 0);

  const invoiceRows = items.map((item: any) => [
    { text: item.colour || item.description || "", style: "tableCell" },
    { text: item.thickness || "", style: "tableCell", alignment: "center" },
    { text: item.netWeight != null ? String(item.netWeight) : "", style: "tableCell", alignment: "right" },
    { text: item.noOfSlabs != null ? String(item.noOfSlabs) : "", style: "tableCell", alignment: "center" },
    { text: Number(item.sqft ?? item.sqFt ?? 0).toFixed(3), style: "tableCell", alignment: "right" },
    { text: "SQFT", style: "tableCell", alignment: "center" },
    { text: Number(item.unitPrice ?? 0).toFixed(3), style: "tableCell", alignment: "right" },
    { text: Number(item.amount ?? 0).toFixed(2), style: "tableCell", alignment: "right" },
  ]);

  // ── PACKING LIST ROWS ────────────────────────────────────────────────────
  const plRows = items.map((item: any) => [
    { text: item.colour || item.description || "", style: "tableCell" },
    { text: item.thickness || "", style: "tableCell", alignment: "center" },
    { text: item.netWeight != null ? String(item.netWeight) : "", style: "tableCell", alignment: "right" },
    { text: item.noOfSlabs != null ? String(item.noOfSlabs) : "", style: "tableCell", alignment: "center" },
    { text: Number(item.sqft ?? item.sqFt ?? 0).toFixed(3), style: "tableCell", alignment: "right" },
    { text: "SQFT", style: "tableCell", alignment: "center" },
    { text: item.remarks || "", style: "tableCell" },
  ]);

  // ── MEASUREMENT LIST ──────────────────────────────────────────────────────
  // Build per-slab rows from items. Each item = one colour/thickness group.
  // Slab numbers are sequential across colours.
  let slNo = 1;
  const mlRows: any[] = [];
  const mlSummaryRows: any[] = [];
  let crateNo = 1;
  let slabsInCrate = 0;
  const MAX_SLABS_PER_CRATE = 7;

  for (const item of items) {
    const n = Number(item.noOfSlabs ?? 0);
    const sqftPerSlab = n > 0 ? Number(item.sqft ?? item.sqFt ?? 0) / n : 0;
    const colour  = item.colour || item.description || "";
    const thick   = item.thickness || "";
    const batchNo = item.batchNo || item.batch || "";

    // Estimate Lg × Ht from sqftPerSlab if possible
    // 136" × 79" = 74.611 SQFT (typical 3CM slab). We store area only.
    const approxLg = item.length || "---";
    const approxHt = item.height || "---";

    for (let i = 0; i < n; i++) {
      // Assign to crate
      if (slabsInCrate >= MAX_SLABS_PER_CRATE) {
        crateNo++;
        slabsInCrate = 0;
      }
      mlRows.push([
        { text: String(slNo++), style: "tableCell", alignment: "center" },
        { text: colour, style: "tableCell" },
        { text: batchNo, style: "tableCell", alignment: "center" },
        { text: item.slabNos || "---", style: "tableCell", alignment: "center" },
        { text: thick, style: "tableCell", alignment: "center" },
        { text: String(approxLg), style: "tableCell", alignment: "right" },
        { text: String(approxHt), style: "tableCell", alignment: "right" },
        { text: sqftPerSlab.toFixed(3), style: "tableCell", alignment: "right" },
        { text: String(crateNo).padStart(2, "0"), style: "tableCell", alignment: "center" },
      ]);
      slabsInCrate++;
    }

    // Summary row per colour
    mlSummaryRows.push([
      { text: String(mlSummaryRows.length + 1), style: "tableCell", alignment: "center" },
      { text: colour, style: "tableCell" },
      { text: thick, style: "tableCell", alignment: "center" },
      { text: String(n), style: "tableCell", alignment: "center" },
      { text: batchNo, style: "tableCell", alignment: "center" },
      { text: Number(item.sqft ?? item.sqFt ?? 0).toFixed(3), style: "tableCell", alignment: "right" },
      { text: item.netWeight != null ? String(item.netWeight) : "---", style: "tableCell", alignment: "right" },
    ]);
  }

  // ── BUILD DOCUMENT ────────────────────────────────────────────────────────
  const styles = {
    ...docStyles as any,
    label:       { fontSize: 7.5, bold: true, color: "#333" },
    small:       { fontSize: 7.5, color: "#555" },
    tableHeader: { fontSize: 7.5, bold: true, fillColor: "#f5f5f5" },
    tableCell:   { fontSize: 7.5 },
  };

  const docDef: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: "Roboto", fontSize: 8.5 },
    styles,
    content: [

      // ── PAGE 1: INVOICE ──────────────────────────────────────────────────
      ...pageHeader("Invoice"),
      { text: `HSN NO: ${COMPANY_DEFAULTS.hsnCode}     Artificial Quartz Slabs`, bold: true, fontSize: 7.5, marginBottom: 4 },
      {
        stack: [
          { text: "Our Bank Details:", style: "label", marginBottom: 1 },
          { text: C.bankName, bold: true, fontSize: 8 },
          { text: C.bankAddr, style: "small" },
          {
            columns: [
              { text: `AD Code: ${C.adCode}`, style: "small", width: "50%" },
              { text: `A/c No. ${C.accountNo}    Swift: ${C.swift}`, style: "small", width: "50%" },
            ],
          },
          { text: `Routing Bank: ${COMPANY_DEFAULTS.routingBank}  Swift: ${COMPANY_DEFAULTS.routingSwift}`, style: "small" },
        ],
        marginBottom: 4,
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", "auto", "auto", "auto", "auto", "auto", "auto", "auto"],
          body: [
            [
              { text: "Colour", style: "tableHeader" },
              { text: "Thick", style: "tableHeader", alignment: "center" },
              { text: "Net Wt", style: "tableHeader", alignment: "right" },
              { text: "No. of\nSlabs/Pcs", style: "tableHeader", alignment: "center" },
              { text: "Qty (SQFT)", style: "tableHeader", alignment: "right" },
              { text: "Unit", style: "tableHeader", alignment: "center" },
              { text: `Rate\n${currency}/Unit`, style: "tableHeader", alignment: "right" },
              { text: `Total\n${currency}`, style: "tableHeader", alignment: "right" },
            ],
            ...invoiceRows,
            [
              { text: "Total -- Slabs / Pcs", bold: true, fontSize: 7.5, colSpan: 3 }, {}, {},
              { text: String(totalSlabs), bold: true, fontSize: 7.5, alignment: "center" },
              { text: totalSqft.toFixed(3), bold: true, fontSize: 7.5, alignment: "right" },
              { text: "SQFT", fontSize: 7.5, alignment: "center" },
              {},
              { text: totalAmount.toFixed(2), bold: true, fontSize: 7.5, alignment: "right" },
            ],
          ],
        },
        layout: "lightHorizontalLines",
        marginBottom: 4,
      },
      containerBlock(),
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 0.5 }], marginBottom: 3 },
      {
        columns: [
          {
            width: "60%",
            stack: [
              { text: "Amount Chargeable (In Words):", style: "label" },
              { text: amountToWords(totalAmount, currency), italics: true, fontSize: 7.5 },
            ],
          },
          {
            width: "40%",
            alignment: "right",
            text: [{ text: `Total  ${currency}  `, fontSize: 8 }, { text: totalAmount.toFixed(2), bold: true, fontSize: 9 }],
          },
        ],
        marginBottom: 4,
      },
      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: "Weight in MT", style: "label" },
              { text: `Gross Wt: ${ship?.grossWeight || "---"} MT`, fontSize: 7.5 },
              { text: `Net Wt:   ${ship?.netWeight   || "---"} MT`, fontSize: 7.5 },
              { text: "\nDeclaration:", style: "label" },
              { text: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.", fontSize: 7, italics: true },
            ],
          },
          {
            width: "50%",
            alignment: "right",
            stack: [
              { text: `For ${C.name}`, bold: true, fontSize: 8 },
              { text: "\n\n\n" },
              { text: "(Authorised Signatory)", fontSize: 8 },
            ],
          },
        ],
      },

      // ── PAGE 2: PACKING LIST ─────────────────────────────────────────────
      ...pageHeader("Packing List").map((node: any, i: number) =>
        i === 0 ? { ...node, pageBreak: "before" } : node
      ),
      { text: `Marks & Nos: ${ship?.containerNo || "---"}     HSN No: ${COMPANY_DEFAULTS.hsnCode}`, fontSize: 7.5, marginBottom: 2 },
      { text: "Artificial Quartz Slabs", bold: true, fontSize: 7.5, marginBottom: 4 },
      {
        table: {
          headerRows: 1,
          widths: ["*", "auto", "auto", "auto", "auto", "auto", "*"],
          body: [
            [
              { text: "Colour", style: "tableHeader" },
              { text: "Thick", style: "tableHeader", alignment: "center" },
              { text: "Net Wt", style: "tableHeader", alignment: "right" },
              { text: "No. of\nSlabs/Pcs", style: "tableHeader", alignment: "center" },
              { text: "Quantity\n(SQFT)", style: "tableHeader", alignment: "right" },
              { text: "Unit", style: "tableHeader", alignment: "center" },
              { text: "Remarks", style: "tableHeader" },
            ],
            ...plRows,
            [
              { text: "Total -- Slabs / Pcs", bold: true, fontSize: 7.5, colSpan: 3 }, {}, {},
              { text: String(totalSlabs), bold: true, fontSize: 7.5, alignment: "center" },
              { text: totalSqft.toFixed(3), bold: true, fontSize: 7.5, alignment: "right" },
              { text: "SQFT", fontSize: 7.5, alignment: "center" },
              {},
            ],
          ],
        },
        layout: "lightHorizontalLines",
        marginBottom: 4,
      },
      containerBlock(),
      {
        stack: [
          { text: "Summary", style: "label", marginBottom: 2 },
          { text: `Tot. Area in Sq.ft:  ${totalSqft.toFixed(3)}`, fontSize: 7.5 },
          { text: `Tot. No. of Pcs:  ${totalSlabs}`, fontSize: 7.5 },
          { text: `Tot. No. of Packages:  ${ship?.packageDescription || "---"}`, fontSize: 7.5 },
          { text: `Gross Wt: ${ship?.grossWeight || "---"} MT     Net Wt: ${ship?.netWeight || "---"} MT`, fontSize: 7.5, marginTop: 2 },
        ],
        marginBottom: 6,
      },
      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: "\nDeclaration:", style: "label" },
              { text: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.", fontSize: 7, italics: true },
            ],
          },
          {
            width: "50%",
            alignment: "right",
            stack: [
              { text: `For ${C.name}`, bold: true, fontSize: 8 },
              { text: "\n\n\n" },
              { text: "(Authorised Signatory)", fontSize: 8 },
            ],
          },
        ],
      },

      // ── PAGE 3: MEASUREMENT LIST ─────────────────────────────────────────
      {
        pageBreak: "before",
        stack: [
          { text: "Sree Hari Om", italics: true, alignment: "center", fontSize: 9, marginBottom: 2 },
          { text: "Detailed Measurement List", bold: true, fontSize: 18, alignment: "center", marginBottom: 4 },
          {
            columns: [
              {
                width: "50%",
                stack: [
                  { text: [{ text: "PO Ref: ", bold: true }, (pi?.buyerPoNo || "---")], fontSize: 8 },
                  { text: [{ text: "Inv Ref: ", bold: true }, `${invoiceNo} Dated: ${invoiceDate}`], fontSize: 8 },
                ],
              },
              {
                width: "50%",
                alignment: "right",
                stack: [
                  { text: [{ text: "POD: ", bold: true }, pod], fontSize: 8 },
                  { text: [{ text: "Final Destn: ", bold: true }, podFull], fontSize: 8 },
                  { text: [{ text: "Country: ", bold: true }, (pi?.countryOfDestination || "---")], fontSize: 8 },
                ],
              },
            ],
            marginBottom: 6,
          },
          { text: "Gross Measurements", style: "label", marginBottom: 2 },
          {
            table: {
              headerRows: 1,
              widths: ["auto", "*", "auto", "auto", "auto", "auto", "auto", "auto", "auto"],
              body: [
                [
                  { text: "Sl No.", style: "tableHeader", alignment: "center" },
                  { text: "Colour", style: "tableHeader" },
                  { text: "Batch No.", style: "tableHeader", alignment: "center" },
                  { text: "Slab Nos", style: "tableHeader", alignment: "center" },
                  { text: "Thick\n(CM)", style: "tableHeader", alignment: "center" },
                  { text: "Lg\n(Inches)", style: "tableHeader", alignment: "right" },
                  { text: "Ht\n(Inches)", style: "tableHeader", alignment: "right" },
                  { text: "Area\n(SQFT)", style: "tableHeader", alignment: "right" },
                  { text: "Crate\nNo.", style: "tableHeader", alignment: "center" },
                ],
                ...mlRows,
              ],
            },
            layout: "lightHorizontalLines",
            marginBottom: 6,
          },
          { text: "Summary", style: "label", marginBottom: 2 },
          {
            table: {
              headerRows: 1,
              widths: ["auto", "*", "auto", "auto", "auto", "auto", "auto"],
              body: [
                [
                  { text: "No.", style: "tableHeader", alignment: "center" },
                  { text: "Colour", style: "tableHeader" },
                  { text: "Thick", style: "tableHeader", alignment: "center" },
                  { text: "Slabs/Pcs", style: "tableHeader", alignment: "center" },
                  { text: "Batch No.", style: "tableHeader", alignment: "center" },
                  { text: "SQFT", style: "tableHeader", alignment: "right" },
                  { text: "Net Wt", style: "tableHeader", alignment: "right" },
                ],
                ...mlSummaryRows,
                [
                  { text: "TOTAL", bold: true, colSpan: 3, fontSize: 7.5 }, {}, {},
                  { text: String(totalSlabs), bold: true, fontSize: 7.5, alignment: "center" },
                  {},
                  { text: totalSqft.toFixed(3), bold: true, fontSize: 7.5, alignment: "right" },
                  {},
                ],
              ],
            },
            layout: "lightHorizontalLines",
            marginBottom: 6,
          },
          containerBlock(),
        ],
      },
    ],
  };

  return buildPdf(docDef);
}
