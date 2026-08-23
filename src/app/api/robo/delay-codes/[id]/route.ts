import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: RouteContext) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await ctx.params;
  const code = await prisma.roboDelayCode.findUnique({ where: { id } });
  if (!code) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(code);
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await ctx.params;
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.description !== undefined)     data.description = body.description;
  if (body.category !== undefined)        data.category = body.category;
  if (body.isRobotSpecific !== undefined) data.isRobotSpecific = body.isRobotSpecific;
  const updated = await prisma.roboDelayCode.update({ where: { id }, data });
  return NextResponse.json(updated);
}

/** Refuses to delete a delay code that has already been logged against production. */
export async function DELETE(_req: Request, ctx: RouteContext) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await ctx.params;

  const logged = await prisma.roboDelayLog.count({ where: { delayCodeId: id } });
  if (logged > 0) {
    return NextResponse.json(
      { error: `This delay code has been logged ${logged} time${logged === 1 ? "" : "s"}. Deleting it would break those records.` },
      { status: 409 }
    );
  }

  await prisma.roboDelayCode.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
