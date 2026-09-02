/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pure payment reminder job — no Inngest dependency.
 * Called by /api/sales/cron/payment-reminders (daily cron)
 * and by /api/sales/orders/[id]/payment-division/remind (manual trigger).
 */
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/sales/mailer";
import { getCCList } from "@/lib/sales/mailHelpers";
import { paymentDeadlineHtml } from "@/lib/sales/emailTemplates";
import { createNotification } from "@/lib/sales/notifications";
import { getSp, getSpMap } from "@/lib/sales/spLookup";

const db = prisma as any;

export function daysDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function resolveDueDate(div: any, extra: any, order: any): Date | null {
  if (extra?.extended_due_date) return new Date(extra.extended_due_date);

  const days: number | null = div.deadlineDays ?? null;

  if (div.type === "CAD") {
    // CAD: due when goods arrive at port (free days already baked in)
    if (order.shipmentDocs?.etaDate) return new Date(order.shipmentDocs.etaDate);
    if (order.portArrival?.arrivalDate) {
      const freeDays = order.portArrival.freeDays ?? 21;
      return new Date(new Date(order.portArrival.arrivalDate).getTime() + freeDays * 86400000);
    }
    return null; // CAD with no ETA yet — skip
  }

  if (div.type === "ADVANCE") {
    // ADVANCE: from PI acceptance date + deadlineDays
    const pi = order.proformaInvoices?.[0];
    const base = pi?.acceptedAt ? new Date(pi.acceptedAt) : new Date(order.createdAt);
    if (!days) return null;
    return new Date(base.getTime() + days * 86400000);
  }

  if (div.type === "BL_TO_PAY") {
    // BL_TO_PAY: from BL date + deadlineDays
    const blDate = order.shipmentDocs?.blDate;
    if (!blDate || !days) return null;
    return new Date(new Date(blDate).getTime() + days * 86400000);
  }

  if (div.type === "RECEIVE_TO_PAY") {
    // RECEIVE_TO_PAY: from goods inspected/arrived date + deadlineDays
    const base = order.shipmentDocs?.inspectedAt ?? order.portArrival?.arrivalDate;
    if (!base || !days) return null;
    return new Date(new Date(base).getTime() + days * 86400000);
  }

  return null;
}

/**
 * Run the full payment deadline reminder sweep.
 * Processes all PENDING/OVERDUE divisions, sends due milestones, marks OVERDUE.
 */
