import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await params;
  const shift = await prisma.roboShift.findUnique({
    where: { id },
    include: {
      batchRecipes: { include: { design: true, program: true, entries: { include: { machine: true } } } },
      productionRecords: { orderBy: { createdAt: "desc" } },
      delayLogs: { include: { delayCode: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!shift) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(shift);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await params;
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.status)            data.status = body.status;
  if (body.endTime)           data.endTime = body.endTime;
  if (body.notes !== undefined) data.notes = body.notes;
  const shift = await prisma.roboShift.update({ where: { id }, data });
  return NextResponse.json(shift);
}
