/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { redirect } from "next/navigation";
import { getSpMap } from "@/lib/sales/spLookup";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import ProductionClient from "./ProductionClient";

const db = prisma as any;

export default async function ProductionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user      = session.user as any;
  const salesRole = user.salesRole as string | null;

  const allowed = salesRole === "SALES_ADMIN"; // production duties belong to module admins
  if (!allowed) redirect("/sales");

  const orders = await db.salesOrder.findMany({
    where: { status: { in: ["PENDING_PRODUCTION", "IN_PRODUCTION", "PACKING"] } },
    include: {
      client:           { select: { id: true, name: true, country: true } },
      proformaInvoices: {
        where:   { status: "ACCEPTED" },
        take:    1,
        orderBy: { acceptedAt: "desc" },
      },
      productionJob: true,
    },
    orderBy: { updatedAt: "asc" },
  });
  const spMap = await getSpMap(orders.map((o: { spId: string | null }) => o.spId));
  const withSp = orders.map((o: { spId: string | null }) => ({ ...o, sp: spMap.get(String(o.spId)) ?? { id: String(o.spId ?? ""), name: String(o.spId ?? "—"), email: null } }));

  return (
    <ProductionClient
      initialOrders={orders}
      isProductionManager={salesRole === "SALES_ADMIN"}
    />
  );
}
