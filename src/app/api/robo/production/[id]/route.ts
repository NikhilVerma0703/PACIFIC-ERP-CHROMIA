import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await prisma.roboProductionRecord.findUnique({
    where: { id },
    include: { batchRecipe: { include: { design: true, program: true, entries: { include: { machine: true } } } }, shift: true, delayLogs: { include: { delayCode: true } } },
  });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(record);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.status !== undefined)          data.status = body.status;
  if (body.remarks !== undefined)         data.remarks = body.remarks;
  if (body.inTime !== undefined)          data.inTime = body.inTime;
  if (body.outTime !== undefined)         data.outTime = body.outTime;
  if (body.roymixCycleTime !== undefined) data.roymixCycleTime = body.roymixCycleTime ? Number(body.roymixCycleTime) : null;
  const record = await prisma.roboProductionRecord.update({ where: { id }, data });
  return NextResponse.json(record);
}
