/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";

const db = prisma as any;

/** Move an order out of PENDING_PAYMENT once every ADVANCE division is settled.
 *  The same step /api/sales/payments/[id] runs when Accounts marks an advance
 *  paid — "settled" just means paid_at OR overridden_at, because a manager
 *  waiver releases the order exactly like a receipt does. Safe to call twice:
 *  it only acts on an order still sitting in PENDING_PAYMENT. */
async function advanceIfAdvancesSettled(orderId: string, userId: string): Promise<void> {
  const divisions: any[] = await db.salesPaymentDivision.findMany({ where: { orderId } });
  const advanceDivs = divisions.filter((d: any) => d.type === "ADVANCE");
  if (advanceDivs.length === 0) return;
  if (!advanceDivs.every((d: any) => !!d.paidAt || !!d.overriddenAt)) return;

  const order = await db.salesOrder.findUnique({ where: { id: orderId } });
  if (order?.status !== "PENDING_PAYMENT") return;

  await db.salesOrder.update({
    where: { id: orderId },
    data:  { status: "PENDING_STOCK_CHECK" },
  });
  // PI acceptance already creates the stock check for most orders; create one
  // only when none exists, or the unique order_id index throws on the second.
  const existingCheck = await db.salesStockCheck.findFirst({ where: { orderId } }).catch(() => null);
  if (!existingCheck) {
    await db.salesStockCheck.create({ data: { orderId, status: "PENDING" } }).catch(() => {});
  }
  await db.salesOrderLog.create({
    data: {
      orderId,
      userId,
      action: "PENDING_STOCK_CHECK",
      note:   "All advance payments settled (received or waived) — ready for stock check.",
    },
  }).catch(() => {});
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = session.user as any;
  const callerId = user.id as string;
  const salesRole = user.salesRole as string | null;
  const sysRole = user.role as string | null;

  // Only RM, SALES_ADMIN, or ADMIN can use this endpoint
  if (
    salesRole !== "REPORTING_MANAGER" &&
    salesRole !== "SALES_ADMIN" &&
    sysRole !== "ADMIN"
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: orderId } = await params;
  const refused = await assertOrderVisible(session.user, orderId);
  if (refused) return refused;
  const body = await req.json();
  const { divisionId, action, newDueDate, note } = body as {
    divisionId: string;
    action: "extend" | "override";
    newDueDate?: string;
    note?: string;
  };

  if (!divisionId || !action) {
    return Response.json({ error: "divisionId and action are required" }, { status: 400 });
  }

  if (action === "extend") {
    if (!newDueDate) return Response.json({ error: "newDueDate is required for extend" }, { status: 400 });
    await db.$queryRawUnsafe(
      `UPDATE sales_payment_divisions
       SET extended_due_date = $1, reminders_sent = '[]'::jsonb, updated_at = now()
       WHERE id = $2 AND order_id = $3`,
      new Date(newDueDate).toISOString(),
      divisionId,
      orderId
    );
  } else if (action === "override") {
    // paid_at is deliberately NOT written here. An override is permission to move
    // on without the money, not a receipt: paidAmount and the paid % on the order
    // page both key on paid_at / amount_received, and stamping paid_at would book
    // never-received cash into them.
    await db.$queryRawUnsafe(
      `UPDATE sales_payment_divisions
       SET overridden_at = now(), overridden_by_id = $1, override_note = $2, status = 'PAID', updated_at = now()
       WHERE id = $3 AND order_id = $4`,
      callerId,
      note ?? null,
      divisionId,
      orderId
    );
    // ...which is why the override has to run the release itself. Both gates read
    // paid_at OR overridden_at, but nothing used to advance the order from here,
    // so a waived advance left it parked in PENDING_PAYMENT with the stock check
    // still refusing ("Awaiting advance payment") and the only way out was
    // Accounts falsely clicking Mark Paid — the very write the paragraph above
    // exists to avoid.
    await advanceIfAdvancesSettled(orderId, callerId);
    // Audit log
    try {
      await db.salesOrderLog.create({
        data: {
          orderId,
          userId: callerId,
          action: "PAYMENT_OVERRIDDEN",
          note: "Override by RM/Admin: " + (note ?? "(no note)"),
        },
      });
    } catch { /* non-fatal */ }
  } else {
    return Response.json({ error: "Invalid action" }, { status: 400 });
  }

  return Response.json({ ok: true });
}
