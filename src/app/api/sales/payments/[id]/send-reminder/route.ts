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

const TYPE_LABEL: Record<string, string> = {
  ADVANCE: "Advance Payment",
  CAD: "CAD (Cash Against Documents)",
  INSPECTION: "Inspection Payment",
  RECEIVE_TO_PAY: "Receive to Pay",
  BL_TO_PAY: "BL to Pay",
  CREDIT: "Credit Term Payment",
};

// Where the goods are, in words the customer recognises. Only used by the
// no-due-date mail below, where the shipment stage is the whole justification
// for asking: every one of the 50 divisions that mail exists for sits on a
// DISPATCHED or DELIVERED order.
const STAGE_LINE: Record<string, string> = {
  PACKING:      "The goods are being prepared for despatch.",
  DISPATCHED:   "The goods have been despatched.",
  IN_TRANSIT:   "The goods are in transit.",
  PORT_ARRIVED: "The goods have arrived at the destination port.",
  DELIVERED:    "The goods have been delivered.",
};

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** The mail we send when no due date can be PROVEN — see the long note in POST().
 *  It states the amount, the payment stage and where the shipment has got to,
 *  and asks for settlement. It quotes a milestone date only as the dated fact it
 *  is ("Commercial Invoice Date: 12 Mar 2026"), never in a "Due Date:" row and
 *  never as a deadline, because we do not know the deadline — that is the whole
 *  reason this variant exists. Built here and handed to paymentReminderHtml() as
 *  its customBody, which is the sanctioned way to replace a template's body
 *  (piEmailHtml, blReadyHtml and the rest all take the same escape hatch);
 *  emailTemplates.ts is shared with the cron and is not ours to reshape. */
