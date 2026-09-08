// GET /api/office/commercial/proformas — the PI register: every PI of every
// order, newest first, filtered by ?status=, ?orderId=, ?clientId= and ?q=
// (the number or the client's name), paged with ?page=&limit=. Each row
// carries `date`, the PI's printed date, so the register can show it under
// the number (answer 6) without shipping the whole snapshot. Cancelled PIs
// stay in the register, marked (answer 24).
//
// A cancelled row also carries `replacedByNumber`, resolved HERE. Round two,
// answer 8 has the register print "replaced by <number>" beside a struck
// -through one, and proforma-rules.replacementOf resolves that from the
// siblings on screen — which works on the order's PI tab, where every PI of
// the order is in hand, and does NOT work in this cross-order register, where
// the replacement is a different order's PI or simply on the next page. A
// number resolved off a short page would leave a bare id on the customer's
// register, so the number comes off a second read of the ids this page names.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain } from "@/lib/commercial/http";
import { pageArgs, parseProformaStatus, type PiSnapshot } from "@/lib/commercial/proforma-rules";
import { db, PI_LIST_SELECT } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view", "proforma");
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
    const rowsOnPage = rows as Array<Record<string, unknown> & { snapshot: PiSnapshot | null; replacedById?: string | null }>;
    // The distinct non-null links this page names — one extra read, however
    // many cancelled rows point at the same replacement, and none at all when
    // nothing on the page was replaced.
    const replacedIds = [...new Set(rowsOnPage.map((r) => r.replacedById).filter((id): id is string => Boolean(id)))];
    const replacements: Array<{ id: string; number: string }> = replacedIds.length
      ? await db.commercialProforma.findMany({ where: { id: { in: replacedIds } }, select: { id: true, number: true } })
      : [];
    const numberOf = new Map(replacements.map((p) => [p.id, p.number]));

    const items = rowsOnPage.map(({ snapshot, ...r }) => ({
      ...r,
      date: snapshot?.date ?? null,
      bankKey: snapshot?.bankKey ?? null,
      revises: snapshot?.revises ?? null,
      // null when the link points at a PI that no longer exists — the row
      // prints as cancelled with its reason, never as a bare id.
      replacedByNumber: r.replacedById ? numberOf.get(r.replacedById) ?? null : null,
    }));
    return json(plain({ items, total, page, limit }));
  });
}
