/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/sales/payments/[id]/send-reminder
 * Manually send a payment reminder email for a specific payment division.
 * Works without Inngest — sends directly via SP SMTP.
 * Allowed for: SALES_ADMIN, ACCOUNTS, SALESPERSON (any sales role).
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { sendMail } from "@/lib/sales/mailer";
import { getCCList } from "@/lib/sales/mailHelpers";
import { paymentReminderHtml } from "@/lib/sales/emailTemplates";

const db = prisma as any;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  if (!salesRole) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const division = await db.salesPaymentDivision.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          client: true,
          sp: { select: { id: true, name: true, email: true } },
          proformaInvoices: {
            where: { status: "ACCEPTED" },
            take: 1,
            orderBy: { acceptedAt: "desc" },
          },
        },
      },
    },
  });

  if (!division) return NextResponse.json({ error: "Division not found" }, { status: 404 });
  if (division.paidAt) return NextResponse.json({ error: "Payment already marked as paid" }, { status: 400 });

  const order = division.order;
  if (!order?.client?.email) return NextResponse.json({ error: "Client has no email address" }, { status: 400 });

  // Determine due date
  const dueDate = division.dueDate ? new Date(division.dueDate) : new Date();
  const today   = new Date();
  today.setHours(0, 0, 0, 0);
  dueDate.setHours(0, 0, 0, 0);

  // Pick label: overdue / day_before / 99 (manual send always treats as urgent reminder)
  let threshold = "manual";
  if (dueDate < today) threshold = "overdue_manual";
  else if (dueDate.getTime() === today.getTime() + 86_400_000) threshold = "day_before";
  else threshold = "manual";

  const cc = await getCCList(order.spId, order.clientId).catch(() => [] as string[]);

  try {
    await sendMail({
      spId: order.spId,
      to:   order.client.email,
      subject: `Payment Reminder — Order ${order.orderNumber} (${division.type.replace(/_/g, " ")})`,
      html: paymentReminderHtml(order, division, threshold, dueDate),
      ...(cc.length ? { cc: cc.join(",") } : {}),
    } as any);
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to send: ${e.message}` }, { status: 500 });
  }

  // Log it
  await db.salesOrderLog.create({
    data: {
      orderId: order.id,
      userId:  (session.user as any).id,
      action:  "PAYMENT_REMINDER_SENT",
      note:    `Manual payment reminder sent for ${division.type} division (${order.currency ?? "USD"} ${Number(division.amount).toFixed(2)}) to ${order.client.email}`,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, sentTo: order.client.email });
}
