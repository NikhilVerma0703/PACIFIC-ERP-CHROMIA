/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = session.user as any;
  const salesRole = user.salesRole as string | undefined;

  const allowed =
    salesRole === "SALESPERSON" ||
    salesRole === "SALES_ADMIN" ||
    salesRole === "COMMERCIAL"; // production-manager duty retired -> admins
  if (!allowed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { status, note } = body as { status: string; note?: string };

  if (!status) return Response.json({ error: "status is required" }, { status: 400 });

  const db = prisma as any;

  // Payment gate: block PACKING until advance is paid
  if (status === "PACKING") {
    const existing = await db.salesOrder.findUnique({
      where: { id },
      include: { paymentDivisions: true },
    });
    const advanceDivs: any[] = (existing?.paymentDivisions ?? []).filter((d: any) => d.type === "ADVANCE");
    if (advanceDivs.length > 0) {
      const allPaid = advanceDivs.every((d: any) => !!d.paidAt);
      if (!allPaid) {
        return Response.json(
          { error: "Advance payment must be received before moving to Packing.", code: "ADVANCE_UNPAID" },
          { status: 422 }
        );
      }
    }
  }

  const order = await db.salesOrder.update({
    where: { id },
    data: { status },
  });

  try {
    await db.salesOrderLog.create({
      data: {
        orderId: id,
        userId: user.id,
        action: "STATUS_CHANGED",
        note: note ? `-> ${status}: ${note}` : `-> ${status}`,
      },
    });
  } catch { /* non-fatal */ }

  return Response.json(order);
}
