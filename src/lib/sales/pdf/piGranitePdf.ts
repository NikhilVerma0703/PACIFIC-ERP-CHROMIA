/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Proforma Invoice — Pacific Granites (India) Pvt. Ltd.
 * Rendered via Puppeteer (headless Chrome) for pixel-perfect HTML/CSS output.
 * Layout matches PI-PG reference format exactly (PI-PG 7489).
 */
import { prisma } from "@/lib/prisma";
import { getSp } from "../spLookup";
import { htmlToPdf } from "./puppeteerPdf";
import { amountToWords } from "./common";

const db = prisma as any;

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
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dd   = String(dt.getDate()).padStart(2, "0");
  const mmm  = months[dt.getMonth()];
  const yyyy = dt.getFullYear();
  return `${dd} ${mmm} ${yyyy}`;
}

function buildHtml(pi: any): string {
  const items: any[] = Array.isArray(pi.items) ? pi.items : [];
  const total = Number(pi.totalAmount || 0);

  const piDate  = fmtDate(pi.createdAt);
  const country = pi.countryOfDestination || pi.client?.country || "";

  const totalSqm   = items.reduce((s: number, i: any) => s + Number(i.sqm ?? i.sqft ?? 0), 0);
  const totalSlabs = items.reduce((s: number, i: any) => s + Number(i.noOfSlabs ?? 0), 0);

  // Columns: Item Code | Colour | Thick | No. of Slabs | HSN/SAC | Unit | Quantity | Rate In USD | Amount in USD
  const itemRows = items.map((item: any) => {
    const qty    = Number(item.sqm ?? item.sqft ?? 0);
    const rate   = Number(item.unitPrice ?? 0);
    const amount = Number(item.amount ?? qty * rate);
    const hsn    = esc(item.hsnCode ?? item.hsn ?? item.hsnSac ?? "");
    const unit   = item.unit ?? (item.sqm != null ? "SQM" : "SQFT");
    const thick  = item.thickness ? `${item.thickness}mm` : "";
    return `
      <tr>
        <td style="border:1px solid #000;padding:5px 6px;">${esc(item.marksNo ?? item.itemCode ?? "")}</td>
        <td style="border:1px solid #000;padding:5px 6px;">${esc(item.colour)}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:center;">${thick}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:center;">${item.noOfSlabs ?? ""}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:center;">${hsn}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:center;">${esc(unit)}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:right;">${qty.toFixed(3)}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:right;">$ ${rate.toFixed(3)}</td>
        <td style="border:1px solid #000;padding:5px 6px;text-align:right;">$ ${amount.toFixed(2)}</td>
      </tr>`;
  }).join("");

  const wordsText = amountToWords(total, "USD");
  const clientName = pi.client?.name || "";

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
  }
  table { border-collapse: collapse; width: 100%; }
  td, th { font-size: 11px; vertical-align: top; }
</style>
</head>
<body style="padding:10px 14px;">

