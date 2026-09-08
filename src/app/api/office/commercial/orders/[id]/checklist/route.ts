// GET   /api/office/commercial/orders/[id]/checklist — the sheet, its stamps and
//       who is looking (the "Prepared by" default is the signed-in name)
// PATCH /api/office/commercial/orders/[id]/checklist
//   { items: [{ key, value?, ok? }] }  values / ok by key (known keys only)
//   { check: true }                    stamps checkedBy* — "prepared / checked by"
//   { approve: true }                  stamps approvedBy* — the "approve" action
//                                      (answer 10: the Commercial Manager or an admin)
// Any combination in one call. Events "checklist" / "approved".
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { CHECKLIST_POINTS, parseChecklist, prefillChecklist, outstandingPoints } from "@/lib/commercial/checklist";
import { canApprove } from "@/lib/commercial/orders-rules";
import { db, loadOrderDetail, loadOrderWithItems, checklistSourceOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

interface Body {
  items?: Array<{ key?: unknown; value?: unknown; ok?: unknown }>;
  check?: unknown;
  approve?: unknown;
}

// Not exported: a route file may only export handlers and config, and Next
// type-checks that.
const APPROVE_REFUSED = "Only the Commercial Manager or an admin approves";

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "checklist");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const order = await loadOrderWithItems(id);
    const stamp = actorStamp(g.user);
    return json(plain({
      checklist: parseChecklist(order.checklist),
      checkedByName: order.checkedByName ?? null, checkedAt: order.checkedAt ?? null,
      approvedByName: order.approvedByName ?? null, approvedAt: order.approvedAt ?? null,
      viewer: { name: stamp.name, canApprove: canApprove(g.actor) },
    }));
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "checklist");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const order = await loadOrderWithItems(id);
    const body = await readBody<Body>(req);
    const wantCheck = body.check === true;
    const wantApprove = body.approve === true;
    const incoming = Array.isArray(body.items) ? body.items : [];
    if (!wantCheck && !wantApprove && incoming.length === 0) fail(400, "Nothing to change: send items, check: true or approve: true");
    if (wantApprove) {
      // Filling and checking are write; the approval alone is the narrower
      // action, asked for only once the body says that is what this call is.
      const a = await commercialGate("approve", "checklist");
      if (!a.ok || !canApprove(a.actor)) fail(403, APPROVE_REFUSED);
    }

    const data: Record<string, unknown> = {};
    const now = new Date();
    const stamp = actorStamp(g.user);
    let touched: string[] = [];

    if (incoming.length) {
      const known = new Set(CHECKLIST_POINTS.map((p) => p.key));
      const list = parseChecklist(order.checklist);
      const byKey = new Map(list.map((i) => [i.key, i]));
      for (const raw of incoming) {
        const key = typeof raw.key === "string" ? raw.key : "";
        const item = known.has(key) ? byKey.get(key) : undefined;
        if (!item) continue;
        if (raw.value !== undefined) item.value = raw.value == null ? "" : String(raw.value).trim();
        if (raw.ok !== undefined) item.ok = Boolean(raw.ok);
        touched.push(key);
      }
      touched = Array.from(new Set(touched));
      // a point blanked by hand gets the order's own answer back
      data.checklist = prefillChecklist(list, checklistSourceOf(order, order.items));
    }
    if (wantCheck) { data.checkedById = stamp.id; data.checkedByName = stamp.name; data.checkedAt = now; }
    if (wantApprove) { data.approvedById = stamp.id; data.approvedByName = stamp.name; data.approvedAt = now; }

    await db.commercialOrder.update({ where: { id }, data });
    const finalList = (data.checklist as ReturnType<typeof parseChecklist> | undefined) ?? parseChecklist(order.checklist);
    const open = outstandingPoints(finalList).length;
    if (touched.length || wantCheck) {
      await logOrderEvent(id, "checklist", {
        note: wantCheck ? `Checklist prepared and checked by ${stamp.name ?? "—"}${open ? ` · ${open} point${open === 1 ? "" : "s"} outstanding` : " · all points settled"}` : `Checklist updated: ${touched.join(", ")}`,
        by: g.user,
        payload: { keys: touched, checked: wantCheck, outstanding: open },
      });
    }
    if (wantApprove) {
      await logOrderEvent(id, "approved", { note: `Checklist approved by ${stamp.name ?? "—"} (Commercial Manager)`, by: g.user, payload: { outstanding: open } });
    }
    return json(plain(await loadOrderDetail(id)));
  });
}
