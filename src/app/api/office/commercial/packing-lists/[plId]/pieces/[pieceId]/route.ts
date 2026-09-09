// PATCH  /…/packing-lists/[plId]/pieces/[pieceId] — edit one cut-to-size line
// DELETE /…/packing-lists/[plId]/pieces/[pieceId] — take the line off the list
//
// A piece line is OURS alone: unlike a packed slab it points at no finished-goods
// row, so removing one moves nothing in the inventory and there is no bridge call
// to make honest here. What it does share with a slab line is when it may be
// touched at all — requireEditable, the rule packing-rules already states.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { piecePatch, matchCrate, pieceLabel, type PieceInput } from "@/lib/commercial/pieces-rules";
import { db, loadList, paramTwo, requireEditable, pieceOf } from "../../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string; pieceId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "packing");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const [plId, pieceId] = await paramTwo(params as Promise<Record<string, string>>, "plId", "pieceId");
    const list = await loadList(plId);
    requireEditable(list);
    const row = list.pieces.find((p) => p.id === pieceId);
    if (!row) fail(404, "That line is not on this list");
    const body = await readBody<Record<string, unknown>>(req);

    // The whole line is re-validated against the row as it stands, so an edit
    // cannot leave behind a line the add route would have refused — and a size
    // or quantity change re-derives the sqft rather than printing the old area
    // against the new size (piecePatch).
    const current: PieceInput = pieceOf(row);
    const patch = piecePatch(current, body);
    if (!patch.ok) fail(400, patch.reason);

    const data: Record<string, unknown> = {};
    for (const k of patch.fields) data[k] = patch.value[k];

    if (Object.prototype.hasOwnProperty.call(body, "crateId")) {
      const crateId = str(body.crateId);
      if (crateId && !list.crates.some((c) => c.id === crateId)) fail(400, "That crate is not on this list");
      data.crateId = crateId;
    } else if (patch.fields.includes("crateNo")) {
      // The typed crate number moved, so the link follows it — a stale link to
      // crate 3 under a line that now reads crate 4 apportions the weight to
      // the wrong crate (matchCrate).
      data.crateId = matchCrate(patch.value.crateNo, list.crates);
    }

    if (!Object.keys(data).length) return json(plain(pieceOf(row)));

    const updated = await db.commercialPackedPiece.update({ where: { id: pieceId }, data });
    await logOrderEvent(list.orderId, "edited", {
      note: `${list.number}: cut-to-size line ${pieceLabel(current)} updated (${Object.keys(data).join(", ")})`,
      by: g.user,
      payload: { packingListId: plId, pieceId, fields: Object.keys(data) },
    });
    return json(plain(pieceOf(updated as Record<string, unknown>)));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "packing");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const [plId, pieceId] = await paramTwo(params as Promise<Record<string, string>>, "plId", "pieceId");
    const list = await loadList(plId);
    requireEditable(list);
    const row = list.pieces.find((p) => p.id === pieceId);
    if (!row) fail(404, "That line is not on this list");

    const piece = pieceOf(row);
    await db.commercialPackedPiece.delete({ where: { id: pieceId } });
    await logOrderEvent(list.orderId, "edited", {
      note: `${list.number}: cut-to-size line ${pieceLabel(piece)} removed — ${piece.quantity} piece(s)`,
      by: g.user,
      payload: { packingListId: plId, pieceId, design: piece.design, quantity: piece.quantity },
    });
    return json(plain({ list: await loadList(plId) }));
  });
}
