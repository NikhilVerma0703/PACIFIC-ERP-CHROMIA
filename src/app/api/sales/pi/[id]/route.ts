/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertPiVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";
import { getSpMap } from "@/lib/sales/spLookup";

const db = prisma as any;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const refused = await assertPiVisible(session.user, id);
  if (refused) return refused;
  const pi = await db.proformaInvoice.findUnique({
    where: { id },
    include: {
      client:        true,
      order:         true,
      rejectionLogs: { orderBy: { rejectedAt: "desc" }, take: 5 },
      revisions:     { orderBy: { revisionNo: "desc" }, take: 10 },
    },
  });
  if (!pi) return Response.json({ error: "Not found" }, { status: 404 });

  // spId/createdById carry no Prisma relation (no hard FK) — stitch users in
  const userMap = await getSpMap([
    pi.spId,
    ...(pi.revisions ?? []).map((r: any) => r.createdById),
  ]);
  pi.sp = userMap.get(pi.spId) ?? null;
  pi.revisions = (pi.revisions ?? []).map((r: any) => ({
    ...r,
    createdBy: { name: userMap.get(r.createdById)?.name ?? null },
  }));

  // Attach paymentTermsData via raw SQL (graceful if column missing)
  try {
    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT payment_terms_data FROM proforma_invoices WHERE id = $1`, id
    );
    if (rows[0]?.payment_terms_data) pi.paymentTermsData = rows[0].payment_terms_data;
  } catch { /* column not yet created */ }

  return Response.json(pi);
}

// DELETE /api/sales/pi/[id] — managers (SALES_ADMIN, REPORTING_MANAGER) may
// delete ANY PI; a SALESPERSON only their own (spId is a plain TEXT user id —
// compared directly, resolved elsewhere via spLookup; no relation involved).
// A PI referenced by an order is never deleted: the caller gets a 409 telling
// them why. Child rows (rejection logs, revisions) carry real DB FKs
// (scripts/0019), so they are removed with the PI in one transaction.
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid       = (session.user as any).id as string;
  const salesRole = (session.user as any).salesRole as string | null;

  const isManager = salesRole === "SALES_ADMIN" || salesRole === "REPORTING_MANAGER";
  if (!isManager && salesRole !== "SALESPERSON") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const pi = await db.proformaInvoice.findUnique({
    where:  { id },
    select: { id: true, piNumber: true, spId: true, orderId: true },
  });
  if (!pi) return Response.json({ error: "Not found" }, { status: 404 });

  if (!isManager && pi.spId !== uid) {
    return Response.json({ error: "You can only delete your own PIs" }, { status: 403 });
  }

  // Block when any order references this PI (pi.orderId or the order-side
  // relation) — deleting a PI must never touch an order.
  const linkedOrder = pi.orderId
    ? await db.salesOrder.findUnique({ where: { id: pi.orderId }, select: { orderNumber: true } })
    : await db.salesOrder.findFirst({ where: { proformaInvoices: { some: { id } } }, select: { orderNumber: true } });
  if (linkedOrder) {
    return Response.json({
      error: `This PI is linked to order ${linkedOrder.orderNumber}. Deleting a PI never deletes an order — cancel or remove that order first.`,
    }, { status: 409 });
  }

  await db.$transaction([
    db.pIRejectionLog.deleteMany({ where: { piId: id } }),
    db.pIRevision.deleteMany({ where: { piId: id } }),
    db.proformaInvoice.delete({ where: { id } }),
  ]);

  return Response.json({ ok: true, deleted: pi.piNumber });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const refused = await assertPiVisible(session.user, id);
  if (refused) return refused;
  const body = await req.json();

  const existing = await db.proformaInvoice.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (!["DRAFT", "UNDER_REVISION"].includes(existing.status)) {
    return Response.json({ error: "Can only edit DRAFT or UNDER_REVISION PIs" }, { status: 400 });
  }

  const {
    currency, validityDays, deliveryTerms, paymentTermsSummary, paymentTerms,
    portOfLoading, portOfDischarge, notes, items,
    consigneeDetails, notifyPartyDetails, buyerPoNo, countryOfDestination,
    placeOfReceipt, finalDestination, buyerIfNotConsignee,
  } = body;

  let totalAmount = existing.totalAmount;
  if (items) {
    totalAmount = (items as any[]).reduce((s: number, i: any) =>
      s + Number(i.amount ?? (Number(i.unitPrice) * Number(i.sqft || i.sqm || i.qty || 0))), 0);
  }

  const pi = await db.proformaInvoice.update({
    where: { id },
    data: {
      ...(currency              !== undefined ? { currency }              : {}),
      ...(validityDays          !== undefined ? { validityDays }          : {}),
      ...(deliveryTerms         !== undefined ? { deliveryTerms }         : {}),
      ...(paymentTermsSummary   !== undefined ? { paymentTermsSummary }   : {}),
      ...(portOfLoading         !== undefined ? { portOfLoading }         : {}),
      ...(portOfDischarge       !== undefined ? { portOfDischarge }       : {}),
      ...(notes                 !== undefined ? { notes }                 : {}),
      ...(consigneeDetails      !== undefined ? { consigneeDetails }      : {}),
      ...(notifyPartyDetails    !== undefined ? { notifyPartyDetails }    : {}),
      ...(buyerPoNo             !== undefined ? { buyerPoNo }             : {}),
      ...(countryOfDestination  !== undefined ? { countryOfDestination }  : {}),
      ...(placeOfReceipt        !== undefined ? { placeOfReceipt }        : {}),
      ...(finalDestination      !== undefined ? { finalDestination }      : {}),
      ...(buyerIfNotConsignee   !== undefined ? { buyerIfNotConsignee }   : {}),
      ...(items                 !== undefined ? { items, totalAmount }    : {}),
    },
    include: { client: true },
  });

  // Save paymentTerms via raw SQL (graceful if column missing)
  if (paymentTerms !== undefined) {
    try {
      await db.$queryRawUnsafe(
        `UPDATE proforma_invoices SET payment_terms_data = $1::jsonb WHERE id = $2`,
        paymentTerms ? JSON.stringify(paymentTerms) : null,
        id
      );
    } catch { /* column not yet created — run migrate-pi-payment-terms.js */ }
  }

  return Response.json(pi);
}
