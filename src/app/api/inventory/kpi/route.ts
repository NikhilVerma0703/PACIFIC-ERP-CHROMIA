// Finished-goods dashboard KPIs. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { sweepExpiredReservations } from "@/lib/inventory/finishedSlab";
import { buildInventoryWhere, approvedOnlyWhere, andWhere, anyCutWhere, slabMarkAvailable, isMissingSlabMarkError } from "@/lib/inventory/searchWhere";
import { isAdmin } from "@/lib/rbac";

const db = prisma as any;

export async function GET(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) return Response.json({ error: "Not available for this login" }, { status: 403 });
  try {
    await sweepExpiredReservations(); // lapsed PI holds -> AVAILABLE before we count
    // Cards follow the SAME filters as the slab table (empty filters = global).
    const sp = new URL(request.url).searchParams;
    let w: any = await buildInventoryWhere(sp);
    const showPending = sp.get("pending") === "1" && (await isAdmin());
    if (!showPending) w = await approvedOnlyWhere(w);
    // "Stock on hand", the same shape the grade and thickness cards already use.
    const onFloor: any = { ...w, status: w.status ?? { not: "DISPATCHED" } };
    // HOW MANY OF THESE SLABS HAVE BEEN CUT — grade OR mark (searchWhere
    // anyCutWhere). It cannot be `byGrade` + `byMark` added together: all 62
    // live CTS slabs carry BOTH signals (measured on Neon 2026-09-03), so a sum
    // would report 120 cut slabs where there are 60 on the floor. One counted
    // query with an OR is the only shape that does not double-count during the
    // changeover, when every cut slab has a foot in each column.
    const hasMark = await slabMarkAvailable();
    const cutCount = db.finishedSlab
      .count({ where: andWhere(onFloor, anyCutWhere(hasMark)) })
      // The column can land — or a stale client be regenerated — between the
      // probe and this query. Falling back to the grade count keeps the card
      // reading today's 60 rather than 500ing the whole KPI strip.
      .catch((e: any) => {
        if (!isMissingSlabMarkError(e)) throw e;
        return db.finishedSlab.count({ where: andWhere(onFloor, anyCutWhere(false)) });
      });
    const [total, byGrade, byStatus, byThickness, pendingPolish, pendingRw, cut] = await Promise.all([
      db.finishedSlab.count({ where: w }),
      db.finishedSlab.groupBy({ by: ["grade"], _count: { _all: true }, where: { ...w, status: w.status ?? { not: "DISPATCHED" } } }), // grades = stock on hand
      db.finishedSlab.groupBy({ by: ["status"], _count: { _all: true }, where: w }),
      db.finishedSlab.groupBy({ by: ["slabThickness"], _count: { _all: true }, where: { ...w, status: w.status ?? { not: "DISPATCHED" } } }), // thickness = stock on hand
      db.finishedSlab.count({ where: { ...w, repolishStatus: "Repolish Required" } }),
      db.finishedSlab.count({ where: { ...w, rwStatus: "RW Required and ongoing" } }),
      cutCount,
    ]);
    const g_ = (grade: string) => byGrade.find((r: any) => r.grade === grade)?._count?._all ?? 0;
    const s_ = (status: string) => byStatus.find((r: any) => r.status === status)?._count?._all ?? 0;
    const t_ = (thk: string) => byThickness.find((r: any) => r.slabThickness === thk)?._count?._all ?? 0;
    return Response.json({
      total,
      gradeA: g_("A"), gradeA2: g_("A2"), gradeB: g_("B"), gradeC: g_("C"),
      // THREE THINGS NOW SHARE THE WORD CTS, so each is named for what it
      // actually counts and none of them is left to be guessed at:
      //
      //   cut        slabs that HAVE BEEN CUT — grade says CTS/SAMPLE, or the
      //              mark does. The honest name for the concept, and the one to
      //              read from here on.
      //   cts        the SAME NUMBER, under the older key the dashboard's CTS
      //              card already reads. Kept so nothing on the screen goes
      //              blank on deploy, and widened from `g_("CTS")` for the
      //              reason this whole change exists: once fabrication records
      //              the cut in the MARK instead of overwriting the grade, a
      //              grade-only count reads zero while the yard is full of cut
      //              slabs. 60 on the floor today, by either route.
      //   ctsStatus  the inventory STATUS somebody applied by hand (below). A
      //              different fact about a different column: a slab can carry
      //              the status without having been cut, and — far more often —
      //              be cut without anyone having applied the status. That gap
      //              is why the dispatch rule reads the mark, not the status.
      cut, cts: cut, printing: g_("Printing"),
      thk12cm: t_("1.2 cm"), thk2cm: t_("2 cm"), thk3cm: t_("3 cm"),
      available: s_("AVAILABLE"), reserved: s_("RESERVED"), packed: s_("PACKED"), dispatched: s_("DISPATCHED"), returned: s_("RETURNED"),
      // ctsStatus, not `cts`: this endpoint already returns `cts`/`cut` for the
      // slabs that HAVE BEEN CUT (a few lines up — the grade said so, or the
      // mark does). Two different things share the name in the domain; they
      // must not share it in the payload.
      ctsStatus: s_("CTS"),
      // Slabs the Chromia register has taken for printing (scripts/0063) —
      // written only by the Chromia intake bridge, never by hand.
      chromia: s_("CHROMIA"),
      pendingPolish, pendingRw,
    });
  } catch (e) {
    console.error("Inventory KPI error:", e);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}
