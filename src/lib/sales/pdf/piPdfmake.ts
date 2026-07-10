/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Proforma Invoice — pdfmake engine.
 *
 * The pixel-perfect PI templates (piPdf.ts / piGranitePdf.ts) render HTML via
 * puppeteer, which is deliberately NOT a dependency of this repo — on Vercel
 * every PI PDF (download, send, resend) therefore died with "PDF engine not
 * installed…". This module renders the same data through pdfmake (which IS a
 * dependency and powers the commercial invoice / packing / stuffing PDFs), so
 * a PI PDF always exists:
 *
 *   generatePiPdfAuto(piId)
 *     1. puppeteer installed → use the exact HTML template for the PI's
 *        productType (QUARTZ → PESPL, GRANITE → PGI); if that render fails at
 *        runtime (e.g. no Chrome binary) fall through to pdfmake instead of
 *        failing the request;
 *     2. otherwise → pdfmake layout below (company block per productType).
 *
 * The old "PDF engine not installed" error can now only surface if pdfmake
 * itself is missing, i.e. truly no engine.
 */
import { prisma } from "@/lib/prisma";
import { getSp } from "../spLookup";
import { buildPdf, amountToWords, COMPANY_DEFAULTS, GRANITE_COMPANY_DEFAULTS } from "./common";
import { isPuppeteerAvailable } from "./puppeteerPdf";
import { generatePIPdf } from "./piPdf";
import { generateGranitePiPdf } from "./piGranitePdf";

const db = prisma as any;

