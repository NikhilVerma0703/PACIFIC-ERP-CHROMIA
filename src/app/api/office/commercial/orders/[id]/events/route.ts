// GET /api/office/commercial/orders/[id]/events?page=&limit=&kind= — the order log, newest first
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain, paramId, str } from "@/lib/commercial/http";
import { pageArgs } from "@/lib/commercial/orders-rules";
import { db, loadOrderWithItems } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    await loadOrderWithItems(id);
    const u = new URL(req.url);
    const { page, limit, skip, take } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const kind = str(u.searchParams.get("kind"));
    const where: Record<string, unknown> = { orderId: id };
    if (kind) where.kind = { in: kind.split(",").map((k) => k.trim()).filter(Boolean) };
    const [items, total] = await Promise.all([
      db.commercialOrderEvent.findMany({ where, orderBy: { at: "desc" }, skip, take }),
      db.commercialOrderEvent.count({ where }),
    ]);
    return json(plain({ items, total, page, limit }));
  });
}
