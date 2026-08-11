import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await prisma.roboProgram.update({ where: { id }, data: await req.json() });
  return NextResponse.json(data);
}
/** Refuses to delete a program that a production setup still points at. */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const setups = await prisma.roboBatchRecipe.count({ where: { programId: id } });
  if (setups > 0) {
    return NextResponse.json(
      { error: `This program is in use by ${setups} production setup${setups === 1 ? "" : "s"}. Remove those first.` },
      { status: 409 }
    );
  }

  await prisma.roboProgram.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
