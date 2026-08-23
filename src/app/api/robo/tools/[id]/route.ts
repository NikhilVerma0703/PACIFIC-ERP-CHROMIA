import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await params;
  await prisma.roboTool.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
