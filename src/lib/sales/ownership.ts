// Who may open ONE International Sales record — the per-id counterpart of the
// scoping every LIST route already applies.
//
// The lists narrow a SALESPERSON to their own records (spWhere = { spId: uid }
// in /api/sales/orders, /pi, /clients), a REPORTING_MANAGER to their own plus
// their assigned team (getAssignedSpIds), and leave SALES_ADMIN, COMMERCIAL and
// ACCOUNTS global. The per-id routes — GET /api/sales/orders/[id] and its whole
// family (pdfs, shipping, port arrival, doc upload, payment divisions...),
// /api/sales/pi/[id]/*, /api/sales/clients/[id] — checked only that the caller
// was a sales session, so any salesperson could read or edit any other
// salesperson's order, client or PI by id. lib/sales/session.ts documents
// SALESPERSON as "own-records-only"; this makes the per-id routes say the same.
//
// WHAT COUNTS AS "MINE" is deliberately the UNION of every scope the module's
// screens use, so no link a legitimate user can click is refused:
//   - the list scope: uid, plus (for a REPORTING_MANAGER) every active
//     sales_manager_assignments row with manager_id = uid;
//   - the dashboard scope (lib/sales/dashboardData.ts), which treats ANY login
//     with active assignments as a manager, whatever its salesRole says — so the
//     assignment lookup here is role-independent too;
//   - both ends of a partially-transferred pair: /api/sales/transfer hands an
//     order, a PI or a client to a new owner ONE RECORD AT A TIME, so an order
//     can belong to B while its PI still belongs to A. The orders list shows B
//     the order with a link to that PI, and the PI page shows A a link to the
//     order. An order is therefore visible through its own spId OR any of its
//     PIs' spIds, and a PI through its own spId OR its order's.
// Today every record is open to every sales session, so this only ever
// narrows; what it never does is refuse a record a scoped list, the dashboard
// or a notification put in front of the caller.
//
// The predicate is pure and import-free (node --test resolves neither the `@/`
// alias nor Prisma — see lib/chromia/tier.ts for the same split), and
// tests/salesOwnership.test.ts exercises it. The three gates below are what the
// routes call; they load the record's owner ids and, only when the pure check
// needs it, the caller's active assignments.

/** Duties that see every record in the module, exactly as the list routes treat them. */
const GLOBAL_SALES_DUTIES = new Set(["SALES_ADMIN", "COMMERCIAL", "ACCOUNTS"]);

export function isGlobalSalesDuty(salesRole: string | null | undefined): boolean {
  return GLOBAL_SALES_DUTIES.has(String(salesRole ?? ""));
}

export interface SalesViewer {
  /** users.id of the caller. */
  uid: string;
  /** The EFFECTIVE duty salesAuth computes (never null for a sales session). */
  salesRole: string | null | undefined;
  /** sp_id of every ACTIVE sales_manager_assignments row with manager_id = uid,
   *  role-independent; null/undefined when not loaded (treated as none). */
  managedSpIds?: readonly string[] | null;
}

/**
 * May `viewer` open a record owned by any of `ownerIds`?
 * An owner id that is null/blank never grants anything: a record with no
 * salesperson is not "everybody's", it is nobody's until an admin transfers it
 * — which is also what the lists do (spId: uid never matches null).
 */
export function canSeeSalesRecord(viewer: SalesViewer, ownerIds: ReadonlyArray<string | null | undefined>): boolean {
  if (isGlobalSalesDuty(viewer.salesRole)) return true;
  const mine = new Set<string>([viewer.uid, ...(viewer.managedSpIds ?? [])].filter(Boolean));
  return ownerIds.some((id) => !!id && mine.has(id));
}

/* ── Route gates ───────────────────────────────────────────────────────────── */

type SessionUser = { id?: string; salesRole?: string | null };

/** Active assignments where this user is the manager — the role-independent
 *  form (see the header). One indexed query, run only when the pure check
 *  could not already answer yes. */
