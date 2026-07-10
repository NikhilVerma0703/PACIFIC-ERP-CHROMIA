/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Commercial Invoice — Pacific Engineered Surfaces Pvt. Ltd.
 * Layout matches PESPL reference format exactly.
 */
import { prisma } from "@/lib/prisma";
import { getSp } from "../spLookup";
import { buildPdf, amountToWords, COMPANY_DEFAULTS } from "./common";

type TDocumentDefinitions = any;

// ── Colours ───────────────────────────────────────────────────────────────────
const NAVY    = "#1B3A6B";
const GOLD    = "#B8860B";
const LBG     = "#EEF2FB";
const BORDER  = "#C5CFE4";
const WHITE   = "#FFFFFF";
const DARK    = "#1A1A1A";
const GREY    = "#555555";

// ── Section-header bar (works in stacks and table cells alike) ────────────────
function sh(label: string, fillColor = NAVY, color = WHITE) {
  return {
    table: { widths: ["*"], body: [[{
      text: `  ${label}`,
      fontSize: 6.5, bold: true, color, fillColor,
      margin: [2, 3, 2, 3], border: [false, false, false, false],
    }]] },
    layout: "noBorders",
    marginBottom: 2,
  };
}

// ── Table header cell ─────────────────────────────────────────────────────────
function th(text: string, align = "center", extra: any = {}) {
  return { text, fontSize: 7, bold: true, color: WHITE, fillColor: NAVY, alignment: align, margin: [2, 3, 2, 3], ...extra };
}

// ── Box cell for routing grid ─────────────────────────────────────────────────
function bc(label: string, value: string | null | undefined, opts: any = {}) {
  return {
    stack: [
      { text: label, fontSize: 6, bold: true, color: GREY },
      { text: value || "", fontSize: 7.5, color: DARK, marginTop: 2 },
    ],
    border: [true, true, true, true],
    margin: [4, 3, 4, 3],
    ...opts,
  };
}

