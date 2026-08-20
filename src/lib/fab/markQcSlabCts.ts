// When a physical QC slab is chosen for fabrication, mark it CTS on polish_qc.
// The row stays in stock and in the picker — CTS is a routing grade (cut-to-
// size / fab), not a delete. Shift scoring already treats CTS as "not a
// reject" (shiftScoreMath.ts). Idempotent: setting CTS on a slab that is
// already CTS is a no-op.

import { prisma } from "@/lib/prisma";

export async function markQcSlabCts(pacificQcId: string): Promise<void> {
  if (!pacificQcId) return;
  await prisma.$executeRaw`
    UPDATE polish_qc SET quality_grade = 'CTS' WHERE id = ${pacificQcId}
  `;
}
