/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { generateOrderNumber } from "@/lib/sales/orderNumber";

const db = prisma as any;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const { id } = await params;

  const pi = await db.proformaInvoice.findUnique({ where: { id } });
  if (!pi)                  return Response.json({ error: "Not found" }, { status: 404 });
  if (pi.status !== "SENT") return Response.json({ error: "Only SENT PIs can be accepted" }, { status: 400 });
  if (pi.orderId)           return Response.json({ error: "Order already exists for this PI" }, { status: 400 });

  // Read paymentTermsData via raw SQL (not in Prisma schema to avoid P2022 if column missing)
  let pt: any = {};
  try {
    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT payment_terms_data FROM proforma_invoices WHERE id = $1`, id
    );
    pt = rows[0]?.payment_terms_data ?? {};
  } catch { /* column not yet created — treat as no terms */ }

  const orderNumber = await generateOrderNumber();
  const total       = Number(pi.totalAmount ?? 0);

  // Build payment division rows from the PI's stored payment terms
  type DivRow = { type: string; percentage: number; amount: number; deadlineDays: number | null };
  const divRows: DivRow[] = [];
  const push = (type: string, pct: number, days?: number | null) => {
    if (pct > 0) divRows.push({ type, percentage: pct, amount: +(total * pct / 100).toFixed(2), deadlineDays: days ?? null });
  };
  push("ADVANCE",        pt.advancePct      ?? 0);
  push("CAD",            pt.cadPct          ?? 0);
  push("BL_TO_PAY",      pt.blToPayPct      ?? 0, pt.blToPayDays);
  push("RECEIVE_TO_PAY", pt.receiveToPayPct ?? 0, pt.receiveToPayDays);
  push("INSPECTION",     pt.inspectionPct   ?? 0, pt.inspectionDays);
  push("CREDIT",         pt.creditPct       ?? 0, pt.creditDays);

  // Fallback: if no structured terms were set, create a single ADVANCE 100% division
  // so Accounts always has a record to action (mark as paid / override)
  if (divRows.length === 0) {
    divRows.push({ type: "ADVANCE", percentage: 100, amount: +total.toFixed(2), deadlineDays: null });
  }

  const result = await db.$transaction(async (tx: any) => {
    // 1. Mark PI accepted
    const updatedPi = await tx.proformaInvoice.update({
      where: { id },
      data:  { status: "ACCEPTED", acceptedAt: new Date() },
    });

    // 2. Create the order (PENDING_PAYMENT)
    const order = await tx.salesOrder.create({
      data: {
        orderNumber,
        clientId:      pi.clientId,
        spId:          pi.spId,
        status:        "PENDING_PAYMENT",
        totalAmount:   pi.totalAmount,
        currency:      pi.currency,
        deliveryTerms: pi.deliveryTerms,
        // Payment terms record (if percentages exist on the PI)
        ...(Object.keys(pt).length > 0 ? {
          paymentTerms: {
            create: {
              advancePct:       pt.advancePct       ?? 0,
              cadPct:           pt.cadPct           ?? 0,
              inspectionPct:    pt.inspectionPct    ?? 0,
              inspectionDays:   pt.inspectionDays   ?? null,
              receiveToPayPct:  pt.receiveToPayPct  ?? 0,
              receiveToPayDays: pt.receiveToPayDays ?? null,
              blToPayPct:       pt.blToPayPct       ?? 0,
              blToPayDays:      pt.blToPayDays      ?? null,
              creditPct:        pt.creditPct        ?? 0,
              creditDays:       pt.creditDays       ?? null,
            },
          },
        } : {}),
      },
    });

    // 3. Create payment divisions so Accounts can see + action them
    await tx.salesPaymentDivision.createMany({
      data: divRows.map(d => ({
        orderId:      order.id,
        type:         d.type,
        percentage:   d.percentage,
        amount:       d.amount,
        deadlineDays: d.deadlineDays,
        status:       "PENDING",
      })),
    });

    // 4. Create stock check immediately — locked for Commercial until advance paid
    await tx.salesStockCheck.create({
      data: { orderId: order.id, status: "PENDING" },
    });

    // 5. Link PI → order
    await tx.proformaInvoice.update({
      where: { id },
      data:  { orderId: order.id },
    });

    // 6. Audit log
    await tx.salesOrderLog.create({
      data: {
        orderId: order.id,
        userId,
        action: "ORDER_CREATED",
        note:   `Auto-created from accepted PI ${pi.piNumber}`,
      },
    }).catch(() => {});

    return { pi: updatedPi, order };
  });

  return Response.json(result);
}
