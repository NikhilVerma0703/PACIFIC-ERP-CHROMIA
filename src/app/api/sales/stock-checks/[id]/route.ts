/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma }      from "@/lib/prisma";
import { NextResponse } from "next/server";
import { createNotification } from "@/lib/sales/notifications";

const db = prisma as any;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole    = (session.user as any).salesRole as string | null;
  const isAdmin      = salesRole === "SALES_ADMIN";
  const isCommercial = salesRole === "COMMERCIAL";

  if (!isAdmin && !isCommercial) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as {
    status?: string;
    notes?: string;
    assignedSlabIds?: string[];
    resultCount?: number;
  };

  const userId = (session.user as any).id as string;

  const check = await db.salesStockCheck.findUnique({ where: { id }, include: { order: true } });
  if (!check) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (check.order.status !== "PENDING_STOCK_CHECK" && !isAdmin) {
    return NextResponse.json(
      { error: "Stock check not available -- advance payment must be received first." },
      { status: 422 }
    );
  }

  // THE ADVANCE GATE, SECOND COPY. AVAILABLE and PARTIAL write
  // salesOrder.status = "PACKING" further down, which is the point the warehouse
  // starts pulling slabs — money spent on the customer's behalf. That write had
  // no advance check of its own; it trusted the order already being in
  // PENDING_STOCK_CHECK to mean the advance had settled. It did not: until the
  // sibling fix in /api/sales/orders/[id]/status, a SALESPERSON could PATCH an
  // unpaid order straight into PENDING_STOCK_CHECK and it arrived here
  // indistinguishable from one whose money had come in. Both doors into PACKING
  // are now guarded, because that is the door the money walks out of.
  //
  // "Settled" is paid_at OR overridden_at — an RM waiver releases the order
  // exactly like a receipt does, and that documented, audited override
  // (/api/sales/orders/[id]/payment-division) is the way past this check. There
  // is deliberately no admin bypass: the bypass IS the override, which leaves a
  // record of who waived what.
  //
  // Checked BEFORE the stock-check row is written so nothing lands half-done,
  // and the stock page keeps the panel and the typed notes open on a non-2xx, so
  // Commercial loses no work — they re-submit once the advance is recorded.
  // Measured on the live database 2026-09-03: of the 9 orders sitting in
  // PENDING_STOCK_CHECK, none has an ADVANCE division at all, and no order in
  // the database has an unsettled one. This refuses nothing that exists today.
  if (body.status === "AVAILABLE" || body.status === "PARTIAL") {
    const advanceDivs: any[] = await db.salesPaymentDivision.findMany({
      where: { orderId: check.orderId, type: "ADVANCE" },
    });
    if (advanceDivs.length > 0 && !advanceDivs.every((d: any) => !!d.paidAt || !!d.overriddenAt)) {
      return NextResponse.json(
        {
          error:
            "Advance payment has not been received for this order, so it cannot move to Packing. Record the advance in Payments, or have an RM override it, then confirm the stock again.",
          code: "ADVANCE_UNPAID",
        },
        { status: 422 }
      );
    }
  }

  const updated = await db.salesStockCheck.update({
    where: { id },
    data: {
      ...(body.status !== undefined          && { status: body.status }),
      ...(body.notes  !== undefined          && { notes: body.notes }),
      ...(body.assignedSlabIds !== undefined && {
        assignedSlabIds: body.assignedSlabIds,
        resultCount: body.assignedSlabIds.length,
      }),
      checkedById: userId,
    },
  });

  // AVAILABLE / PARTIAL => PACKING
  if (body.status === "AVAILABLE" || body.status === "PARTIAL") {
    await db.salesOrder.update({
      where: { id: check.orderId },
      data:  { status: "PACKING" },
    });

    try {
      await db.salesOrderLog.create({
        data: {
          orderId: check.orderId,
          userId,
          action: "PACKING",
          note:   ("Stock " + body.status + " -- moved to packing. " + (body.notes ?? "")).trim(),
        },
      });
    } catch { /* non-fatal */ }

    if (check.order && check.order.spId) {
      await createNotification({
        userId:    check.order.spId,
        orderId:   check.orderId,
        type:      "STOCK_CHECK_DONE",
        title:     "Stock confirmed -- " + (check.order.orderNumber || check.orderId),
        body:      "Stock " + body.status + ". Order moved to PACKING.",
        actionUrl: "/sales/orders/" + check.orderId,
        actions:   [{ label: "View Order", url: "/sales/orders/" + check.orderId }],
      }).catch(() => {});
    }
  }

  // UNAVAILABLE => PENDING_PRODUCTION
  if (body.status === "UNAVAILABLE") {
    await db.salesOrder.update({
      where: { id: check.orderId },
      data:  { status: "PENDING_PRODUCTION" },
    });

    const existingJob = await db.salesProductionJob.findUnique({
      where: { orderId: check.orderId },
    }).catch(() => null);
    if (!existingJob) {
      await db.salesProductionJob.create({
        data: {
          orderId: check.orderId,
          type:    "SLAB",
          status:  "PENDING",
          notes:   body.notes || null,
        },
      }).catch((e: any) => console.error("salesProductionJob.create failed:", e.message));
    }

    await db.salesAdminAlert.create({
      data: {
        orderId: check.orderId,
        type:    "STOCK_UNAVAILABLE",
        message: ("Stock unavailable for " + (check.order.orderNumber || "") + " -- moved to Production. " + (body.notes || "")).trim(),
      },
    }).catch(() => {});

    try {
      await db.salesOrderLog.create({
        data: {
          orderId: check.orderId,
          userId,
          action: "PENDING_PRODUCTION",
          note:   ("Stock unavailable -- production request created. " + (body.notes || "")).trim(),
        },
      });
    } catch { /* non-fatal */ }

    if (check.order && check.order.spId) {
      await createNotification({
        userId:    check.order.spId,
        orderId:   check.orderId,
        type:      "STOCK_CHECK_DONE",
        title:     "Stock unavailable -- " + (check.order.orderNumber || check.orderId),
        body:      ("Order moved to PENDING PRODUCTION. " + (body.notes || "")).trim(),
        actionUrl: "/sales/orders/" + check.orderId,
        actions:   [{ label: "View Order", url: "/sales/orders/" + check.orderId }],
      }).catch(() => {});
    }
  }

  return NextResponse.json(updated);
}
