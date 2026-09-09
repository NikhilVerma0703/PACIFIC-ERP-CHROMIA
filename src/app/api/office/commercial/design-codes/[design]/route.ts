// PUT /api/office/commercial/design-codes/[design]
//     { code?, shade?, shadeConfirmed?, notes?,
//       colourName?, hex?, labL?, labA?, labB? } → the row (upsert)
//
// The design is the key, as stock spells it (URL-encoded in the path; Next
// hands it over decoded). Only the fields the body names change
// (design-rules.designCodePatch), so a save
// of the code alone cannot clear a confirmed shade. A code already on another
// design is answered 409 with that design's name — the column is unique
// because the code is what the customer's paperwork identifies a design by,
// and two designs under one code would make an export line ambiguous.
//
// THE LOOKUP IS CASE-BLIND. Every reader of the master matches the design
// trimmed and case-insensitively (design-rules.findDesignRow, the seed, the
// stock picker's de-dup), so a PUT for "CARRARA ROYALE" must land on the row
// stored as "Carrara Royale" — a case-sensitive upsert on the primary key
// would create a second master row that every reader then finds first or
// second by accident, with two codes and two shades for one design. So: find
// the stored spelling first and update THAT row; create only when none exists.
//
// THE COLOUR (round two, answer 15) rides in the same body: the colour name,
// the L*a*b* read off the sample and the hex. designCodePatch validates the
// hex shape and each axis, and back-fills the reading from a hand-typed hex
// when the body sends no L*a*b* of its own — L* is what sequences the queue
// (answer 14), so a colour typed by hand must still leave a number behind.
//
// AND THE QUEUE IS RE-DERIVED (round two, answer 14). L*, the hex that
// derives it and the shade label that stands in for it are the INPUTS to the
// cleaning rule, and the production queue stores the hours that rule produced.
// A colour corrected here without a recompute would leave the plant with the
// hours the OLD shade produced until somebody happened to drag the queue —
// which is exactly the case answer 14 is about, a design that turned out to be
// far darker than its name suggested. So a save or a delete that touched labL,
// the hex or the shade calls recomputeQueue with a reason naming the design,
// and hands back { recomputed, warnings } the way the reorder route does, so
// the screen can say where the abrupt changeovers now are.
//
// Gates "write" on the designCodes AREA (_lib.areaRefusal): the manager
// maintains the codes and the colours, and answer 16 narrowed "plan" to the
// admin alone.
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { designCodePatch, normaliseDesignName, guessShade, type DesignCodePatch } from "@/lib/commercial/design-rules";
import { db, isUniqueViolation, areaRefusal } from "../_lib";
import { recomputeQueue } from "../../production-requests/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ design: string }> };

/** The master row whose design matches `design` trimmed and case-blind, or
 *  null — the stored spelling is the one every write must key on. */
async function findStored(design: string): Promise<{ design: string } | null> {
  return db.commercialDesignCode.findFirst({ where: { design: { equals: design, mode: "insensitive" } }, select: { design: true } });
}

/** The three columns the cleaning rule reads (answer 14): the measured L*,
 *  the hex it derives (a typed one wins and back-fills L*) and the shade word
 *  that stands in when nobody has measured. A patch that names none of them —
 *  a code, a note, a colour name — cannot move a single planned hour, so it
 *  does not pay for a recompute. */
const QUEUE_INPUTS = ["labL", "hex", "shade"] as const;
const touchesQueue = (patch: DesignCodePatch) =>
  QUEUE_INPUTS.some((k) => Object.prototype.hasOwnProperty.call(patch, k));

export async function PUT(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "designCodes");
  if (!g.ok) return deny(g);
  const refused = areaRefusal(g, "write");
  if (refused) return refused;
  return handle(async () => {
    const { design: raw } = await params;
    const design = normaliseDesignName(raw ?? "");
    if (!design) fail(400, "Which design?");
    const body = await readBody<Record<string, unknown>>(req);
    const parsed = designCodePatch(body);
    if (!parsed.ok) fail(400, parsed.reason);
    const stamp = actorStamp(g.user);

    const stored = await findStored(design);
    const key = stored?.design ?? design;
    if (parsed.patch.code) {
      const clash = await db.commercialDesignCode.findUnique({ where: { code: parsed.patch.code }, select: { design: true } });
      if (clash && clash.design.trim().toLowerCase() !== key.trim().toLowerCase()) fail(409, `Code ${parsed.patch.code} is already ${clash.design}'s.`);
    }
    let row: Record<string, unknown>;
    try {
      row = stored
        ? await db.commercialDesignCode.update({ where: { design: key }, data: { ...parsed.patch, updatedById: stamp.id } })
        // A row created by hand gets the same first guess the seed would give
        // it, unless the body already says.
        : await db.commercialDesignCode.create({ data: { design, shade: guessShade(design), shadeConfirmed: false, ...parsed.patch, updatedById: stamp.id } });
    } catch (e) {
      if (isUniqueViolation(e)) fail(409, `Code ${parsed.patch.code ?? ""} is already another design's.`);
      throw e;
    }
    // The colour changed, so the planned cleaning hours the old shade produced
    // are stale (answer 14). Recompute AFTER the write, so the rule reads the
    // colour that was just saved.
    const queue = touchesQueue(parsed.patch)
      ? await recomputeQueue(g.user, `${key}: colour changed on the design master`)
      : { recomputed: 0, warnings: [] };
    return json(plain({ ...row, recomputed: queue.recomputed, warnings: queue.warnings }));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "designCodes");
  if (!g.ok) return deny(g);
  const refused = areaRefusal(g, "write");
  if (refused) return refused;
  return handle(async () => {
    const { design: raw } = await params;
    const design = normaliseDesignName(raw ?? "");
    if (!design) fail(400, "Which design?");
    // Same case-blind lookup as PUT: delete the row as it is stored.
    const stored = await findStored(design);
    if (!stored) fail(404, "No master row for that design");
    await db.commercialDesignCode.delete({ where: { design: stored.design } });
    // A deleted master row takes the L*, the hex and the shade with it, so
    // every queued row for that design falls back to MEDIUM and its planned
    // cleaning hours change (answer 14). Always recompute here — a delete
    // always touches the inputs.
    const { recomputed, warnings } = await recomputeQueue(g.user, `${stored.design}: design master row deleted`);
    return json(plain({ deleted: true, design: stored.design, recomputed, warnings }));
  });
}
