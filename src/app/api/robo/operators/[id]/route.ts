import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await prisma.roboOperator.findUnique({ where: { id } });
  if (!op) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(op);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  const op = await prisma.roboOperator.update({ where: { id }, data });
  return NextResponse.json(op);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Soft-delete: set isActive = false
  const op = await prisma.roboOperator.update({
    where: { id },
    data: { isActive: false },
  });
  return NextResponse.json(op);
}
