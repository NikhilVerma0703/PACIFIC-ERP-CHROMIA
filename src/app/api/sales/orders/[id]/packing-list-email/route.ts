/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Packing List email flow.
 *
 * POST  => Sends the packing list PDF to the customer. Works for all order types.
 * PATCH => accept | reject. Reject reverts to PACKING or PENDING_PRODUCTION.
 * GET   => Returns current packing list status record.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma }                 from "@/lib/prisma";
import { NextResponse }           from "next/server";
import { getCCList }              from "@/lib/sales/mailHelpers";
import { sendMail }               from "@/lib/sales/mailer";
import { generatePackingListPdf } from "@/lib/sales/pdf/packingListPdf";
import { resolveSubject }         from "@/lib/sales/mailSubjects";
import { createNotification, notifyByRole } from "@/lib/sales/notifications";

const db = prisma as any;

async function getPackingList(orderId: string) {
  return db.salesPackingList.findUnique({ where: { orderId } }).catch(() => null);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const pl = await getPackingList(id);
  return NextResponse.json(pl || { status: "PENDING_SEND", orderId: id });
}

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
      proformaInvoices: { take: 1, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  if (!order.client || !order.client.email) {
    return NextResponse.json({ error: "Client has no email address" }, { status: 400 });
  }

  let pdfBuf: Buffer;
  try {
    const rows: any[] = await db.$queryRaw`
      SELECT packing_list_upload
      FROM sales_shipment_docs
      WHERE order_id = ${id}
        AND packing_list_upload IS NOT NULL
        AND packing_list_upload != ''
    `;
    if (rows.length && rows[0].packing_list_upload) {
      const dataUri: string = rows[0].packing_list_upload;
      const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
      pdfBuf = Buffer.from(base64, "base64");
    } else {
      pdfBuf = await generatePackingListPdf(id) as Buffer;
    }
  } catch (err: any) {
    return NextResponse.json({ error: "Could not generate packing list: " + err.message }, { status: 500 });
  }

  const invoiceNo = order.invoiceNumber || order.orderNumber;
  const cc = await getCCList(order.sp.id, order.clientId).catch(() => [] as string[]);

  const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const html = "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"></head>"
    + "<body style=\"font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:640px;margin:0 auto;padding:20px\">"
    + "<p>Dear " + (order.client.contactPerson || order.client.name) + ",</p>"
    + "<p>Please find attached the <strong>Packing List</strong> for your order <strong>" + invoiceNo + "</strong>.</p>"
    + "<p>Kindly review and confirm your approval. If you have any corrections, please reply with details.</p>"
    + "<table style=\"border-collapse:collapse;width:100%;margin:16px 0;font-size:14px\">"
    + "<tr><td style=\"padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap\">Order Reference:</td>"
    + "<td style=\"padding:6px 0\">" + invoiceNo + "</td></tr>"
    + "<tr><td style=\"padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap\">Customer:</td>"
    + "<td style=\"padding:6px 0\">" + order.client.name + "</td></tr>"
    + "<tr><td style=\"padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap\">Date:</td>"
    + "<td style=\"padding:6px 0\">" + dateStr + "</td></tr></table>"
    + "<p style=\"margin-top:24px\">Regards,<br><strong>" + (order.sp.name || order.sp.email) + "</strong></p>"
    + "<p style=\"margin-top:16px;font-size:12px;color:#555;border-top:1px solid #ddd;padding-top:12px\">"
    + "Pacific Engineered Surfaces Pvt. Ltd.<br>Tel: +91-7830008181 | Email: sales@pacific-surfaces.com</p>"
    + "</body></html>";

  await sendMail({
    spId: order.sp.id,
    to:   order.client.email,
    cc,
    subject: await resolveSubject("packing_list_subject", { invoiceNo }),
    html,
    attachments: [
      { filename: "PackingList_" + invoiceNo + ".pdf", content: pdfBuf, contentType: "application/pdf" },
    ],
  });

  const now = new Date();
  const pl = await db.salesPackingList.upsert({
    where:  { orderId: id },
    update: { status: "SENT", sentAt: now },
    create: { orderId: id, status: "SENT", sentAt: now },
  });

  await db.$executeRaw`
    UPDATE sales_packing_lists
    SET rejected_at = NULL, rejection_reason = NULL
    WHERE order_id = ${id}
  `.catch(() => {});

  await db.salesOrderLog.create({
    data: {
      orderId: id,
      userId:  (session.user as any).id,
      action:  "PACKING_LIST_SENT",
      note:    "Packing list sent to " + order.client.email,
    },
  }).catch(() => {});

  await notifyByRole("SALES_ADMIN", {
    orderId:   id,
    type:      "PACKING_LIST_SENT",
    title:     "Packing list sent -- " + (order.orderNumber || id),
    body:      "SP " + (order.sp.name || "") + " sent packing list to " + (order.client.name || "") + ". Please review and accept/reject.",
    actionUrl: "/sales/orders/" + id,
    actions:   [{ label: "Review", url: "/sales/orders/" + id }],
  }).catch(() => {});

  return NextResponse.json({ ok: true, sentTo: order.client.email, pl });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as {
    action: "accept" | "reject";
    reason?: string;
    revertTo?: "PACKING" | "PENDING_PRODUCTION";
  };
  const { action, reason, revertTo } = body;

  if (action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "action must be accept or reject" }, { status: 400 });
  }

  const order = await db.salesOrder.findUnique({
    where:  { id },
    select: { orderNumber: true, spId: true, sp: { select: { id: true, name: true } } },
  }).catch(() => null);

  const now = new Date();
  const newStatus = action === "accept" ? "ACCEPTED" : "REJECTED";

  const pl = await db.salesPackingList.upsert({
    where:  { orderId: id },
    update: { status: newStatus, notes: reason || null },
    create: { orderId: id, status: newStatus, notes: reason || null },
  });

  if (action === "accept") {
    await db.$executeRaw`
      UPDATE sales_packing_lists
      SET accepted_at = ${now}, rejected_at = NULL, rejection_reason = NULL
      WHERE order_id = ${id}
    `.catch(() => {});

    await db.salesOrder.update({
      where: { id },
      data:  { status: "PACKING" },
    }).catch(() => {});

    if (order && order.sp && order.sp.id) {
      await createNotification({
        userId:    order.sp.id,
        orderId:   id,
        type:      "PACKING_LIST_ACCEPTED",
        title:     "Packing list approved -- " + (order.orderNumber || id),
        body:      "Order moved to PACKING. Ready to send dispatch email.",
        actionUrl: "/sales/orders/" + id,
        actions:   [
          { label: "View Order",         url: "/sales/orders/" + id },
          { label: "Send Dispatch Mail", url: "/sales/orders/" + id + "?action=dispatch-email" },
        ],
      }).catch(() => {});
    }

  } else {
    await db.$executeRaw`
      UPDATE sales_packing_lists
      SET rejected_at = ${now}, rejection_reason = ${reason || null}, accepted_at = NULL
      WHERE order_id = ${id}
    `.catch(() => {});

    const revertStatus = revertTo === "PACKING" ? "PACKING" : "PENDING_PRODUCTION";

    await db.salesOrder.update({
      where: { id },
      data:  { status: revertStatus },
    }).catch(() => {});

    await db.salesAdminAlert.create({
      data: {
        orderId: id,
        type:    "PACKING_LIST_REJECTED",
        message: ("Packing list rejected -- reverting to " + revertStatus + ". " + (reason || "")).trim(),
      },
    }).catch(() => {});

    if (order && order.sp && order.sp.id) {
      await createNotification({
        userId:    order.sp.id,
        orderId:   id,
        type:      "PACKING_LIST_REJECTED",
        title:     "Packing list rejected -- " + (order.orderNumber || id),
        body:      ("Reverted to " + revertStatus + ". " + (reason || "")).trim(),
        actionUrl: "/sales/orders/" + id,
        actions:   [{ label: "View Order", url: "/sales/orders/" + id }],
      }).catch(() => {});
    }
  }

  await db.salesOrderLog.create({
    data: {
      orderId: id,
      userId:  (session.user as any).id,
      action:  action === "accept" ? "PACKING_LIST_ACCEPTED" : "PACKING_LIST_REJECTED",
      note:    reason ? "Reason: " + reason : null,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, status: newStatus, pl });
}
