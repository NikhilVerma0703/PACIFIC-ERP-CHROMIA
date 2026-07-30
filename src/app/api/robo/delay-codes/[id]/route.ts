import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const code = await prisma.roboDelayCode.findUnique({ where: { id } });
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(code);
}
