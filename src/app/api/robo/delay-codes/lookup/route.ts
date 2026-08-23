import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";
export async function GET(req: NextRequest) {
  const refused = await roboGate();
  if (refused) return refused;
  const code = req.nextUrl.searchParams.get("code")?.toUpperCase();
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
  const dc = await prisma.roboDelayCode.findUnique({ where: { code } });
  if (!dc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(dc);
}