<!-- ══ MASTER OUTER BORDER — wraps all sections including title ═══════ -->
<div style="border:1px solid #000;">

  <!-- ══ SECTION 1 — Title row (inside master border) ═══════════════════ -->
  <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #000;">
    <tr>
      <td style="width:30%;padding:6px 10px;"></td>
      <td style="width:40%;text-align:center;font-size:15px;font-weight:bold;letter-spacing:1px;padding:6px 10px;">Proforma invoice</td>
      <td style="width:30%;text-align:right;font-weight:bold;font-size:11px;padding:6px 10px;">100% EOU</td>
    </tr>
  </table>

  <!-- ══ SECTION 2 — Main info: left 42% | right 58% ═══════════════════ -->
  <table style="width:100%;border-collapse:collapse;">
    <tr>

      <!-- LEFT COLUMN ~42% -->
      <td style="width:42%;border-right:1px solid #000;padding:0;vertical-align:top;">
        <table style="width:100%;border-collapse:collapse;">

          <!-- Block 1: Exporter -->
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #000;">
              <div style="font-weight:bold;">Exporter:</div>
              <div style="font-weight:bold;">Pacific Granites (India) Pvt. Ltd.</div>
              <div>Konerupalli Union, ShoolagiriBlock, Krishnagiri Dist.</div>
              <div>Hosur, Tamilnadu 635117</div>
              <div>P: 434-429-4054/984-516-4342</div>
              <div style="color:#1a56db;">www.pacificgranitesindia.com</div>
            </td>
          </tr>

          <!-- Block 2: Consignee -->
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #000;min-height:110px;">
              <div style="font-weight:bold;">Consignee:</div>
              <div>${esc(pi.consigneeDetails || "")}</div>
            </td>
          </tr>

          <!-- Block 3: Notify Party (no border-bottom — last block) -->
          <tr>
            <td style="padding:8px 10px;min-height:80px;">
              <div style="font-weight:bold;">Notify Party:</div>
              <div>${esc(pi.notifyPartyDetails || "")}</div>
            </td>
          </tr>

        </table>
      </td>

      <!-- RIGHT COLUMN ~58% -->
      <td style="width:58%;padding:0;vertical-align:top;">
        <table style="width:100%;border-collapse:collapse;">

          <!-- Row 1: PI number | Dated -->
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #000;border-right:1px solid #000;width:50%;font-weight:bold;">
              PI - ${esc(pi.piNumber)}
            </td>
            <td style="padding:6px 10px;border-bottom:1px solid #000;width:50%;font-weight:bold;">
              Dated: &nbsp;${esc(piDate)}
            </td>
          </tr>

          <!-- Row 2: Buyer PO Ref | blank -->
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #000;border-right:1px solid #000;">
              <span style="font-weight:bold;">Buyer's PO Ref:</span>&nbsp;&nbsp;${esc(pi.buyerPoNo || "")}
            </td>
            <td style="padding:6px 10px;border-bottom:1px solid #000;"></td>
          </tr>

          <!-- Row 3: spacer -->
          <tr>
            <td colspan="2" style="border-bottom:1px solid #000;height:14px;"></td>
          </tr>

          <!-- Row 4: IEC Code -->
          <tr>
            <td colspan="2" style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">IEC Code No:</span>&nbsp;&nbsp;3811000012
            </td>
          </tr>

          <!-- Row 5: spacer -->
          <tr>
            <td colspan="2" style="border-bottom:1px solid #000;height:12px;"></td>
          </tr>

          <!-- Row 6: Sales Person -->
          <tr>
            <td colspan="2" style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">Sales Person Code.:</span>&nbsp;&nbsp;${esc(pi.sp?.name || "")}
            </td>
          </tr>

          <!-- Row 7: GST -->
          <tr>
            <td colspan="2" style="padding:6px 10px;border-bottom:1px solid #000;">
              <span style="font-weight:bold;">Our GST No:</span>&nbsp;&nbsp;33AAFCP5374A1ZQ
            </td>
          </tr>

          <!-- Row 8+9: Customs (merged, no line between them) -->
          <tr>
            <td colspan="2" style="padding:6px 10px;border-bottom:1px solid #000;">
              OFFICE OF THE ASSISTANT COMMISSIONER OF CUSTOMS
              CUSTOMS PREVENTIVE UNIT, ROOM NO.32 &amp; 33, PHASE2, 3rd FLOOR, NO.6/7, A.T.D. STREET, RACE COURSE ROAD, COIMBATORE-641018.
            </td>
          </tr>

          <!-- Row 10: Buyer if Not Consignee (no border-bottom — last row) -->
          <tr>
            <td colspan="2" style="padding:6px 10px;">
              <span style="font-weight:bold;">Buyer if Not Consignee:</span>&nbsp;&nbsp;${esc(pi.buyerIfNotConsignee || "")}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

  <!-- ══ SECTION 3 — Routing + Country (border-top closes prev section) ═ -->
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">

    <!-- Header row 1 -->
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;width:20%;font-weight:bold;">Pre-Carriage By</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;width:30%;font-weight:bold;">Place of Receipt By Pre-Carrier</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;width:25%;font-weight:bold;">Country of Origin of Goods</td>
      <td style="border-bottom:1px solid #000;padding:6px 10px;width:25%;font-weight:bold;">Country of Final Destination</td>
    </tr>

    <!-- Values row 1 -->
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;">By Road</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;">${esc(pi.placeOfReceipt || "")}</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;">India</td>
      <td style="border-bottom:1px solid #000;padding:6px 10px;">${esc(country)}</td>
    </tr>

    <!-- Label row 2 -->
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;font-weight:bold;">Vessel/Flight Number</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;font-weight:bold;">Port of Loading</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;font-weight:bold;">Delivery Terms:</td>
      <td style="border-bottom:1px solid #000;padding:6px 10px;">${esc(pi.deliveryTerms || "")}</td>
    </tr>

    <!-- Values row 2 -->
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;min-height:22px;"></td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;">${esc(pi.portOfLoading || "")}</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;font-weight:bold;">Payment Terms:</td>
      <td style="border-bottom:1px solid #000;padding:6px 10px;">${esc(pi.paymentTermsSummary || "")}</td>
    </tr>

    <!-- Label row 3 -->
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;font-weight:bold;">Port of Discharge</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;font-weight:bold;">Final Destination</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 10px;"></td>
      <td style="border-bottom:1px solid #000;padding:6px 10px;"></td>
    </tr>

    <!-- Values row 3 -->
    <tr>
      <td style="border-right:1px solid #000;padding:6px 10px;">${esc(pi.portOfDischarge || "")}</td>
      <td style="border-right:1px solid #000;padding:6px 10px;">${esc(pi.finalDestination || "")}</td>
      <td style="border-right:1px solid #000;padding:6px 10px;"></td>
      <td style="padding:6px 10px;"></td>
    </tr>

  </table>

  <!-- ══ SECTION 4 — Items table ════════════════════════════════════════ -->
  <!-- Columns: Item Code | Colour | Thick | No. of Slabs | HSN/SAC | Unit | Quantity | Rate In USD | Amount in USD -->
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">

    <tr>
      <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:10%;font-weight:bold;">Item Code</th>
      <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:16%;font-weight:bold;">Colour</th>
      <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:8%;font-weight:bold;">Thick</th>
      <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:10%;font-weight:bold;">No. of Slabs</th>
      <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:12%;font-weight:bold;">HSN/SAC</th>
      <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:7%;font-weight:bold;">Unit</th>
      <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:12%;font-weight:bold;">Quantity</th>
      <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:13%;font-weight:bold;">Rate In USD/Unit</th>
      <th style="border:1px solid #000;padding:5px 6px;text-align:center;width:12%;font-weight:bold;">Amount in USD</th>
    </tr>

    <!-- Item data rows -->
    ${itemRows}

    <!-- Total row -->
    <tr style="font-weight:bold;">
      <td style="border:1px solid #000;padding:5px 6px;"></td>
      <td style="border:1px solid #000;padding:5px 6px;text-align:center;">Total</td>
      <td style="border:1px solid #000;padding:5px 6px;"></td>
      <td style="border:1px solid #000;padding:5px 6px;text-align:center;">${totalSlabs}</td>
      <td style="border:1px solid #000;padding:5px 6px;"></td>
      <td style="border:1px solid #000;padding:5px 6px;"></td>
      <td style="border:1px solid #000;padding:5px 6px;text-align:right;">${totalSqm.toFixed(3)}</td>
      <td style="border:1px solid #000;padding:5px 6px;"></td>
      <td style="border:1px solid #000;padding:5px 6px;text-align:right;">$ ${total.toFixed(2)}</td>
    </tr>

  </table>

  <!-- ══ SECTION 5 — Bank + Tax ══════════════════════════════════════════ -->
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">
    <tr>

      <!-- Left: bank details (60%) -->
      <td style="width:60%;border-right:1px solid #000;padding:8px 10px;vertical-align:top;">
        <div style="font-weight:bold;margin-bottom:4px;">Our Bank Details</div>
        <div style="font-weight:bold;">Kotak Mahindra Bank Limited</div>
        <div>10/7, Umiya Landmark,Lavelle Road,</div>
        <div>Next to Chancry Hotel, Bangalore 560001</div>
        <div>Karnataka, India AD Code:0180038 8400009</div>
        <div style="margin-top:2px;">Account No. 8711541164 Swift Code - KKBKINBBXXX</div>
        <div style="margin-top:2px;">Routing Bank: The Bank of Newyork Mellon, No.1, Wall St. Newyork, NY 10015 Swift Code- - IRVTUS3NXXX</div>
      </td>

      <!-- Right: tax table (40%) -->
      <td style="width:40%;padding:0;vertical-align:top;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="border-bottom:1px solid #000;border-right:1px solid #000;padding:6px 8px;">Tax</td>
            <td style="border-bottom:1px solid #000;border-right:1px solid #000;padding:6px 8px;">Tax 0%-Tax 0% 0%</td>
            <td style="border-bottom:1px solid #000;padding:6px 8px;">$0</td>
          </tr>
          <tr>
            <td style="border-right:1px solid #000;padding:6px 8px;font-weight:bold;">Total</td>
            <td style="border-right:1px solid #000;padding:6px 8px;"></td>
            <td style="padding:6px 8px;font-weight:bold;">$${total.toFixed(2)}</td>
          </tr>
        </table>
      </td>

    </tr>
  </table>

  <!-- ══ SECTION 6 — Amount in words ════════════════════════════════════ -->
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">
    <tr>
      <td style="padding:8px 10px;">
        <div style="font-weight:bold;">Amount Chargeable (In Words):</div>
        <div>(IN USD's)</div>
        <div>${esc(wordsText)}</div>
      </td>
    </tr>
  </table>

  <!-- ══ SECTION 7 — Declaration + Signatures ════════════════════════════ -->
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">
    <tr>

      <!-- Left half (50%) -->
      <td style="width:50%;border-right:1px solid #000;padding:8px 10px;vertical-align:top;">
        <div style="font-weight:bold;margin-bottom:4px;">Declaration:</div>
        <div style="margin-bottom:16px;">
          We declare that the invoice shows the actual price of the goods described and that all particulars are true and correct
        </div>
        <div style="height:30px;"></div>
        <div style="margin-bottom:2px;">Accepted By Customer</div>
        <div>For ${esc(clientName)}</div>
        <div style="border-top:1px solid #000;margin-top:40px;padding-top:2px;"></div>
      </td>

      <!-- Right half (50%) -->
      <td style="width:50%;padding:8px 10px;vertical-align:top;">
        <div style="font-weight:bold;margin-bottom:4px;">For Pacific Granites (India) Pvt. Ltd.</div>
        <div style="height:60px;"></div>
        <div style="border-top:1px solid #000;margin-top:20px;padding-top:2px;text-align:center;">
          (Authorised Singature)
        </div>
      </td>

    </tr>
  </table>

</div><!-- end master outer border -->

</body>
</html>`;
}

export async function generateGranitePiPdf(piId: string): Promise<Buffer> {
  const pi = await db.proformaInvoice.findUnique({
    where:   { id: piId },
    include: { client: true },
  });
  if (!pi) throw new Error("PI not found");
  // spId carries no Prisma relation (no hard FK) — `include: { sp }` throws
  // PrismaClientValidationError. Stitch the salesperson in via spLookup.
  pi.sp = await getSp(pi.spId);

  const html = buildHtml(pi);
  return htmlToPdf(html);
}
