// Shared by the customer-article handlers. Not a route.
//
// THE AREA IS `designCodes` (round three, answer 4). An article is the design
// master seen from the customer's side — the same design, at one size, under
// the customer's own item code and barcode — so the people who maintain the
// codes maintain these, and the area table already says who they are: the
// Commercial Manager and the admin write, Setumani and Murali read, Raghav and
// the dispatch checker do not see the screen at all.
import { prisma } from "@/lib/prisma";
import { commercialCan, type CommercialGate, type CommercialAction } from "@/lib/commercial/access";
import { type CommercialArea } from "@/lib/commercial/access-rules";
import { bad, fail } from "@/lib/commercial/http";
import { sizeLabel } from "@/lib/commercial/articles-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

export const AREA: CommercialArea = "designCodes";

/** The area question on top of the action question, worded as this screen —
 *  a refused action is disabled with its reason, never hidden. */
export function areaRefusal(g: CommercialGate, action: CommercialAction) {
  if (commercialCan(g.user, action, AREA)) return null;
  return bad(
    action === "view"
      ? "The customer article list is not one of this login's screens."
      : "Item codes and barcodes are changed by the Commercial Manager or an admin.",
    403,
  );
}

/** What every handler returns, with the customer's name for the list. */
export const ARTICLE_SELECT = {
  id: true, clientId: true, design: true,
  lengthCm: true, widthCm: true, thicknessCm: true,
  itemCode: true, description: true, ean: true, notes: true,
  createdAt: true, updatedAt: true,
  client: { select: { id: true, name: true } },
} as const;

export const ARTICLE_ORDER = [
  { design: "asc" }, { lengthCm: "asc" }, { widthCm: "asc" }, { thicknessCm: "asc" },
] as const;

/**
 * The row already holding this (client, design, size), or null.
 *
 * WHY THIS RUNS BEFORE THE INSERT. scripts/0081 puts the unique index on
 * COALESCE(client_id, ''), which Prisma's schema cannot express, so a clash
 * comes back as a bare constraint violation with no useful message. Asking
 * first lets the answer name the row that is already there — twelve articles
 * for one design differ only by size, and "already exists" without saying
 * WHICH is no help at all.
 */
export async function findClash(
  key: { clientId: string | null; design: string; lengthCm: number; widthCm: number; thicknessCm: number },
  exceptId?: string,
): Promise<{ id: string; itemCode: string | null } | null> {
  const row = await db.commercialCustomerArticle.findFirst({
    where: {
      clientId: key.clientId,
      design: { equals: key.design, mode: "insensitive" },
      lengthCm: key.lengthCm, widthCm: key.widthCm, thicknessCm: key.thicknessCm,
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true, itemCode: true },
  });
  return row ?? null;
}

/** Prisma reports the database's unique index as P2002 even when the schema
 *  does not declare it — the last line of defence against two clerks saving
 *  the same size at the same moment. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/**
 * One EAN on two articles — a WARNING, never a refusal.
 *
 * The owner's own file does it: `220x19.5x2` and `220x15x2` both carry
 * 8720847172266 (DECISIONS-3.md 4, "to raise with the customer, not to copy").
 * That is the customer's decision to explain or to correct, not ours to
 * overrule, and refusing the save would leave the desk unable to enter the
 * codes it was sent. So both rows exist and the person typing is told.
 */
export async function eanWarning(ean: string | null, exceptId?: string): Promise<string | null> {
  if (!ean) return null;
  const others: Array<{ design: string; lengthCm: unknown; widthCm: unknown; thicknessCm: unknown }> =
    await db.commercialCustomerArticle.findMany({
      where: { ean, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { design: true, lengthCm: true, widthCm: true, thicknessCm: true },
      take: 5,
    });
  if (!others.length) return null;
  const where = others
    .map((o) => `${o.design} ${sizeLabel(Number(o.lengthCm), Number(o.widthCm), Number(o.thicknessCm))}`)
    .join(", ");
  return `${ean} is also on ${where}. One barcode on two sizes is worth raising with the customer.`;
}

/** A customer id that is not a customer is a 400 with a sentence, not the
 *  foreign key's own 500. */
export async function requireClient(clientId: string | null): Promise<void> {
  if (!clientId) return;
  const row = await db.salesClient.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!row) fail(400, "That customer is not in the master — pick one from the list, or leave it blank for an article of ours.");
}

export function clashMessage(design: string, size: string, itemCode?: string | null): string {
  return `${design} ${size} is already on the list${itemCode ? ` as ${itemCode}` : ""} — edit that row rather than adding a second one.`;
}
