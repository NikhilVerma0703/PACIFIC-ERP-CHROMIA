import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() {
  return NextResponse.json(await prisma.roboProgram.findMany({ include: { design: true }, orderBy: { name: "asc" } }));
}
export async function POST(req: Request) {
  const { name, designId } = await req.json();
  const data = await prisma.roboProgram.create({ data: { name, designId } });
  return NextResponse.json(data, { status: 201 });
}
