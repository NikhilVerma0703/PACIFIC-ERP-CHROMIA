/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getSpMap } from "@/lib/sales/spLookup";

const db = prisma as any;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const isAdmin   = salesRole === "SALES_ADMIN";
  const isCommercial = salesRole === "COMMERCIAL";

  if (!isAdmin && !isCommercial) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const checks = await db.salesStockCheck.findMany({
    include: {
      order: {
        include: {
          client: { select: { name: true, country: true } },
          proformaInvoices: {
            where: { status: "ACCEPTED" },
            take: 1,
            select: { piNumber: true, items: true, currency: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // spId/checkedById carry no Prisma relation (no hard FK) — stitch users in
  const userMap = await getSpMap(
    checks.flatMap((c: any) => [c.order?.spId, c.checkedById])
  );
  return NextResponse.json(checks.map((c: any) => ({
    ...c,
    order: c.order ? { ...c.order, sp: userMap.get(c.order.spId) ?? null } : c.order,
    checkedBy: c.checkedById ? (userMap.get(c.checkedById) ?? null) : null,
  })));
}
