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
import { validateArticle, sizeLabel } from "@/lib/commercial/articles-rules";
import { db, areaRefusal, ARTICLE_SELECT, findClash, requireClient, eanWarning, isUniqueViolation, clashMessage } from "../_lib";

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
    const existing = await db.commercialCustomerArticle.findUnique({ where: { id }, select: { id: true } });
    if (!existing) fail(404, "That article is no longer on the list — it may have been deleted while this form was open.");

    const parsed = validateArticle(await readBody<Record<string, unknown>>(req));
    if (!parsed.ok) fail(400, parsed.reason);
    const v = parsed.value;
    const size = sizeLabel(v.lengthCm, v.widthCm, v.thicknessCm);

    await requireClient(v.clientId);
    const clash = await findClash(v, id);
    if (clash) fail(409, clashMessage(v.design, size, clash.itemCode));

    try {
      const warning = await eanWarning(v.ean, id);
      const row = await db.commercialCustomerArticle.update({
        where: { id },
        data: { ...v, updatedById: actorStamp(g.user).id },
        select: ARTICLE_SELECT,
      });
      return json(plain({ ...row, warning }));
    } catch (e) {
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
