/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/sales/payments/[id]/send-reminder
 * Manually send a payment reminder email for a specific payment division.
 * Works without Inngest — sends directly via SP SMTP.
 * Allowed for: SALES_ADMIN, ACCOUNTS, SALESPERSON (any sales role).
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertPaymentDivisionVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { sendMail } from "@/lib/sales/mailer";
import { getCCList } from "@/lib/sales/mailHelpers";
import { paymentReminderHtml } from "@/lib/sales/emailTemplates";
import { resolveDueDate } from "@/lib/sales/paymentReminderJob";

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
  const refused = await assertPaymentDivisionVisible(session.user, id);
  if (refused) return refused;

  const division = await db.salesPaymentDivision.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          client: true,
          // shipmentDocs / portArrival are what resolveDueDate() reads for the
          // CAD, BL_TO_PAY and RECEIVE_TO_PAY divisions — same include as
          // sendSingleDivisionReminder() in lib/sales/paymentReminderJob.ts.
          shipmentDocs: true,
          portArrival: true,
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
  // A waived division is settled too — chasing the customer for money an RM has
  // already written off is the same mistake as chasing a paid one.
  if (division.overriddenAt) {
    return NextResponse.json({ error: "Payment has been overridden — nothing to chase" }, { status: 400 });
  }

  const order = division.order;
  if (!order?.client?.email) return NextResponse.json({ error: "Client has no email address" }, { status: 400 });

  // Due date. This used to be `division.dueDate ?? new Date()`, and NOTHING in
  // the app ever writes due_date — so every manual reminder ever sent told the
  // customer their payment was due TODAY, whatever the terms said. The real date
  // is derived from the division type and the order's milestones (PI acceptance,
  // BL date, port arrival) by resolveDueDate(), the same function the daily cron
  // uses, so the manual mail and the automatic one can no longer disagree.
  // extended_due_date is raw-SQL-only (0019), hence its own read — exactly how
  // the cron does it.
  const extras: any[] = await db.$queryRawUnsafe(
    `SELECT extended_due_date FROM sales_payment_divisions WHERE id = $1`, id
  ).catch(() => []);
  // The one case where the stored due_date is worth something: 45 of the 135
  // divisions carry one, every last one written by the books import
  // (scripts/import-international-sales.js) for balances that predate the ERP.
  // Those orders have no shipment docs or port arrival to compute from, so
  // resolveDueDate() returns null for them and refusing outright would take the
  // chase-up mail away from precisely the oldest outstanding money. A date from
  // the books is a real commitment; today's date is a fiction.
  const dueDate =
    resolveDueDate(division, extras[0] ?? {}, order) ??
    (division.dueDate ? new Date(division.dueDate) : null);
  if (!dueDate) {
    return NextResponse.json(
      { error: "Cannot determine the due date yet for this payment — it depends on a milestone (PI acceptance, BL date or port arrival) that has not been recorded." },
      { status: 400 }
    );
  }

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
