import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const shift = await prisma.roboShift.findFirst({
    where: { status: "ACTIVE" },
    include: {
      batchRecipes: { include: { design: true, program: true, entries: { include: { machine: true } } }, orderBy: { createdAt: "asc" } },
      // delayLogs nested under each record, not only on the shift: the Recent
      // slabs table's Remarks column shows a slab's delays alongside its own
      // remark, the same way Slabs Records does, and it cannot pair them up
      // from a flat shift-level list.
      productionRecords: {
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } } },
      },
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "desc" }, take: 500 },
    },
  });
  if (!shift) return NextResponse.json(null);
  return NextResponse.json(shift);
}
