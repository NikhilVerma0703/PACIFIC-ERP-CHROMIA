// PUT    /api/office/commercial/articles/[id] → the row
// DELETE /api/office/commercial/articles/[id] → { deleted: true }
//
// The whole row is sent back on a PUT rather than a patch of named keys: the
// key ITSELF (client, design, size) is editable — the size is the commonest
// thing to be typed wrong off a customer's sheet — so a save has to be able to
// move a row from one key to another, and 409 when the key it is moving to is
// already somebody's (round three, answer 4).
//
// A DELETE is a row that should never have existed. It does NOT stop the
// design being packed: a line with no article prints the design and the size
// and no barcode, and the labels screen names it (articles-rules.missingArticles).
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, plain, readBody, paramId } from "@/lib/commercial/http";
import { validateArticle, sizeLabel, claimEan, parseEanSource } from "@/lib/commercial/articles-rules";
import {
  db, areaRefusal, ARTICLE_SELECT, findClash, requireClient,
  findEanOwner, isUniqueViolation, isEanUniqueViolation, eanTakenMessage, clashMessage,
} from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "designCodes");
  if (!g.ok) return deny(g);
  const refused = areaRefusal(g, "write");
  if (refused) return refused;
  return handle(async () => {
    const id = await paramId(params);
    const existing = await db.commercialCustomerArticle.findUnique({
      where: { id },
      select: { id: true, ean: true, eanSource: true, eanBlockedReason: true },
    });
    if (!existing) fail(404, "That article is no longer on the list — it may have been deleted while this form was open.");

    const body = await readBody<Record<string, unknown>>(req);
    const parsed = validateArticle(body);
    if (!parsed.ok) fail(400, parsed.reason);
    const v = parsed.value;
    const size = sizeLabel(v.lengthCm, v.widthCm, v.thicknessCm);

    await requireClient(v.clientId);
    const clash = await findClash(v, id);
    if (clash) fail(409, clashMessage(v.design, size, clash.itemCode));

    // THE BLOCK OUTLIVES AN ORDINARY SAVE. A row that lost its code keeps the
    // sentence saying so through every later edit of its description or its
    // notes, because "somebody typed in this form again" is not "the duplicate
    // was settled with the customer". Two things clear it and both are
    // deliberate: taking a code (there is then nothing left to wait for), and
    // `clearBlock`, which is the person saying the collision is dealt with.
    //
    // AND SO DOES THE PROVENANCE, which is why the row's own code and source
    // are read above and handed back as `prior`. A save that sends the same
    // code keeps the source already stored against it. The form has no field
    // for the source and sends CUSTOMER with every save — right for a code
    // somebody has just typed off the customer's sheet, wrong for one our
    // allocator minted and put on the row ten minutes ago — and an API caller
    // that omits the field defaults to the same thing. Believing either of
    // them would quietly relabel a generated code as the customer's, and the
    // allocator would afterwards refuse to touch it saying it came off their
    // file, which is the one thing eanSource exists to tell us (round four,
    // answer 2).
    const claim = claimEan({
      ean: v.ean,
      source: parseEanSource(body.eanSource) ?? "CUSTOMER",
      self: { ...v, id },
      owner: await findEanOwner(v.ean, id),
      prior: { ean: existing.ean, source: existing.eanSource },
      blockedReason: existing.eanBlockedReason ?? null,
      clearBlock: body.clearBlock === true,
    });
    // The flag tells this 409 from the key clash's, so the screen knows it has
    // a second button to offer: store the row without the barcode.
    if (claim.refused && body.withoutBarcode !== true) {
      return json({ error: claim.message, eanTaken: true }, 409);
    }

    try {
      const row = await db.commercialCustomerArticle.update({
        where: { id },
        data: {
          ...v,
          ean: claim.ean,
          eanSource: claim.eanSource,
          eanBlockedReason: claim.eanBlockedReason,
          updatedById: actorStamp(g.user).id,
        },
        select: ARTICLE_SELECT,
      });
      return json(plain({ ...row, blocked: claim.eanBlockedReason }));
    } catch (e) {
      if (isEanUniqueViolation(e)) fail(409, await eanTakenMessage({ ...v, id }, v.ean));
      if (isUniqueViolation(e)) fail(409, clashMessage(v.design, size));
      throw e;
    }
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "designCodes");
  if (!g.ok) return deny(g);
  const refused = areaRefusal(g, "write");
  if (refused) return refused;
  return handle(async () => {
    const id = await paramId(params);
    const row = await db.commercialCustomerArticle.findUnique({
      where: { id },
      select: { id: true, design: true, lengthCm: true, widthCm: true, thicknessCm: true },
    });
    if (!row) fail(404, "That article has already been deleted.");
    await db.commercialCustomerArticle.delete({ where: { id } });
    return json(plain({
      deleted: true,
      id,
      design: row.design,
      size: sizeLabel(Number(row.lengthCm), Number(row.widthCm), Number(row.thicknessCm)),
    }));
  });
}
