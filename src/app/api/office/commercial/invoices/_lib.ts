// Shared by the /api/office/commercial/invoices/** and
// /api/office/commercial/orders/[id]/invoices handlers: the include the
// register and the detail both use, the loader, and the row columns that are
// kept in step with the snapshot. Not a route — Next ignores a colocated file
// that is not route.ts.
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/commercial/http";
import { rowTotalsFromSnapshot } from "@/lib/commercial/invoice-rules";
import type { InvoiceSnapshot } from "@/lib/commercial/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** Every invoice screen shows the order it belongs to and who it is for. */
export const INVOICE_INCLUDE = {
  order: { select: { id: true, number: true, kind: true, status: true, client: { select: { id: true, name: true, country: true } } } },
  packingList: { select: { id: true, number: true, status: true } },
  exportDocSet: { select: { id: true, generatedAt: true } },
} as const;

/** Next 15 hands route params as a promise; this segment's is `invId`. */
export async function invoiceIdOf(params: Promise<{ invId: string }>): Promise<string> {
  const { invId } = await params;
  if (!invId) fail(400, "Missing invoice id");
  return invId;
}

/** The invoice with its order and packing list, or a 404. */
export async function loadInvoice(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialInvoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
  if (!row) fail(404, "Invoice not found");
  return row;
}

/** The stored snapshot, or a 409 when the row was written without one. */
export function snapshotOf(row: Record<string, unknown>): InvoiceSnapshot {
  const s = row.snapshot as InvoiceSnapshot | null;
  if (!s || typeof s !== "object" || !Array.isArray(s.lines)) fail(409, "This invoice has no snapshot to print");
  return s;
}

/** The row columns that mirror the snapshot, so a list never disagrees with a PDF. */
export function rowPatchFor(snapshot: InvoiceSnapshot): Record<string, unknown> {
  return { snapshot, ...rowTotalsFromSnapshot(snapshot) };
}

/** The PI the invoice references: the order's live issued (or accepted) one. */
export async function livePiFor(orderId: string): Promise<{ number: string; date: string | null } | null> {
  const pi = await db.commercialProforma.findFirst({
    where: { orderId, status: { in: ["ISSUED", "ACCEPTED"] } },
    orderBy: [{ issuedAt: "desc" }, { revision: "desc" }],
    select: { number: true, issuedAt: true },
  });
  if (!pi) return null;
  return { number: pi.number, date: pi.issuedAt ? new Date(pi.issuedAt).toISOString().slice(0, 10) : null };
}

/** "01 TO 07" — the marks & nos an export invoice prints for N crates. */
export function marksForCrates(count: number): string | null {
  if (!count || count < 1) return null;
  return count === 1 ? "01" : `01 TO ${String(count).padStart(2, "0")}`;
}

/** kg → the weight string the export sheets print. */
export function weightText(kg: unknown): string | null {
  const n = kg === null || kg === undefined ? NaN : Number(kg);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} KGS` : null;
}

/** Prisma's unique-violation code, so a duplicate invoice number is a 409. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
