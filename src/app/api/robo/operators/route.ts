import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";

export async function GET(req: NextRequest) {
  const refused = await roboGate();
  if (refused) return refused;
  const activeOnly = req.nextUrl.searchParams.get("active");
  const where = activeOnly === "true" ? { isActive: true } : {};
  const operators = await prisma.roboOperator.findMany({
    where,
    orderBy: { name: "asc" },
  });
  return NextResponse.json(operators);
}

export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const { name } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  const existing = await prisma.roboOperator.findUnique({ where: { name: name.trim() } });
  if (existing) {
    return NextResponse.json({ error: "Operator already exists" }, { status: 409 });
  }
  const op = await prisma.roboOperator.create({ data: { name: name.trim() } });
  return NextResponse.json(op, { status: 201 });
}
