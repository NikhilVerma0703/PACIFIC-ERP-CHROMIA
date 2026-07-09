/* eslint-disable @typescript-eslint/no-explicit-any */
// POST /api/admin/wipe-sales-data — DANGER: deletes every sales-module row
// (clients, PIs, orders, payments, shipping docs, …). Module-admin only
// (salesGate ADMIN tier / SALES_ADMIN duty). Used by Sales → Settings →
// Danger Zone to reset test data before go-live.
import { salesAuth as auth } from "@/lib/sales/session";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const db = prisma as any;

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const salesRole = session.user.salesRole as string | null;
  if (salesRole !== "SALES_ADMIN") {
    return NextResponse.json({ error: "Forbidden — SALES_ADMIN only" }, { status: 403 });
  }

  const results: Record<string, string> = {};

  // Delete in reverse dependency order
  const steps: [string, () => Promise<any>][] = [
    ["salesOrderLog",         () => db.salesOrderLog.deleteMany({})],
    ["salesAdminAlert",       () => db.salesAdminAlert.deleteMany({})],
    ["salesCreditNote",       () => db.salesCreditNote.deleteMany({})],
    ["salesPortArrival",      () => db.salesPortArrival.deleteMany({})],
    ["salesShipmentDocs",     () => db.salesShipmentDocs.deleteMany({})],
    ["salesContainer",        () => db.salesContainer.deleteMany({})],
    ["salesPackingList",      () => db.salesPackingList.deleteMany({})],
    ["salesPackage",          () => db.salesPackage.deleteMany({})],
    ["salesProductionJob",    () => db.salesProductionJob.deleteMany({})],
    ["salesStockCheck",       () => db.salesStockCheck.deleteMany({})],
    ["salesPaymentDivision",  () => db.salesPaymentDivision.deleteMany({})],
    ["salesPaymentTerms",     () => db.salesPaymentTerms.deleteMany({})],
    ["pIRejectionLog",        () => db.pIRejectionLog.deleteMany({})],
    ["pIRevision",            () => db.pIRevision.deleteMany({})],
    ["proformaInvoice",       () => db.proformaInvoice.deleteMany({})],
    ["salesOrder",            () => db.salesOrder.deleteMany({})],
    ["salesManagerAssignment",() => db.salesManagerAssignment.deleteMany({})],
    ["salesClient",           () => db.salesClient.deleteMany({})],
  ];

  for (const [name, fn] of steps) {
    try {
      const r = await fn();
      results[name] = `deleted ${r.count ?? "?"}`;
    } catch (e: any) {
      results[name] = `error: ${e.message}`;
    }
  }

  return NextResponse.json({ ok: true, results });
}
