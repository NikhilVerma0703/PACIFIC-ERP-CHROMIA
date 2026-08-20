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
        take: 25,
        include: { delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } } },
      },
      // The shift-level delayLogs list that used to be here is gone. Nothing
      // read it — RoboEntryForm is this route's only caller and its ActiveShift
      // type never declared it — and with the delays now nested under each
      // record it was a second copy of the same rows. The tablet refetches this
      // after every save, so both halves of that were paid for repeatedly.
      //
      // `take: 25` for the same reason: the form renders records.slice(0, 10)
      // and otherwise uses only records.length, so 500 rows plus their delays
      // were being downloaded to draw ten.
    },
  });
  if (!shift) return NextResponse.json(null);
  return NextResponse.json(shift);
}
