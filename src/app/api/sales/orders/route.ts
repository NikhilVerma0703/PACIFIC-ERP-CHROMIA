/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { generateOrderNumber } from "@/lib/sales/orderNumber";
import { getAssignedSpIds } from "@/lib/sales/rmScope";
import { getSp, getSpMap } from "@/lib/sales/spLookup";

const db = prisma as any;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid       = (session.user as any).id       as string;
  const salesRole = (session.user as any).salesRole as string | null;
  const url = new URL(req.url);
  const status            = url.searchParams.get("status");
  const limit             = parseInt(url.searchParams.get("limit") || "50");
  const page              = parseInt(url.searchParams.get("page")  || "1");
  const from              = url.searchParams.get("from");
  const to                = url.searchParams.get("to");
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

  // Factory filter -- raw SQL to avoid text = "ProductType" enum cast error
  const effectiveFactory =
    (salesRole === "COMMERCIAL" || salesRole === "ACCOUNTS") && salesFactory
      ? salesFactory
      : (clientProductType === "QUARTZ" || clientProductType === "GRANITE")
        ? clientProductType
        : null;

  // SP scope
  const isGlobalAdmin = salesRole === "SALES_ADMIN" || salesRole === "COMMERCIAL" || salesRole === "ACCOUNTS";
  let spWhere: object = {};
  if (!isGlobalAdmin) {
    if (salesRole === "REPORTING_MANAGER") {
      const assignedSpIds = await getAssignedSpIds(uid, salesRole);
      const ids = assignedSpIds || [];
      const targetId = spFilter_param && ids.includes(spFilter_param) ? spFilter_param : null;
      spWhere = { spId: { in: targetId ? [targetId] : ids } };
    } else {
      spWhere = { spId: uid };
    }
  } else if (spFilter_param) {
    spWhere = { spId: spFilter_param };
  }

  // productType filter -- raw SQL. The DB column is the "ProductType" enum, so
  // the text parameter must be compared via ::text (a bare `product_type = $1`
  // throws 42883 "operator does not exist" and the whole list 500s).
  let productTypeWhere: object = {};
  if (effectiveFactory) {
    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT DISTINCT order_id FROM proforma_invoices WHERE product_type::text = $1 AND order_id IS NOT NULL`,
      effectiveFactory
    );
    const orderIds = rows.map((r: any) => r.order_id).filter(Boolean);
    productTypeWhere = { id: { in: orderIds } };
  }

  const orders = await db.salesOrder.findMany({
    where: {
      ...spWhere,
      ...(status ? { status } : {}),
      ...(from || to ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to + "T23:59:59Z") } : {}),
        },
      } : {}),
      ...productTypeWhere,
    },
    include: {
      client:           { select: { id: true, name: true, country: true } },
      proformaInvoices: { select: { id: true, piNumber: true, currency: true, totalAmount: true, status: true } },
      productionJob:    { select: { type: true, status: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit,
    skip: (page - 1) * limit,
  });
  // spId has no Prisma relation (no hard FK) — stitch SP info in afterwards
  const spMap = await getSpMap(orders.map((o: any) => o.spId));
  return Response.json(orders.map((o: any) => ({ ...o, sp: spMap.get(o.spId) ?? null })));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const uid       = (session.user as any).id as string;
  const salesRole = (session.user as any).salesRole as string | null;
  if (!salesRole) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { piId, deliveryTerms, notes } = await req.json();
  if (!piId) return Response.json({ error: "piId required" }, { status: 400 });

  const pi = await db.proformaInvoice.findUnique({ where: { id: piId } });
  if (!pi) return Response.json({ error: "PI not found" }, { status: 404 });
  if (pi.status !== "ACCEPTED") return Response.json({ error: "PI must be accepted first" }, { status: 400 });

  const existing = await db.salesOrder.findFirst({ where: { proformaInvoices: { some: { id: piId } } } });
  if (existing) return Response.json({ error: "Order already exists for this PI" }, { status: 409 });

  const orderNumber = await generateOrderNumber();
  const order = await db.salesOrder.create({
    data: {
      orderNumber,
      spId:         pi.spId,
      clientId:          pi.clientId,
      status:       "PENDING_PAYMENT",
      totalAmount:  pi.totalAmount,
      currency:     pi.currency,
      deliveryTerms: deliveryTerms ?? pi.deliveryTerms ?? null,
      notes:         notes ?? null,
    },
    include: {
      client:           { select: { name: true, country: true } },
      proformaInvoices: true,
    },
  });

  // Link PI → order
  await db.proformaInvoice.update({
    where: { id: piId },
    data:  { orderId: order.id },
  });

  const sp = await getSp(order.spId);
  return Response.json({ ...order, sp }, { status: 201 });
}
