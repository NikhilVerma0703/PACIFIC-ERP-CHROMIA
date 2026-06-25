// GET /api/fab/slabs
// Returns PolishQc slabs that have passed QC and are available for fabrication.
// Called by erp-v4's /api/slabs to populate the supervisor's slab picker.
//
// A slab is "available" when:
//   - rwStatus is null/empty OR not "RW" (no rework pending)
//   - dispatchStatus is null/empty OR not "Dispatched" (not yet shipped out)
//   - slabNumber is present

import { prisma } from "@/lib/prisma";

const THICKNESS_MAP: Record<string, number> = {
  "2cm": 20,
  "3cm": 30,
  "1.2cm": 12,
  "1.5cm": 15,
  "2.5cm": 25,
};

function parseThicknessMm(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const normalised = raw.trim().toLowerCase();
  if (THICKNESS_MAP[normalised]) return THICKNESS_MAP[normalised];
  // Try to extract a number directly (e.g. "30mm" → 30, "3" → 30 assuming cm)
  const mm = parseFloat(normalised);
  if (!isNaN(mm)) return mm < 10 ? mm * 10 : mm; // treat <10 as cm
  return null;
}

export async function GET() {
  try {
    const qcSlabs = await prisma.polishQc.findMany({
      where: {
        slabNumber: { not: null },
        // Exclude rework slabs — must use OR because NOT: {} also filters out NULLs in SQL
        OR: [
          { rwStatus: null },
          { rwStatus: { not: "RW" } },
        ],
      },
      select: {
        id: true,
        slabNumber: true,
        batchNumber: true,
        design: true,
        slabThickness: true,
        qualityGrade: true,
        dispatchStatus: true,
        rwStatus: true,
        sku: true,
        batchKey: true,
      },
      orderBy: { slabNumber: "asc" },
    });

    // Filter out already-dispatched slabs
    const available = qcSlabs.filter(
      (s) =>
        !s.dispatchStatus ||
        (s.dispatchStatus.toLowerCase() !== "dispatched" &&
          s.dispatchStatus.toLowerCase() !== "yes")
    );

    return Response.json(
      available.map((s) => ({
        // id used by erp-v4 as the "pacificQcId" reference
        pacificQcId: s.id,
        // slabCode = slab number as string (e.g. "1350")
        slabCode: String(s.slabNumber),
        batchKey: s.batchKey ?? s.batchNumber ?? null,
        // design = colour/material in erp-v4 terms
        colour: s.design ?? s.sku ?? null,
        material: s.sku ?? null,
        thicknessMm: parseThicknessMm(s.slabThickness),
        qualityGrade: s.qualityGrade ?? null,
        // Standard quartz slab dimensions in mm (3200 × 1600)
        length: 3200,
        width: 1600,
        source: "pacific_qc" as const,
      }))
    );
  } catch (error) {
    console.error("[fab/slabs]", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
