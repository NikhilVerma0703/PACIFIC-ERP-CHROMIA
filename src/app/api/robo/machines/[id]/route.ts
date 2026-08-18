import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const data = await prisma.roboMachine.update({ where: { id }, data: body });
  return NextResponse.json(data);
}
/**
 * Deactivates a machine only when nothing references it. A machine that has run
 * production or carried a delay is kept, so history stays intact — deactivate
 * it instead.
 */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [entries, delays] = await Promise.all([
    prisma.roboBatchRecipeEntry.count({ where: { machineId: id } }),
    prisma.roboDelayLog.count({ where: { machineId: id } }),
  ]);

  if (entries > 0 || delays > 0) {
    const used: string[] = [];
    if (entries > 0) used.push(`${entries} production setup${entries === 1 ? "" : "s"}`);
    if (delays > 0) used.push(`${delays} delay log${delays === 1 ? "" : "s"}`);
    return NextResponse.json(
      { error: `This machine is used by ${used.join(" and ")}. Deactivate it instead of deleting.` },
      { status: 409 }
    );
  }

  await prisma.roboMachine.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
