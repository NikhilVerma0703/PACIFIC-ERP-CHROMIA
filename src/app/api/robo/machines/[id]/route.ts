import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const data = await prisma.roboMachine.update({ where: { id }, data: body });
  return NextResponse.json(data);
}
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.roboMachine.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
