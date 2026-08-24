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

  // Ownership, on the end being TOUCHED — not both ends unconditionally. The
  // note belongs to a source order, but the picker offers it by CLIENT, and a
  // partially transferred client legitimately has orders under two owners
  // (see lib/sales/ownership.ts: a scoped screen must never offer what the
  // route then refuses; requiring the source here 403'd exactly that).
  //   - editing the note itself (status/amount/notes): the source order — its
  //     owner issued it, nobody else rewrites it;
  //   - applying: the order the credit lands on — that is whose balance
  //     changes, and whose page offered the picker;
  //   - unapplying: the order it currently sits on, with the source accepted
  //     too (either page legitimately shows the remove control).
  // The same-client rule the picker enforces (loadAvailableCNs by clientId)
  // still holds.
  const cn = await db.salesCreditNote.findUnique({ where: { id }, select: { orderId: true } });
  if (!cn) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const touchingApplication = "appliedToOrderId" in body;
  const editingNote = body.status !== undefined || body.amount !== undefined || body.notes !== undefined;
  if (editingNote || !touchingApplication) {
    const refusedSource = await assertOrderVisible(session.user, cn.orderId);
    if (refusedSource) return refusedSource;
  }
  if (touchingApplication) {
    if (body.appliedToOrderId) {
      const refusedTarget = await assertOrderVisible(session.user, body.appliedToOrderId);
      if (refusedTarget) return refusedTarget;
    } else {
      const cur: Array<{ id: string | null }> = await db.$queryRaw`
        SELECT applied_to_order_id AS id FROM sales_credit_notes WHERE id = ${id}`;
      const currentId = cur?.[0]?.id ?? null;
      const refusedCurrent = currentId ? await assertOrderVisible(session.user, currentId) : null;
      if (refusedCurrent) {
        const refusedSource = await assertOrderVisible(session.user, cn.orderId);
        if (refusedSource) return refusedCurrent;
      }
    }
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