async function managedSpIdsOf(uid: string): Promise<string[]> {
  // Dynamic so this module stays importable by node --test (a static import of
  // @/lib/prisma would pull the client, and the alias, into the test run); the
  // route bundle resolves it statically all the same.
  //
  // No catch: a failed assignments query must THROW (the route answers 500),
  // not read as "manages nobody" — that answered a manager 403 Forbidden on a
  // team order their own list shows, over a pooler blip.
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.$queryRaw<Array<{ spId: string }>>`
    SELECT sp_id AS "spId" FROM sales_manager_assignments WHERE manager_id = ${uid} AND is_active = true`;
  return rows.map((r) => r.spId);
}

async function visibleTo(user: SessionUser, ownerIds: ReadonlyArray<string | null | undefined>): Promise<boolean> {
  const uid = String(user.id ?? "");
  const viewer: SalesViewer = { uid, salesRole: user.salesRole };
  if (canSeeSalesRecord(viewer, ownerIds)) return true;
  if (isGlobalSalesDuty(viewer.salesRole) || !uid) return false;
  return canSeeSalesRecord({ ...viewer, managedSpIds: await managedSpIdsOf(uid) }, ownerIds);
}

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
// A record that is not the caller's answers exactly like one that does not
// exist. Answering 403 told a probing salesperson which ids EXIST (403 = real,
// 404 = not) — an existence oracle. One answer, no oracle, and it matches what
// the module promised: a miss is 404.
const forbidden = notFound;

/**
 * The refusal to return from a route that was handed an order id — 404 whether
 * no such order exists or it is not the caller's (deliberately the same
 * answer; see `forbidden`) — or null when the caller may go on. Call it right
 * after the session check and before any read or write:
 *
 *   const refused = await assertOrderVisible(session.user, id);
 *   if (refused) return refused;
 *
 * The owner lookups carry NO catch: a query failure here is a system fault and
 * must answer 500 like any other, not 404 — "the database blinked" and "this
 * record is gone" are different sentences on a live sales floor.
 */
export async function assertOrderVisible(user: SessionUser, orderId: string): Promise<Response | null> {
  const { prisma } = await import("@/lib/prisma");
  // spId carries no relation (no hard FK), so it is a plain column read here.
  const order = await prisma.salesOrder.findUnique({
    where: { id: orderId },
    select: { spId: true, proformaInvoices: { select: { spId: true } } },
  });
  if (!order) return notFound();
  const ok = await visibleTo(user, [order.spId, ...order.proformaInvoices.map((p) => p.spId)]);
  return ok ? null : forbidden();
}

/** Same as assertOrderVisible, for a proforma invoice (own spId, or its order's). */
export async function assertPiVisible(user: SessionUser, piId: string): Promise<Response | null> {
  const { prisma } = await import("@/lib/prisma");
  const pi = await prisma.proformaInvoice.findUnique({
    where: { id: piId },
    select: { spId: true, order: { select: { spId: true } } },
  });
  if (!pi) return notFound();
  const ok = await visibleTo(user, [pi.spId, pi.order?.spId]);
  return ok ? null : forbidden();
}

/** Same, for a client — owned by whoever created it (createdById), which is
 *  exactly the column the clients list scopes on. */
export async function assertClientVisible(user: SessionUser, clientId: string): Promise<Response | null> {
  const { prisma } = await import("@/lib/prisma");
  const client = await prisma.salesClient.findUnique({
    where: { id: clientId },
    select: { createdById: true },
  });
  if (!client) return notFound();
  const ok = await visibleTo(user, [client.createdById]);
  return ok ? null : forbidden();
}

/** Same, for a payment division — owned through its order. */
export async function assertPaymentDivisionVisible(user: SessionUser, divisionId: string): Promise<Response | null> {
  const { prisma } = await import("@/lib/prisma");
  const div = await prisma.salesPaymentDivision.findUnique({
    where: { id: divisionId },
    select: { order: { select: { spId: true, proformaInvoices: { select: { spId: true } } } } },
  });
  if (!div) return notFound();
  const ok = await visibleTo(user, [div.order?.spId, ...(div.order?.proformaInvoices ?? []).map((p) => p.spId)]);
  return ok ? null : forbidden();
}
