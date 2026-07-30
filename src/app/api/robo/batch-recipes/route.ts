import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const shiftId = req.nextUrl.searchParams.get("shiftId");
  const where = shiftId ? { shiftId } : {};
  const data = await prisma.roboBatchRecipe.findMany({
    where,
    include: {
      design: true,
      program: true,
      entries: { include: { machine: true } },
      _count: { select: { productionRecords: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Look up or create Design (optional — only if designName provided)
    let designId: string | null = null;
    if (body.designName?.trim()) {
      const existing = await prisma.roboDesign.findUnique({ where: { name: body.designName.trim() } });
      if (existing) {
        designId = existing.id;
      } else {
        const created = await prisma.roboDesign.create({ data: { name: body.designName.trim() } });
        designId = created.id;
      }
    }

    const recipe = await prisma.roboBatchRecipe.create({
      data: {
        shiftId:     body.shiftId,
        designId:    designId,
        designName:  body.designName?.trim() || "",
        programName: "", // no longer global — stored per machine entry
        targetSlabs: body.targetSlabs ? Number(body.targetSlabs) : null,
        thickness:   body.thickness ? Number(body.thickness) : null,
        notes:       body.notes || null,
        entries: {
          create: (body.entries || []).map((e: {
            machineId: string; programName?: string; toolName?: string; liquidName?: string;
            powderName?: string; rollerHeight?: string; targetCycleTime?: number | null;
          }) => ({
            machineId:       e.machineId,
            programName:     e.programName || null,
            toolName:        e.toolName || null,
            liquidName:      e.liquidName || null,
            powderName:      e.powderName || null,
            rollerHeight:    e.rollerHeight || null,
            targetCycleTime: e.targetCycleTime ? Number(e.targetCycleTime) : null,
          })),
        },
      },
      include: { entries: { include: { machine: true } } },
    });
    return NextResponse.json(recipe, { status: 201 });
  } catch (err) {
    console.error("BatchRecipe POST error:", err);
    return NextResponse.json({ error: "Failed to create batch recipe" }, { status: 500 });
  }
}
