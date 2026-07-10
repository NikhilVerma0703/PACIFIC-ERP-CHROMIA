/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

// PATCH /api/sales/payments/[id] — mark paid, record a part payment, or update notes
//
// Body variants:
//   { paidAt: ISO | null }      legacy full-payment toggle (Mark Paid / Undo)
//   { amountReceived: number }  CUMULATIVE amount received against this division:
//                               0 < amountReceived < amount keeps the division
//                               PENDING/OVERDUE with a balance; >= amount marks it
//                               fully paid exactly like Mark Paid. null/0 clears.
//   { notes?, status? }         unchanged passthrough updates
//
// amount_received is a raw-SQL-only column (scripts/0024, applied) — deliberately
// NOT in the Prisma model so stale deploys keep working (0019 convention).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole  = (session.user as any).salesRole as string | null;
  const isAdmin    = salesRole === "SALES_ADMIN";
  const isAccounts = salesRole === "ACCOUNTS";

  if (!isAdmin && !isAccounts) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as {
    paidAt?: string | null; notes?: string; status?: string; amountReceived?: number | null;
  };
  const userId = (session.user as any).id as string;

  const existing = await db.salesPaymentDivision.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Payment division not found" }, { status: 404 });

  // ── Part-payment handling ──────────────────────────────────────────────────
  // undefined = amountReceived not part of this request; null = cleared.
  let amountReceived: number | null | undefined = undefined;
  let becameFullyPaid = false;
  let partialData: Record<string, unknown> = {};
  if (body.amountReceived !== undefined) {
    const v = body.amountReceived === null ? 0 : Number(body.amountReceived);
    if (!Number.isFinite(v) || v < 0) {
      return NextResponse.json({ error: "amountReceived must be a number >= 0" }, { status: 400 });
    }
    amountReceived = v > 0 ? v : null;
    if (v > 0 && v >= Number(existing.amount) - 0.005) {
      // Received in full — behaves exactly like Mark Paid.
      becameFullyPaid = !existing.paidAt;
      partialData = { paidAt: existing.paidAt ?? new Date(), status: "PAID" };
    } else {
      // Partial (or cleared): division is not fully paid.
      partialData = { paidAt: null, ...(existing.status === "PAID" ? { status: "PENDING" } : {}) };
    }
  }

  const updated = await db.salesPaymentDivision.update({
    where: { id },
    data: {
      ...(body.paidAt  !== undefined && { paidAt: body.paidAt ? new Date(body.paidAt) : null }),
      ...(body.notes   !== undefined && { notes: body.notes }),
      ...(body.status  !== undefined && { status: body.status }),
      ...partialData,
    },
  });

  // Keep the raw-SQL amount_received column in sync (scripts/0024).
  try {
    if (amountReceived !== undefined) {
      await db.$executeRawUnsafe(
        `UPDATE sales_payment_divisions SET amount_received = $1 WHERE id = $2`,
        amountReceived, id
      );
    } else if (body.paidAt !== undefined) {
      // Legacy toggle: Mark Paid = fully received; Undo = back to nothing received.
      await db.$executeRawUnsafe(
        `UPDATE sales_payment_divisions SET amount_received = $1 WHERE id = $2`,
        body.paidAt ? Number(existing.amount) : null, id
      );
    }
  } catch { /* 0024 not applied yet — non-fatal */ }

  const fullPay = !!body.paidAt || body.status === "PAID" || becameFullyPaid;

  // Log on the order
  const typeLabel = updated.type.replace(/_/g, " ");
  const logNote = amountReceived !== undefined && !fullPay
    ? (typeLabel + " part payment: " + (amountReceived ?? 0).toFixed(2) + " of " +
       Number(existing.amount).toFixed(2) + " received (balance " +
       (Number(existing.amount) - (amountReceived ?? 0)).toFixed(2) + "). " + (body.notes ?? "")).trim()
    : (typeLabel + " " + (fullPay ? "marked paid" : "updated") + ". " + (body.notes ?? "")).trim();
  await db.salesOrderLog.create({
    data: {
      orderId: updated.orderId,
      userId,
      action: fullPay ? "PAYMENT_RECEIVED" : (amountReceived !== undefined ? "PAYMENT_PARTIAL" : "PAYMENT_UPDATED"),
      note: logNote,
    },
  }).catch(() => {});

  // Auto-advance: if all ADVANCE divisions are now paid, move order to PENDING_STOCK_CHECK.
  // (A part payment never advances the order — only full receipt does.)
  if (fullPay) {
    const allDivisions = await db.salesPaymentDivision.findMany({
      where: { orderId: updated.orderId },
    });
    const advanceDivs = allDivisions.filter((d: any) => d.type === "ADVANCE");
    // Check: every advance div is paid (use updated value for the current one)
    const allAdvancePaid =
      advanceDivs.length > 0 &&
      advanceDivs.every((d: any) => d.paidAt !== null || d.id === id);

    if (allAdvancePaid) {
      const order = await db.salesOrder.findUnique({ where: { id: updated.orderId } });
      if (order?.status === "PENDING_PAYMENT") {
        await db.salesOrder.update({
          where: { id: updated.orderId },
          data:  { status: "PENDING_STOCK_CHECK" },
        });
        // Create stock check record if none exists yet
        const existingCheck = await db.salesStockCheck.findFirst({
          where: { orderId: updated.orderId },
        }).catch(() => null);
        if (!existingCheck) {
          await db.salesStockCheck.create({
            data: { orderId: updated.orderId, status: "PENDING" },
          }).catch(() => {});
        }
        await db.salesOrderLog.create({
          data: {
            orderId: updated.orderId,
            userId,
            action: "PENDING_STOCK_CHECK",
            note:   "All advance payments received — ready for stock check.",
          },
        }).catch(() => {});
      }
    }
  }

  return NextResponse.json({
    ...updated,
    ...(amountReceived !== undefined ? { amountReceived } : {}),
  });
}
