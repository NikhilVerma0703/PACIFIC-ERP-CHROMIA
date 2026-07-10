/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { getSp, getSpMap } from "@/lib/sales/spLookup";

const db = prisma as any;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  // Fetch order without logs first (logs have a known column-type bug until migration runs)
  const order = await db.salesOrder.findUnique({
    where: { id },
    include: {
      client:           true,
      proformaInvoices: { include: { rejectionLogs: { orderBy: { rejectedAt: "desc" } } } },
      paymentTerms:     true,
      paymentDivisions: { orderBy: { createdAt: "asc" } },
      stockCheck:       true,
      productionJob:    true,
      packages:         { include: { packingList: true } },
      shipmentDocs:     true,
      portArrival:      true,
      adminAlerts:      { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) return Response.json({ error: "Not found" }, { status: 404 });

  // spId has no Prisma relation (no hard FK) — resolve separately
  const sp = await getSp(order.spId);

  // Fetch logs separately so an error doesn't break the whole response.
  // userId has no relation either — stitch user names in afterwards.
  let logs: any[] = [];
  try {
    const logRows = await db.salesOrderLog.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const userMap = await getSpMap(logRows.map((l: any) => l.userId));
    logs = logRows.map((l: any) => ({
      ...l,
      user: { name: userMap.get(l.userId)?.name ?? null },
    }));
  } catch { /* non-fatal */ }

  // Supplement paymentDivisions with new columns (extended_due_date, overridden_at, override_note)
  // that are not yet in the Prisma schema
  if (order.paymentDivisions?.length > 0) {
    try {
      const divIds = order.paymentDivisions.map((d: any) => d.id);
      const placeholders = divIds.map((_: any, i: number) => `$${i + 1}`).join(",");
      const extras: any[] = await db.$queryRawUnsafe(
        `SELECT id, extended_due_date, overridden_at, override_note, amount_received
         FROM sales_payment_divisions
         WHERE id IN (${placeholders})`,
        ...divIds
      );
      const extraMap = new Map(extras.map((r: any) => [r.id, r]));
      order.paymentDivisions = order.paymentDivisions.map((d: any) => {
        const ex = extraMap.get(d.id);
        if (!ex) return d;
        return {
          ...d,
          extendedDueDate: ex.extended_due_date ?? null,
          overriddenAt: ex.overridden_at ?? null,
          overrideNote: ex.override_note ?? null,
          amountReceived: ex.amount_received == null ? null : Number(ex.amount_received),
        };
      });
    } catch { /* non-fatal — new columns may not exist yet */ }
  }

  return Response.json({ ...order, sp, logs });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid = (session.user as any).id as string;
  const { id } = await params;
  const body = await req.json();
  const { deliveryTerms, notes, status } = body;

  const order = await db.salesOrder.update({
    where: { id },
    data: {
      ...(deliveryTerms !== undefined ? { deliveryTerms } : {}),
      ...(notes         !== undefined ? { notes }         : {}),
      ...(status        !== undefined ? { status }        : {}),
    },
  });

  // Audit log (non-fatal)
  if (status) {
    try {
      await db.salesOrderLog.create({
        data: { orderId: id, userId: uid, action: "STATUS_CHANGED", note: `→ ${status}` },
      });
    } catch { /* ignore until column type fixed */ }
  }

  return Response.json(order);
}
