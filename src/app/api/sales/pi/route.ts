/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { generatePINumber } from "@/lib/sales/orderNumber";
import { getAssignedSpIds } from "@/lib/sales/rmScope";
import { getSpMap } from "@/lib/sales/spLookup";

const db = prisma as any;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid       = (session.user as any).id       as string;
  const salesRole = (session.user as any).salesRole as string | null;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit  = parseInt(url.searchParams.get("limit") ?? "10");
  const page   = parseInt(url.searchParams.get("page")  ?? "1");
  const from   = url.searchParams.get("from");
  const to     = url.searchParams.get("to");
  const clientProductType = url.searchParams.get("productType");
  const spFilter_param    = url.searchParams.get("sp");

  // Read salesFactory fresh from DB (not JWT) so admin changes take effect immediately
  let salesFactory: string | null = null;
  if (salesRole === "COMMERCIAL" || salesRole === "ACCOUNTS") {
    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT sales_factory FROM users WHERE id = $1`, uid
    ).catch(() => []);
    salesFactory = rows[0]?.sales_factory ?? null;
  }

  // Resolve factory filter
  const effectiveFactory =
    (salesRole === "COMMERCIAL" || salesRole === "ACCOUNTS") && salesFactory
      ? salesFactory
      : (clientProductType === "QUARTZ" || clientProductType === "GRANITE")
        ? clientProductType
        : null;

  // SP scope
  const isGlobalAdmin = salesRole === "SALES_ADMIN" || salesRole === "COMMERCIAL" || salesRole === "ACCOUNTS";
  let spFilter: object = {};
  if (!isGlobalAdmin) {
    if (salesRole === "REPORTING_MANAGER") {
      const assignedSpIds = await getAssignedSpIds(uid, salesRole);
      const ids = assignedSpIds || [];
      const targetId = spFilter_param && ids.includes(spFilter_param) ? spFilter_param : null;
      spFilter = { spId: { in: targetId ? [targetId] : ids } };
    } else {
      spFilter = { spId: uid };
    }
  } else if (spFilter_param) {
    spFilter = { spId: spFilter_param };
  }

  // productType filter -- raw SQL to avoid text = "ProductType" enum cast mismatch
  let productTypeWhere: object = {};
  if (effectiveFactory) {
    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT id FROM proforma_invoices WHERE product_type = $1`,
      effectiveFactory
    );
    const piIds = rows.map((r: any) => r.id).filter(Boolean);
    productTypeWhere = { id: { in: piIds } };
  }

  const pis = await db.proformaInvoice.findMany({
    where: {
      ...spFilter,
      ...(status ? { status } : {}),
      ...productTypeWhere,
      ...(from || to ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to + "T23:59:59Z") } : {}),
        },
      } : {}),
    },
    include: {
      client: { select: { id: true, name: true, country: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: (page - 1) * limit,
  });
  // spId has no Prisma relation (no hard FK) — stitch SP info in afterwards
  const spMap = await getSpMap(pis.map((p: any) => p.spId));
  return Response.json(pis.map((p: any) => ({ ...p, sp: spMap.get(p.spId) ?? null })));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid       = (session.user as any).id as string;
  const salesRole = (session.user as any).salesRole as string | null;
  if (!salesRole) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const {
    clientId, currency, validityDays, deliveryTerms, paymentTermsSummary,
    portOfLoading, portOfDischarge, notes, items,
    productType, consigneeDetails, notifyPartyDetails, buyerPoNo,
    countryOfDestination, paymentTerms, buyerIfNotConsignee, finalDestination,
  } = body;

  if (!clientId || !items?.length) {
    return Response.json({ error: "clientId and items required" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { id: uid }, select: { email: true } });
  const piNumber = await generatePINumber(user?.email ?? uid, productType);

  const totalAmount = (items as any[]).reduce((s: number, i: any) => {
    if (i.amount != null) return s + Number(i.amount);
    const qty = Number(i.sqm ?? i.sqft ?? i.qty ?? 0);
    return s + qty * Number(i.unitPrice ?? 0);
  }, 0);

  const pi = await db.proformaInvoice.create({
    data: {
      piNumber,
      clientId,
      spId:                uid,
      currency:            currency ?? "USD",
      totalAmount,
      validityDays:        validityDays ?? 30,
      deliveryTerms:       deliveryTerms ?? null,
      paymentTermsSummary: paymentTermsSummary ?? null,
      portOfLoading:       portOfLoading ?? null,
      portOfDischarge:     portOfDischarge ?? null,
      notes:               notes ?? null,
      status:              "DRAFT",
      items,
      productType:         productType ?? "QUARTZ",
      consigneeDetails:    consigneeDetails ?? null,
      notifyPartyDetails:  notifyPartyDetails ?? null,
      buyerPoNo:           buyerPoNo ?? null,
      buyerIfNotConsignee: buyerIfNotConsignee ?? null,
      countryOfDestination:countryOfDestination ?? null,
      finalDestination:    finalDestination ?? null,
    },
    include: { client: true },
  });
  if (paymentTerms) {
    try {
      await db.$queryRawUnsafe(
        `UPDATE proforma_invoices SET payment_terms_data = $1::jsonb WHERE id = $2`,
        JSON.stringify(paymentTerms),
        pi.id
      );
    } catch { /* Column not yet created */ }
  }

  return Response.json(pi, { status: 201 });
}
