// GET /api/office/commercial/dispatch-check — the dispatch team's queue.
//
// This segment is the ONLY one a verify-only login reaches (access-rules
// isDispatchCheckPath), so everything the floor screen needs comes from here
// and the payload carries the order number and the client name rather than the
// order itself: a store incharge may check slabs, not read the order book.
//
// AND ONLY THE THREE STATUSES THAT ARE THAT JOB. ?status= used to take any
// packing status, so the same screen would list every DRAFT list Commercial had
// open — the register, through the one door the dispatch team has. It is
// clamped to CHECKER_STATUSES now (anything else falls back to the queue), and
// so is the groupBy behind the tab counts, which was counting the lot.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain } from "@/lib/commercial/http";
import { pageArgs, parseCheckerStatus, fitCounts, CHECKER_STATUSES } from "@/lib/commercial/packing-rules";
import { db } from "../packing-lists/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("verify", "dispatchCheck");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    // The queue is SUBMITTED; ?status= lets the same screen look back at what
    // it verified or rejected today — and at nothing else.
    const status = parseCheckerStatus(u.searchParams.get("status"));
    const { page, limit, skip, take } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const where = { status };
    const [rows, total, groups] = await Promise.all([
      db.commercialPackingList.findMany({
        where,
        // Oldest first: the container that has been waiting longest is checked
        // first. FINAL lists (at the loading bay, answer 30) newest first.
        orderBy: status === "SUBMITTED" ? { submittedAt: "asc" } : status === "FINAL" ? { finalisedAt: "desc" } : { verifiedAt: "desc" },
        skip, take,
        select: {
          id: true, number: true, status: true, submittedAt: true, verifiedAt: true, verifiedByName: true, finalisedAt: true,
          verificationNote: true, containerNo: true, vehicleNo: true, packagesSummary: true,
          order: { select: { number: true, kind: true, client: { select: { name: true, country: true } } } },
          crates: { select: { id: true } },
          slabs: { select: { fit: true } },
        },
      }),
      db.commercialPackingList.count({ where }),
      db.commercialPackingList.groupBy({ by: ["status"], where: { status: { in: CHECKER_STATUSES } }, _count: { _all: true } }),
    ]);

    const counts: Record<string, number> = {};
    for (const x of groups as Array<{ status: string; _count: { _all: number } }>) counts[x.status] = x._count._all;

    const items = (rows as Array<Record<string, unknown>>).map((r) => {
      const order = r.order as { number: string; kind: string; client: { name: string; country: string | null } | null };
      const slabs = (r.slabs as Array<{ fit: string }>) ?? [];
      return {
        id: r.id, number: r.number, status: r.status,
        submittedAt: r.submittedAt, verifiedAt: r.verifiedAt, verifiedByName: r.verifiedByName, finalisedAt: r.finalisedAt,
        verificationNote: r.verificationNote,
        containerNo: r.containerNo, vehicleNo: r.vehicleNo, packagesSummary: r.packagesSummary,
        orderNumber: order?.number ?? "", kind: order?.kind ?? "", clientName: order?.client?.name ?? "",
        crateCount: ((r.crates as Array<unknown>) ?? []).length,
        slabCount: slabs.length,
        fit: fitCounts(slabs),
      };
    });
    return json(plain({ items, total, page, limit, counts }));
  });
}
