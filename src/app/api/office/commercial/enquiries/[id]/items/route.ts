// POST /api/office/commercial/enquiries/[id]/items — add one line, or several.
//
// The body is either one line ({ design, thickness, qtySlabs, … }) or
// { items: [ … ] }; both go through the same parser, and the first bad line
// stops the whole save so a half-typed table never half-lands.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { parseEnquiryItem, parseEnquiryItems, nextLineNo } from "@/lib/commercial/enquiries-rules";
import { db, loadEnquiry, loadEnquiryLines } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await commercialGate("write", "enquiries");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id } = await params;
    await loadEnquiry(id);
    const body = await readBody<Record<string, unknown>>(req);

    let rows: Array<Record<string, unknown>>;
    if (Array.isArray(body.items)) {
      const parsed = parseEnquiryItems(body.items);
      if (!parsed.ok) fail(parsed.status, parsed.error);
      rows = parsed.items;
    } else {
      const parsed = parseEnquiryItem(body, "create");
      if (!parsed.ok) fail(parsed.status, parsed.error);
      rows = [{ ...parsed.data, lineNo: 1 }];
    }
    if (!rows.length) fail(400, "No lines to add.");

    // parseEnquiryItems numbers its lines 1..n; they continue this enquiry's
    // own numbering rather than restarting it.
    const start = nextLineNo(await loadEnquiryLines(id));
    const data = rows.map((r, i) => ({ ...r, lineNo: start + i, enquiryId: id }));
    // create, not createMany: the created rows are what the caller gets back,
    // and one transaction keeps a rejected line from leaving the ones before
    // it behind.
    const created = await db.$transaction(data.map((d) => db.commercialEnquiryItem.create({ data: d })));

    const items = await db.commercialEnquiryItem.findMany({ where: { enquiryId: id }, orderBy: { lineNo: "asc" } });
    return json(plain({ created, items, added: created.length }), 201);
  });
}
