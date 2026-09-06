// GET  /api/office/commercial/enquiries — the enquiry book, filtered and paged
// POST /api/office/commercial/enquiries — log one, with its lines
//
// Enquiries arrive by e-mail to Commercial and are logged by hand (owner,
// 2026-09-05), so `source` defaults to EMAIL and `receivedAt` to now. The
// number comes from the ERP counter (ENQ/26-27/0001 by default) and, like
// every number in this module, can be typed by hand when Tally issued it.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { issueNumber } from "@/lib/commercial/sequence";
import { pageParams } from "@/lib/commercial/clients-rules";
import {
  enquiryListWhere, parseEnquiryHeader, parseEnquiryItems, ENQUIRY_STATUSES,
} from "@/lib/commercial/enquiries-rules";
import { db, ENQUIRY_LIST_SELECT, ENQUIRY_DETAIL_INCLUDE, shapeEnquiryRow } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const u = new URL(req.url);
    const filter = { status: u.searchParams.get("status"), q: u.searchParams.get("q"), clientId: u.searchParams.get("clientId") };
    const where = enquiryListWhere(filter);
    const { page, limit, skip, take } = pageParams({ page: u.searchParams.get("page"), limit: u.searchParams.get("limit") });
    // The status counts ignore the status filter, so the chips keep showing
    // every column while the table shows the one that was clicked.
    const countWhere = enquiryListWhere({ ...filter, status: null });
    const [rows, total, groups] = await Promise.all([
      db.commercialEnquiry.findMany({ where, select: ENQUIRY_LIST_SELECT, orderBy: { receivedAt: "desc" }, skip, take }),
      db.commercialEnquiry.count({ where }),
      db.commercialEnquiry.groupBy({ by: ["status"], where: countWhere, _count: { _all: true } }),
    ]);
    const counts: Record<string, number> = {};
    for (const s of ENQUIRY_STATUSES) counts[s] = 0;
    for (const x of groups as Array<{ status: string; _count: { _all: number } }>) counts[x.status] = x._count._all;
    const items = (rows as Array<Record<string, unknown>>).map(shapeEnquiryRow);
    return json(plain({ items, total, page, limit, counts }));
  });
}

export async function POST(req: Request) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const body = await readBody<Record<string, unknown>>(req);
    const header = parseEnquiryHeader(body, "create");
    if (!header.ok) fail(header.status, header.error);
    const lines = parseEnquiryItems(body.items);
    if (!lines.ok) fail(lines.status, lines.error);

    // A client id that names nothing would be a foreign-key error out of
    // Postgres; say which field is wrong instead.
    const clientId = header.data.clientId as string | null;
    if (clientId) {
      const client = await db.salesClient.findUnique({ where: { id: clientId }, select: { id: true } });
      if (!client) fail(400, "That client is not on the master.");
    }

    const receivedAt = (header.data.receivedAt as Date | undefined) ?? new Date();
    const issued = await issueNumber("enquiry", receivedAt, body.numberOverride);
    let created: { id: string };
    try {
      created = await db.commercialEnquiry.create({
        data: {
          ...header.data,
          number: issued.number,
          createdById: g.user?.id ?? null,
          items: lines.items.length ? { create: lines.items } : undefined,
        },
        select: { id: true },
      });
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
        fail(409, `Enquiry number ${issued.number} already exists`);
      }
      throw e;
    }
    const row = await db.commercialEnquiry.findUnique({ where: { id: created.id }, include: ENQUIRY_DETAIL_INCLUDE });
    return json(plain(row), 201);
  });
}
