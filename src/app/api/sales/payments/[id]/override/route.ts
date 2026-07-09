/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * POST /api/sales/payments/[id]/override
 * Manager/Admin-only: mark a payment division as "override reviewed".
 * The payment stays PENDING but the reminder cron will skip it.
 * Sends a DELETE body `{ note }` to clear the override.
 *
 * POST  → set override (SALES_ADMIN only)
 * DELETE → clear override (SALES_ADMIN only)
 */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

async function guard(session: any) {
  const salesRole = (session?.user as any)?.salesRole as string | null;
  if (!salesRole) return false;
  // Only SALES_ADMIN can override — not regular SP, COMMERCIAL, ACCOUNTS, PM
  return salesRole === "SALES_ADMIN";
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await guard(session)) return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({} as any));
  const note = typeof body.note === "string" ? body.note.trim() : "";

  // Raw SQL update — overridden_at and override_note added by migrate-phase17.js
  await db.$executeRaw`
    UPDATE sales_payment_divisions
    SET overridden_at = now(),
        overridden_by_id = ${(session.user as any).id},
        override_note = ${note || null}
    WHERE id = ${id}
  `;

  const division = await db.salesPaymentDivision.findUnique({ where: { id } });
  if (!division) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.salesOrderLog.create({
    data: {
      orderId: division.orderId,
      userId:  (session.user as any).id,
      action:  "PAYMENT_OVERRIDE_SET",
      note:    `Payment override set for ${division.type} division. Note: ${note || "(none)"}`,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await guard(session)) return NextResponse.json({ error: "Forbidden — Admin only" }, { status: 403 });

  const { id } = await params;

  await db.$executeRaw`
    UPDATE sales_payment_divisions
    SET overridden_at = NULL,
        overridden_by_id = NULL,
        override_note = NULL
    WHERE id = ${id}
  `;

  const division = await db.salesPaymentDivision.findUnique({ where: { id } });
  if (!division) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.salesOrderLog.create({
    data: {
      orderId: division.orderId,
      userId:  (session.user as any).id,
      action:  "PAYMENT_OVERRIDE_CLEARED",
      note:    `Payment override cleared for ${division.type} division.`,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
