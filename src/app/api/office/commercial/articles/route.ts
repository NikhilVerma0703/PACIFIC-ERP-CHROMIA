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
import { validateArticle, sizeLabel, claimEan, parseEanSource } from "@/lib/commercial/articles-rules";
import { pageParams } from "@/lib/commercial/clients-rules";
import {
  db, areaRefusal, ARTICLE_SELECT, ARTICLE_ORDER, findClash, requireClient,
  findEanOwner, isUniqueViolation, isEanUniqueViolation, eanTakenMessage, clashMessage,
} from "./_lib";

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

    // ROUND FOUR, ANSWER 2. The barcode is refused before the row is written,
    // with the article that owns it named — and the person is asked rather
    // than overruled: `withoutBarcode` is them answering "store it anyway,
    // I'll settle the duplicate", which is the state the column
    // eanBlockedReason exists for and the state that stops this customer's
    // label run until somebody does settle it.
    const claim = claimEan({
      ean: v.ean,
      source: parseEanSource(body.eanSource) ?? "CUSTOMER",
      self: v,
      owner: await findEanOwner(v.ean),
    });
    // A 409 WITH A FLAG, not a bare sentence. The screen has a second button to
    // offer — "store it without the barcode" — and it may only offer it for
    // THIS refusal, not for the (client, design, size) clash, which is a
    // different 409 with a different answer (open the row that is already
    // there). The flag is what tells the two apart without reading the prose.
    if (claim.refused && body.withoutBarcode !== true) {
      return json({ error: claim.message, eanTaken: true }, 409);
    }

    try {
      const row = await db.commercialCustomerArticle.create({
        data: {
          ...v,
          ean: claim.ean,
          eanSource: claim.eanSource,
          eanBlockedReason: claim.eanBlockedReason,
          updatedById: actorStamp(g.user).id,
        },
        select: ARTICLE_SELECT,
      });
      return json(plain({ ...row, blocked: claim.eanBlockedReason }), 201);
    } catch (e) {
      // Two clerks saving in the same instant: the database's indexes catch
      // what the two lookups above could not see yet. WHICH index matters —
      // the key's answer is "that size is already on the list", the EAN's is
      // "another article owns that barcode", and they send the person to two
      // different rows.
      if (isEanUniqueViolation(e)) fail(409, await eanTakenMessage(v, v.ean));
      if (isUniqueViolation(e)) fail(409, clashMessage(v.design, size));
      throw e;
    }
  });
}
