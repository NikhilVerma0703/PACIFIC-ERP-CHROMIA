// Finished-goods dashboard KPIs. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate } from "@/lib/inventory/access";
import { sweepExpiredReservations } from "@/lib/inventory/finishedSlab";

const db = prisma as any;

export async function GET() {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    await sweepExpiredReservations(); // lapsed PI holds -> AVAILABLE before we count
    const [total, byGrade, byStatus, byThickness, pendingPolish, pendingRw] = await Promise.all([
      db.finishedSlab.count(),
      db.finishedSlab.groupBy({ by: ["grade"], _count: { _all: true }, where: { status: { not: "DISPATCHED" } } }), // grades = stock on hand
      db.finishedSlab.groupBy({ by: ["status"], _count: { _all: true } }),
      db.finishedSlab.groupBy({ by: ["slabThickness"], _count: { _all: true }, where: { status: { not: "DISPATCHED" } } }), // thickness = stock on hand
      db.finishedSlab.count({ where: { repolishStatus: "Repolish Required" } }),
      db.finishedSlab.count({ where: { rwStatus: "RW Required and ongoing" } }),
    ]);
    const g_ = (grade: string) => byGrade.find((r: any) => r.grade === grade)?._count?._all ?? 0;
    const s_ = (status: string) => byStatus.find((r: any) => r.status === status)?._count?._all ?? 0;
    const t_ = (thk: string) => byThickness.find((r: any) => r.slabThickness === thk)?._count?._all ?? 0;
    return Response.json({
      total,
      gradeA: g_("A"), gradeA2: g_("A2"), gradeB: g_("B"), gradeC: g_("C"),
      cts: g_("CTS"), printing: g_("Printing"),
      thk12cm: t_("1.2 cm"), thk2cm: t_("2 cm"), thk3cm: t_("3 cm"),
      available: s_("AVAILABLE"), reserved: s_("RESERVED"), packed: s_("PACKED"), dispatched: s_("DISPATCHED"), returned: s_("RETURNED"),
      pendingPolish, pendingRw,
    });
  } catch (e) {
    console.error("Inventory KPI error:", e);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
