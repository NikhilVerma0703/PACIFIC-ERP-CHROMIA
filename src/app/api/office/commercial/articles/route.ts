// GET  /api/office/commercial/articles → { items, total, page, limit }
// POST /api/office/commercial/articles → the created row
//
// The customer's article master (round three, answer 4): one row per (client,
// design, size) carrying the customer's item code, description and EAN-13. The
// crate label is generated from it, so a row missing here is a crate that goes
// out without a barcode.
//
// Gated on `write` + the designCodes AREA — an article is the design master
// seen from the customer's side (see ./_lib).
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, plain, str, readBody } from "@/lib/commercial/http";
import { validateArticle, sizeLabel } from "@/lib/commercial/articles-rules";
import { pageParams } from "@/lib/commercial/clients-rules";
import { db, areaRefusal, ARTICLE_SELECT, ARTICLE_ORDER, findClash, requireClient, eanWarning, isUniqueViolation, clashMessage } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view", "designCodes");
  if (!g.ok) return deny(g);
  const refused = areaRefusal(g, "view");
  if (refused) return refused;
  return handle(async () => {
    const sp = new URL(req.url).searchParams;
    const q = str(sp.get("q"));
    const clientId = str(sp.get("clientId"));
    const design = str(sp.get("design"));
    const where: Record<string, unknown> = {};
    // "clientId=none" is the OURS row — the one that answers for a customer
    // who has not sent their own codes. It is a real filter, not the absence
    // of one, so it cannot be expressed by leaving the parameter off.
    if (clientId) where.clientId = clientId === "none" ? null : clientId;
    if (design) where.design = { equals: design, mode: "insensitive" };
    if (q) {
      where.OR = [
        { design: { contains: q, mode: "insensitive" } },
        { itemCode: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { ean: { contains: q } },
      ];
    }
    // PAGED, like every other list in this module (clients, packing lists).
    // The owner's single file already carries twelve articles for ONE design
    // for ONE customer; a handful of customers is thousands of rows, and an
    // unbounded findMany would fetch and render all of them on every search.
    const { page, limit, skip, take } = pageParams({ page: sp.get("page"), limit: sp.get("limit") });
    const [items, total] = await Promise.all([
      db.commercialCustomerArticle.findMany({ where, select: ARTICLE_SELECT, orderBy: ARTICLE_ORDER, skip, take }),
      db.commercialCustomerArticle.count({ where }),
    ]);
    return json(plain({ items, total, page, limit }));
  });
}

export async function POST(req: Request) {
  const g = await commercialGate("write", "designCodes");
  if (!g.ok) return deny(g);
  const refused = areaRefusal(g, "write");
  if (refused) return refused;
  return handle(async () => {
    const body = await readBody<Record<string, unknown>>(req);
    const parsed = validateArticle(body);
    if (!parsed.ok) fail(400, parsed.reason);
    const v = parsed.value;
    const size = sizeLabel(v.lengthCm, v.widthCm, v.thicknessCm);

    await requireClient(v.clientId);
    const clash = await findClash(v);
    if (clash) fail(409, clashMessage(v.design, size, clash.itemCode));

    try {
      const warning = await eanWarning(v.ean);
      const row = await db.commercialCustomerArticle.create({
        data: { ...v, updatedById: actorStamp(g.user).id },
        select: ARTICLE_SELECT,
      });
      return json(plain({ ...row, warning }), 201);
    } catch (e) {
      // Two clerks typing the same size at the same moment: the database's
      // unique index catches what findClash could not see yet.
      if (isUniqueViolation(e)) fail(409, clashMessage(v.design, size));
      throw e;
    }
  });
}
