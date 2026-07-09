import { prisma } from "@/lib/prisma";

export async function generateOrderNumber(): Promise<string> {
  const db = prisma as any; // stale generated client until `prisma generate` runs post-merge
  const year  = new Date().getFullYear();
  const count = await db.salesOrder.count();
  const seq   = String(count + 1).padStart(5, "0");
  return `PAC-${year}-${seq}`;
}

export async function generatePINumber(spEmail: string, productType?: string): Promise<string> {
  const db = prisma as any;
  const count  = await db.proformaInvoice.count();
  const seq    = String(count + 1).padStart(4, "0");

  if (productType === "GRANITE") {
    // PG-7421 format — use PG prefix + 4 digit seq starting from 7001 range
    return `PG-${seq}`;
  }

  // Quartz: PI-SPP-XXXX format
  const prefix = (spEmail.split("@")[0] ?? "PI").toUpperCase().slice(0, 3);
  return `PI-${prefix}-${seq}`;
}
