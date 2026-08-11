import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SLAB_COMPLETED, SLAB_IN_PROCESSING } from "@/lib/robo/utils";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await prisma.roboProductionRecord.findUnique({
    where: { id },
    include: {
      batchRecipe: { include: { design: true, program: true, entries: { include: { machine: true } } } },
      shift: true,
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(record);
}

/**
 * PATCH /api/robo/production/[id] — update an existing slab in place.
 * Supplying an Out Time moves the slab from In-Processing to Completed.
 * `delays` appends new delay logs; existing ones are left untouched.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (body.slabNumber !== undefined)       data.slabNumber = body.slabNumber;
  if (body.remarks !== undefined)          data.remarks = body.remarks || null;
  if (body.inTime !== undefined)           data.inTime = body.inTime || null;
  if (body.outTime !== undefined)          data.outTime = body.outTime || null;
  if (body.roymixCycleTime !== undefined)  data.roymixCycleTime = body.roymixCycleTime ? Number(body.roymixCycleTime) : null;
  if (body.roymixBodyWeight !== undefined) data.roymixBodyWeight = body.roymixBodyWeight ? Number(body.roymixBodyWeight) : null;

  if (body.status !== undefined) {
    data.status = body.status;
  } else if (body.outTime !== undefined) {
    data.status = body.outTime ? SLAB_COMPLETED : SLAB_IN_PROCESSING;
  }

  // One transaction: the slab update and its appended delay logs land together
  // or not at all, so a mid-write failure can't leave a half-saved edit.
  const record = await prisma.$transaction(async (tx) => {
    const rec = await tx.roboProductionRecord.update({ where: { id }, data });
    if (Array.isArray(body.delays) && body.delays.length > 0) {
      await tx.roboDelayLog.createMany({
        data: body.delays.map((d: { delayCodeId: string; machineId?: string; machineName?: string; durationMinutes: number; startTime?: string; endTime?: string; remarks?: string }) => ({
          shiftId:            rec.shiftId,
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

  return NextResponse.json(record);
}
