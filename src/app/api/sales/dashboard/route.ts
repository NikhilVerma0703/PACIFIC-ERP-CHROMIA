import { NextResponse } from "next/server";
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = prisma as any;

  const userId    = (session.user as any).id as string;
  const salesRole = (session.user as any).salesRole as string | null;
  const userName  = (session.user as any).name as string | null;
  const userEmail = (session.user as any).email as string | null;

  const isAdmin = salesRole === "SALES_ADMIN";
  const isCommercialOrAccounts = salesRole === "COMMERCIAL" || salesRole === "ACCOUNTS";

  // Roles that see ALL orders (not filtered by SP)
  const isAllOrders = isAdmin || isCommercialOrAccounts; // production-manager duty retired -> admins

  // Read salesFactory fresh from DB for Commercial/Accounts (JWT may be stale)
  let salesFactory: string | null = null;
  if (isCommercialOrAccounts) {
    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT sales_factory FROM users WHERE id = $1`, userId
    ).catch(() => []);
    salesFactory = rows[0]?.sales_factory ?? null;
  }

  // Check if user is a Reporting Manager (has active SP assignments)
  const managedAssignments = isAllOrders ? [] : await db.salesManagerAssignment.findMany({
    where: { managerId: userId, isActive: true },
    include: { sp: { select: { id: true, name: true, email: true } } },
  });
  const isRM = managedAssignments.length > 0;

  // Determine which spIds to filter by
  let spFilter: string[] | null = null;
  if (isAllOrders) {
    spFilter = null; // all orders
  } else if (isRM) {
    spFilter = managedAssignments.map((a: any) => a.spId);
  } else {
    spFilter = [userId]; // own orders only
  }

  // Factory filter for Commercial/Accounts based on their DB salesFactory setting
  let factoryOrderIds: string[] | null = null;
  if (isCommercialOrAccounts && salesFactory) {
    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT DISTINCT order_id FROM proforma_invoices WHERE product_type = $1 AND order_id IS NOT NULL`,
      salesFactory
    ).catch(() => []);
    factoryOrderIds = rows.map((r: any) => r.order_id).filter(Boolean);
  }

  const spOrderWhere  = spFilter ? { spId: { in: spFilter } } : {};
  const factoryWhere  = factoryOrderIds ? { id: { in: factoryOrderIds } } : {};
  const orderWhere    = { ...spOrderWhere, ...factoryWhere };

  // PI factory filter
  let factoryPiIds: string[] | null = null;
  if (isCommercialOrAccounts && salesFactory) {
    const rows: any[] = await db.$queryRawUnsafe(
      `SELECT id FROM proforma_invoices WHERE product_type = $1`,
      salesFactory
    ).catch(() => []);
    factoryPiIds = rows.map((r: any) => r.id).filter(Boolean);
  }
  const spPiWhere = spFilter ? { spId: { in: spFilter } } : {};
  const piWhere   = { ...spPiWhere, ...(factoryPiIds ? { id: { in: factoryPiIds } } : {}) };

  // Order counts by status
  const [
    totalOrders,
    pendingPayment,
    inProduction,
    dispatched,
    delivered,
  ] = await Promise.all([
    db.salesOrder.count({ where: orderWhere }),
    db.salesOrder.count({ where: { ...orderWhere, status: "PENDING_PAYMENT" } }),
    db.salesOrder.count({ where: { ...orderWhere, status: "IN_PRODUCTION" } }),
    db.salesOrder.count({ where: { ...orderWhere, status: "DISPATCHED" } }),
    db.salesOrder.count({ where: { ...orderWhere, status: "DELIVERED" } }),
  ]);

  // PI counts
  const [totalPIs, draftPIs, sentPIs, acceptedPIs] = await Promise.all([
    db.proformaInvoice.count({ where: piWhere }),
    db.proformaInvoice.count({ where: { ...piWhere, status: "DRAFT" } }),
    db.proformaInvoice.count({ where: { ...piWhere, status: "SENT" } }),
    db.proformaInvoice.count({ where: { ...piWhere, status: "ACCEPTED" } }),
  ]);

  // Recent orders
  const recentOrdersRaw = await db.salesOrder.findMany({
    where: orderWhere,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      currency: true,
      totalAmount: true,
      createdAt: true,
      client: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const recentOrders = recentOrdersRaw.map((o: any) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    clientName: o.client?.name ?? "",
    status: o.status,
    currency: o.currency,
    totalAmount: o.totalAmount ?? 0,
    createdAt: o.createdAt,
  }));

  // ── Hierarchy tree (RM and Admin only) ────────────────────────────────────
  // Shape: { managers: [{ id, name, email, role, sps: [{ id, name, email, orderCount, piCount, clients: [] }] }], unassigned: [...] }
  let hierarchy: any = null;

  if (isRM || isAdmin) {
    // Helper: get stats + recent clients for a salesperson
    async function spNode(sp: { id: string; name: string | null; email: string | null }) {
      const [orderCount, piCount, recentClients] = await Promise.all([
        db.salesOrder.count({ where: { spId: sp.id } }),
        db.proformaInvoice.count({ where: { spId: sp.id } }),
        db.salesClient.findMany({
          where: { orders: { some: { spId: sp.id } } },
          select: { id: true, name: true, country: true },
          orderBy: { name: "asc" },
          take: 5,
        }),
      ]);
      return {
        id: sp.id,
        name: sp.name ?? "",
        email: sp.email ?? "",
        orderCount,
        piCount,
        clients: recentClients,
      };
    }

    if (isRM) {
      // RM sees themselves as the root with their SPs as children
      const spNodes = await Promise.all(
        managedAssignments.map((a: any) => spNode(a.sp))
      );
      // Also get RM's own order/pi counts
      const [rmOrders, rmPIs] = await Promise.all([
        db.salesOrder.count({ where: { spId: userId } }),
        db.proformaInvoice.count({ where: { spId: userId } }),
      ]);
      hierarchy = {
        managers: [{
          id: userId,
          name: userName ?? "",
          email: userEmail ?? "",
          role: "REPORTING_MANAGER",
          orderCount: rmOrders,
          piCount: rmPIs,
          sps: spNodes,
        }],
        unassigned: [],
      };
    } else {
      // Admin sees all RMs + SALES_ADMIN + unassigned SPs
      const allManagers: any[] = await db.$queryRawUnsafe(
        `SELECT id, name, email, role, sales_role AS "salesRole"
         FROM users
         WHERE role = 'ADMIN' OR sales_role IN ('SALES_ADMIN','REPORTING_MANAGER')
         ORDER BY name ASC`
      ).catch(() => []);

      // All active assignments
      const allAssignments = await db.salesManagerAssignment.findMany({
        where: { isActive: true },
        select: {
          managerId: true,
          spId: true,
          sp: { select: { id: true, name: true, email: true } },
        },
      });

      // All salespersons
      const allSPs: any[] = await db.$queryRawUnsafe(
        `SELECT id, name, email FROM users WHERE sales_role = 'SALESPERSON' ORDER BY name ASC`
      ).catch(() => []);

      const assignedSpIds = new Set(allAssignments.map((a: any) => a.spId));

      // Build manager nodes
      const managerNodes = await Promise.all(
        allManagers.map(async (mgr: any) => {
          const mgrAssignments = allAssignments.filter((a: any) => a.managerId === mgr.id);
          const spNodes = await Promise.all(mgrAssignments.map((a: any) => spNode(a.sp)));
          const [mgrOrders, mgrPIs] = await Promise.all([
            db.salesOrder.count({ where: { spId: mgr.id } }),
            db.proformaInvoice.count({ where: { spId: mgr.id } }),
          ]);
          return {
            id: mgr.id,
            name: mgr.name ?? "",
            email: mgr.email ?? "",
            role: mgr.salesRole ?? mgr.role,
            orderCount: mgrOrders,
            piCount: mgrPIs,
            sps: spNodes,
          };
        })
      );

      // Unassigned SPs
      const unassignedSPs = await Promise.all(
        allSPs
          .filter((sp: any) => !assignedSpIds.has(sp.id))
          .map((sp: any) => spNode(sp))
      );

      hierarchy = { managers: managerNodes, unassigned: unassignedSPs };
    }
  }

  // Legacy flat myTeam (kept for backward compat, but hierarchy is preferred)
  const myTeam = hierarchy
    ? (hierarchy.managers?.[0]?.sps ?? []).map((s: any) => ({
        id: s.id, name: s.name, email: s.email, orderCount: s.orderCount, piCount: s.piCount,
      }))
    : [];

  return NextResponse.json({
    totalOrders,
    pendingPayment,
    inProduction,
    dispatched,
    delivered,
    totalPIs,
    draftPIs,
    sentPIs,
    acceptedPIs,
    recentOrders,
    myTeam,
    hierarchy,
  });
}
