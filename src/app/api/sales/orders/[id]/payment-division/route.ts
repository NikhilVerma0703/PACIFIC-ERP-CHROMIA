/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";

const db = prisma as any;

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
    await db.$queryRawUnsafe(
      `UPDATE sales_payment_divisions
       SET overridden_at = now(), overridden_by_id = $1, override_note = $2, status = 'PAID', updated_at = now()
       WHERE id = $3 AND order_id = $4`,
      callerId,
      note ?? null,
      divisionId,
      orderId
    );
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
