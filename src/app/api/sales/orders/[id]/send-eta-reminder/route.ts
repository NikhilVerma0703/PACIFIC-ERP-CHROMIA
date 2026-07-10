/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/sales/orders/[id]/send-eta-reminder
 * Manually send an ETA reminder email to the client for testing.
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { sendMail } from "@/lib/sales/mailer";
import { getCCList } from "@/lib/sales/mailHelpers";
import { etaReminderHtml } from "@/lib/sales/emailTemplates";

const db = prisma as any;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const salesRole = (session.user as any).salesRole as string | null;
  const sysRole   = (session.user as any).role      as string | null;
  if (!salesRole && sysRole !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const order = await db.salesOrder.findUnique({
    where: { id },
    include: {
      client: true,
      shipmentDocs: true,
    },
  });

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!order.client?.email) return NextResponse.json({ error: "Client has no email address" }, { status: 400 });

  // Map shipmentDocs fields to the shape etaReminderHtml expects under order.container
  const docs = order.shipmentDocs;
  order.container = docs ? {
    eta:             docs.etaDate ?? null,
    containerNumber: docs.containerNo ?? null,
    vesselName:      docs.vesselName ?? null,
    trackingLink:    docs.trackingLink ?? null,
    trackingUrl:     docs.trackingLink ?? null,
  } : null;

  const cc = await getCCList(order.spId, order.clientId).catch(() => [] as string[]);

  try {
    await sendMail({
      spId: order.spId,
      to:   order.client.email,
      subject: `ETA Reminder — Order ${order.orderNumber}`,
      html: etaReminderHtml(order.client.name, order),
      ...(cc.length ? { cc: cc.join(",") } : {}),
    } as any);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  await db.salesOrderLog.create({
    data: {
      orderId: order.id,
      userId:  (session.user as any).id,
      action:  "ETA_REMINDER_SENT",
      note:    `Manual ETA reminder sent to ${order.client.email}`,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, sentTo: order.client.email });
}
