/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

// PATCH /api/sales/payments/[id]  — mark paid or update notes
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
  const body = await req.json() as { paidAt?: string | null; notes?: string; status?: string };
  const userId = (session.user as any).id as string;

  const updated = await db.salesPaymentDivision.update({
    where: { id },
    data: {
      ...(body.paidAt  !== undefined && { paidAt: body.paidAt ? new Date(body.paidAt) : null }),
      ...(body.notes   !== undefined && { notes: body.notes }),
      ...(body.status  !== undefined && { status: body.status }),
    },
  });

  // Log on the order
  await db.salesOrderLog.create({
    data: {
      orderId: updated.orderId,
      userId,
      action: body.paidAt ? "PAYMENT_RECEIVED" : "PAYMENT_UPDATED",
      note: (updated.type.replace(/_/g, " ") + " " + (body.paidAt ? "marked paid" : "updated") + ". " + (body.notes ?? "")).trim(),
    },
  }).catch(() => {});

  // Auto-advance: if all ADVANCE divisions are now paid, move order to PENDING_STOCK_CHECK
  if (body.paidAt || body.status === "PAID") {
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
        const existing = await db.salesStockCheck.findFirst({
          where: { orderId: updated.orderId },
        }).catch(() => null);
        if (!existing) {
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

  return NextResponse.json(updated);
}