export async function runPaymentDeadlineReminders(): Promise<{ processed: number; results: any[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const divisions: any[] = await db.salesPaymentDivision.findMany({
    where: { status: { in: ["PENDING", "OVERDUE"] }, paidAt: null },
    include: {
      order: {
        include: {
          client: true,
          shipmentDocs: true,
          portArrival: true,
          proformaInvoices: { where: { status: "ACCEPTED" }, take: 1, orderBy: { acceptedAt: "desc" } },
        },
      },
    },
  });

  // order.spId has no Prisma relation (no hard FK) — stitch SP info in
  const spMap = await getSpMap(divisions.map((d: any) => d.order?.spId));
  for (const d of divisions) {
    if (d.order) d.order.sp = spMap.get(d.order.spId) ?? null;
  }

  const extras: any[] = await db.$queryRawUnsafe(
    `SELECT id, reminders_sent, extended_due_date, overridden_at, override_note
     FROM sales_payment_divisions
     WHERE status IN ('PENDING','OVERDUE') AND paid_at IS NULL`
  );
  const extraMap = new Map(extras.map((r: any) => [r.id, r]));

  const adminUsers: any[] = await db.$queryRawUnsafe(
    `SELECT id FROM users WHERE sales_role = 'SALES_ADMIN'`
  ).catch(() => []);

  const results: any[] = [];

  for (const div of divisions) {
    const order = div.order;
    if (!order) continue;
    const ex = extraMap.get(div.id);
    if (ex?.overridden_at || div.paidAt || div.status === "PAID") continue;

    const dueDate = resolveDueDate(div, ex, order);
    if (!dueDate) continue;

    const windowStart = new Date(order.createdAt); windowStart.setHours(0, 0, 0, 0);
    const dueDay = new Date(dueDate); dueDay.setHours(0, 0, 0, 0);
    const totalWindow = dueDay.getTime() - windowStart.getTime();
    const elapsed = today.getTime() - windowStart.getTime();
    const pctElapsed = totalWindow > 0 ? (elapsed / totalWindow) * 100 : 100;
    const daysLeft = daysDiff(today, dueDay);

    let remindersSent: string[] = [];
    try {
      const raw = ex?.reminders_sent;
      remindersSent = Array.isArray(raw) ? raw : (typeof raw === "string" ? JSON.parse(raw) : []);
    } catch { remindersSent = []; }

    // Built in ASCENDING urgency — the order matters, see below. day_before and
    // due_day are mutually exclusive (daysLeft === 1 vs daysLeft <= 0), so the
    // last entry is always the most urgent thing that is true today.
    const due: string[] = [];
    if (pctElapsed >= 50 && !remindersSent.includes("50")) due.push("50");
    if (pctElapsed >= 80 && !remindersSent.includes("80")) due.push("80");
    if (pctElapsed >= 95 && !remindersSent.includes("95")) due.push("95");
    if (daysLeft === 1   && !remindersSent.includes("day_before")) due.push("day_before");
    if (daysLeft <= 0    && !remindersSent.includes("due_day"))    due.push("due_day");

    // ONE EMAIL PER SWEEP, AND IT IS THE MOST URGENT ONE.
    //
    // This was a loop over every unsent milestone. A division whose deadline had
    // already passed when it was entered — a back-dated BL, an order keyed in a
    // week late, a CAD whose ETA finally arrived — crossed 50%, 80%, 95% and its
    // due date all at once, so the customer got FOUR emails minutes apart, three
    // of them saying something softer than the truth ("Payment Reminder",
    // "Approaching Deadline") about an invoice that was already overdue. That
    // reads as a broken system, and the one email that mattered was buried under
    // three that contradicted it.
    //
    // So: send the last one, and record the ones it supersedes as sent. They are
    // not owed to the customer — 50% elapsed is not news once you are past the
    // due date — and leaving them unrecorded would only walk the ladder back
    // down on tomorrow's sweep, sending "Payment Reminder" the day AFTER
    // "OVERDUE".
    if (due.length) {
      const milestone = due[due.length - 1];
      try {
        if (order.client?.email) {
          const cc = await getCCList(order.spId, order.clientId);
          const urgency =
            daysLeft <= 0  ? "OVERDUE" : daysLeft === 1 ? "Due Tomorrow" :
            milestone === "95" ? "Final Reminder" : milestone === "80" ? "Approaching Deadline" : "Payment Reminder";
          await sendMail({
            spId: order.spId, to: order.client.email,
            subject: `${urgency}: Payment for Order ${order.orderNumber}`,
            html: paymentDeadlineHtml(order, div, milestone, dueDate, daysLeft),
            ...(cc.length ? { cc: cc.join(",") } : {}),
          } as any);
        }

        // THE MARKER GOES DOWN THE INSTANT THE MAIL IS AWAY.
        //
        // It used to be written AFTER the internal notifications — an insert for
        // the SP, one for their manager, one per sales admin. Any one of those
        // failing threw past this UPDATE, so the customer had the email and the
        // database had no record of it, and tomorrow's sweep mailed them the
        // same reminder again. Nothing about a chase email is idempotent from
        // the customer's side: they only see that we cannot count.
        //
        // A duplicate reminder to a paying customer is worse than a missing
        // in-app notification, so the ordering is now: mail, mark, then
        // best-effort notify. Nothing below can undo the mark.
        await db.$queryRawUnsafe(
          `UPDATE sales_payment_divisions SET reminders_sent = reminders_sent || $1::jsonb WHERE id = $2`,
          JSON.stringify(due), div.id
        );
        results.push({ divId: div.id, orderId: order.id, milestone, superseded: due.slice(0, -1), sent: true });

        // BEST-EFFORT, IN ITS OWN TRY. These are our own staff's notification
        // bells; the customer is already served. A failure here is worth
        // reporting in the cron result and worth nothing else — it must never
        // re-arm the email.
        try {
          const notifTitle = `Payment ${milestone === "due_day" ? "Due Today" : milestone === "day_before" ? "Due Tomorrow" : `${milestone}% Elapsed`} — ${order.orderNumber}`;
          const notifBody  = `${div.type.replace(/_/g, " ")} payment${daysLeft <= 0 ? " is overdue" : ` due in ${daysLeft} day(s)`}. Amount: ${order.currency || "USD"} ${Number(div.amount).toFixed(2)}`;
          const actionUrl  = `/sales/orders/${order.id}`;
          const actions    = [{ label: "View Order", url: actionUrl }];

          if (order.spId) await createNotification({ userId: order.spId, orderId: order.id, type: "PAYMENT_REMINDER", title: notifTitle, body: notifBody, actionUrl, actions });

          const rmRows: any[] = await db.$queryRawUnsafe(
            `SELECT manager_id FROM sales_manager_assignments WHERE sp_id = $1 AND is_active = true LIMIT 1`, order.spId
          ).catch(() => []);
          if (rmRows.length) await createNotification({ userId: rmRows[0].manager_id, orderId: order.id, type: "PAYMENT_REMINDER", title: notifTitle, body: notifBody, actionUrl, actions });

          for (const admin of adminUsers) {
            await createNotification({ userId: admin.id, orderId: order.id, type: "PAYMENT_REMINDER", title: notifTitle, body: notifBody, actionUrl, actions });
          }
        } catch (e: any) {
          results.push({ divId: div.id, orderId: order.id, milestone, notifyError: e.message });
        }
      } catch (e: any) {
        results.push({ divId: div.id, orderId: order.id, milestone, error: e.message });
      }
    }

    if (daysLeft < 0 && div.status === "PENDING") {
      try { await db.salesPaymentDivision.update({ where: { id: div.id }, data: { status: "OVERDUE" } }); }
      catch { /* non-fatal */ }
    }
  }

  return { processed: divisions.length, results };
}

/**
 * Send a reminder for a single division (used by the manual "Send Reminder" button).
 * force=true → send now regardless of % elapsed, don't update remindersSent tracking.
 */
export async function sendSingleDivisionReminder(
  orderId: string,
  divisionId: string,
  force: boolean,
  specificMilestone?: string
): Promise<{ ok: boolean; milestones?: string[]; results?: any[]; message?: string; pctElapsed?: number; daysLeft?: number }> {
  const div = await db.salesPaymentDivision.findUnique({
    where: { id: divisionId },
    include: {
      order: {
        include: {
          client: true,
          shipmentDocs: true,
          portArrival: true,
          proformaInvoices: { where: { status: "ACCEPTED" }, take: 1, orderBy: { acceptedAt: "desc" } },
        },
      },
    },
  });
  if (!div || div.orderId !== orderId) throw new Error("Division not found");
  // order.spId has no Prisma relation (no hard FK) — stitch SP info in
  if (div.order) div.order.sp = await getSp(div.order.spId);
  if (div.paidAt || div.overriddenAt) throw new Error("Division already settled");

  const extras: any[] = await db.$queryRawUnsafe(
    `SELECT reminders_sent, extended_due_date, overridden_at FROM sales_payment_divisions WHERE id = $1`, divisionId
  ).catch(() => []);
  const extra = extras[0] ?? {};
  if (extra.overridden_at) throw new Error("Division has been overridden");

  const order = div.order;
  const dueDate = resolveDueDate(div, extra, order);
  if (!dueDate) throw new Error("Cannot determine due date for this division");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDay = new Date(dueDate); dueDay.setHours(0, 0, 0, 0);
  const windowStart = new Date(order.createdAt); windowStart.setHours(0, 0, 0, 0);
  const totalWindow = dueDay.getTime() - windowStart.getTime();
  const elapsed     = today.getTime() - windowStart.getTime();
  const pctElapsed  = totalWindow > 0 ? (elapsed / totalWindow) * 100 : 100;
  const daysLeft    = daysDiff(today, dueDay);

  let remindersSent: string[] = [];
  try {
    const raw = extra.reminders_sent;
    remindersSent = Array.isArray(raw) ? raw : (typeof raw === "string" ? JSON.parse(raw) : []);
  } catch { remindersSent = []; }

  const toSend: string[] = [];
  if (specificMilestone) {
    // Explicit milestone requested — send it regardless of state (for testing)
    toSend.push(specificMilestone);
  } else if (force) {
    if      (daysLeft <= 0)    toSend.push("due_day");
    else if (daysLeft === 1)   toSend.push("day_before");
    else if (pctElapsed >= 95) toSend.push("95");
    else if (pctElapsed >= 80) toSend.push("80");
    else                       toSend.push("50");
  } else {
    if (pctElapsed >= 50 && !remindersSent.includes("50"))        toSend.push("50");
    if (pctElapsed >= 80 && !remindersSent.includes("80"))        toSend.push("80");
    if (pctElapsed >= 95 && !remindersSent.includes("95"))        toSend.push("95");
    if (daysLeft === 1   && !remindersSent.includes("day_before")) toSend.push("day_before");
    if (daysLeft <= 0    && !remindersSent.includes("due_day"))   toSend.push("due_day");
  }

  if (!toSend.length) return { ok: false, message: "No milestones due yet (use force=true to send anyway)", pctElapsed: Math.round(pctElapsed), daysLeft };

  const adminUsers: any[] = await db.$queryRawUnsafe(`SELECT id FROM users WHERE sales_role = 'SALES_ADMIN'`).catch(() => []);
  const results: any[] = [];

  for (const milestone of toSend) {
    try {
      const urgency = daysLeft <= 0 ? "OVERDUE" : daysLeft === 1 ? "Due Tomorrow" :
        milestone === "95" ? "Final Reminder" : milestone === "80" ? "Approaching Deadline" : "Payment Reminder";
      if (order.client?.email) {
        const cc = await getCCList(order.spId, order.clientId);
        await sendMail({ spId: order.spId, to: order.client.email, subject: `${urgency}: Payment for Order ${order.orderNumber}`, html: paymentDeadlineHtml(order, div, milestone, dueDate, daysLeft), ...(cc.length ? { cc: cc.join(",") } : {}) } as any);
      }
      const notifTitle = `Payment ${milestone === "due_day" ? "Due Today" : milestone === "day_before" ? "Due Tomorrow" : `${milestone}% Elapsed`} — ${order.orderNumber}`;
      const notifBody  = `${div.type.replace(/_/g, " ")} payment${daysLeft <= 0 ? " is overdue" : ` due in ${daysLeft} day(s)`}. Amount: ${order.currency || "USD"} ${Number(div.amount).toFixed(2)}`;
      const actionUrl  = `/sales/orders/${orderId}`;
      if (order.spId) await createNotification({ userId: order.spId, orderId, type: "PAYMENT_REMINDER", title: notifTitle, body: notifBody, actionUrl, actions: [{ label: "View Order", url: actionUrl }] });
      const rmRows: any[] = await db.$queryRawUnsafe(`SELECT manager_id FROM sales_manager_assignments WHERE sp_id = $1 AND is_active = true LIMIT 1`, order.spId).catch(() => []);
      if (rmRows.length) await createNotification({ userId: rmRows[0].manager_id, orderId, type: "PAYMENT_REMINDER", title: notifTitle, body: notifBody, actionUrl, actions: [{ label: "View Order", url: actionUrl }] });
      for (const admin of adminUsers) await createNotification({ userId: admin.id, orderId, type: "PAYMENT_REMINDER", title: notifTitle, body: notifBody, actionUrl, actions: [{ label: "View Order", url: actionUrl }] });
      if (!force && !specificMilestone) {
        await db.$queryRawUnsafe(`UPDATE sales_payment_divisions SET reminders_sent = reminders_sent || $1::jsonb WHERE id = $2`, JSON.stringify([milestone]), divisionId);
      }
      results.push({ milestone, sent: true });
    } catch (e: any) { results.push({ milestone, sent: false, error: e.message }); }
  }
  return { ok: true, milestones: toSend, results, pctElapsed: Math.round(pctElapsed), daysLeft };
}
