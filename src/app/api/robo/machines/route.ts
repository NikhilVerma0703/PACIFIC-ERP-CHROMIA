import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  const data = await prisma.roboMachine.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(data);
}
export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const body = await req.json();
  const data = await prisma.roboMachine.create({ data: { name: body.name, type: body.type } });
  return NextResponse.json(data, { status: 201 });
}
