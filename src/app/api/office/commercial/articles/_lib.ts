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
import {
  articleName, barcodeBlockFor, claimEan,
  type BarcodeBlock, type EanOwner,
} from "@/lib/commercial/articles-rules";

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
  // Round four, answer 2. The screen needs all three: whose code it is, why
  // there is none, and — because the second of those stops the client's whole
  // label run — it has to be visible on the row rather than discovered when
  // somebody tries to print.
  eanSource: true, eanBlockedReason: true,
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
 * WHICH unique index a P2002 came off.
 *
 * There are two on this table now and they mean opposite things to the person
 * saving: the key index says "this customer already has this design at this
 * size", the EAN index says "another article owns this barcode". Prisma reports
 * the target as the declared field list (`["ean"]`) when the schema declares
 * the index and as the database's index NAME when only scripts/0082 does, so
 * both shapes are flattened to a string and asked the same question.
 */
export function uniqueViolationTarget(e: unknown): string {
  const meta = (e as { meta?: { target?: unknown } } | null)?.meta;
  const target = meta?.target;
  if (Array.isArray(target)) return target.join(",");
  return target === undefined || target === null ? "" : String(target);
}

/** A P2002 that is the EAN's, not the (client, design, size) key's. */
export function isEanUniqueViolation(e: unknown): boolean {
  return isUniqueViolation(e) && /ean/i.test(uniqueViolationTarget(e));
}

/** The name a refusal calls a row, off the database's Decimal columns. */
export function nameOfRow(a: { design?: string | null; itemCode?: string | null; lengthCm?: unknown; widthCm?: unknown; thicknessCm?: unknown }): string {
  return articleName({
    design: a.design ?? null,
    itemCode: a.itemCode ?? null,
    lengthCm: a.lengthCm === null || a.lengthCm === undefined ? null : Number(a.lengthCm),
    widthCm: a.widthCm === null || a.widthCm === undefined ? null : Number(a.widthCm),
    thicknessCm: a.thicknessCm === null || a.thicknessCm === undefined ? null : Number(a.thicknessCm),
  });
}

/**
 * The article that already owns a code, or null.
 *
 * ROUND FOUR, ANSWER 2 TURNED THE OLD WARNING INTO A REFUSAL. Until 0082 both
 * rows were stored and the person was told — the owner's own file carries
 * 8720847172266 on `220x19.5x2` AND on `220x15x2`, and that was read as the
 * customer's business to explain. It is now the database's: the EAN is unique
 * across the table, so the second row cannot hold the code at all. Asking FIRST
 * is what turns the constraint into a sentence naming the row that has it;
 * without this the desk would get Prisma's index name and a 500.
 */
export async function findEanOwner(ean: string | null, exceptId?: string): Promise<EanOwner | null> {
  if (!ean) return null;
  const row = await db.commercialCustomerArticle.findFirst({
    where: { ean, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true, design: true, itemCode: true, lengthCm: true, widthCm: true, thicknessCm: true },
  });
  return row ? { id: String(row.id), label: nameOfRow(row) } : null;
}

/** Every article of one customer, in the shape the block and the allocator
 *  read. `clientId: null` is the OURS set, which is a client of nobody's and
 *  has no GS1 prefix. It is an equality filter and nothing more: a customer's
 *  rows and ours are two separate sets here, and whoever needs both has to ask
 *  for both, which is what labelBarcodeBlock below does. */
export async function loadClientArticles(clientId: string | null): Promise<Array<{
  id: string; label: string; ean: string | null; eanSource: string | null; eanBlockedReason: string | null;
  design: string; itemCode: string | null; lengthCm: number; widthCm: number; thicknessCm: number;
}>> {
  const rows = await db.commercialCustomerArticle.findMany({
    where: { clientId },
    select: {
      id: true, design: true, itemCode: true, lengthCm: true, widthCm: true, thicknessCm: true,
      ean: true, eanSource: true, eanBlockedReason: true,
    },
    orderBy: ARTICLE_ORDER,
  });
  return rows.map((a: Record<string, unknown>) => ({
    id: String(a.id),
    label: nameOfRow(a as Record<string, never>),
    ean: (a.ean as string | null) ?? null,
    eanSource: (a.eanSource as string | null) ?? null,
    eanBlockedReason: (a.eanBlockedReason as string | null) ?? null,
    design: String(a.design ?? ""),
    itemCode: (a.itemCode as string | null) ?? null,
    lengthCm: Number(a.lengthCm), widthCm: Number(a.widthCm), thicknessCm: Number(a.thicknessCm),
  }));
}

/**
 * "Don't generate barcodes till it's fixed", asked of every set a label can
 * print a code out of.
 *
 * THE LABEL IS NOT RESOLVED PER CUSTOMER, so the block cannot be asked per
 * customer. articles-rules.articleFor takes the customer's own row first and
 * the CLIENT-LESS row second, so a customer with no row for a design prints
 * the code sitting on OUR row — and a duplicate inside the ours set is
 * invisible to a query filtered on their client id. The labels route asked
 * that narrower question until this was written, and printed a code off a pair
 * of our rows wearing one identity: the half-right answer at the customer's
 * gate that answer 2 exists to prevent.
 *
 * THE TWO SETS ARE READ AS ONE ARRAY rather than asked separately and merged,
 * so a collision ACROSS them is caught as well. The EAN is unique across the
 * whole table and not per customer, so one row of ours and one of theirs
 * holding one code is the same accident as two of theirs.
 *
 * THE ALLOCATOR IS NOT ASKED THIS WIDER QUESTION and must not be: it writes
 * into one customer's rows out of one customer's GS1 prefix, and the allocate
 * route refuses a blank customer outright, so the set its plan must be clean of
 * is that customer's. Printing reads the wider set, so printing asks the wider
 * question.
 */
export async function labelBarcodeBlock(clientId: string | null): Promise<BarcodeBlock> {
  const own = (clientId ?? "").trim();
  const sets: Array<string | null> = own ? [own, null] : [null];
  const rows = (await Promise.all(sets.map((c) => loadClientArticles(c)))).flat();
  return barcodeBlockFor(rows);
}

/** A customer id that is not a customer is a 400 with a sentence, not the
 *  foreign key's own 500. */
export async function requireClient(clientId: string | null): Promise<void> {
  if (!clientId) return;
  const row = await db.salesClient.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!row) fail(400, "That customer is not in the master — pick one from the list, or leave it blank for an article of ours.");
}

/**
 * The sentence for a duplicate the database caught that findEanOwner did not.
 *
 * TWO PEOPLE CAN SAVE IN THE SAME INSTANT and the loser must not get Prisma's
 * "Unique constraint failed on the fields: (`ean`)". The owner is looked up
 * again here because by the time the insert failed it EXISTS — that is what
 * failed the insert — so the second answer names it exactly as the first would
 * have.
 */
export async function eanTakenMessage(self: { id?: string | null; design: string; itemCode: string | null; lengthCm: number; widthCm: number; thicknessCm: number }, ean: string | null): Promise<string> {
  const owner = await findEanOwner(ean, self.id ?? undefined);
  const claim = claimEan({
    ean,
    self,
    owner: owner ?? { id: "another", label: "another article saved a moment ago" },
  });
  return claim.message ?? `${ean} is already on another article.`;
}

export function clashMessage(design: string, size: string, itemCode?: string | null): string {
  return `${design} ${size} is already on the list${itemCode ? ` as ${itemCode}` : ""} — edit that row rather than adding a second one.`;
}
