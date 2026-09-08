// GET /api/office/commercial/proformas — the PI register: every PI of every
// order, newest first, filtered by ?status=, ?orderId=, ?clientId= and ?q=
// (the number or the client's name), paged with ?page=&limit=. Each row
// carries `date`, the PI's printed date, so the register can show it under
// the number (answer 6) without shipping the whole snapshot. Cancelled PIs
// stay in the register, marked (answer 24).
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain } from "@/lib/commercial/http";
import { pageArgs, parseProformaStatus, type PiSnapshot } from "@/lib/commercial/proforma-rules";
import { db, PI_LIST_SELECT } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const { page, limit, skip } = pageArgs(u.searchParams.get("page"), u.searchParams.get("limit"));
    const status = parseProformaStatus(u.searchParams.get("status"));
    const orderId = u.searchParams.get("orderId");
    const clientId = u.searchParams.get("clientId");
    const q = (u.searchParams.get("q") ?? "").trim();

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (orderId) where.orderId = orderId;
    if (clientId) where.order = { clientId };
    if (q) {
      where.OR = [
        { number: { contains: q, mode: "insensitive" } },
        { order: { client: { name: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const [rows, total] = await Promise.all([
      db.commercialProforma.findMany({
        where,
        select: { ...PI_LIST_SELECT, snapshot: true, order: { select: { id: true, number: true, kind: true, status: true, client: { select: { id: true, name: true } } } } },
        orderBy: [{ createdAt: "desc" }],
        skip, take: limit,
      }),
      db.commercialProforma.count({ where }),
    ]);
    const items = (rows as Array<Record<string, unknown> & { snapshot: PiSnapshot | null }>).map(({ snapshot, ...r }) => ({
      ...r,
      date: snapshot?.date ?? null,
      bankKey: snapshot?.bankKey ?? null,
      revises: snapshot?.revises ?? null,
    }));
    return json(plain({ items, total, page, limit }));
  });
}
