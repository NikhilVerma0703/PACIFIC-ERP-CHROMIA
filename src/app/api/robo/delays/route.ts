import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(req: NextRequest) {
  const shiftId = req.nextUrl.searchParams.get("shiftId");
  const where = shiftId ? { shiftId } : {};
  const data = await prisma.roboDelayLog.findMany({
    where,
    include: { delayCode: true, machine: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(data);
}
export async function POST(req: Request) {
  const body = await req.json();
  const data = await prisma.roboDelayLog.create({
    data: {
      shiftId:            body.shiftId,
      productionRecordId: body.productionRecordId || null,
      machineId:          body.machineId || null,
      machineName:        body.machineName || null,
      delayCodeId:        body.delayCodeId,
      durationMinutes:    Number(body.durationMinutes),
      startTime:          body.startTime || null,
      endTime:            body.endTime || null,
      remarks:            body.remarks || null,
    },
    include: { delayCode: true, machine: true },
  });
  return NextResponse.json(data, { status: 201 });
}
