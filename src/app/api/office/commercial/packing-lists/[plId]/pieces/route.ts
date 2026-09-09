// GET  /api/office/commercial/packing-lists/[plId]/pieces — the cut-to-size lines
// POST /api/office/commercial/packing-lists/[plId]/pieces — add one or many
//
// The second kind of line (round three, answer 5): a packing list packs slabs
// today, and his three cut-to-size workbooks pack PIECES — crate, drawing,
// piece, design, size in MILLIMETRES, sqft, quantity, building and weight, with
// a TOTAL row per crate and per sheet. A list may hold both kinds at once.
//
// Editing is closed on exactly the same terms as the slab lines — requireEditable
// (packing-rules canEdit), read rather than restated here, so a piece can never
// be added to a list the dispatch team is holding, or to one that has shipped.
//
// A POST may carry ONE line or an array of them, because these sheets are typed
// (or pasted) a crate at a time: a body of thirty lines with one bad row adds
// the twenty-nine and names the one, exactly as the slab route does, rather than
// making the clerk find it and re-type the lot.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { logOrderEvent } from "@/lib/commercial/events";
import { parsePiece, matchCrate, pieceTotals, pieceLabel, type PieceLike } from "@/lib/commercial/pieces-rules";
import { db, loadList, paramPl, requireEditable, pieceOf } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

/** The most lines one request may carry — a paste, not an import. */
const MAX_LINES = 500;

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view", "packing");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const list = await loadList(await paramPl(params));
    const pieces = list.pieces.map(pieceOf);
    return json(plain({ pieces, totals: pieceTotals(pieces as PieceLike[]) }));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "packing");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const list = await loadList(plId);
    requireEditable(list);
    const body = await readBody<Record<string, unknown>>(req);

    const raw = Array.isArray(body.pieces) ? (body.pieces as unknown[]) : [body];
    if (!raw.length) fail(400, "Nothing to add");
    if (raw.length > MAX_LINES) fail(400, `${raw.length} lines at once is too many — send them ${MAX_LINES} at a time`);

    const rows: Array<Record<string, unknown>> = [];
    const refused: Array<{ line: number; reason: string }> = [];
    raw.forEach((entry, i) => {
      if (!entry || typeof entry !== "object") { refused.push({ line: i + 1, reason: "not a line" }); return; }
      const one = entry as Record<string, unknown>;
      const parsed = parsePiece(one);
      if (!parsed.ok) { refused.push({ line: i + 1, reason: parsed.reason }); return; }

      // A crate the clerk named explicitly must be on THIS list; otherwise the
      // link follows the typed crate number (matchCrate), and stays null when
      // his sheet numbers a crate we have no row for — which is the ordinary
      // case on a cut-to-size sheet.
      let crateId: string | null = null;
      if (Object.prototype.hasOwnProperty.call(one, "crateId")) {
        crateId = str(one.crateId);
        if (crateId && !list.crates.some((c) => c.id === crateId)) { refused.push({ line: i + 1, reason: "that crate is not on this list" }); return; }
      } else {
        crateId = matchCrate(parsed.value.crateNo, list.crates);
      }
      rows.push({ ...parsed.value, crateId, packingListId: plId });
    });

    // Nothing usable at all is a refusal with the reason, not a silent 201 that
    // adds no line and leaves the clerk looking for the row they just typed.
    if (!rows.length) fail(400, refused.length === 1 ? refused[0].reason : `No line could be added: ${refused.map((r) => `line ${r.line} — ${r.reason}`).join("; ")}`);

    await db.commercialPackedPiece.createMany({ data: rows });
    const pieces = rows.map((r) => r as unknown as PieceLike);
    const added = pieceTotals(pieces).total;
    await logOrderEvent(list.orderId, "edited", {
      note: `${list.number}: ${rows.length} cut-to-size line(s) added — ${added.pieces} piece(s), ${added.sqft} sqft${refused.length ? `; ${refused.length} refused` : ""} (${pieceLabel(pieces[0])}${rows.length > 1 ? ` and ${rows.length - 1} more` : ""})`,
      by: g.user,
      payload: { packingListId: plId, added: rows.length, pieces: added.pieces, refused },
    });
    return json(plain({ list: await loadList(plId), added: rows.length, refused }), 201);
  });
}
