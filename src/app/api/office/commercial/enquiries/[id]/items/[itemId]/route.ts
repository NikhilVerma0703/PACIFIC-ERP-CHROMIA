// PATCH  /api/office/commercial/enquiries/[id]/items/[itemId] — edit a line
// DELETE /api/office/commercial/enquiries/[id]/items/[itemId] — remove it and
//        renumber, so a deleted line leaves no gap for the order to copy.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { parseEnquiryItem } from "@/lib/commercial/enquiries-rules";
import { renumberLines } from "@/lib/commercial/orders-rules";
import { db, loadEnquiry, loadEnquiryLines } from "../../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

async function loadItem(enquiryId: string, itemId: string): Promise<Record<string, unknown>> {
  if (!enquiryId || !itemId) fail(400, "Missing id");
  const item = await db.commercialEnquiryItem.findUnique({ where: { id: itemId } });
  if (!item || item.enquiryId !== enquiryId) fail(404, "Line not found on this enquiry");
  return item;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id, itemId } = await params;
    await loadEnquiry(id);
    const existing = await loadItem(id, itemId);
    const body = await readBody<Record<string, unknown>>(req);
    const parsed = parseEnquiryItem(body, "patch");
    if (!parsed.ok) fail(parsed.status, parsed.error);
    const data = { ...parsed.data };
    if (Object.prototype.hasOwnProperty.call(body, "lineNo")) {
      const n = Math.floor(Number(body.lineNo));
      if (Number.isFinite(n) && n > 0) data.lineNo = n;
    }
    if (!Object.keys(data).length) return json(plain(existing));
    const item = await db.commercialEnquiryItem.update({ where: { id: itemId }, data });
    return json(plain(item));
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id, itemId } = await params;
    await loadEnquiry(id);
    await loadItem(id, itemId);
    const rest = (await loadEnquiryLines(id)).filter((i) => i.id !== itemId);
    const renumber = renumberLines(rest);
    await db.$transaction([
      db.commercialEnquiryItem.delete({ where: { id: itemId } }),
      ...renumber.map((r) => db.commercialEnquiryItem.update({ where: { id: r.id }, data: { lineNo: r.lineNo } })),
    ]);
    return json({ ok: true, deleted: itemId, renumbered: renumber.length });
  });
}
