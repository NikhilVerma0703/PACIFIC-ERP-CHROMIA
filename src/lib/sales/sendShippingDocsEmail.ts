/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared shipping docs email sender.
 * Called from the API route (manual) and from shipping PATCH (auto-trigger).
 */
import { prisma } from "@/lib/prisma";
import { getCCList } from "@/lib/sales/mailHelpers";
import { sendMail } from "@/lib/sales/mailer";
import { generateCombinedShipmentPdf } from "@/lib/sales/pdf/combinedShipmentPdf";
import { resolveSubject } from "@/lib/sales/mailSubjects";

const db = prisma as any;

function base64ToBuffer(dataUri: string | null | undefined): Buffer | null {
  if (!dataUri || !dataUri.startsWith("data:")) return null;
  const base64Part = dataUri.split(",")[1];
  if (!base64Part) return null;
  return Buffer.from(base64Part, "base64");
}

export async function sendShippingDocsEmail(orderId: string, triggeredByUserId?: string): Promise<{ sentTo: string }> {
  const order = await db.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      client:           true,
      proformaInvoices: {
        where:   { status: "ACCEPTED" },
        take:    1,
        orderBy: { acceptedAt: "desc" },
      },
      shipmentDocs:     true,
      paymentDivisions: { orderBy: { type: "asc" } },
    },
  });
  if (!order) throw new Error("Order not found");

  const pi   = order.proformaInvoices?.[0];
  const ship = order.shipmentDocs;

  if (!ship?.blNo) throw new Error("BL No. must be set before sending shipping docs email");

  // Build combined PDF
  const pdfBuf    = await generateCombinedShipmentPdf(orderId);
  const invoiceNo = order.invoiceNumber || order.orderNumber;

  // Resolve payment due date
  const cadDiv = order.paymentDivisions?.find((d: any) => d.type === "CAD");
  const paymentDueDate = ship?.paymentDueDate
    ? new Date(ship.paymentDueDate)
    : cadDiv?.dueDate
      ? new Date(cadDiv.dueDate)
      : null;

  const fmt     = (v: any) => v || "---";
  const fmtDate = (d: any) =>
    d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "---";

  const tableRows = [
    ["Shipper",            "Pacific Engineered Surfaces Pvt. Ltd."],
    ["Invoice No.",        `<strong>${fmt(invoiceNo)}</strong>`],
    ["Dated",              fmtDate(new Date())],
    ["Buyer's PO Ref",     fmt(pi?.buyerPoNo || pi?.piNumber)],
    ["Consignee",          fmt(pi?.consigneeDetails || order.client.name)],
    ["Notify Party",       fmt(pi?.notifyPartyDetails)],
    ["Container No.",      fmt(ship?.containerNo)],
    ["Invoice Value",      `${order.currency || "USD"} ${Number(order.totalAmount || pi?.totalAmount || 0).toFixed(2)}`],
    ["BL No. / Date",      `${fmt(ship?.blNo)} / ${fmtDate(ship?.blDate)}`],
    ["Payment Terms",      fmt(pi?.paymentTermsSummary)],
    ["Payment Due Date",   fmtDate(paymentDueDate)],
    ["ETA",                fmtDate(ship?.etaDate)],
  ].map(([label, val]) => `
    <tr>
      <td style="padding:6px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;white-space:nowrap;color:#374151">${label}</td>
      <td style="padding:6px 12px;border:1px solid #e2e8f0;color:#111827">${val}</td>
    </tr>`).join("");

  const hasFumigation = !!(ship?.fumigationCertUrl && (ship.fumigationCertUrl as string).startsWith("data:"));
  const hasBankDetails = !!(ship?.bankDetailsUrl && (ship.bankDetailsUrl as string).startsWith("data:"));

  const docList = [
    "1. Commercial Invoice + Packing List + Measurement List (Combined PDF)",
    "2. Bill of Lading",
    hasFumigation  ? "3. Fumigation Certificate" : null,
    hasBankDetails ? `${hasFumigation ? "4" : "3"}. Bank / Account Details` : null,
  ].filter(Boolean).join("<br>");

  const html = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:700px;margin:0 auto">
<p style="font-size:14px">Dear ${order.client.contactPerson || order.client.name},</p>
<p style="font-size:14px">
  Greetings from <strong>Pacific Engineered Surfaces Pvt. Ltd.</strong><br>
  Please find attached the shipping documents for your shipment. Kindly arrange payment as per the terms agreed.
</p>

<table style="border-collapse:collapse;width:100%;margin:16px 0">
  <tbody>${tableRows}</tbody>
</table>

<p style="font-size:13px;color:#374151">
  <strong>Documents Attached:</strong><br>
  ${docList}
</p>

<p style="font-size:13px;margin-top:24px">
  Thanks &amp; Regards,<br>
  <strong>Commercial Team</strong><br>
  Pacific Engineered Surfaces Pvt. Ltd.
</p>
</body></html>`;

  // Decode base64 PDFs
  const blDocBuf       = base64ToBuffer(ship?.blDocUrl);
  const fumigationBuf  = base64ToBuffer(ship?.fumigationCertUrl);
  const bankDetailsBuf = base64ToBuffer(ship?.bankDetailsUrl);

  const attachments: any[] = [
    { filename: `${invoiceNo}_Shipment_Documents.pdf`, content: pdfBuf, contentType: "application/pdf" },
  ];
  if (blDocBuf)       attachments.push({ filename: "Bill_of_Lading.pdf",        content: blDocBuf,       contentType: "application/pdf" });
  if (fumigationBuf)  attachments.push({ filename: "Fumigation_Certificate.pdf", content: fumigationBuf,  contentType: "application/pdf" });
  if (bankDetailsBuf) attachments.push({ filename: "Bank_Account_Details.pdf",   content: bankDetailsBuf, contentType: "application/pdf" });

  const toEmail = order.client.email;
  const cc      = await getCCList(order.spId, order.clientId).catch(() => [] as string[]);
  await sendMail({
    spId:    order.spId,
    to:      toEmail,
    cc,
    subject: await resolveSubject("shipping_docs_subject", { invoiceNo }),
    html,
    attachments,
  });

  // Mark sent
  await db.salesShipmentDocs.update({
    where: { orderId },
    data:  { shippingDocsMailSentAt: new Date(), t15MailSentAt: new Date() },
  });

  await db.salesOrderLog.create({
    data: {
      orderId,
      userId: triggeredByUserId ?? null,
      action: "SHIPPING_DOCS_EMAIL_SENT",
      note:   `Shipping docs email sent to ${toEmail}`,
    },
  });

  return { sentTo: toEmail };
}
