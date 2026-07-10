/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * generateCommercialInvoicePdf
 * Builds a pixel-accurate replica of the Pacific commercial invoice template
 * for both Quartz (PESPL) and Granite (PGI) factory types.
 *
 * Returns a Buffer with the generated PDF.
 */
import { buildPdf, amountToWords } from "./common";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InvoiceData {
  // Config (from invoice-config route)
  cfg: Record<string, any>;

  // Order / PI basics
  invoiceNo:      string;
  invoiceDate:    string;   // "DD.MM.YYYY"
  fyYear:         string;   // "2025-26"
  buyerPoNo:      string;
  piNumber:       string;
  piDate:         string;

  // SP / RBI
  spName:         string;   // shown as "Sales Rep <name>"

  // Shipping
  consigneeDetails:  string;
  notifyPartyDetails:string;
  buyerIfNotConsignee: string;
  countryOfOrigin:   string;
  countryOfDestination: string;
  deliveryTerms:     string;
  paymentTermsSummary: string;
  preCarriageBy:     string;
  placeOfReceipt:    string;
  vesselName:        string;
  portOfLoading:     string;
  portOfDischarge:   string;
  finalDestination:  string;
  packageDescription: string;

  // Per-order overrides
  marksNos:       string;
  itemNetWeights: string[];  // kg per item
  oceanFreight:   number;
  packingCharges: number;
  insurancePct:   number;
  discountAmount: number;

  // PI items
  currency: string;
  productType: "QUARTZ" | "GRANITE";
  piItems: Array<{
    colour?:      string;
    description?: string;
    thick?:       string;
    sqft?:        number;
    sqm?:         number;
    rate?:        number;
    unitPrice?:   number;
    total?:       number;
    amount?:      number;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cell(text: string, opts: Record<string, any> = {}): any {
  return { text: text ?? "", fontSize: 7, ...opts };
}

function hCell(text: string, opts: Record<string, any> = {}): any {
  return { text: text ?? "", fontSize: 7, bold: true, fillColor: "#f5f5f5", ...opts };
}

function borderCell(text: string, opts: Record<string, any> = {}): any {
  return { text: text ?? "", fontSize: 7, border: [true, true, true, true], ...opts };
}

function noBorderCell(text: string, opts: Record<string, any> = {}): any {
  return { text: text ?? "", fontSize: 7, border: [false, false, false, false], ...opts };
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ─── Main generator ──────────────────────────────────────────────────────────

export async function generateCommercialInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const { cfg, productType, piItems, currency } = data;
  const isGranite = productType === "GRANITE";
  const unit = cfg.unit || (isGranite ? "SQM" : "SQFT");

  // ── Compute totals ──────────────────────────────────────────────────────────
  let subtotal = 0;
  const rows: any[][] = [];

  piItems.forEach((item, i) => {
    const qty     = unit === "SQM" ? (item.sqm ?? 0) : (item.sqft ?? 0);
    const rate    = item.rate ?? item.unitPrice ?? 0;
    const amount  = item.total ?? item.amount ?? (qty * rate);
    subtotal += amount;

    const netWt   = data.itemNetWeights[i] ?? "";
    const desc    = [
      item.colour || item.description || "",
      item.thick  ? `Thickness: ${item.thick}` : "",
      netWt       ? `Net Weight: ${netWt} KGS` : "",
    ].filter(Boolean).join("\n");

    rows.push([
      cell(String(i + 1),       { alignment: "center" }),
      cell(data.marksNos || "", { alignment: "center" }),
      cell(""),                  // No. of W/Crt — filled from packageDescription
      cell(desc,                 { lineHeight: 1.3 }),
      cell(fmt(qty),             { alignment: "right" }),
      cell(unit,                 { alignment: "center" }),
      cell(fmt(rate),            { alignment: "right" }),
      cell(fmt(amount),          { alignment: "right" }),
    ]);
  });

  // Charges
  const ins      = subtotal * (data.insurancePct / 100);
  const totalFob = subtotal - data.discountAmount;
  const totalCif = totalFob + data.oceanFreight + data.packingCharges + ins;

  const chargeRow = (label: string, amount: number | null) => [
    noBorderCell("", {}),
    noBorderCell("", {}),
    noBorderCell("", {}),
    noBorderCell(label, { bold: true, alignment: "right", colSpan: 4 }),
    noBorderCell("", {}),
    noBorderCell("", {}),
    noBorderCell("", {}),
    noBorderCell(amount != null ? fmt(amount) : "", { alignment: "right", bold: true }),
  ];

  const chargeRows: any[][] = [];
  if (data.oceanFreight)   chargeRows.push(chargeRow(`Ocean Freight (${currency})`, data.oceanFreight));
  if (data.packingCharges) chargeRows.push(chargeRow(`Packing Charges (${currency})`, data.packingCharges));
  if (data.insurancePct)   chargeRows.push(chargeRow(`Insurance @ ${data.insurancePct}%`, ins));
  if (data.discountAmount) chargeRows.push(chargeRow(`Less: Discount (${currency})`, -data.discountAmount));

  chargeRows.push([
    noBorderCell("", { border: [false, true, false, false] }),
    noBorderCell("", { border: [false, true, false, false] }),
    noBorderCell("", { border: [false, true, false, false] }),
    { text: `TOTAL CIF (${currency})`, fontSize: 8, bold: true, alignment: "right",
      colSpan: 4, border: [false, true, false, false] },
    noBorderCell("", {}),
    noBorderCell("", {}),
    noBorderCell("", {}),
    { text: fmt(totalCif), fontSize: 8, bold: true, alignment: "right",
      border: [false, true, false, false] },
  ]);

  // ── Amount in words ─────────────────────────────────────────────────────────
  const amtWords = amountToWords(totalCif, currency);

  // ── Total net weight ────────────────────────────────────────────────────────
  const totalNetKg = data.itemNetWeights
    .map(w => parseFloat(w) || 0)
    .reduce((a, b) => a + b, 0);
  const totalNetMT = totalNetKg / 1000;

  // ── Build left/right info boxes ─────────────────────────────────────────────
  const companyName    = cfg.companyName    || "";
  const companyAddress = cfg.companyAddress || "";
  const iecCode        = cfg.iecCode        || "";
  const gstin          = cfg.gstin          || "";
  const stateCode      = cfg.stateCode      || "";
  const districtCode   = cfg.districtCode   || "";
  const hsnCode        = cfg.hsnCode        || "";

  // Religious / decorative header
  const religiousHeader = cfg.religiousHeader ? cfg.religiousHeader : "";

  // ── Document definition ─────────────────────────────────────────────────────
  const docDef: any = {
    pageSize:    "A4",
    pageMargins: [28, 28, 28, 28],

    defaultStyle: { font: "Roboto", fontSize: 7 },

    content: [
      // ═══ TITLE BLOCK ═══════════════════════════════════════════════════════
      ...(religiousHeader ? [
        { text: religiousHeader, fontSize: 9, italics: true, alignment: "center", marginBottom: 1 },
      ] : []),

      {
        columns: [
          { text: `FY ${data.fyYear}`, fontSize: 7, color: "#555", width: "50%" },
          { text: "(Under Rule 46 CGST 2017)", fontSize: 7, color: "#555", alignment: "right", width: "50%" },
        ],
        marginBottom: 1,
      },

      {
        columns: [
          {
            width: "65%",
            stack: [
              { text: companyName, fontSize: 11, bold: true },
              { text: companyAddress, fontSize: 7, color: "#333", lineHeight: 1.35, marginTop: 2 },
              { text: `${iecCode}`, fontSize: 7, marginTop: 3 },
              { text: `GSTIN: ${gstin}`, fontSize: 7 },
              { text: `State Code: ${stateCode}   District Code: ${districtCode}`, fontSize: 7 },
              ...(cfg.tinNo ? [{ text: `TIN No: ${cfg.tinNo}   CST No: ${cfg.cstNo}`, fontSize: 7 }] : []),
              ...(cfg.is100EOU ? [
                { text: "100% EXPORT ORIENTED UNIT", fontSize: 7, bold: true, color: "#1e40af", marginTop: 2 },
              ] : []),
            ],
          },
          {
            width: "35%",
            table: {
              widths: ["*"],
              body: [
                [{ text: "COMMERCIAL INVOICE", fontSize: 12, bold: true, alignment: "center",
                   fillColor: "#e8e8e8", border: [true, true, true, false] }],
                [{ stack: [
                  kvRow("Invoice No.", data.invoiceNo),
                  kvRow("Dated",       data.invoiceDate),
                  kvRow("PI Ref.",     `${data.piNumber} Dt.${data.piDate}`),
                  kvRow("Buyer's PO",  data.buyerPoNo || ""),
                  kvRow("RBI Code",    cfg.rbiCode || "678"),
                  kvRow("Sales Rep",   data.spName || ""),
                ], fontSize: 7, border: [true, false, true, true], padding: [4, 3, 4, 3] }],
              ],
            },
            layout: "noBorders",
          },
        ],
        marginBottom: 4,
      },

      // ═══ JURISDICTIONAL OFFICE ══════════════════════════════════════════════
      {
        table: {
          widths: ["*"],
          body: [[{
            text: [
              { text: "Jurisdictional Office: ", fontSize: 7, bold: true },
              { text: cfg.jurisdictionalOfficeAddress || "", fontSize: 6.5, color: "#333" },
            ],
            border: [true, true, true, true],
            fillColor: "#f9f9f9",
          }]],
        },
        layout: "noBorders",
        marginBottom: 3,
      },

      // ═══ CONSIGNEE / COUNTRY BOX ═════════════════════════════════════════════
      {
        table: {
          widths: ["50%", "50%"],
          body: [
            [
              hCell("Consignee", { border: [true, true, false, false] }),
              hCell("Country of Origin", { border: [false, true, true, false] }),
            ],
            [
              borderCell(data.consigneeDetails || "", { border: [true, false, false, true], minHeight: 36, lineHeight: 1.3 }),
              {
                stack: [
                  kvRow("Country of Origin:", data.countryOfOrigin || "India"),
                  kvRow("Country of Destination:", data.countryOfDestination || ""),
                  kvRow("Delivery Terms:", data.deliveryTerms || "CIF"),
                  kvRow("Payment Terms:", data.paymentTermsSummary || ""),
                ],
                fontSize: 7,
                border: [false, false, true, true],
              },
            ],
          ],
        },
        marginBottom: 0,
      },

      // ═══ NOTIFY PARTY ════════════════════════════════════════════════════════
      {
        table: {
          widths: ["50%", "50%"],
          body: [
            [
              hCell("Notify Party", { border: [true, false, false, false] }),
              hCell("Buyer (if other than Consignee)", { border: [false, false, true, false] }),
            ],
            [
              borderCell(data.notifyPartyDetails || "", { border: [true, false, false, true], minHeight: 24, lineHeight: 1.3 }),
              borderCell(data.buyerIfNotConsignee || "", { border: [false, false, true, true], minHeight: 24, lineHeight: 1.3 }),
            ],
          ],
        },
        marginBottom: 0,
      },

      // ═══ TRANSPORT ROW ════════════════════════════════════════════════════════
      {
        table: {
          widths: ["16.66%", "16.66%", "16.66%", "16.66%", "16.66%", "16.7%"],
          body: [
            [
              hCell("Pre-Carriage By",    { border: [true, false, false, false] }),
              hCell("Place of Receipt",   { border: [false, false, false, false] }),
              hCell("Vessel / Flight No", { border: [false, false, false, false] }),
              hCell("Port of Loading",    { border: [false, false, false, false] }),
              hCell("Port of Discharge",  { border: [false, false, false, false] }),
              hCell("Final Destination",  { border: [false, false, true, false] }),
            ],
            [
              borderCell(data.preCarriageBy    || "By Road",      { border: [true, false, false, true] }),
              borderCell(data.placeOfReceipt   || "",             { border: [false, false, false, true] }),
              borderCell(data.vesselName       || "",             { border: [false, false, false, true] }),
              borderCell(data.portOfLoading    || "",             { border: [false, false, false, true] }),
              borderCell(data.portOfDischarge  || "",             { border: [false, false, false, true] }),
              borderCell(data.finalDestination || "",             { border: [false, false, true, true] }),
            ],
          ],
        },
        marginBottom: 4,
      },

      // ═══ ITEMS TABLE ══════════════════════════════════════════════════════════
      {
        table: {
          headerRows: 1,
          widths: ["4%", "10%", "8%", "*", "9%", "7%", "9%", "10%"],
          body: [
            // Header
            [
              hCell("Sr.\nNo.", { alignment: "center", rowSpan: 1 }),
              hCell("Marks &\nNos.", { alignment: "center" }),
              hCell("No. of\nW/Crt", { alignment: "center" }),
              hCell(`Description of Goods (HSN: ${hsnCode})`, {}),
              hCell(`Qty\n(${unit})`, { alignment: "center" }),
              hCell("Unit", { alignment: "center" }),
              hCell(`Rate\n(${currency})`, { alignment: "center" }),
              hCell(`Amount\n(${currency})`, { alignment: "center" }),
            ],
            // Items
            ...rows,
            // Empty padding row
            [
              cell(""), cell(""), cell(""), cell(""), cell(""), cell(""), cell(""), cell(""),
            ],
            // Subtotal row
            [
              noBorderCell("", { border: [false, true, false, false] }),
              noBorderCell("", { border: [false, true, false, false] }),
              noBorderCell("", { border: [false, true, false, false] }),
              { text: "Sub Total (FOB):", fontSize: 7, bold: true, alignment: "right",
                colSpan: 4, border: [false, true, false, false] },
              noBorderCell("", {}),
              noBorderCell("", {}),
              noBorderCell("", {}),
              { text: fmt(subtotal), fontSize: 7, bold: true, alignment: "right",
                border: [false, true, false, false] },
            ],
            // Charge rows
            ...chargeRows,
          ],
        },
        marginBottom: 3,
      },

      // ═══ BANK DETAILS (left) | AMOUNT IN WORDS + WEIGHT (right) ═════════════
      {
        columns: [
          {
            width: "55%",
            table: {
              widths: ["*"],
              body: [
                [hCell("Bank Details", { border: [true, true, true, false] })],
                [{
                  stack: [
                    { text: cfg.bankName || "", fontSize: 7, bold: true },
                    { text: cfg.bankAddress || "", fontSize: 6.5, color: "#333", lineHeight: 1.3 },
                    { text: `A/c No: ${cfg.accountNo || ""}`, fontSize: 7, marginTop: 2 },
                    { text: `SWIFT: ${cfg.swiftCode || ""}`, fontSize: 7 },
                    { text: `AD Code: ${cfg.adCode || ""}`, fontSize: 7 },
                    ...(cfg.routingBankName ? [
                      { text: "Routing Bank:", fontSize: 7, bold: true, marginTop: 3 },
                      { text: cfg.routingBankName, fontSize: 7 },
                      { text: cfg.routingBankAddress || "", fontSize: 6.5, color: "#333" },
                      { text: `SWIFT: ${cfg.routingBankSwift || ""}`, fontSize: 7 },
                      ...(cfg.routingBankNostro ? [
                        { text: `Nostro A/c: ${cfg.routingBankNostro}`, fontSize: 7 },
                      ] : []),
                    ] : []),
                  ],
                  border: [true, false, true, true],
                  fontSize: 7,
                }],
              ],
            },
          },
          { width: 8, text: "" },
          {
            width: "*",
            stack: [
              {
                table: {
                  widths: ["*"],
                  body: [
                    [hCell("Amount in Words", { border: [true, true, true, false] })],
                    [{ text: amtWords, fontSize: 7, italics: true, border: [true, false, true, true] }],
                  ],
                },
                marginBottom: 3,
              },
              {
                table: {
                  widths: ["*", "*"],
                  body: [
                    [
                      hCell("Gross Weight (MT)", { border: [true, true, false, false] }),
                      hCell("Net Weight (MT)",   { border: [false, true, true, false] }),
                    ],
                    [
                      borderCell("",                               { border: [true, false, false, true] }),
                      borderCell(totalNetMT > 0 ? fmt(totalNetMT, 3) + " MT" : "", { border: [false, false, true, true] }),
                    ],
                  ],
                },
                marginBottom: 3,
              },
              {
                table: {
                  widths: ["*"],
                  body: [[{
                    text: `Package: ${data.packageDescription || ""}`,
                    fontSize: 7, border: [true, true, true, true],
                  }]],
                },
              },
            ],
          },
        ],
        marginBottom: 4,
      },

      // ═══ DECLARATION ══════════════════════════════════════════════════════════
      {
        text: "I/We hereby certify that particulars given above are true and correct and that the goods described are of Indian Origin.",
        fontSize: 7, italics: true, alignment: "center", marginBottom: 2,
      },

      // ═══ LEGAL FOOTER (Granite only) ══════════════════════════════════════════
      ...(cfg.legalFooter ? [
        {
          table: {
            widths: ["*"],
            body: [[{
              text: cfg.legalFooter,
              fontSize: 6.5, color: "#333", lineHeight: 1.35,
              border: [true, true, true, true], fillColor: "#fafafa",
            }]],
          },
          marginBottom: 3,
        },
      ] : []),

      // ═══ SIGNATURE ═════════════════════════════════════════════════════════════
      {
        columns: [
          { width: "*", text: "" },
          {
            width: "auto",
            stack: [
              { text: cfg.signatureLine || `For ${companyName}`, fontSize: 8, bold: true, alignment: "center" },
              { text: "\n\n\n", fontSize: 7 },
              { text: "Authorised Signatory", fontSize: 7, alignment: "center", color: "#555" },
            ],
          },
        ],
      },
    ],
  };

  return buildPdf(docDef);
}

// ─── Tiny KV helper ──────────────────────────────────────────────────────────
function kvRow(label: string, value: string) {
  return {
    columns: [
      { text: label, fontSize: 6.5, bold: true, width: 60 },
      { text: value, fontSize: 6.5 },
    ],
    marginBottom: 1,
  };
}
