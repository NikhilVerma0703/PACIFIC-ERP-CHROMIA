// Shared by the /api/office/commercial/clients handlers (and by the enquiry
// convert route, which needs the same client shape): the include every client
// response carries, the 404 loader, and the ext upsert both create and patch
// end with. Not a route — Next ignores a colocated file that is not route.ts.
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/commercial/http";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/**
 * A client is always returned with its commercial extension and the two
 * counts the list and the detail page show. The counts come from the relation
 * aggregate rather than a second query so a 50-row page is still one round
 * trip to Neon.
 */
export const CLIENT_INCLUDE = {
  commercialExt: true,
  _count: { select: { commercialOrders: true, commercialEnquiries: true } },
} as const;

/** `_count` flattened to the two fields the screens read. */
export function shapeClient(row: Record<string, unknown>): Record<string, unknown> {
  const c = (row._count ?? {}) as { commercialOrders?: number; commercialEnquiries?: number };
  const { _count, ...rest } = row;
  void _count;
  return { ...rest, ordersCount: c.commercialOrders ?? 0, enquiriesCount: c.commercialEnquiries ?? 0 };
}

export async function loadClientRow(id: string): Promise<Record<string, unknown>> {
  if (!id) fail(400, "Missing id");
  const row = await db.salesClient.findUnique({ where: { id }, include: CLIENT_INCLUDE });
  if (!row) fail(404, "Client not found");
  return row;
}

/**
 * commercial_client_ext is one row per client keyed by client_id, so every
 * write is an upsert: a client created before this module existed (or by the
 * ported Sales module) has no ext row at all until Commercial first edits it.
 */
export async function upsertExt(clientId: string, ext: Record<string, unknown>): Promise<void> {
  await db.commercialClientExt.upsert({ where: { clientId }, update: ext, create: { clientId, ...ext } });
}

/**
 * The rows the duplicate-name check compares against. `contains` is the widest
 * cheap query — it also catches "Acme Corporation" when "Acme" is typed, which
 * nameKey() in clients-rules then rejects, so the warning stays exact while
 * the query stays one index scan.
 */
export async function nameCandidates(name: string): Promise<Array<{ id: string; name: string }>> {
  const q = String(name ?? "").trim();
  if (!q) return [];
  return db.salesClient.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    select: { id: true, name: true },
    take: 25,
  });
}
