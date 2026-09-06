// GET /api/office/commercial/packing-lists — every list, by status, with the
// order and client beside it and the fit counts the queue reads.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain } from "@/lib/commercial/http";
import { pageArgs, parsePackingStatus, fitCounts } from "@/lib/commercial/packing-rules";
import { db } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const status = parsePackingStatus(u.searchParams.get("status"));
    const orderId = (u.searchParams.get("orderId") ?? "").trim();
    const q = (u.searchParams.get("q") ?? "").trim();
    const { page, limit, skip, take } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (orderId) where.orderId = orderId;
    if (q) {
      where.OR = [
        { number: { contains: q, mode: "insensitive" } },
        { containerNo: { contains: q, mode: "insensitive" } },
        { order: { number: { contains: q, mode: "insensitive" } } },
        { order: { client: { name: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const [rows, total, groups] = await Promise.all([
      db.commercialPackingList.findMany({
        where, orderBy: { createdAt: "desc" }, skip, take,
        select: {
          id: true, number: true, status: true, orderId: true, containerNo: true, vehicleNo: true,
          grossWeightKg: true, netWeightKg: true, packagesSummary: true,
          createdByName: true, createdAt: true, submittedAt: true, verifiedAt: true, verifiedByName: true,
          finalisedAt: true, dispatchedAt: true, verificationNote: true,
          order: { select: { id: true, number: true, kind: true, status: true, client: { select: { id: true, name: true, country: true } } } },
          crates: { select: { id: true } },
          slabs: { select: { fit: true, sqm: true } },
        },
      }),
      db.commercialPackingList.count({ where }),
      db.commercialPackingList.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    const counts: Record<string, number> = {};
    for (const x of groups as Array<{ status: string; _count: { _all: number } }>) counts[x.status] = x._count._all;

    const items = (rows as Array<Record<string, unknown>>).map((r) => {
      const slabs = (r.slabs as Array<{ fit: string; sqm: unknown }>) ?? [];
      const crates = (r.crates as Array<unknown>) ?? [];
      const { slabs: _s, crates: _c, ...rest } = r; void _s; void _c;
      return {
        ...rest,
        crateCount: crates.length,
        slabCount: slabs.length,
        fit: fitCounts(slabs),
        sqm: slabs.reduce((a, s) => a + (Number(s.sqm) || 0), 0),
      };
    });
    return json(plain({ items, total, page, limit, counts }));
  });
}