const DARK = "#1A1A1A";
const GREY = "#555555";
const LINE = "#9AA3AF";

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${dt.getFullYear()}`;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function labelled(label: string, value: string | null | undefined) {
  return {
    stack: [
      { text: label, fontSize: 6.5, bold: true, color: GREY },
      { text: value || "—", fontSize: 8, color: DARK, marginTop: 1 },
    ],
    margin: [4, 3, 4, 3],
  };
}

function buildPiDocDef(pi: any): any {
  const isGranite = pi.productType === "GRANITE";
  const C: any = isGranite ? GRANITE_COMPANY_DEFAULTS : COMPANY_DEFAULTS;
  const items: any[] = Array.isArray(pi.items) ? pi.items : [];
  const total = Number(pi.totalAmount ?? 0);
  const currency = pi.currency || "USD";

  const totalSlabs = items.reduce((s, i) => s + Number(i.noOfSlabs ?? 0), 0);
  const totalQty   = items.reduce((s, i) => s + Number(i.sqm ?? i.sqft ?? i.qty ?? 0), 0);

  const itemRows = items.map((item) => {
    const qty    = Number(item.sqm ?? item.sqft ?? item.qty ?? 0);
    const rate   = Number(item.unitPrice ?? 0);
    const amount = Number(item.amount ?? qty * rate);
    const unit   = item.unit ?? (item.sqm != null ? "SQM" : "SQFT");
    const desc   = [item.colour || item.description || item.desc || "", item.finish]
      .filter(Boolean).join(" — ");
    return [
      { text: item.marksNo ?? item.itemCode ?? "", fontSize: 7.5 },
      { text: desc, fontSize: 7.5 },
      { text: item.thickness ? String(item.thickness) : "", fontSize: 7.5, alignment: "center" },
      { text: item.noOfSlabs != null ? String(item.noOfSlabs) : "", fontSize: 7.5, alignment: "center" },
      { text: String(item.hsnCode ?? item.hsn ?? item.hsnSac ?? C.hsnCode ?? ""), fontSize: 7.5, alignment: "center" },
      { text: unit, fontSize: 7.5, alignment: "center" },
      { text: qty ? qty.toFixed(3) : "", fontSize: 7.5, alignment: "right" },
      { text: rate ? money(rate) : "", fontSize: 7.5, alignment: "right" },
      { text: money(amount), fontSize: 7.5, alignment: "right" },
    ];
  });

  const th = (t: string, align = "center") =>
    ({ text: t, fontSize: 7, bold: true, fillColor: "#EFEFEF", alignment: align, margin: [1, 2, 1, 2] });

  return {
    pageSize: "A4",
    pageMargins: [32, 30, 32, 34],
    footer: (page: number, pages: number) => ({
      text: `${pi.piNumber}  ·  Page ${page} of ${pages}`,
      alignment: "center", fontSize: 6.5, color: GREY, margin: [0, 8, 0, 0],
    }),
    content: [
      // ── Company + title ────────────────────────────────────────────────
      { text: C.name, fontSize: 14, bold: true },
      { text: (C.address || "").replace(/\n/g, ", "), fontSize: 7.5, color: GREY, marginTop: 1 },
      { text: `IEC: ${C.iec}   GSTIN: ${C.gstin}`, fontSize: 7.5, color: GREY, marginTop: 1 },
      { text: "PROFORMA INVOICE", fontSize: 12, bold: true, alignment: "center", margin: [0, 10, 0, 6] },

      // ── PI meta ────────────────────────────────────────────────────────
      {
        table: {
          widths: ["*", "*", "*", "*"],
          body: [[
            labelled("PI No.", pi.piNumber),
            labelled("Date", fmtDate(pi.createdAt)),
            labelled("Buyer PO No.", pi.buyerPoNo),
            labelled("Validity", pi.validityDays ? `${pi.validityDays} days` : null),
          ]],
        },
        layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
        marginBottom: 6,
      },

      // ── Parties ────────────────────────────────────────────────────────
      {
        table: {
          widths: ["*", "*"],
          body: [[
            labelled("Consignee", pi.consigneeDetails ||
              [pi.client?.name, pi.client?.address, pi.client?.country].filter(Boolean).join("\n")),
            labelled("Notify Party", pi.notifyPartyDetails || pi.buyerIfNotConsignee),
          ]],
        },
        layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
        marginBottom: 6,
      },

      // ── Routing ────────────────────────────────────────────────────────
      {
        table: {
          widths: ["*", "*", "*"],
          body: [
            [
              labelled("Country of Destination", pi.countryOfDestination || pi.client?.country),
              labelled("Port of Loading", pi.portOfLoading || C.portOfLoading),
              labelled("Port of Discharge", pi.portOfDischarge),
            ],
            [
              labelled("Final Destination", pi.finalDestination || pi.portOfDischarge),
              labelled("Delivery Terms", pi.deliveryTerms),
              labelled("Payment Terms", pi.paymentTermsSummary),
            ],
          ],
        },
        layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
        marginBottom: 8,
      },

      // ── Items ──────────────────────────────────────────────────────────
      {
        table: {
          headerRows: 1,
          widths: [38, "*", 30, 30, 42, 28, 46, 46, 56],
          body: [
            [th("Code", "left"), th("Description", "left"), th("Thick"), th("Slabs"), th("HSN"), th("Unit"), th("Qty", "right"), th(`Rate (${currency})`, "right"), th(`Amount (${currency})`, "right")],
            ...itemRows,
            [
              { text: "TOTAL", colSpan: 3, bold: true, fontSize: 7.5, alignment: "left" }, {}, {},
              { text: totalSlabs ? String(totalSlabs) : "", bold: true, fontSize: 7.5, alignment: "center" },
              {}, {},
              { text: totalQty ? totalQty.toFixed(3) : "", bold: true, fontSize: 7.5, alignment: "right" },
              {},
              { text: money(total), bold: true, fontSize: 8, alignment: "right" },
            ],
          ],
        },
        layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
        marginBottom: 6,
      },

      { text: `Amount in words: ${amountToWords(total, currency)}`, fontSize: 8, bold: true, marginBottom: 8 },

      // ── Bank ───────────────────────────────────────────────────────────
      {
        table: {
          widths: ["*"],
          body: [[{
            stack: [
              { text: "BANK DETAILS", fontSize: 6.5, bold: true, color: GREY },
              { text: `${C.bankName}, ${C.bankAddr}`, fontSize: 7.5, marginTop: 2 },
              { text: `A/c No: ${C.accountNo}   Swift: ${C.swift}   AD Code: ${C.adCode}`, fontSize: 7.5, marginTop: 1 },
              { text: `Routing bank: ${C.routingBank} (Swift: ${C.routingSwift})`, fontSize: 7.5, marginTop: 1 },
            ],
            margin: [4, 3, 4, 3],
          }]],
        },
        layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
        marginBottom: 6,
      },

      ...(pi.notes ? [{ text: `Notes: ${pi.notes}`, fontSize: 7.5, color: GREY, marginBottom: 6 }] : []),

      // ── Declaration + signatures ───────────────────────────────────────
      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: "Declaration:", fontSize: 7.5, bold: true },
              { text: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.", fontSize: 7.5, marginTop: 2 },
              { text: "Accepted By Customer", fontSize: 7.5, marginTop: 26 },
              { text: `For ${pi.client?.name ?? ""}`, fontSize: 7.5, marginTop: 1 },
            ],
          },
          {
            width: "50%",
            stack: [
              { text: `For ${C.name}`, fontSize: 7.5, bold: true },
              { text: "Authorised Signatory & Stamp", fontSize: 7.5, marginTop: 44 },
            ],
            alignment: "right",
          },
        ],
        marginTop: 4,
      },
    ],
  };
}

/** Render a PI PDF with whichever engine is actually usable (see header). */
export async function generatePiPdfAuto(piId: string): Promise<Buffer> {
  const pi = await db.proformaInvoice.findUnique({
    where:   { id: piId },
    include: { client: true },
  });
  if (!pi) throw new Error("PI not found");
  const isGranite = pi.productType === "GRANITE";

  if (isPuppeteerAvailable()) {
    try {
      return isGranite ? await generateGranitePiPdf(piId) : await generatePIPdf(piId);
    } catch (err: any) {
      console.error(`PI ${pi.piNumber}: puppeteer render failed (${err?.message}); falling back to pdfmake`);
    }
  }

  // spId carries no Prisma relation (no hard FK) — stitch, matching the HTML path.
  pi.sp = await getSp(pi.spId);
  return buildPdf(buildPiDocDef(pi));
}
