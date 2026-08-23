import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { roboGate } from "@/lib/rbac";

export async function GET() {
  const refused = await roboGate();
  if (refused) return refused;
  const shifts = await prisma.roboShift.findMany({
    include: {
      batchRecipes: { include: { design: true, program: true } },
      productionRecords: true,
      delayLogs: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(shifts);
}

export async function POST(req: Request) {
  const refused = await roboGate();
  if (refused) return refused;
  const body = await req.json();
  try {
    // Serializable so the check-then-create is atomic: when two devices start a
    // shift in the same instant, one transaction conflicts and lands in the
    // catch below — there can never be two ACTIVE shifts.
    const shift = await prisma.$transaction(async (tx) => {
      const active = await tx.roboShift.findFirst({ where: { status: "ACTIVE" } });
      if (active) return null;
      return tx.roboShift.create({
        data: {
          date:             body.date,
          shiftNumber:      Number(body.shiftNumber),
          startTime:        body.startTime,
          operatorName:     body.operatorName || "",
          notes:            body.notes || null,
        },
      });
    }, { isolationLevel: "Serializable" });
    if (!shift) return NextResponse.json({ error: "A shift is already active." }, { status: 409 });
    return NextResponse.json(shift, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "P2034") {
      return NextResponse.json({ error: "A shift is already active." }, { status: 409 });
    }
    console.error("Shift POST error:", err);
    return NextResponse.json({ error: "Failed to start shift" }, { status: 500 });
  }
}
