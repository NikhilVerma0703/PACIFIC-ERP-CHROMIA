/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/sales/orders/[id]/dispatch-email
 * Sends the Dispatch / Stuffing email:
 *   - Combined PDF (Invoice + Packing List + Measurement List) as attachment
 *   - Table summary of the shipment
 *   - Up to N stuffing photos embedded in email
 * Uses the commercial/docs SMTP (falls back to SP SMTP).
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCCList } from "@/lib/sales/mailHelpers";
import { sendMail } from "@/lib/sales/mailer";
import { generateCombinedShipmentPdf } from "@/lib/sales/pdf/combinedShipmentPdf";
import { resolveSubject } from "@/lib/sales/mailSubjects";

const db = prisma as any;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const order = await db.salesOrder.findUnique({
    where: { id },
    include: {
      client: true,
      sp: { select: { id: true, name: true, email: true } },
      proformaInvoices: {
        where: { status: "ACCEPTED" },
        take: 1,
        orderBy: { acceptedAt: "desc" },
      },
      shipmentDocs: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const pi   = order.proformaInvoices?.[0];
  const ship = order.shipmentDocs;

  // ── Build combined PDF ────────────────────────────────────────────────────
  const pdfBuf = await generateCombinedShipmentPdf(id);
  const invoiceNo = order.invoiceNumber || order.orderNumber;

  // ── Build email HTML ──────────────────────────────────────────────────────
  const fmt = (v: any) => v || "---";
  const fmtDate = (d: any) =>
    d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "---";

  const tableRows = [
    ["SHIPPER",                C_val("Pacific Engineered Surfaces Pvt. Ltd.")],
    ["Invoice No.",            `<strong style='color:#0d9488'>${fmt(invoiceNo)}</strong>`],
    ["Dated",                  fmtDate(new Date())],
    ["PO / PI Ref",            fmt(pi?.buyerPoNo || pi?.piNumber)],
    ["Container No.",          fmt(ship?.containerNo)],
    ["Material / Color Name",  pi?.items && Array.isArray(pi.items) ? (pi.items as any[]).map((i: any) => i.colour || i.description).join(", ") : "---"],
    ["Quantity (SQFT)",        pi?.items && Array.isArray(pi.items) ? (pi.items as any[]).reduce((s: number, i: any) => s + Number(i.sqft ?? i.sqFt ?? 0), 0).toFixed(3) + " SQFT" : "---"],
    ["Consignee Name",         fmt(pi?.consigneeDetails || order.client.name)],
    ["Notify Party",           fmt(pi?.notifyPartyDetails)],
    ["Buyer (if not Consignee)", fmt(pi?.buyerIfNotConsignee)],
    ["Invoice Value",          `${order.currency || "USD"} ${Number(order.totalAmount || pi?.totalAmount || 0).toFixed(2)}`],
  ].map(([label, val]) => `
    <tr>
      <td style="padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap;vertical-align:top">${label}</td>
      <td style="padding:6px 0">${val}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:680px;margin:0 auto;padding:20px">
<p>Dear ${order.client.contactPerson || order.client.name},</p>
<p>Please find below the dispatch details for your shipment. The Commercial Invoice, Packing List, and Detailed Measurement List are attached as a combined PDF.</p>
<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
  <tbody>${tableRows}</tbody>
</table>
<p>Container and stuffing photos are attached for your reference. Kindly acknowledge receipt of this email.</p>
<p style="margin-top:24px">Regards,<br><strong>Export &amp; Import Operations</strong><br>docs@pacific-surfaces.com</p>
<p style="margin-top:16px;font-size:12px;color:#555;border-top:1px solid #ddd;padding-top:12px">Pacific Engineered Surfaces Pvt. Ltd.<br>Tel: +91-7830008181 | Email: sales@pacific-surfaces.com</p>
</body></html>`;

  // ── Gather stuffing photo attachments (base64 data URLs → nodemailer buffers) ─
  const photos: any[] = Array.isArray(ship?.stuffingPhotos) ? ship.stuffingPhotos : [];
  const photoAttachments: any[] = photos
    .filter((p: any) => typeof p?.url === "string" && p.url.startsWith("data:"))
    .map((p: any, i: number) => {
      const [meta, b64] = (p.url as string).split(",");
      const contentType = meta.match(/:(.*?);/)?.[1] ?? "image/jpeg";
      const ext = contentType.split("/")[1] ?? "jpg";
      return {
        filename:    p.filename || `stuffing_photo_${i + 1}.${ext}`,
        content:     Buffer.from(b64, "base64"),
        contentType,
      };
    });

  // ── Send email ────────────────────────────────────────────────────────────
  const toEmail = order.client.email;
  const cc      = await getCCList(order.sp.id, order.clientId).catch(() => [] as string[]);

  await sendMail({
    spId: order.sp.id,
    to:   toEmail,
    cc,
    subject: await resolveSubject("dispatch_subject", { invoiceNo }),
    html,
    attachments: [
      {
        filename:    `${invoiceNo}_Shipment_Documents.pdf`,
        content:     pdfBuf,
        contentType: "application/pdf",
      },
      ...photoAttachments,
    ],
  });

  // ── Mark sent ─────────────────────────────────────────────────────────────
  await db.salesShipmentDocs.update({
    where: { orderId: id },
    data:  { stuffingMailSentAt: new Date() },
  });

  await db.salesOrderLog.create({
    data: {
      orderId: id,
      userId:  (session.user as any).id,
      action:  "DISPATCH_EMAIL_SENT",
      note:    `Dispatch email sent to ${toEmail} with ${photos.length} photos`,
    },
  });

  return NextResponse.json({ ok: true, sentTo: toEmail });
}

function C_val(v: string) { return v; }
