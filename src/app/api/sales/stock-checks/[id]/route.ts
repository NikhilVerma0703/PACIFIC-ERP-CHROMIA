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
