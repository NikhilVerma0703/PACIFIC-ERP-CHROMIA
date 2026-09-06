// GET   /api/office/commercial/proformas/[piId] — one revision, snapshot and all
// PATCH /api/office/commercial/proformas/[piId] — edit a DRAFT: { notes,
//       snapshot? } (or the snapshot fields flat in the body). Only the fields
//       applyDraftPatch allows move; totals and the amount in words are
//       re-derived whenever lines or the discount change, and the row's
//       totalAmount / currency follow the snapshot so the register never
//       disagrees with the paper.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { applyDraftPatch, canEditDraft, piLabel } from "@/lib/commercial/proforma-rules";
import { db, loadProforma, snapshotOf, piIdOf } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ piId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const piId = await piIdOf(params);
    return json(plain(await loadProforma(piId)));
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const piId = await piIdOf(params);
    const pi = await loadProforma(piId);
    if (!canEditDraft(pi.status)) fail(409, `Only a draft can be edited (this revision is ${pi.status.toLowerCase()})`);

    const body = await readBody<Record<string, unknown>>(req);
    const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");
    // Either shape is accepted: { snapshot: {...} } from a form that edits the
    // whole document, or the snapshot's own fields flat in the body from the PI
    // tab's small form. `notes` prints as the PI's Terms & Conditions, so it
    // lives on the snapshot as well as the row.
    const patchSource = (body.snapshot && typeof body.snapshot === "object" && !Array.isArray(body.snapshot))
      ? { ...(body.snapshot as Record<string, unknown>), ...(hasNotes ? { notes: body.notes } : {}) }
      : body;

    const { snapshot, changed } = applyDraftPatch(snapshotOf(pi), patchSource);
    const notes = hasNotes ? str(body.notes) : (pi.notes as string | null | undefined) ?? null;
    if (!changed && notes === ((pi.notes as string | null | undefined) ?? null)) {
      return json(plain(await loadProforma(piId)));
    }

    await db.commercialProforma.update({
      where: { id: piId },
      data: { snapshot, notes, currency: snapshot.currency, totalAmount: snapshot.totalAmount },
    });
    await logOrderEvent(pi.orderId, "note", {
      note: `Proforma ${piLabel(pi.number, pi.revision)} draft edited`,
      by: g.user,
      payload: { proformaId: piId, number: pi.number, revision: pi.revision, total: snapshot.totalAmount },
    });
    return json(plain(await loadProforma(piId)));
  });
}