function noDueDateBody(order: any, division: any, reference: { label: string; date: Date } | null): string {
  const currency = order.currency || "USD";
  const amount = Number(division.amount || 0).toFixed(2);
  const rows: [string, string][] = [
    ["Order No:", order.orderNumber],
    ["Order Date:", fmt(new Date(order.createdAt))],
    ["Payment Type:", TYPE_LABEL[division.type] || String(division.type).replace(/_/g, " ")],
    ["Amount Outstanding:", `${currency} ${amount}`],
  ];
  if (reference) rows.push([`${reference.label}:`, fmt(reference.date)]);

  const table = `<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
${rows.map(([k, v]) => `  <tr>
    <td style="padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap;vertical-align:top">${k}</td>
    <td style="padding:6px 0">${v}</td>
  </tr>`).join("")}
</table>`;

  const stage = STAGE_LINE[String(order.status)] ?? "";
  return `
<p>Dear ${order.client?.name || "Sir/Madam"},</p>
<p>This is a reminder regarding the outstanding <strong>${TYPE_LABEL[division.type] || String(division.type).replace(/_/g, " ")}</strong> on order <strong>${order.orderNumber}</strong>.${stage ? ` ${stage}` : ""}</p>
${table}
<p>Kindly arrange the payment of <strong>${currency} ${amount}</strong> at the earliest and share the remittance advice by replying to this email. If you believe this amount has already been settled, please let us know so we can reconcile our records.</p>
<p>Regards,<br><strong>${order.sp?.name || "Pacific Group"}</strong></p>`;
}

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

  // ── DUE DATE, AND WHAT THE MAIL IS ALLOWED TO CLAIM ABOUT IT ───────────────
  //
  // This block has now been wrong in two directions, and the second was worse.
  //
  // It began as `division.dueDate ?? new Date()`. Nothing in the app writes
  // due_date, so every manual reminder ever sent told the customer the payment
  // was due TODAY, whatever the terms actually said. A lie in every mail.
  //
  // The repair computed the real date with resolveDueDate() — the same function
  // the daily cron uses, so manual and automatic mail agree — and hard-400'd
  // when it came back null. Measured against the live database on 2026-09-03:
  // of the 102 unpaid, unwaived divisions, that refusal silenced 50 of them —
  // 48 BL_TO_PAY with no bl_date recorded and 2 CAD with neither ETA nor port
  // arrival, about USD 1.18M — and EVERY ONE sits on a DISPATCHED or DELIVERED
  // order. Goods gone, money outstanding, and the one button Accounts has for
  // chasing it returned an error. Nor could a formula rescue them:
  // deadline_days is NULL on all 102 rows, so "milestone + deadlineDays"
  // computes nothing, and 29 of the 50 have no shipment_docs row at all.
  //
  // THE MAIL'S JOB IS TO CHASE THE MONEY, NOT TO ASSERT A DATE IT CANNOT PROVE.
  // So the reminder ALWAYS goes out now, and only its wording varies with how
  // good the date is:
  //   "resolved" — computed from the order's own milestones. 52 of the 102.
  //   "books"    — the stored due_date, every one of them written by the books
  //                import (scripts/import-international-sales.js) for balances
  //                that predate the ERP. A commitment from the books is real.
  //   "derived"  — no due date exists, but a dated milestone does (BL,
  //                commercial invoice, BL docs sent, ETD, arrival, ETA). Quoted
  //                as the dated fact it is; NOT put in a "Due Date:" row and
  //                NOT called a deadline, because we do not know the deadline.
  //   "none"     — nothing datable anywhere. Amount, payment stage, where the
  //                shipment has got to, and a request to settle. No date claimed.
  // The first two use the normal template and its overdue / day_before wording,
  // exactly as before — this change does not touch the 52 that already worked.
  //
  // If you are ever tempted to reinstate the refusal: 50 divisions, USD 1.18M,
  // goods already delivered. A mail that does not name a due date is a chase-up.
  // No mail at all is a write-off.
  //
  // extended_due_date is raw-SQL-only (0019), hence its own read — exactly how
  // the cron does it.
  const extras: any[] = await db.$queryRawUnsafe(
    `SELECT extended_due_date FROM sales_payment_divisions WHERE id = $1`, id
  ).catch(() => []);

  let dueDateSource: "resolved" | "books" | "derived" | "none" = "resolved";
  let reference: { label: string; date: Date } | null = null;

  let dueDate: Date | null = resolveDueDate(division, extras[0] ?? {}, order);
  if (!dueDate && division.dueDate) {
    dueDate = new Date(division.dueDate);
    dueDateSource = "books";
  }
  if (!dueDate) {
    // Best available milestone, most commercially meaningful first.
    // resolveDueDate() has already had first refusal on whichever of these its
    // own type rule uses, so anything reached here is a date it deliberately did
    // NOT treat as a deadline — which is exactly how the mail quotes it: under
    // its own name, at its own value.
    //
    // deadlineDays is deliberately not added on. The row is labelled with the
    // milestone it names ("Commercial Invoice Date"), so shifting the value by N
    // days would make the label wrong, and the terms hang the deadline off a
    // milestone we could not compute in the first place. For the same reason
    // order.createdAt + deadlineDays is not used as a due date either: the order
    // date is a fact, "order date + N" is a guess, and the mail already prints
    // the order date plainly.
    const docs = order.shipmentDocs;
    const candidates: Array<[string, any]> = [
      ["Bill of Lading Date",     docs?.blDate],
      ["Commercial Invoice Date", docs?.commercialInvoiceDate],
      ["Documents Sent On",       docs?.blDocSentAt],
      ["Shipment Departure Date", docs?.etdDate],
      ["Port Arrival Date",       order.portArrival?.arrivalDate],
      ["Vessel ETA",              docs?.etaDate],
    ];
    const hit = candidates.find(([, v]) => !!v);
    if (hit) {
      reference = { label: hit[0], date: new Date(hit[1]) };
      // A derived reference dates the mail; it is NOT promoted to `dueDate`,
      // because the "Due Date:" row and the "pay by X" sentence in the standard
      // template would then assert a deadline nobody agreed to.
      dueDateSource = "derived";
    } else {
      dueDateSource = "none";
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Pick label: overdue / day_before / manual (manual send always treats as urgent reminder)
  let threshold = "manual";
  if (dueDate) {
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate < today) threshold = "overdue_manual";
    else if (dueDate.getTime() === today.getTime() + 86_400_000) threshold = "day_before";
  }

  const cc = await getCCList(order.spId, order.clientId).catch(() => [] as string[]);

  try {
    await sendMail({
      spId: order.spId,
      to:   order.client.email,
      subject: `Payment Reminder — Order ${order.orderNumber} (${division.type.replace(/_/g, " ")})`,
      // dueDate is only read by the template on the proven paths; on the other
      // two customBody replaces the body wholesale and the date argument is
      // ignored, so today's date goes in purely to satisfy the signature and
      // reaches no customer.
      html: dueDate
        ? paymentReminderHtml(order, division, threshold, dueDate)
        : paymentReminderHtml(order, division, threshold, today, noDueDateBody(order, division, reference)),
      ...(cc.length ? { cc: cc.join(",") } : {}),
    } as any);
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to send: ${e.message}` }, { status: 500 });
  }

  // Log it. The due-date provenance is part of the record: when Accounts asks
  // months later why a mail did not quote a date, "no milestone recorded" is the
  // answer, and it is only findable if it was written down at send time.
  await db.salesOrderLog.create({
    data: {
      orderId: order.id,
      userId:  (session.user as any).id,
      action:  "PAYMENT_REMINDER_SENT",
      note:
        `Manual payment reminder sent for ${division.type} division (${order.currency ?? "USD"} ${Number(division.amount).toFixed(2)}) to ${order.client.email}` +
        (dueDate
          ? ` — due ${fmt(dueDate)} (${dueDateSource})`
          : reference
            ? ` — no due date derivable; quoted ${reference.label} ${fmt(reference.date)}`
            : ` — no due date derivable; sent without a date`),
    },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    sentTo: order.client.email,
    // So the caller (and anyone reading a network log) can tell a mail that
    // named a deadline from one that only asked for the money.
    dueDateSource,
    dueDate: dueDate ? dueDate.toISOString() : null,
  });
}
