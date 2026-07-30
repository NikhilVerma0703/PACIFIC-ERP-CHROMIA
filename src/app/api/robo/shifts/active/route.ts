import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const shift = await prisma.roboShift.findFirst({
    where: { status: "ACTIVE" },
    include: {
      batchRecipes: { include: { design: true, program: true, entries: { include: { machine: true } } }, orderBy: { createdAt: "asc" } },
      productionRecords: { orderBy: { createdAt: "desc" }, take: 50 },
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!shift) return NextResponse.json(null);
  return NextResponse.json(shift);
}
