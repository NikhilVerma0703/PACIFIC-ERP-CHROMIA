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
  const allowed   = salesRole === "SALES_ADMIN"; // production duties belong to module admins
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const jobs = await db.salesProductionJob.findMany({
    include: {
      order: {
        include: {
          client: { select: { name: true, country: true } },
          proformaInvoices: {
            where: { status: "ACCEPTED" },
            take: 1,
            select: { piNumber: true, items: true, currency: true, totalAmount: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // order.spId has no Prisma relation (no hard FK) — stitch SP info in
  const spMap = await getSpMap(jobs.map((j: any) => j.order?.spId));
  return NextResponse.json(jobs.map((j: any) => ({
    ...j,
    order: j.order ? { ...j.order, sp: spMap.get(j.order.spId) ?? null } : j.order,
  })));
}
