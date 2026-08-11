import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await prisma.roboDesign.update({ where: { id }, data: await req.json() });
  return NextResponse.json(data);
}
/** Refuses to delete a design that production history still points at. */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [programs, setups] = await Promise.all([
    prisma.roboProgram.count({ where: { designId: id } }),
    prisma.roboBatchRecipe.count({ where: { designId: id } }),
  ]);

  if (programs > 0 || setups > 0) {
    const used: string[] = [];
    if (programs > 0) used.push(`${programs} program${programs === 1 ? "" : "s"}`);
    if (setups > 0) used.push(`${setups} production setup${setups === 1 ? "" : "s"}`);
    return NextResponse.json(
      { error: `This design is in use by ${used.join(" and ")}. Remove those first.` },
      { status: 409 }
    );
  }

  await prisma.roboDesign.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
