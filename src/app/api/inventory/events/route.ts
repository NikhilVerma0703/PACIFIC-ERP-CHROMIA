// Slab audit feed: SlabEvent history — per slab (?slab=123) or the recent
// activity feed. Gated to inventory roles.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { inventoryGate, SLABS_ONLY_ROLES } from "@/lib/inventory/access";
import { getUnapprovedSlabNumbers } from "@/lib/inventory/searchWhere";
import { isAdmin } from "@/lib/rbac";

const db = prisma as any;

export async function GET(request: Request) {
  const g = await inventoryGate();
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (SLABS_ONLY_ROLES.has(String((g.user as any)?.role ?? ""))) return Response.json({ error: "Not available for this login" }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const slabRaw = (searchParams.get("slab") ?? "").trim();
    const slab = slabRaw ? Number(slabRaw) : null;
    if (slabRaw && !Number.isFinite(slab)) return Response.json({ error: "Slab # must be a number" }, { status: 400 });
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 500);
    const where = slab !== null && Number.isFinite(slab) ? { slabNumber: slab } : {};
    let rows = await db.slabEvent.findMany({ where, orderBy: { at: "desc" }, take: limit });
    if (!(await isAdmin())) {
      const unapproved = new Set(await getUnapprovedSlabNumbers());
      rows = rows.filter((r: any) => !unapproved.has(r.slabNumber));
    }
    return Response.json(rows);
  } catch (e) {
    console.error("Inventory events error:", e);
    return Response.json([], { status: 500 });
  }
}
