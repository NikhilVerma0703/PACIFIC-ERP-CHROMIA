import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const projects = await prisma.fabProject.findMany({
    include: {
      drawings: { include: { requirements: true } },
      requirements: true,
      _count: { select: { pieces: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return Response.json(projects);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { projectCode, customerName, requirements, remarks } = body;
    if (!projectCode || !customerName || !requirements?.length) {
      return Response.json({ error: "projectCode, customerName and requirements required" }, { status: 400 });
    }

    const totalPieces = requirements.reduce((s: number, r: any) => s + (r.quantity || 0), 0);
    const project = await prisma.$transaction(async (tx) => {
      const proj = await tx.fabProject.create({
        data: { projectCode, customerName, numberOfPieces: totalPieces, remarks },
      });
      const drawingsMap = new Map<string, string>();
      const uniqueDrawings = [...new Set(requirements.map((r: any) => r.drawingNumber))];
      for (const dn of uniqueDrawings) {
        const sample = requirements.find((r: any) => r.drawingNumber === dn);
        const drawing = await tx.fabDrawing.create({
          data: { projectId: proj.id, drawingNumber: dn as string, unitType: sample.unitType, units: sample.units, areaName: sample.areaName },
        });
        drawingsMap.set(dn as string, drawing.id);
      }
      for (const r of requirements) {
        const sinkRequired = (r.sinkCuts ?? 0) > 0 || !!(r.sinkModel?.trim());
        const polishRequired = (r.depLength ?? 0) > 0;
        await tx.fabRequirement.create({
          data: {
            projectId:   proj.id,
            drawingId:   drawingsMap.get(r.drawingNumber),
            pieceLabel:  r.pieceLabel,
            description: r.description,
            slabCode:    r.description ?? r.pieceLabel ?? "UNKNOWN",
            length:      r.length    ?? null,
            width:       r.width     ?? null,
            thickness:   r.thickness ?? null,
            quantity:    r.quantity  || 1,
            sinkRequired,
            fabricationRequired: sinkRequired,
            polishRequired,
            sinkModel:    r.sinkModel,
            sinkCuts:     r.sinkCuts,
            faucetCount:  r.faucets,
            depLength:    r.depLength    ?? null,
            jointCount:   r.joints,
            sqftPerPiece: r.sqftPerPiece,
            totalSqft:    r.totalSqft,
            notes:        r.notes,
          },
        });
      }
      return proj;
    });
    return Response.json({ success: true, projectId: project.id });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
