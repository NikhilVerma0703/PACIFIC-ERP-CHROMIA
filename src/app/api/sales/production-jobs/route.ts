/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

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
          sp:     { select: { name: true } },
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

  return NextResponse.json(jobs);
}
