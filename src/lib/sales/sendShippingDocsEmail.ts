/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Shared shipping docs email sender.
 * Called from the API route (the "Send Shipping Docs" button) and from
 * /doc-upload once the last of the three PDFs lands (auto-trigger, which passes
 * onlyIfUnsent so it can never re-mail an order a human already mailed).
 * Every caller goes through the claim below — see the comment there.
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

export async function sendShippingDocsEmail(
  orderId: string,
  triggeredByUserId?: string,
  opts?: { onlyIfUnsent?: boolean },
): Promise<{ sentTo: string }> {
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

  // Decode the base64 PDFs BEFORE composing the body: the "Documents Attached"
  // list below is built from these buffers, not from what the screen believed
  // was uploaded. An export customer once received this mail listing a Bill of
  // Lading that was never attached — the PDFs were still sitting in browser
  // state and the body listed the BL unconditionally. Whatever is not decoded
  // here is not listed, and a missing BL stops the mail outright: this is the
  // BL-release mail, the buyer's bank needs the document, and a BL No. typed
  // into a form is not the document.
  const blDocBuf       = base64ToBuffer(ship?.blDocUrl);
  const fumigationBuf  = base64ToBuffer(ship?.fumigationCertUrl);
  const bankDetailsBuf = base64ToBuffer(ship?.bankDetailsUrl);
  if (!blDocBuf) throw new Error("The BL PDF must be uploaded before sending the shipping docs email — save the shipping docs first");

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

  // Numbered from what is actually attached, so the list can never run ahead of
  // the attachments (see the decode block above).
  const docList = [
    "Commercial Invoice + Packing List + Measurement List (Combined PDF)",
    blDocBuf       ? "Bill of Lading"          : null,
    fumigationBuf  ? "Fumigation Certificate"  : null,
    bankDetailsBuf ? "Bank / Account Details"  : null,
  ].filter(Boolean).map((label, i) => `${i + 1}. ${label}`).join("<br>");

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

  const attachments: any[] = [
    { filename: `${invoiceNo}_Shipment_Documents.pdf`, content: pdfBuf, contentType: "application/pdf" },
  ];
  if (blDocBuf)       attachments.push({ filename: "Bill_of_Lading.pdf",        content: blDocBuf,       contentType: "application/pdf" });
  if (fumigationBuf)  attachments.push({ filename: "Fumigation_Certificate.pdf", content: fumigationBuf,  contentType: "application/pdf" });
  if (bankDetailsBuf) attachments.push({ filename: "Bank_Account_Details.pdf",   content: bankDetailsBuf, contentType: "application/pdf" });

  const toEmail = order.client.email;
  const cc      = await getCCList(order.spId, order.clientId).catch(() => [] as string[]);

  // CLAIM THE SEND BEFORE MAILING, never after. Three call sites used to reach
  // this function for the same order — the shipping PATCH auto-trigger, the
  // doc-upload auto-trigger and the "Send Shipping Docs" button — and because
  // the sent stamp was only written at the very end, a button click landing
  // while a background trigger was still building the combined PDF mailed the
  // customer twice. The compare-and-swap below is the interlock: only the
  // caller that flips the stamp from the value it read mails anything.
  // Swapping on the PREVIOUS value rather than on null is what keeps a
  // deliberate re-send possible — a corrected set of documents after the first
  // mail went out with the wrong BL still has to be sendable from the button.
  const prevSentAt = ship.shippingDocsMailSentAt ?? null;
  const prevT15    = ship.t15MailSentAt ?? null;
  if (opts?.onlyIfUnsent && prevSentAt) {
    throw new Error("Shipping docs email already sent for this order");
  }
  const claimedAt = new Date();
  const claim = await db.salesShipmentDocs.updateMany({
    where: { orderId, shippingDocsMailSentAt: prevSentAt },
    data:  { shippingDocsMailSentAt: claimedAt, t15MailSentAt: claimedAt },
  });
  if (claim.count === 0) {
    throw new Error("Shipping docs email is already being sent for this order");
  }

  try {
    await sendMail({
      spId:    order.spId,
      to:      toEmail,
      cc,
      subject: await resolveSubject("shipping_docs_subject", { invoiceNo }),
      html,
      attachments,
    });
  } catch (e) {
    // A claim that outlives a FAILED send would mark the order as mailed and
    // hide a customer who never got their documents. Give the row back exactly
    // as it was found, and only while our own claim still stands.
    await db.salesShipmentDocs.updateMany({
      where: { orderId, shippingDocsMailSentAt: claimedAt },
      data:  { shippingDocsMailSentAt: prevSentAt, t15MailSentAt: prevT15 },
    }).catch(() => {});
    throw e;
  }

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
