/* eslint-disable @typescript-eslint/no-explicit-any */
// GET /api/sales/pi/samples — return cutting entries with purpose=Sample for PI line item picker
import { salesAuth as auth } from "@/lib/sales/session";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const db = prisma as any;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = (session.user as any).salesRole as string | null;
  const mainRole  = (session.user as any).role as string | null;

  if (!salesRole && mainRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const samples = await db.cuttingEntry.findMany({
      where: { purpose: "Sample" },
      orderBy: { cutDate: "desc" },
      take: 200,
      select: {
        id: true,
        slabNumber: true,
        batchKey: true,
        design: true,
        cutDate: true,
        lengthCm: true,
        widthCm: true,
        thicknessMm: true,
        quantity: true,
        remarks: true,
      },
    });
    return NextResponse.json(samples);
  } catch {
    return NextResponse.json({ error: "Failed to fetch samples" }, { status: 500 });
  }
}
