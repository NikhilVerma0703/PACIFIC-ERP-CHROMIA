/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

async function generateCreditNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.salesCreditNote.count();
  return `CN-${year}-${String(count + 1).padStart(4, "0")}`;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const orderId          = searchParams.get("orderId");
  const clientId         = searchParams.get("clientId");
  const appliedToOrderId = searchParams.get("appliedToOrderId");

  // clientId and appliedToOrderId queries use raw SQL because applied_to_order_id
  // is not in the Prisma schema (added via migrate-phase11.js raw migration).

  if (clientId) {
    // Fetch ISSUED, unapplied CNs for a client (used in PI new form + order apply UI)
    const notes = await db.$queryRaw`
      SELECT
        cn.id,
        cn.order_id            AS "orderId",
        cn.credit_number       AS "creditNumber",
        cn.reason,
        cn.description,
        cn.amount::float8      AS amount,
        cn.currency,
        cn.status,
        cn.notes,
        cn.inspected_at        AS "inspectedAt",
        cn.issued_at           AS "issuedAt",
        cn.created_at          AS "createdAt",
        cn.updated_at          AS "updatedAt",
        cn.created_by_id       AS "createdById",
        cn.applied_to_order_id AS "appliedToOrderId",
        cn.applied_at          AS "appliedAt",
        json_build_object(
          'orderNumber', o.order_number,
          'client', json_build_object('name', c.name, 'id', c.id)
        ) AS "order"
      FROM sales_credit_notes cn
      JOIN sales_orders  o ON o.id = cn.order_id
      JOIN sales_clients c ON c.id = o.client_id
      WHERE cn.status = 'ISSUED'
        AND cn.applied_to_order_id IS NULL
        AND o.client_id = ${clientId}
      ORDER BY cn.created_at DESC
    `;
    return NextResponse.json(notes);
  }

  if (appliedToOrderId) {
    // Fetch CNs that were applied to a specific order
    const notes = await db.$queryRaw`
      SELECT
        cn.id,
        cn.order_id            AS "orderId",
        cn.credit_number       AS "creditNumber",
        cn.reason,
        cn.description,
        cn.amount::float8      AS amount,
        cn.currency,
        cn.status,
        cn.notes,
        cn.inspected_at        AS "inspectedAt",
        cn.issued_at           AS "issuedAt",
        cn.created_at          AS "createdAt",
        cn.updated_at          AS "updatedAt",
        cn.created_by_id       AS "createdById",
        cn.applied_to_order_id AS "appliedToOrderId",
        cn.applied_at          AS "appliedAt",
        json_build_object(
          'orderNumber', o.order_number,
          'client', json_build_object('name', c.name, 'id', c.id)
        ) AS "order"
      FROM sales_credit_notes cn
      JOIN sales_orders  o ON o.id = cn.order_id
      JOIN sales_clients c ON c.id = o.client_id
      WHERE cn.applied_to_order_id = ${appliedToOrderId}
      ORDER BY cn.created_at DESC
    `;
    return NextResponse.json(notes);
  }

  // Default: fetch by orderId (or all if no filter)
  const where: any = orderId ? { orderId } : {};

  const notes = await db.salesCreditNote.findMany({
    where,
    include: {
      order:     { select: { orderNumber: true, client: { select: { name: true, id: true } } } },
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(notes);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id as string;
  const body = await req.json() as {
    orderId: string;
    reason: string;
    description?: string;
    amount: number;
    currency?: string;
    notes?: string;
  };

  if (!body.orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });
  if (!body.reason)  return NextResponse.json({ error: "reason required" }, { status: 400 });
  if (body.amount === undefined || body.amount === null || body.amount < 0)
    return NextResponse.json({ error: "amount must be >= 0" }, { status: 400 });

  const order = await db.salesOrder.findUnique({ where: { id: body.orderId } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const creditNumber = await generateCreditNumber();

  const cn = await db.salesCreditNote.create({
    data: {
      orderId:      body.orderId,
      creditNumber,
      reason:       body.reason,
      description:  body.description ?? null,
      amount:       body.amount,
      currency:     body.currency ?? order.currency ?? "USD",
      notes:        body.notes ?? null,
      status:       "PENDING_INSPECTION",
      createdById:  userId,
    },
  });

  await db.salesOrderLog.create({
    data: {
      orderId: body.orderId,
      userId,
      action: "CREDIT_NOTE_CREATED",
      note: `${creditNumber} — ${body.reason} — ${cn.currency} ${cn.amount}`,
    },
  }).catch(() => {});

  return NextResponse.json(cn, { status: 201 });
}
