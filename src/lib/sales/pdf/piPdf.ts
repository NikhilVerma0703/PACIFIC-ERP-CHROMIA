/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Proforma Invoice — Pacific Engineered Surfaces Private Limited (PESPL)
 * Rendered via Puppeteer (headless Chrome).
 * Layout matches reference PDF (Stone Galeria Jax Inc) exactly.
 */
import { prisma } from "@/lib/prisma";
import { htmlToPdf } from "./puppeteerPdf";
import { amountToWords } from "./common";

const db = prisma as any;

const COMPANY_NAME = "Pacific Engineered Surfaces Private Limited";
const COMPANY_ADDR = "SY.NO.73/2B, Nallaganakotapalli Village, N.H.7, Hosur, Krishnagiri, Tamil Nadu, 635117";
const COMPANY_GSTIN = "33AALCP2750N1Z3";
const RBI_CODE = "678";
const CUSTOMS_ADDR = "OFFICE OF THE ASSISTANT COMMISSIONER OF CUSTOMS, CUSTOMS PREVENTIVE UNIT, 21B, RAAGAVIS CENTER, I-FLOOR, NETHAJI NAGAR, NANJUNDAPURAM MAIN ROAD, RAMANATHAPURAM, COIMBATORE-641045.";
const BANK_DETAILS = "Kotak Mahindra Bank Limited 10/7, Umiya Landmark, Lavelle Road, Next to Chancery Hotel, Bangalore 560001 Karnataka, India AD Code: 0180038-8400009 A/c No. 3214292773; IFSC Code: KKBK0000422 Swift Code - KKBKINBBXXX";
const ROUTING_BANK = "The Bank of Newyork Mellon, No.1, Wall St. Newyork, NY 10015 Swift Code - IRVTUS3NXXX";
const HSN_CODE = "68101990";

