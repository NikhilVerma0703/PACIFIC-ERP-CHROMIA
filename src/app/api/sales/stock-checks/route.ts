/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

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
          sp: { select: { name: true, email: true } },
          proformaInvoices: {
            where: { status: "ACCEPTED" },
            take: 1,
            select: { piNumber: true, items: true, currency: true },
          },
        },
      },
      checkedBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(checks);
}
