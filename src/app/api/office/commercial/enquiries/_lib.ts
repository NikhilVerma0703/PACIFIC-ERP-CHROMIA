// Shared by the /api/office/commercial/enquiries/** handlers: the detail
// include, the 404 loader, and the row shape the list returns. Not a route —
// Next ignores a colocated file that is not route.ts.
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/commercial/http";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** Everything the enquiry screen shows: who it is from (with the commercial
 *  ext, so the convert dialog can name the incoterm and currency it will
 *  copy), its lines, and the order it became. */
export const ENQUIRY_DETAIL_INCLUDE = {
  client: { include: { commercialExt: true } },
  items: { orderBy: { lineNo: "asc" } },
  orders: { select: { id: true, number: true, kind: true, status: true }, orderBy: { createdAt: "desc" } },
} as const;

/** The columns the list needs — no bodies, no items, one join for the name. */
export const ENQUIRY_LIST_SELECT = {
  id: true, number: true, clientId: true, prospectName: true, contactName: true, contactEmail: true, contactPhone: true,
  receivedAt: true, source: true, subject: true, status: true, orderId: true, lostReason: true,
  assignedToId: true, createdById: true, createdAt: true, updatedAt: true,
  client: { select: { id: true, name: true, country: true } },
  _count: { select: { items: true } },
} as const;

/** `_count` flattened to the one field the list prints. */
export function shapeEnquiryRow(row: Record<string, unknown>): Record<string, unknown> {
  const c = (row._count ?? {}) as { items?: number };
  const { _count, ...rest } = row;
  void _count;
  return { ...rest, itemsCount: c.items ?? 0 };
}

export async function loadEnquiry(id: string): Promise<Record<string, unknown> & { items: Array<Record<string, unknown>> }> {
  if (!id) fail(400, "Missing id");
  const row = await db.commercialEnquiry.findUnique({ where: { id }, include: ENQUIRY_DETAIL_INCLUDE });
  if (!row) fail(404, "Enquiry not found");
  return row;
}

/** The enquiry's own lines, ordered — used by the item handlers, which do not
 *  need the client or the order. */
export async function loadEnquiryLines(enquiryId: string): Promise<Array<{ id: string; lineNo: number }>> {
  return db.commercialEnquiryItem.findMany({ where: { enquiryId }, orderBy: { lineNo: "asc" }, select: { id: true, lineNo: true } });
}
