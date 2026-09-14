// Finished-goods dashboard KPIs. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryReadGate, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { sweepExpiredReservations } from "@/lib/inventory/finishedSlab";
import { buildInventoryWhere, approvedOnlyWhere, andWhere, anyCutWhere, slabMarkAvailable, isMissingSlabMarkError } from "@/lib/inventory/searchWhere";
import { isAdmin } from "@/lib/rbac";

const db = prisma as any;

export async function GET(request: Request) {
  const g = await inventoryReadGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) return Response.json({ error: "Not available for this login" }, { status: 403 });
  try {
    // Lapsed PI holds -> AVAILABLE before we count. The one write behind
    // inventoryReadGate, the same one the slabs list makes; the gate's comment
    // in src/lib/inventory/access.ts is the argument for it. Nothing else here
    // writes, and nothing added here may.
    await sweepExpiredReservations();
    // Cards follow the SAME filters as the slab table (empty filters = global).
    const sp = new URL(request.url).searchParams;
    let w: any = await buildInventoryWhere(sp);
    const showPending = sp.get("pending") === "1" && (await isAdmin());
    if (!showPending) w = await approvedOnlyWhere(w);
    // "Stock on hand", the same shape the grade and thickness cards already use.
    const onFloor: any = { ...w, status: w.status ?? { not: "DISPATCHED" } };
    // HOW MANY OF THESE SLABS HAVE BEEN CUT — grade OR mark (searchWhere
    // anyCutWhere). It cannot be `byGrade` + `byMark` added together: a slab
    // can carry both signals, so a sum would double-count it. One counted query
    // with an OR is the only shape that cannot.
    //
    // AND THE FALLBACK IS GONE. This used to catch a missing slab_mark and
    // re-count on the grade alone, with a comment saying that "keeps the card
    // reading today's 60 rather than 500ing the whole KPI strip". THAT COMMENT
    // WAS TRUE FOR ONE DAY. scripts/0071 and 0072 then regraded all 63 cut
    // slabs from 'CTS' to 'B', and the grade count now reads 0 — measured on
    // live Neon 2026-09-03: zero rows with grade 'CTS'/'SAMPLE' anywhere, 61
    // cut slabs on the floor, all grade 'B' and mark 'CTS'. So the fallback
    // stopped being a smaller true number and became a false one, printed in
    // the same confident type as the real thing.
    //
    // `null` INSTEAD, and the card renders "?". A KPI strip that cannot say how
    // much stock has been cut must say that, not say "none": nobody quotes
    // against a question mark, and everybody quotes against a zero. The rest of
    // the strip (statuses, grades, thicknesses) does not depend on the mark and
    // still answers, so one unreadable column does not take the whole header
    // down either.
    const hasMark = await slabMarkAvailable();
    const cutCount: Promise<number | null> = hasMark
      ? db.finishedSlab
          .count({ where: andWhere(onFloor, anyCutWhere(true)) })
          // The column can be dropped from under a stale client between the
          // probe and this query. Same answer as above: unknown, not zero.
          .catch((e: any) => {
            if (!isMissingSlabMarkError(e)) throw e;
            return null;
          })
      : Promise.resolve(null);
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
      //              read from here on. 61 on the floor today, ALL of them found
      //              by the mark: since scripts/0071 and 0072 no slab anywhere
      //              carries a cut GRADE, so the grade arm of the OR contributes
      //              nothing and the mark is carrying this number alone.
      //              `null` when the mark could not be read — see above; it is
      //              "we cannot tell", and the dashboard prints "?" for it. It
      //              is NEVER 0 to mean unknown, because 0 is also a real and
      //              very different answer.
      //   cts        the SAME NUMBER (or the same null), under the older key the
      //              dashboard's CTS card already reads. Kept so nothing on the
      //              screen goes blank on deploy, and widened from `g_("CTS")`
      //              for the reason this whole change exists: a grade-only count
      //              now reads zero while the yard holds 61 cut slabs.
      //
      //              NOTE FOR WHOEVER READS THIS CARD ON THE DASHBOARD: it
      //              OVERLAPS gradeA/A2/B/C. All 61 are grade 'B' and are
      //              counted there too, so this number must never be added into
      //              the grade cards — see InventoryDashboard, which for that
      //              reason no longer renders it inside the "Grades" block.
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
