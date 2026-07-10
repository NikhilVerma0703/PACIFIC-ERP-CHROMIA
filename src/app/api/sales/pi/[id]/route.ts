/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { getSpMap } from "@/lib/sales/spLookup";

const db = prisma as any;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
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