export async function generateInvoicePdf(orderId: string): Promise<Buffer> {
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
  // spId carries no Prisma relation (no hard FK) — `include: { sp }` throws
  // PrismaClientValidationError. Stitch the salesperson in via spLookup.
  order.sp = await getSp(order.spId);

  const pi   = order.proformaInvoices?.[0];
  const ship = order.shipmentDocs;
  const items: any[] = pi && Array.isArray(pi.items) ? pi.items : [];

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

  const currency    = order.currency || pi?.currency || "USD";
  const totalAmount = Number(order.totalAmount || pi?.totalAmount || 0);
  const invoiceNo   = order.invoiceNumber || order.orderNumber || "—";

  const invoiceDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const fy = (() => {
    const now = new Date();
    const yr  = now.getFullYear();
    return now.getMonth() >= 3 ? `FY ${yr}-${String(yr + 1).slice(2)}` : `FY ${yr - 1}-${String(yr).slice(2)}`;
  })();

  const pol = pi?.portOfLoading   || ship?.portOfLoading   || COMPANY_DEFAULTS.portOfLoading;
  const pod = pi?.portOfDischarge || (ship as any)?.portOfDischarge || "";

  // ── Item rows ─────────────────────────────────────────────────────────────
  const itemRows = items.map((item: any) => [
    { text: item.colour || item.description || "", fontSize: 7.5, color: DARK },
    { text: item.thickness ? String(item.thickness).toUpperCase() : "", fontSize: 7.5, alignment: "center", color: DARK },
    { text: item.netWeight != null ? Number(item.netWeight).toLocaleString() : "", fontSize: 7.5, alignment: "right", color: DARK },
    { text: item.noOfSlabs != null ? String(item.noOfSlabs) : "", fontSize: 7.5, alignment: "center", color: DARK },
    { text: Number(item.sqft ?? item.sqFt ?? 0).toFixed(3), fontSize: 7.5, alignment: "right", color: DARK },
    { text: "SQFT", fontSize: 7.5, alignment: "center", color: DARK },
    { text: Number(item.unitPrice ?? 0).toFixed(3), fontSize: 7.5, alignment: "right", color: DARK },
    { text: Number(item.amount ?? 0).toFixed(2), fontSize: 7.5, alignment: "right", bold: true, color: DARK },
  ]);

  const totalSlabs = items.reduce((s: number, r: any) => s + Number(r.noOfSlabs ?? 0), 0);
  const totalSqft  = items.reduce((s: number, r: any) => s + Number(r.sqft ?? r.sqFt ?? 0), 0);

  const docDef: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [28, 28, 28, 32],
    defaultStyle: { font: "Roboto", fontSize: 8 },

    content: [
      // ── TITLE ROW ──────────────────────────────────────────────────────────
      {
        columns: [
          { text: "Sree Hari Om", fontSize: 9, italics: true, color: GOLD, width: "30%" },
          { text: "Invoice", fontSize: 16, bold: true, color: NAVY, alignment: "center", width: "*" },
          { text: fy, fontSize: 8.5, bold: true, color: NAVY, alignment: "right", width: "25%", margin: [0, 4, 0, 0] },
        ],
        marginBottom: 1,
      },
      {
        text: "(Under Rule 46 CGST 2017)",
        fontSize: 7, italics: true, color: GREY, alignment: "center", marginBottom: 4,
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 1.5, lineColor: GOLD }], marginBottom: 4 },

      // ── EXPORTER | INVOICE DETAILS ─────────────────────────────────────────
      {
        table: {
          widths: ["55%", "45%"],
          body: [[
            {
              stack: [
                sh("Exporter:"),
                { text: C.name, fontSize: 9, bold: true, color: NAVY, margin: [4, 2, 4, 2] },
                { text: C.address, fontSize: 7.5, color: DARK, margin: [4, 0, 4, 2] },
                { text: `State Code - ${COMPANY_DEFAULTS.stateCode}    District Code - ${COMPANY_DEFAULTS.distCode}`, fontSize: 7, color: GREY, margin: [4, 0, 4, 4] },
              ],
              border: [true, true, true, true],
            },
            {
              stack: [
                { table: { widths: ["46%", "54%"], body: [
                  [{ text: "Invoice No.", fontSize: 7.5, bold: true, color: GREY, border: [false,false,false,false] },
                   { text: invoiceNo,     fontSize: 8,   bold: true, color: NAVY,  border: [false,false,false,false] }],
                  [{ text: "Dated",       fontSize: 7.5, bold: true, color: GREY, border: [false,false,false,false] },
                   { text: invoiceDate,   fontSize: 7.5, color: DARK, border: [false,false,false,false] }],
                  [{ text: "Buyer's PO Ref.", fontSize: 7.5, bold: true, color: GREY, border: [false,false,false,false] },
                   { text: pi?.buyerPoNo || "—", fontSize: 7.5, color: DARK, border: [false,false,false,false] }],
                  [{ text: "IEC Code No.", fontSize: 7.5, bold: true, color: GREY, border: [false,false,false,false] },
                   { text: `IEC ${C.iec}`, fontSize: 7.5, color: DARK, border: [false,false,false,false] }],
                  [{ text: "RBI Code No.", fontSize: 7.5, bold: true, color: GREY, border: [false,false,false,false] },
                   { text: "", fontSize: 7.5, color: DARK, border: [false,false,false,false] }],
                  [{ text: "Sales Rep",   fontSize: 7.5, bold: true, color: GREY, border: [false,false,false,false] },
                   { text: order.sp?.name || "", fontSize: 7.5, color: DARK, border: [false,false,false,false] }],
                ]}, layout: "noBorders", margin: [4, 2, 4, 2] },
                { text: `GSTIN NO: ${C.gstin}`, fontSize: 7, color: GREY, margin: [4, 0, 4, 4] },
              ],
              border: [true, true, true, true],
            },
          ]],
        },
        layout: { hLineColor: () => BORDER, vLineColor: () => BORDER },
        marginBottom: 3,
      },

      // ── JURISDICTION ────────────────────────────────────────────────────────
      {
        text: `Jurisdictional Address:  ${COMPANY_DEFAULTS.jurisdictionOffice ?? ""}`,
        fontSize: 5.5, color: GREY, italics: true, marginBottom: 3,
      },

      // ── CONSIGNEE | NOTIFY PARTY ───────────────────────────────────────────
      {
        table: {
          widths: ["50%", "50%"],
          body: [[
            {
              stack: [
                sh("Consignee:"),
                { text: pi?.consigneeDetails || [order.client.name, order.client.address, order.client.country].filter(Boolean).join("\n"), fontSize: 8, color: DARK, margin: [4, 2, 4, 4] },
              ],
              border: [true, true, true, true], minHeight: 55,
            },
            {
              stack: [
                sh("Notify Party:"),
                { text: pi?.notifyPartyDetails || "—", fontSize: 8, color: DARK, margin: [4, 2, 4, 4] },
              ],
              border: [true, true, true, true], minHeight: 55,
            },
          ]],
        },
        layout: { hLineColor: () => BORDER, vLineColor: () => BORDER },
        marginBottom: 3,
      },

      // ── ROUTING GRID — Row 1 ───────────────────────────────────────────────
      {
        table: {
          widths: ["20%", "20%", "20%", "20%", "20%"],
          body: [
            [
              bc("Pre-Carriage By",    "By Road"),
              bc("Vessel/Flight No.",  ship?.vesselName || ""),
              bc("Port of Discharge",  pod || ""),
              bc("Marks & Nos",        ship?.containerNo ? `Container No. ${ship.containerNo}` : ""),
              bc("No. of W/Crt / Bdl / Box", ""),
            ],
            [
              { ...bc("Place of Receipt By Pre-Carrier", pol), colSpan: 2, border: [true,true,true,true] }, {},
              bc("Port of Loading", pol),
              { ...bc("Final Destination", pi?.finalDestination || pod || ""), colSpan: 2, border: [true,true,true,true] }, {},
            ],
          ],
        },
        layout: { hLineColor: () => BORDER, vLineColor: () => BORDER },
        marginBottom: 3,
      },

      // ── COUNTRY + TERMS + BANK ─────────────────────────────────────────────
      {
        table: {
          widths: ["25%", "25%", "50%"],
          body: [[
            {
              stack: [
                { text: "Country of Origin of Goods", fontSize: 6.5, bold: true, color: GREY },
                { text: "INDIA", fontSize: 8, bold: true, color: DARK, marginTop: 2 },
              ],
              border: [true, true, true, true], margin: [4, 3, 4, 3],
            },
            {
              stack: [
                { text: "Country of Final Destination", fontSize: 6.5, bold: true, color: GREY },
                { text: pi?.countryOfDestination || order.client?.country || "—", fontSize: 8, color: DARK, marginTop: 2 },
              ],
              border: [true, true, true, true], margin: [4, 3, 4, 3],
            },
            {
              stack: [
                sh("Terms & Conditions:"),
                { table: { widths: ["35%", "65%"], body: [
                  [{ text: "Delivery Terms:", fontSize: 7.5, bold: true, color: GREY, border: [false,false,false,false] },
                   { text: order.deliveryTerms || pi?.deliveryTerms || "—", fontSize: 7.5, color: DARK, border: [false,false,false,false] }],
                  [{ text: "Payment Terms:", fontSize: 7.5, bold: true, color: GREY, border: [false,false,false,false] },
                   { text: pi?.paymentTermsSummary || "—", fontSize: 7.5, color: DARK, border: [false,false,false,false] }],
                  [{ text: "HSN Code:", fontSize: 7.5, bold: true, color: GREY, border: [false,false,false,false] },
                   { text: COMPANY_DEFAULTS.hsnCode, fontSize: 7.5, color: DARK, border: [false,false,false,false] }],
                ]}, layout: "noBorders", margin: [4, 2, 4, 4] },
              ],
              border: [true, true, true, true],
            },
          ]],
        },
        layout: { hLineColor: () => BORDER, vLineColor: () => BORDER },
        marginBottom: 3,
      },

      // ── BANK DETAILS ───────────────────────────────────────────────────────
      {
        table: { widths: ["*"], body: [[{
          columns: [
            {
              width: "50%",
              stack: [
                { text: "Our Bank Details", fontSize: 7.5, bold: true, color: NAVY, marginBottom: 2 },
                { text: C.bankName, bold: true, fontSize: 8, color: DARK },
                { text: C.bankAddr, fontSize: 7, color: GREY, marginTop: 1 },
                { text: `A/c No. ${C.accountNo}`, fontSize: 7.5, color: DARK, marginTop: 2 },
                { text: `AD Code: ${C.adCode}`, fontSize: 7, color: GREY },
              ],
            },
            {
              width: "50%",
              stack: [
                { text: `Routing Bank: ${COMPANY_DEFAULTS.routingBank}`, fontSize: 7, color: GREY },
                { text: `Swift Code (Routing) — ${COMPANY_DEFAULTS.routingSwift}`, fontSize: 7, color: GREY, marginTop: 1 },
                { text: `Swift Code — ${C.swift}`, fontSize: 7.5, color: DARK, marginTop: 2 },
              ],
            },
          ],
          fillColor: LBG, margin: [6, 5, 6, 5], border: [true, true, true, true],
        }]] },
        layout: { hLineColor: () => BORDER, vLineColor: () => BORDER },
        marginBottom: 3,
      },

      // ── DESCRIPTION OF GOODS ───────────────────────────────────────────────
      {
        columns: [
          { text: "Description of Goods", fontSize: 7.5, bold: true, color: NAVY, width: "auto" },
          { text: `HSN NO: ${COMPANY_DEFAULTS.hsnCode}   |   Artificial Quartz Slabs`, fontSize: 7.5, bold: true, color: DARK, alignment: "right", width: "*" },
        ],
        marginBottom: 1,
      },

      // ── ITEM TABLE ─────────────────────────────────────────────────────────
      {
        table: {
          headerRows: 1,
          widths: ["*", 30, 40, 40, 50, 28, 48, 54],
          body: [
            [
              th("Colour", "left"),
              th("Thick", "center"),
              th("Net\nWeight", "right"),
              th("No.of\nSlabs/Pcs", "center"),
              th("Quantity", "right"),
              th("Unit", "center"),
              th(`Rate in\n${currency}/Unit`, "right"),
              th(`Total Amount\nin ${currency}`, "right"),
            ],
            ...itemRows,
            // ── totals row ─────────────────────────────────────────────────
            [
              { text: "Total", bold: true, fontSize: 8, colSpan: 3, fillColor: LBG,
                border: [true,true,true,true], margin: [4,4,4,4] }, {}, {},
              { text: String(totalSlabs), bold: true, fontSize: 8, alignment: "center",
                fillColor: LBG, border: [true,true,true,true], margin: [0,4,0,4] },
              { text: totalSqft.toFixed(3), bold: true, fontSize: 8, alignment: "right",
                fillColor: LBG, border: [true,true,true,true], margin: [0,4,3,4] },
              { text: "SQFT", fontSize: 8, alignment: "center", fillColor: LBG, border: [true,true,true,true] },
              { text: "", fillColor: LBG, border: [true,true,true,true] },
              { text: `${currency} ${totalAmount.toFixed(2)}`, bold: true, fontSize: 8.5,
                alignment: "right", color: NAVY, fillColor: LBG,
                border: [true,true,true,true], margin: [0,4,3,4] },
            ],
          ],
        },
        layout: {
          hLineColor: () => BORDER,
          vLineColor: () => BORDER,
          fillColor: (ri: number) => ri === 0 ? NAVY : ri % 2 === 0 ? LBG : null,
        },
        marginBottom: 3,
      },

      // ── CONTAINER + WEIGHTS ────────────────────────────────────────────────
      {
        table: { widths: ["*"], body: [[{
          columns: [
            {
              width: "60%",
              stack: [
                { text: `Container No. ${ship?.containerNo || "—"}`, fontSize: 7.5, bold: true, color: DARK, marginBottom: 1 },
                { text: `Liner's OTL No. ${(ship as any)?.linerOtlNo || "—"}`, fontSize: 7.5, color: DARK },
                { text: `E-Seal No. ${(ship as any)?.eSealNo || "—"}`, fontSize: 7.5, color: DARK },
                { text: `Vehicle No. ${(ship as any)?.vehicleNo || "—"}`, fontSize: 7.5, color: DARK },
                { text: `BL No. ${ship?.blNo || "—"}`, fontSize: 7.5, color: DARK },
                { text: `SB No. ${ship?.sbNo || "—"}`, fontSize: 7.5, color: DARK },
              ],
            },
            {
              width: "40%",
              stack: [
                { text: "Weight in MT", fontSize: 7.5, bold: true, color: NAVY, marginBottom: 3 },
                { columns: [
                  { text: "Gross Wt", fontSize: 7, color: GREY, width: "50%" },
                  { text: `${(ship as any)?.grossWeight || "—"} MT`, fontSize: 7.5, color: DARK, width: "50%", alignment: "right" },
                ], marginBottom: 2 },
                { columns: [
                  { text: "Net Wt",   fontSize: 7, color: GREY, width: "50%" },
                  { text: `${(ship as any)?.netWeight   || "—"} MT`, fontSize: 7.5, color: DARK, width: "50%", alignment: "right" },
                ]},
              ],
            },
          ],
          fillColor: LBG, margin: [6, 5, 6, 5], border: [true, true, true, true],
        }]] },
        layout: { hLineColor: () => BORDER, vLineColor: () => BORDER },
        marginBottom: 3,
      },

      // ── AMOUNT IN WORDS ────────────────────────────────────────────────────
      {
        table: { widths: ["*"], body: [[{
          text: [
            { text: `Amount Chargeable (In Words) :  `, fontSize: 7.5, bold: true, color: NAVY },
            { text: amountToWords(totalAmount, currency), fontSize: 7.5, italics: true, color: DARK },
          ],
          fillColor: LBG, margin: [6, 4, 6, 4], border: [true, true, true, true],
        }]] },
        layout: { hLineColor: () => GOLD, vLineColor: () => GOLD },
        marginBottom: 6,
      },

      // ── DECLARATION + SIGNATURE ────────────────────────────────────────────
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "Declaration:", fontSize: 7.5, bold: true, color: NAVY, marginBottom: 2 },
              {
                text: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct",
                fontSize: 7, color: GREY, italics: true,
              },
            ],
          },
          {
            width: 190,
            table: { widths: ["*"], body: [[{
              stack: [
                { text: `For ${C.name}`, fontSize: 8, bold: true, color: NAVY, alignment: "center", margin: [0, 4, 0, 26] },
                { canvas: [{ type: "line", x1: 10, y1: 0, x2: 160, y2: 0, lineWidth: 0.5, lineColor: NAVY }] },
                { text: "(Authorised Signatory)", fontSize: 7.5, color: GREY, alignment: "center", marginTop: 3 },
              ],
              margin: [4, 4, 4, 6], fillColor: LBG, border: [true, true, true, true],
            }]] },
            layout: { hLineColor: () => BORDER, vLineColor: () => BORDER },
          },
        ],
      },

      { canvas: [{ type: "line", x1: 0, y1: 8, x2: 539, y2: 8, lineWidth: 1.5, lineColor: GOLD }] },
    ],
  };

  return buildPdf(docDef);
}
