import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  return NextResponse.json(await prisma.roboDesign.findMany({ include: { programs: true }, orderBy: { name: "asc" } }));
}
export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const { name, seriesName } = await req.json();
  const data = await prisma.roboDesign.create({ data: { name, seriesName } });
  return NextResponse.json(data, { status: 201 });
}
