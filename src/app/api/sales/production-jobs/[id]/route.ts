/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

// ── Job status → order status mapping ─────────────────────────────────────────
const JOB_TO_ORDER_STATUS: Record<string, string> = {
  IN_PROGRESS: "IN_PRODUCTION",
  COMPLETED:   "PACKING",
  ON_HOLD:     "PENDING_PRODUCTION",
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const allowed   = salesRole === "SALES_ADMIN"; // production duties belong to module admins
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const userId = (session.user as any).id as string;

  const body = await req.json() as {
    status?: string;   // PENDING | IN_PROGRESS | COMPLETED | ON_HOLD
    notes?: string;
    assignedToId?: string | null;
  };

  const job = await db.salesProductionJob.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Update the production job
  const updated = await db.salesProductionJob.update({
    where: { id },
    data: {
      ...(body.status       !== undefined && { status: body.status }),
      ...(body.notes        !== undefined && { notes: body.notes }),
      ...(body.assignedToId !== undefined && { assignedToId: body.assignedToId }),
      ...(body.status === "COMPLETED"     && { completedAt: new Date() }),
    },
    include: { order: true },
  });

  // Sync order status
  const newOrderStatus = body.status ? JOB_TO_ORDER_STATUS[body.status] : undefined;
  if (newOrderStatus) {
    await db.salesOrder.update({
      where: { id: job.orderId },
      data:  { status: newOrderStatus },
    });

    // Audit log (non-fatal)
    try {
      await db.salesOrderLog.create({
        data: {
          orderId: job.orderId,
          userId,
          action: newOrderStatus,
          note:   `Production job ${body.status}. ${body.notes ?? ""}`.trim(),
        },
      });
    } catch { /* non-fatal */ }

    // Notify Inngest
  }

  return NextResponse.json(updated);
}
