// GET   /api/office/commercial/orders/[id] — the order detail (DESIGN.md §5)
// PATCH /api/office/commercial/orders/[id] — header edit; checklist re-prefilled; event "edited"
//
// One header field is not an ordinary edit: the advance percentage (round two,
// answer 11) is the dispatch gate itself, so an edit that LOWERS it takes the
// same desk as the waiver (answer 12). See advancePctChange below.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, paramId } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { changedFields } from "@/lib/commercial/orders-rules";
import { advancePctChange, effectiveAdvancePct, fmtPct } from "@/lib/commercial/receipts-rules";
import { advanceDefaults, db, headerPatchFromBody, loadClient, loadOrderDetail, loadOrderWithItems, refreshChecklist } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "orders");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    return json(plain(await loadOrderDetail(id)));
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "orders");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const existing = await loadOrderWithItems(id);
    const body = await readBody<Record<string, unknown>>(req);
    const data = headerPatchFromBody(body, { allowKind: true, allowClient: true });
    if (data.clientId && data.clientId !== existing.clientId) await loadClient(String(data.clientId));
    const changed = changedFields(existing, data);
    if (changed.length === 0) {
      return json(plain(await loadOrderDetail(id)));
    }
    // Round two, answers 11 and 12: the advance percentage IS the dispatch
    // gate, so lowering it here is the same act as waiving it — and the waiver
    // is the Commercial Manager's, with a reason. Typing 0 (or clearing the box
    // back to a lower default, or switching the kind to one with a lower
    // default) used to let a write-level login open dispatch outright, with no
    // reason, no stamp and nothing in the log to explain the truck. Both
    // figures are the percentages in force, so only a real lowering is caught.
    let advanceLowered: { from: number; to: number } | null = null;
    if (changed.includes("advancePct") || changed.includes("kind")) {
      const defaults = await advanceDefaults();
      const from = effectiveAdvancePct(existing.advancePct, String(existing.kind ?? ""), defaults);
      const nextKind = String((changed.includes("kind") ? data.kind : existing.kind) ?? "");
      const nextPct = changed.includes("advancePct") ? data.advancePct : existing.advancePct;
      const to = effectiveAdvancePct(nextPct, nextKind, defaults);
      const move = advancePctChange(from, to);
      if (!move.ok) {
        const c = await commercialGate("cancel", "orders");
        if (!c.ok) fail(403, move.reason);
        // The manager may, and does — but the log says it in the same words the
        // waiver does, so "why did this one leave unpaid" has an answer here too.
        advanceLowered = { from, to };
      }
    }
    const patch: Record<string, unknown> = {};
    for (const k of changed) patch[k] = data[k];
    try {
      await db.commercialOrder.update({ where: { id }, data: patch });
    } catch (e) {
      if ((e as { code?: string }).code === "P2003") fail(400, "That client or enquiry does not exist");
      throw e;
    }
    await refreshChecklist(id);
    await logOrderEvent(id, "edited", {
      note: `Edited ${changed.join(", ")}`
        + (advanceLowered ? ` — the advance asked before dispatch was lowered from ${fmtPct(advanceLowered.from)} to ${fmtPct(advanceLowered.to)}` : ""),
      by: g.user,
      payload: { fields: changed, ...(advanceLowered ? { advanceLowered } : {}) },
    });
    return json(plain(await loadOrderDetail(id)));
  });
}
