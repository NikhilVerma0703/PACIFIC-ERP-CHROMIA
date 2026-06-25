// GET /api/fab/packages
// Returns all packages with piece details for the Packages tab.

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.fabRole) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const packages = await prisma.fabPackage.findMany({
    include: {
      pieces: {
        include: {
          piece: {
            include: {
              project:     { select: { projectCode: true, customerName: true } },
              drawing:     { select: { drawingNumber: true } },
              requirement: { select: { pieceLabel: true, length: true, width: true } },
              slab:        { select: { slabCode: true, colour: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json(packages.map(pkg => ({
    id:          pkg.id,
    packageCode: pkg.packageCode,
    remarks:     pkg.remarks,
    createdAt:   pkg.createdAt,
    pieceCount:  pkg.pieces.length,
    projects:    [...new Set(pkg.pieces.map(pp => pp.piece.project?.projectCode ?? "UNKNOWN"))],
    pieces: pkg.pieces.map(pp => ({
      id:            pp.piece.id,
      pieceCode:     pp.piece.pieceCode,
      projectCode:   pp.piece.project?.projectCode ?? "UNKNOWN",
      customerName:  pp.piece.project?.customerName ?? "",
      drawingNumber: pp.piece.drawing?.drawingNumber ?? null,
      pieceLabel:    pp.piece.requirement?.pieceLabel ?? null,
      length:        pp.piece.requirement?.length ?? null,
      width:         pp.piece.requirement?.width ?? null,
      slabCode:      pp.piece.slab?.slabCode ?? null,
      slabColour:    pp.piece.slab?.colour ?? null,
    })),
  })));
}
