// GET /api/fab/excel-to-clo-csv?projectId=xxx
//
// Reads project requirements from DB and returns two CLO Optimizer Excel files.
// Values are stored raw (as-is from the original Excel) -- no unit conversion needed.
//
// Response: { xlsx2cm, xlsx3cm, mapping, counts }

import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

export const maxDuration = 30;

// thickness stored as raw Excel value (e.g. parseFloat("3cm") = 3, parseFloat("2cm") = 2)
function thickBucket(t: number): 2 | 3 | null {
  const rounded = Math.round(t);
  if (rounded === 2) return 2;
  if (rounded === 3) return 3;
  return null;
}

function buildXlsx(rows: { label: string; length: number; width: number; quantity: number }[]): string {
  const sheetData = [
    ["Label", "Length", "Width", "Quantity"],
    ...rows.map((r) => [r.label, r.length, r.width, r.quantity]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "CLO Import");
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.fabRole)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId)
    return Response.json({ error: "projectId required" }, { status: 400 });

  const project = await prisma.fabProject.findUnique({
    where: { id: projectId },
    include: { drawings: { include: { requirements: true } } },
  });
  if (!project)
    return Response.json({ error: "Project not found" }, { status: 404 });

  type MappingRow = {
    label: string;
    drawingNumber: string;
    pieceLabel: string;
    length: number;
    width: number;
    thickness: number;
    quantity: number;
    bucket: 2 | 3 | null;
  };

  const mapping: MappingRow[] = [];

  for (const drawing of project.drawings) {
    for (const req of drawing.requirements) {
      const dwg   = drawing.drawingNumber ?? "";
      const piece = req.pieceLabel?.trim() ?? "";
      const label = dwg && piece ? `${dwg}-${piece}` : `${dwg || "?"}-?`;
      const thick = req.thickness ?? 0;

      mapping.push({
        label,
        drawingNumber: dwg,
        pieceLabel:    piece,
        length:        req.length   ?? 0,
        width:         req.width    ?? 0,
        thickness:     thick,
        quantity:      req.quantity,
        bucket:        thickBucket(thick),
      });
    }
  }

  const rows2cm   = mapping.filter((r) => r.bucket === 2);
  const rows3cm   = mapping.filter((r) => r.bucket === 3);
  const rowsOther = mapping.filter((r) => r.bucket === null);

  return Response.json({
    xlsx2cm:  buildXlsx(rows2cm),
    xlsx3cm:  buildXlsx(rows3cm),
    mapping,
    counts: {
      total: mapping.length,
      cm2:   rows2cm.length,
      cm3:   rows3cm.length,
      other: rowsOther.length,
    },
  });
}
