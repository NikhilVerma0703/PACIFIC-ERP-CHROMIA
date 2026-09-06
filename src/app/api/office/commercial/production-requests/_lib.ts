// Shared by the production-request handlers (the queue, the reorder, one row,
// the "has production run?" hint) and by the order-scoped POST. Not a route.
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/commercial/http";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** The queue shows the order it came from and who the customer is: a planner
 *  choosing what to run next needs to know whose order is waiting. */
export const REQUEST_INCLUDE = {
  order: { select: { id: true, number: true, status: true, client: { select: { id: true, name: true } } } },
  enquiry: { select: { id: true, number: true } },
} as const;

export async function loadRequest(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialProductionRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
  if (!row) fail(404, "Production request not found");
  return row;
}

export async function loadOrderForRequest(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialOrder.findUnique({
    where: { id },
    select: { id: true, number: true, status: true, enquiryId: true, client: { select: { id: true, name: true } } },
  });
  if (!row) fail(404, "Order not found");
  return row;
}