function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "";
  const dd   = String(dt.getDate()).padStart(2, "0");
  const mm   = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function buildHtml(pi: any): string {
  const items: any[] = Array.isArray(pi.items) ? pi.items : [];
  const totalAmt   = Number(pi.totalAmount ?? 0);
  const totalSlabs = items.reduce((s: number, i: any) => s + Number(i.noOfSlabs ?? 0), 0);

  const piDate     = fmtDate(pi.createdAt);
  const deliveryDate = fmtDate(
    pi.deliveryDate ??
    new Date(new Date(pi.createdAt ?? Date.now()).getTime() + (pi.validityDays ?? 30) * 86400000)
  );

  const country          = esc(pi.countryOfDestination || pi.client?.country || "");
  const portOfLoading    = esc(pi.portOfLoading  || "Ennore Port, India");
  const portOfDischarge  = esc(pi.portOfDischarge || "");
  const finalDestination = esc(pi.finalDestination || pi.portOfDischarge || "");
  const placeOfReceipt   = esc(pi.placeOfReceipt  || "");
  const paymentTerms     = esc(pi.paymentTermsSummary || "");
  const deliveryTerms    = esc(pi.deliveryTerms || "");
  const buyerIfNotConsignee = esc(pi.buyerIfNotConsignee || "");
  const grossWt          = pi.grossWeight ? String(pi.grossWeight) : "";
  const netWt            = pi.netWeight   ? String(pi.netWeight)   : "";
  const consigneeDetails = esc(pi.consigneeDetails || pi.client?.name || "");
  const notifyPartyDetails = esc(pi.notifyPartyDetails || "");
  const amountWords = amountToWords(totalAmt, "USD");

  const itemRows = items.map((item: any) => {
    const qty    = Number(item.sqft ?? item.sqFt ?? item.qty ?? 0);
    const rate   = Number(item.unitPrice ?? 0);
    const amount = Number(item.amount ?? qty * rate);
    return `
      <tr>
        <td style="border:1px solid #000;padding:5px 6px;">${esc(item.colour || item.description || "")}</td>
        <td style="border:1px solid #000;padding:5px 6px;">${esc(item.colour || item.description || "")}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:center;">${item.thickness ? `${item.thickness}` : ""}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:center;">${item.noOfSlabs != null ? item.noOfSlabs : ""}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:center;">${HSN_CODE}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:center;">Square Foot</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:right;">${qty.toFixed(2)}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:right;">${rate.toFixed(2)}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:right;">${amount.toFixed(2)}</td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    color: #000;
    background: #fff;
    padding: 10px 14px;
  }
  table { border-collapse: collapse; width: 100%; }
  td, th { font-size: 11px; vertical-align: top; }
</style>
</head>
<body>

<!-- ══ MASTER OUTER BORDER ═══════════════════════════════════════════════════ -->
<div style="border:1px solid #000;">

  <!-- ══ SECTION 1 — Title ══════════════════════════════════════════════════ -->
  <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #000;">
    <tr>
      <td style="width:30%;padding:6px 10px;"></td>
      <td style="width:40%;text-align:center;font-size:16px;font-weight:bold;letter-spacing:1px;padding:6px 10px;">PROFORMA INVOICE</td>
      <td style="width:30%;padding:6px 10px;"></td>
    </tr>
  </table>

  <!-- ══ SECTION 2 — Main info: left 48% | right 52% ════════════════════════ -->
  <table style="width:100%;border-collapse:collapse;">
    <tr>

      <!-- LEFT COLUMN -->
      <td style="width:48%;border-right:1px solid #000;padding:0;vertical-align:top;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #000;">
              <div style="font-weight:bold;">Exporter :</div>
              <div style="font-weight:bold;">${esc(COMPANY_NAME)}</div>
              <div>${esc(COMPANY_ADDR)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #000;min-height:90px;">
              <div style="font-weight:bold;">Consignee :</div>
              <div>${consigneeDetails}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 10px;min-height:80px;">
              <div style="font-weight:bold;">Notify Party :</div>
              <div>${notifyPartyDetails}</div>
            </td>
          </tr>
        </table>
      </td>

      <!-- RIGHT COLUMN -->
      <td style="width:52%;padding:0;vertical-align:top;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #000;border-right:1px solid #000;width:50%;">
              <span style="font-weight:bold;">Invoice No:</span> ${esc(pi.piNumber)}
            </td>
            <td style="padding:6px 10px;border-bottom:1px solid #000;width:50%;">
              <span style="font-weight:bold;">Invoice Date :</span> ${esc(piDate)}
            </td>
          </tr>
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #000;border-right:1px solid #000;">
              <span style="font-weight:bold;">Buyer's PO No:</span> ${esc(pi.buyerPoNo || "")}
            </td>
            <td style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">Delivery Date :</span> ${esc(deliveryDate)}
            </td>
          </tr>
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #000;border-right:1px solid #000;">
              <span style="font-weight:bold;">RBI Code No.:</span> ${RBI_CODE}
            </td>
            <td style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">GSTIN NO:</span> ${COMPANY_GSTIN}
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">Jurisdictional Central Excise Division Office Address:</span>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding:6px 10px;border-bottom:1px solid #000;">
              ${esc(CUSTOMS_ADDR)}
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">Buyer if Not Consignee:</span> ${buyerIfNotConsignee}
            </td>
          </tr>
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #000;border-right:1px solid #000;">
              <span style="font-weight:bold;">Country of Origin of goods:</span> India
            </td>
            <td style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">Country of Final Destination:</span> ${country}
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">Terms &amp; Conditions:</span>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding:6px 10px;">
              <span style="font-weight:bold;">Delivery Terms:</span> ${deliveryTerms}
            </td>
          </tr>
        </table>
      </td>

    </tr>
  </table>

  <!-- ══ SECTION 3 — Routing ════════════════════════════════════════════════ -->
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;width:25%;font-weight:bold;">Pre-Carriage By :</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;width:25%;">By Road</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;width:25%;font-weight:bold;">Place of Receipt By Pre-Carrier:</td>
      <td style="border-bottom:1px solid #000;padding:6px 10px;width:25%;">${placeOfReceipt}</td>
    </tr>
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;font-weight:bold;">Vessel/Flight No:</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;"></td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;font-weight:bold;">Port of Loading:</td>
      <td style="border-bottom:1px solid #000;padding:6px 10px;">${portOfLoading}</td>
    </tr>
    <tr>
      <td style="border-right:1px solid #000;padding:6px 10px;font-weight:bold;">Port of Discharge:</td>
      <td style="border-right:1px solid #000;padding:6px 10px;">${portOfDischarge}</td>
      <td style="border-right:1px solid #000;padding:6px 10px;font-weight:bold;">Final Destination:</td>
      <td style="padding:6px 10px;">${finalDestination}</td>
    </tr>
  </table>

  <!-- ══ SECTION 4 — Payment & Bank ════════════════════════════════════════ -->
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #000;">
        <span style="font-weight:bold;">Payment Terms:</span> ${paymentTerms}
      </td>
    </tr>
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #000;">
        <span style="font-weight:bold;">Our Bank Details:</span> ${esc(BANK_DETAILS)}
      </td>
    </tr>
    <tr>
      <td style="padding:6px 10px;">
        <span style="font-weight:bold;">Routing Bank:</span> ${esc(ROUTING_BANK)}
      </td>
    </tr>
  </table>

  <!-- ══ SECTION 5 — Items table ═══════════════════════════════════════════ -->
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">
    <thead>
      <tr>
        <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:14%;font-weight:bold;">Item Code</th>
        <th colspan="3" style="border:1px solid #000;padding:5px 6px;text-align:center;width:27%;font-weight:bold;">Description of goods</th>
        <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:9%;font-weight:bold;">HSN/SAC</th>
        <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:10%;font-weight:bold;">Unit</th>
        <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:9%;font-weight:bold;">Quantity</th>
        <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:10%;font-weight:bold;">Rate In USD unit</th>
        <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:11%;font-weight:bold;">Total Amount in USD</th>
      </tr>
      <tr>
        <th style="border:1px solid #000;padding:4px 6px;"></th>
        <th style="border:1px solid #000;padding:4px 6px;text-align:center;font-weight:bold;width:10%;">Color</th>
        <th style="border:1px solid #000;padding:4px 6px;text-align:center;font-weight:bold;width:9%;">Thick</th>
        <th style="border:1px solid #000;padding:4px 6px;text-align:center;font-weight:bold;width:9%;">No of Slabs</th>
        <th style="border:1px solid #000;padding:4px 6px;"></th>
        <th style="border:1px solid #000;padding:4px 6px;"></th>
        <th style="border:1px solid #000;padding:4px 6px;"></th>
        <th style="border:1px solid #000;padding:4px 6px;"></th>
        <th style="border:1px solid #000;padding:4px 6px;"></th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      <tr style="font-weight:bold;">
        <td style="border:1px solid #000;padding:5px 6px;"></td>
        <td colspan="2" style="border:1px solid #000;padding:5px 6px;text-align:center;">Total</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:center;">${totalSlabs}</td>
        <td style="border:1px solid #000;padding:5px 6px;"></td>
        <td style="border:1px solid #000;padding:5px 6px;"></td>
        <td style="border:1px solid #000;padding:5px 6px;"></td>
        <td style="border:1px solid #000;padding:5px 6px;"></td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:right;">${totalAmt.toFixed(2)}</td>
      </tr>
    </tbody>
  </table>

  <!-- ══ SECTION 6 — Total amount line ════════════════════════════════════ -->
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">
    <tr>
      <td style="padding:6px 10px;">
        <span style="font-weight:bold;">Total Amount : ${totalAmt.toFixed(2)}</span>
        &nbsp;&nbsp;&nbsp;&nbsp;
        <span style="font-weight:bold;">IN WORDS :</span> ${esc(amountWords)}
      </td>
    </tr>
  </table>

  <!-- ══ SECTION 7 — Footer ════════════════════════════════════════════════ -->
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">
    <tr>
      <td style="width:60%;border-right:1px solid #000;padding:0;vertical-align:top;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">Gross Wt :</span> ${esc(grossWt)}
              &nbsp;&nbsp;&nbsp;
              <span style="font-weight:bold;">Net Wt :</span> ${esc(netWt)}
            </td>
          </tr>
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">DISCOUNT AMOUNT :</span> 0
            </td>
          </tr>
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #000;font-style:italic;">
              Declaration:<br>
              We certify that the above goods are of Indian Origin and we also declare that this invoice shows the actual price of the Goods dispatched that all particulars are true and correct.
            </td>
          </tr>
          <tr>
            <td style="padding:8px 10px;text-align:center;">
              <div style="font-weight:bold;">Accept By Customer</div>
              <div style="border-top:1px solid #000;margin-top:40px;padding-top:4px;">Customer Signatory</div>
            </td>
          </tr>
        </table>
      </td>
      <td style="width:40%;padding:8px 10px;vertical-align:top;text-align:center;">
        <div style="font-weight:bold;">For Pacific Engineered Surfaces Private Limited</div>
        <div style="height:60px;"></div>
        <div style="border-top:1px solid #000;margin-top:20px;padding-top:4px;">Authorised Signatory &amp; Stamp</div>
      </td>
    </tr>
  </table>

</div><!-- end master outer border -->

</body>
</html>`;
}

export async function generatePIPdf(piId: string): Promise<Buffer> {
  const pi = await db.proformaInvoice.findUnique({
    where:   { id: piId },
    // NOTE: spId carries no Prisma relation — the fork's `include: { sp }`
    // threw PrismaClientValidationError (and buildHtml never reads pi.sp).
    include: { client: true },
  });
  if (!pi) throw new Error("PI not found");
  return htmlToPdf(buildHtml(pi));
}
