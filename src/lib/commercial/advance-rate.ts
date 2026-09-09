// THE EXCHANGE RATE THE ADVANCE IS MEASURED THROUGH (round three, answer 10).
//
// It reads the ORDER's live invoice, because that is where the owner types the
// rate: "add exchange rate per invoice, manual." Every surface that weighs the
// advance takes its rate from HERE — the receipts card, the order detail, the
// stage strip, the dashboard tile and the dispatch refusal — so they can never
// convert at different rates and disagree about whether a truck may leave.
//
// It lives in lib rather than beside the invoice routes because lib/commercial/
// order-stage.ts needs it too, and a library reaching up into app/api for a
// query would invert the dependency the whole module is arranged around.
import { prisma } from "@/lib/prisma";
import { invoiceAdvanceRate } from "@/lib/commercial/invoice-rules";
import type { AdvanceRate } from "@/lib/commercial/receipts-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

/** The rate on this order's live invoice, or null when there is none to read. */
export async function advanceRateFor(orderId: string): Promise<AdvanceRate | null> {
  if (!orderId) return null;
  const invoices = await db.commercialInvoice.findMany({
    where: { orderId },
    orderBy: { invoiceDate: "desc" },
    select: { status: true, number: true, currency: true, exchangeRate: true, exchangeRateAt: true },
  });
  return invoiceAdvanceRate(invoices as Array<{ status: string; number: string | null; currency: string | null; exchangeRate: unknown; exchangeRateAt: Date | null }>);
}

/**
 * The same answer for MANY orders in ONE query.
 *
 * The dashboard weighs up to five hundred orders to draw one number. Asking
 * advanceRateFor per order would be five hundred sequential round trips to
 * Neon for a tile — so the invoices are fetched together and grouped here, and
 * each order is still judged by invoiceAdvanceRate, the same rule the single
 * lookup and the receipts card use. One query, one rule.
 */
export async function advanceRatesFor(orderIds: readonly string[]): Promise<Map<string, AdvanceRate | null>> {
  const out = new Map<string, AdvanceRate | null>();
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await db.commercialInvoice.findMany({
    where: { orderId: { in: ids } },
    orderBy: { invoiceDate: "desc" },
    select: { orderId: true, status: true, number: true, currency: true, exchangeRate: true, exchangeRateAt: true },
  });
  const byOrder = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows as Array<Record<string, unknown>>) {
    const k = String(r.orderId ?? "");
    const list = byOrder.get(k);
    if (list) list.push(r); else byOrder.set(k, [r]);
  }
  for (const id of ids) {
    out.set(id, invoiceAdvanceRate((byOrder.get(id) ?? []) as Array<{ status: string; number: string | null; currency: string | null; exchangeRate: unknown; exchangeRateAt: Date | null }>));
  }
  return out;
}
