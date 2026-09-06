// GET   /api/office/commercial/enquiries/[id] — one enquiry, its client, its
//       lines and the order it became.
// PATCH /api/office/commercial/enquiries/[id] — edit the header and/or move
//       the status. Only the keys the body carries are written.
//
// ORDERED is never set by hand: it is what POST …/convert writes when it
// creates the order, so an enquiry can never claim an order that does not
// exist (enquiries-rules enquiryStatusChange).
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain, str } from "@/lib/commercial/http";
import { parseEnquiryHeader, enquiryStatusChange, hasCounterparty } from "@/lib/commercial/enquiries-rules";
import { db, loadEnquiry, ENQUIRY_DETAIL_INCLUDE } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const has = (b: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(b, k);

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id } = await params;
    return json(plain(await loadEnquiry(id)));
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await commercialGate("write");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { id } = await params;
    const existing = await loadEnquiry(id);
    const body = await readBody<Record<string, unknown>>(req);

    const header = parseEnquiryHeader(body, "patch");
    if (!header.ok) fail(header.status, header.error);
    const data: Record<string, unknown> = { ...header.data };

    // A form that posts the whole header sends the status it is already on;
    // that is not a move, so it is not refused as one.
    if (has(body, "status") && str(body.status) !== String(existing.status)) {
      const change = enquiryStatusChange(String(existing.status), str(body.status), { lostReason: body.lostReason });
      if (!change.ok) fail(change.status, change.reason);
      Object.assign(data, change.patch);
    } else if (has(body, "lostReason")) {
      data.lostReason = str(body.lostReason);
    }

    if (has(data, "clientId") && data.clientId) {
      const client = await db.salesClient.findUnique({ where: { id: data.clientId as string }, select: { id: true } });
      if (!client) fail(400, "That client is not on the master.");
    }

    const merged = {
      clientId: (has(data, "clientId") ? data.clientId : existing.clientId) as string | null,
      prospectName: (has(data, "prospectName") ? data.prospectName : existing.prospectName) as string | null,
    };
    if (!hasCounterparty(merged)) fail(400, "Keep a client or the prospect's name on the enquiry.");
    if (existing.orderId && has(data, "clientId") && data.clientId !== existing.clientId) {
      fail(409, "This enquiry has become an order; its client cannot be changed here.");
    }

    if (Object.keys(data).length) await db.commercialEnquiry.update({ where: { id }, data });
    const row = await db.commercialEnquiry.findUnique({ where: { id }, include: ENQUIRY_DETAIL_INCLUDE });
    return json(plain(row));
  });
}
