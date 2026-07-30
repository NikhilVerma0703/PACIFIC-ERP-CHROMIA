import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const shiftId = req.nextUrl.searchParams.get("shiftId");
  const where: Record<string, string> = {};
  if (shiftId) where.shiftId = shiftId;
  const data = await prisma.roboProductionRecord.findMany({
    where,
    include: { batchRecipe: true, shift: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json();
  // One transaction: the slab record and its delay logs land together or not at
  // all, so a mid-write failure can't leave a half-saved slab that duplicates
  // on retry.
  const record = await prisma.$transaction(async (tx) => {
    const rec = await tx.roboProductionRecord.create({
      data: {
        serialNumber:    body.serialNumber ? Number(body.serialNumber) : null,
        slabNumber:      body.slabNumber,
        shiftId:         body.shiftId,
        batchRecipeId:   body.batchRecipeId || null,
        inTime:          body.inTime || null,
        outTime:         body.outTime || null,
        roymixCycleTime:  body.roymixCycleTime ? Number(body.roymixCycleTime) : null,
        roymixBodyWeight: body.roymixBodyWeight ? Number(body.roymixBodyWeight) : null,
        status:          body.status || "COMPLETED",
        remarks:         body.remarks || null,
      },
      include: { batchRecipe: true, shift: true },
    });
    if (Array.isArray(body.delays) && body.delays.length > 0) {
      await tx.roboDelayLog.createMany({
        data: body.delays.map((d: { delayCodeId: string; machineId?: string; machineName?: string; durationMinutes: number; startTime?: string; endTime?: string; remarks?: string }) => ({
          shiftId:            body.shiftId,
          productionRecordId: rec.id,
          machineId:          d.machineId || null,
          machineName:        d.machineName || null,
          delayCodeId:        d.delayCodeId,
          durationMinutes:    Number(d.durationMinutes),
          startTime:          d.startTime || null,
          endTime:            d.endTime || null,
          remarks:            d.remarks || null,
        })),
      });
    }
    return rec;
  });

  return NextResponse.json(record, { status: 201 });
}
