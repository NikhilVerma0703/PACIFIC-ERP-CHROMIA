import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  const where = category ? { category } : {};
  const codes = await prisma.roboDelayCode.findMany({
    where,
    orderBy: { code: "asc" },
  });
  return NextResponse.json(codes);
}

export async function POST(req: Request) {
  const { code, description, category, isRobotSpecific } = await req.json();
  if (!code?.trim() || !description?.trim() || !category?.trim()) {
    return NextResponse.json(
      { error: "Code, description, and category are required" },
      { status: 400 }
    );
  }
  const existing = await prisma.roboDelayCode.findUnique({ where: { code: code.trim() } });
  if (existing) {
    return NextResponse.json({ error: "Delay code already exists" }, { status: 409 });
  }
  const created = await prisma.roboDelayCode.create({
    data: {
      code: code.trim(),
      description: description.trim(),
      category: category.trim(),
      isRobotSpecific: isRobotSpecific || false,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
