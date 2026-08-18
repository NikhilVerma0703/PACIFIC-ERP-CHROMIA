import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() {
  return NextResponse.json(await prisma.roboDesign.findMany({ include: { programs: true }, orderBy: { name: "asc" } }));
}
export async function POST(req: Request) {
  const { name, seriesName } = await req.json();
  const data = await prisma.roboDesign.create({ data: { name, seriesName } });
  return NextResponse.json(data, { status: 201 });
}
