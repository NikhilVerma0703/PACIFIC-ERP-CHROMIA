// Finished-goods inventory search. Filters: design (colour), batch, thickness,
// grade, slab number, bay, status. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryReadGate } from "@/lib/inventory/access";
import { sweepExpiredReservations } from "@/lib/inventory/finishedSlab";
import { buildInventoryWhere, approvedOnlyWhere, getUnapprovedSlabNumbers } from "@/lib/inventory/searchWhere";
import { isAdmin } from "@/lib/rbac";

const db = prisma as any;
const SQFT_TO_SQM = 0.092903;

function withDerived(r: any) {
  const sqft = ((r.lengthIn ?? 0) * (r.widthIn ?? 0)) / 144;
  const ageDays = r.firstSeenAt ? Math.max(0, Math.floor((Date.now() - new Date(r.firstSeenAt).getTime()) / 86400000)) : null;
  return { ...r, sqft: Math.round(sqft * 100) / 100, sqm: Math.round(sqft * SQFT_TO_SQM * 100) / 100, ageDays };
}

export async function GET(request: Request) {
  const g = await inventoryReadGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  try {
    // Lapsed PI holds -> AVAILABLE before we report. This is the one write
    // behind inventoryReadGate, and the gate's own comment in
    // src/lib/inventory/access.ts is where it is argued for and where it has to
    // stay named: the clock picks the rows, not the caller, so a view-grant
    // login triggers it and cannot aim it. Nothing else in this handler writes,
    // and nothing added to it may.
    await sweepExpiredReservations();
    const { searchParams } = new URL(request.url);
    let where: any = await buildInventoryWhere(searchParams);
    // Unapproved stock is ADMIN-only, and only when explicitly requested.
    const showPending = searchParams.get("pending") === "1" && (await isAdmin());
    // AND THE SCREEN IS TOLD WHAT IT IS NOT BEING SHOWN. The gate hides any slab
    // whose design+batch Sales has not approved — every source, not just this
    // one — and it used to do it in silence: a filter could match 21 slabs and
    // list 16 with nothing to say the other 5 existed. That silence is what
    // made "Entered by hand does not show all the slabs I entered by hand" look
    // like a broken filter. The count rides back in a header so the response
    // body stays the bare array every caller already parses.
    let withheld = 0;
    if (!showPending) {
      const pending = await getUnapprovedSlabNumbers(false);
      if (pending.length) {
        withheld = await db.finishedSlab.count({ where: { ...where, slabNumber: { in: pending } } });
        where = await approvedOnlyWhere(where, { pending });
      }
    }

    // Real slab numbers first (newest on top); NB-series legacy slabs
    // (9,000,000+, no original number) always sort to the BOTTOM.
    const NB_FLOOR = 9000000;
    let rows;
    if (where.slabNumber !== undefined) {
      rows = await db.finishedSlab.findMany({ where, orderBy: { slabNumber: "desc" }, take: 1000 });
    } else {
      const normal = await db.finishedSlab.findMany({
        where: { ...where, slabNumber: { lt: NB_FLOOR } },
        orderBy: { slabNumber: "desc" }, take: 1000,
      });
      const room = 1000 - normal.length;
      const nb = room > 0
        ? await db.finishedSlab.findMany({
            where: { ...where, slabNumber: { gte: NB_FLOOR } },
            orderBy: { slabNumber: "asc" }, take: room,
          })
        : [];
      rows = [...normal, ...nb];
    }
    // display canonical design names (merged variants show their correct name)
    const aliasRows: any[] = await db.designAlias.findMany({ select: { variant: true, canonical: true } }).catch(() => []);
    const amap = new Map<string, string>(aliasRows.map((x) => [x.variant, x.canonical]));
    rows = rows.map((r: any) => (r.design && amap.has(r.design) ? { ...r, design: amap.get(r.design) } : r));
    return Response.json(rows.map(withDerived), {
      headers: { "X-Withheld-Unapproved": String(withheld) },
    });
  } catch (e) {
    console.error("Inventory search error:", e);
    return Response.json([], { status: 500 });
  }
}
