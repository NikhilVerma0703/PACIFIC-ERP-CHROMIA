/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getSpMap } from "@/lib/sales/spLookup";

const db = prisma as any;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const isAdmin    = salesRole === "SALES_ADMIN";
  const isAccounts = salesRole === "ACCOUNTS";

  if (!isAdmin && !isAccounts) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url   = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "10");
  const page  = parseInt(url.searchParams.get("page")  ?? "1");
  const from  = url.searchParams.get("from");
  const to    = url.searchParams.get("to");

  const divisions = await db.salesPaymentDivision.findMany({
    where: {
      ...(from || to ? {
        dueDate: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to + "T23:59:59Z") } : {}),
        },
      } : {}),
    },
    include: {
      order: {
        include: {
          client:           { select: { name: true, country: true, id: true } },
          proformaInvoices: {
            where:   { status: { in: ["ACCEPTED", "SENT", "DRAFT", "UNDER_REVISION"] } },
            orderBy: { createdAt: "desc" },
            take:    1,
            select:  { piNumber: true, id: true },
          },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit,
    skip: (page - 1) * limit,
  });

  // Fetch raw-SQL-only fields: override columns (migrate-phase17.js) and
  // amount_received (scripts/0024, part payments) — none are in the Prisma schema.
  const ids: string[] = divisions.map((d: any) => d.id);
  const overrideMap: Record<string, { overriddenAt: string | null; overrideNote: string | null; amountReceived: number | null }> = {};
  if (ids.length) {
    try {
      const rows: any[] = await db.$queryRawUnsafe(
        `SELECT id, overridden_at, override_note, amount_received FROM sales_payment_divisions WHERE id = ANY($1::text[])`,
        ids
      );
      for (const row of rows) {
        overrideMap[row.id] = {
          overriddenAt: row.overridden_at ? new Date(row.overridden_at).toISOString() : null,
          overrideNote: row.override_note ?? null,
          amountReceived: row.amount_received == null ? null : Number(row.amount_received),
        };
      }
    } catch {
      // Column not yet created (pre-migration) — safe to ignore
    }
  }

  // order.spId has no Prisma relation (no hard FK) — stitch SP info in
  const spMap = await getSpMap(divisions.map((d: any) => d.order?.spId));

  const now = new Date();
  const enriched = divisions.map((d: any) => ({
    ...d,
    order: d.order
      ? { ...d.order, sp: spMap.get(d.order.spId) ?? null }
      : d.order,
    isOverdue:    !d.paidAt && d.dueDate && new Date(d.dueDate) < now,
    overriddenAt: overrideMap[d.id]?.overriddenAt ?? null,
    overrideNote: overrideMap[d.id]?.overrideNote ?? null,
    amountReceived: overrideMap[d.id]?.amountReceived ?? null,
  }));

  return NextResponse.json(enriched);
}
