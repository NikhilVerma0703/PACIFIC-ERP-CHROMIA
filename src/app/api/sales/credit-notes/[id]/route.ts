/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { NextResponse } from "next/server";

const db = prisma as any;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json() as {
    status?: string;
    amount?: number;
    notes?: string;
    appliedToOrderId?: string | null;
  };

  // Ownership, both ends. The note belongs to an order; the caller must be able
  // to see that order to touch the note at all, and — when applying it — the
  // order it is applied to as well. The same-client rule the picker enforces
  // (loadAvailableCNs by clientId) still holds; this adds only "and it is
  // yours to see", exactly as the order routes do.
  const cn = await db.salesCreditNote.findUnique({ where: { id }, select: { orderId: true } });
  if (!cn) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const refusedSource = await assertOrderVisible(session.user, cn.orderId);
  if (refusedSource) return refusedSource;
  if (body.appliedToOrderId) {
    const refusedTarget = await assertOrderVisible(session.user, body.appliedToOrderId);
    if (refusedTarget) return refusedTarget;
  }

  const now = new Date();

  // Fields Prisma knows about (in the generated schema)
  const prismaData: any = {};
  if (body.status !== undefined) prismaData.status      = body.status;
  if (body.amount !== undefined) prismaData.amount      = body.amount;
  if (body.notes  !== undefined) prismaData.notes       = body.notes;
  if (body.status === "INSPECTED") prismaData.inspectedAt = now;
  if (body.status === "ISSUED")    prismaData.issuedAt    = now;

  // Update known fields via Prisma ORM (or just fetch if nothing to update)
  let updated: any;
  if (Object.keys(prismaData).length > 0) {
    updated = await db.salesCreditNote.update({ where: { id }, data: prismaData });
  } else {
    updated = await db.salesCreditNote.findUnique({ where: { id } });
  }

  // applied_to_order_id / applied_at are NOT in the Prisma schema (added via
  // migrate-phase11.js). Use raw SQL to update these columns.
  if ("appliedToOrderId" in body) {
    const appliedTo = body.appliedToOrderId ?? null;
    const appliedAt = appliedTo ? now : null;
    await db.$executeRaw`
      UPDATE sales_credit_notes
      SET applied_to_order_id = ${appliedTo},
          applied_at          = ${appliedAt}
      WHERE id = ${id}
    `;
    // Attach to the returned object so callers can read it
    updated = { ...updated, appliedToOrderId: appliedTo, appliedAt };
  }

  const userId = (session.user as any).id as string;

  await db.salesOrderLog.create({
    data: {
      orderId: updated.orderId,
      userId,
      action: "CREDIT_NOTE_UPDATED",
      note: `${updated.creditNumber} -> ${updated.status}`,
    },
  }).catch(() => {});

  if (body.appliedToOrderId) {
    await db.salesOrderLog.create({
      data: {
        orderId: body.appliedToOrderId,
        userId,
        action: "CREDIT_NOTE_APPLIED",
        note: `${updated.creditNumber} — ${updated.currency} ${updated.amount} credit applied from source order`,
      },
    }).catch(() => {});
  }

  return NextResponse.json(updated);
}
