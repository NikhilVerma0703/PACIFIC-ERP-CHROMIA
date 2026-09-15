// Shared by the /api/office/commercial/orders/** handlers: the detail include
// from DESIGN.md §5, the header-field parser, and the checklist refresh every
// write on an order ends with. Not a route — Next ignores a colocated file
// that is not route.ts.
import { prisma } from "@/lib/prisma";
import { fail, str, num, dateOnly } from "@/lib/commercial/http";
import { parseChecklist, prefillChecklist, type ChecklistItem, type ChecklistSource } from "@/lib/commercial/checklist";
import { loadSettings } from "@/lib/commercial/settings";
import { parseSellerKey, sellerChoices, SELLER_KEYS } from "@/lib/commercial/settings-defaults";
import { advanceStatus, effectiveAdvancePct, pctOf, type AdvanceStatus } from "@/lib/commercial/receipts-rules";
import { advanceRateFor } from "@/lib/commercial/advance-rate";
import {
  HEADER_TEXT_FIELDS, HEADER_PARTY_FIELDS, ORDER_KINDS, PO_EVIDENCE,
  normalizeParty, checklistSourceFromOrder, orderTotals,
  type OrderHeaderLike, type ChecklistItemLike, type ItemLike,
} from "@/lib/commercial/orders-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** DESIGN.md §5 — the one include every tab consumes. */
export const ORDER_DETAIL_INCLUDE = {
  client: { include: { commercialExt: true } },
  enquiry: { select: { id: true, number: true } },
  items: { orderBy: { lineNo: "asc" } },
  holds: { include: { slabs: { orderBy: { slabNumber: "asc" } } }, orderBy: { placedAt: "desc" } },
  // The plan's own figures ride on the request row (plannedSlabs, plannedHours,
  // cleaningHours, shade — columns, so nothing to map); every edit to them is a
  // CommercialProductionPlanChange, newest first (answer 13).
  productionRequests: { include: { changes: { orderBy: { changedAt: "desc" } } }, orderBy: { raisedAt: "desc" } },
  proformas: { orderBy: [{ number: "asc" }, { revision: "desc" }] },
  // measurementUnit is a column on the list (answer 17); the include needs no more.
  packingLists: { include: { crates: { orderBy: { crateNo: "asc" } }, slabs: { orderBy: { sortOrder: "asc" } } }, orderBy: { createdAt: "desc" } },
  invoices: { include: { exportDocSet: true }, orderBy: { invoiceDate: "desc" } },
  challans: { orderBy: { challanDate: "desc" } },
  // Newest first by the date the money arrived, then by entry — two receipts on
  // one day keep the order they were typed in.
  receipts: { orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }] },
  // Round three, answers 7 and 8: the outside work — container booking, CHA,
  // the BL, COO, CEFA, fumigation, the Daltile upload, the ETA sheet — as
  // ticks on the order. In the include so the Tasks card and the order's own
  // progress line read the SAME rows the tasks route writes; the route seeds
  // the defaults, so an order nobody has opened yet simply has none here.
  tasks: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] },
  events: { orderBy: { at: "desc" }, take: 100 },
} as const;

/**
 * The advance gate for one order row (answer 2; round two, answers 11 and 12).
 * The percentage is the order's own or the settings default for its kind, the
 * total is Σ of the line amounts — there is no total column — and only ADVANCE
 * receipts in the ORDER's currency count. A waiver satisfies it outright.
 *
 * Written once here because three readers must agree to the paisa: the order
 * detail every screen renders, the stage facts canEnter is handed, and the
 * dispatch route's refusal.
 */
export async function advanceOf(
  order: Record<string, unknown>,
  items: ReadonlyArray<unknown>,
  receipts: ReadonlyArray<{ kind: string; amount: unknown; currency: string }>,
): Promise<AdvanceStatus> {
  return advanceStatus({
    receipts,
    orderTotal: orderTotals(items as ItemLike[]).amount,
    currency: String(order.currency ?? ""),
    advancePct: await advancePctOf(order),
    // Round three, answer 10: a receipt in another currency counts through the
    // rate typed on the order's live invoice. Without this the money shows on
    // the receipts card and still does not open the truck.
    rate: await advanceRateFor(String(order.id ?? "")),
    waived: order.advanceWaivedAt != null,
  });
}

/** The two settings defaults behind the advance (answer 11: 100 domestic, 30
 *  export as shipped), in the shape effectiveAdvancePct reads. loadSettings is
 *  cached per request, so asking twice in one handler costs one read. */
export async function advanceDefaults(): Promise<{ domestic: number; export: number }> {
  const settings = await loadSettings();
  return { domestic: settings.dispatch.advancePctDomestic, export: settings.dispatch.advancePctExport };
}

/** The percentage IN FORCE on one order right now: its own when it has one,
 *  else the settings default for its kind. What the gate measures against, and
 *  what a header edit is compared to before it is allowed to lower it. */
export async function advancePctOf(order: Record<string, unknown>): Promise<number> {
  return effectiveAdvancePct(order.advancePct, String(order.kind ?? ""), await advanceDefaults());
}

/** The order detail, checklist parsed and the advance derived (the dispatch
 *  gate's figures), or a 404. Pass through plain() before json(). */
export async function loadOrderDetail(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialOrder.findUnique({ where: { id }, include: ORDER_DETAIL_INCLUDE });
  if (!row) fail(404, "Order not found");
  return {
    ...row,
    checklist: parseChecklist(row.checklist),
    advance: await advanceOf(row, row.items, row.receipts),
    // Round two, answer 11: the settings default for THIS order's kind, sent
    // whether or not the order overrides it. The overview's hint under a blank
    // "Advance required" box has to name the DEFAULT the blank falls back to;
    // with only the effective percentage it printed the order's own figure and
    // called it the default.
    advanceDefaultPct: effectiveAdvancePct(null, String(row.kind ?? ""), await advanceDefaults()),
    // The selling entities, for the header's dropdown (owner, 2026-09-15;
    // scripts/0085). Derived here rather than shipped in the client bundle so
    // a label corrected in Settings is the label the desk reads, and so the
    // screen can never offer a key the server would refuse.
    sellerChoices: sellerChoices(await loadSettings()),
  };
}

/** The bare order row with its items (for writes), or a 404. */
export async function loadOrderWithItems(id: string): Promise<Record<string, unknown> & { items: Array<Record<string, unknown>> }> {
  const row = await db.commercialOrder.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: "asc" } } } });
  if (!row) fail(404, "Order not found");
  return row;
}

const has = (body: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(body, k);

/**
 * The header fields present in a request body, parsed for Prisma. Only keys
 * the body carries are returned, so a PATCH touches nothing it did not name.
 * Enums are checked here (a bad kind is a 400, not a Postgres error).
 */
export function headerPatchFromBody(body: Record<string, unknown>, opts: { allowKind?: boolean; allowClient?: boolean } = {}): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const k of HEADER_TEXT_FIELDS) if (has(body, k)) data[k] = str(body[k]);
  for (const k of HEADER_PARTY_FIELDS) if (has(body, k)) data[k] = normalizeParty(body[k]);
  // The salesperson the order's PI is raised for (owner, 2026-09-15;
  // scripts/0084). Plain nullable text, parsed exactly like the fields above —
  // a blank box clears it — but not a member of HEADER_TEXT_FIELDS, because
  // that list is the order header the SOP checklist reads and prefills from
  // (checklistSourceFromOrder) and this column answers none of its 22 points.
  // It is the PROFORMA's field that happens to live on the order row, so that
  // every PI of an order names the same person and a revision cannot change
  // who that was.
  if (has(body, "salespersonName")) data.salespersonName = str(body.salespersonName);
  // WHICH GROUP COMPANY SELLS THIS ORDER (owner, 2026-09-15; scripts/0085).
  // Kept off HEADER_TEXT_FIELDS for the same reason the salesperson is: that
  // list is the order header the SOP checklist prefills from, and this answers
  // none of its 22 points.
  //
  // CHECKED HERE AND NOWHERE ELSE. Everywhere a DOCUMENT is built, an unknown
  // seller key reads as the default — it has to, because the column is
  // nullable and every order that predates it says nothing. But this is the
  // one place a person is TYPING the answer, and a typed key that names no
  // company is a mistake to refuse now, not a proforma that quietly goes out
  // under the wrong name. A blank box clears the column back to NULL, which is
  // the default seller.
  if (has(body, "sellerKey")) {
    const raw = str(body.sellerKey);
    const key = raw ? parseSellerKey(raw) : null;
    if (raw && !key) fail(400, `Seller must be one of ${SELLER_KEYS.join(", ")}`);
    data.sellerKey = key;
  }
  if (has(body, "customerPoDate")) {
    const raw = str(body.customerPoDate);
    const d = dateOnly(raw);
    if (raw && !d) fail(400, "Customer PO date must be YYYY-MM-DD");
    data.customerPoDate = d;
  }
  if (has(body, "poEvidence")) {
    const v = str(body.poEvidence);
    if (v && !PO_EVIDENCE.includes(v.toUpperCase())) fail(400, `PO evidence must be one of ${PO_EVIDENCE.join(", ")}`);
    data.poEvidence = v ? v.toUpperCase() : null;
  }
  if (has(body, "exchangeRate")) {
    const raw = body.exchangeRate;
    const n = num(raw);
    if (raw !== null && raw !== undefined && raw !== "" && n === null) fail(400, "Exchange rate must be a number");
    data.exchangeRate = n;
  }
  // Round two, answer 11: the share of the order that must be received before
  // dispatch. A blank box CLEARS it back to the settings default for the kind,
  // which is why an empty string is a null here rather than a "leave it" —
  // unlike currency, this column is nullable and null is a meaningful answer.
  if (has(body, "advancePct")) {
    const raw = body.advancePct;
    if (raw === null || raw === undefined || String(raw).trim() === "") data.advancePct = null;
    else {
      const p = pctOf(raw);
      if (p === null) fail(400, "Advance required must be a percentage between 0 and 100");
      data.advancePct = p;
    }
  }
  if (has(body, "currency")) {
    const c = str(body.currency);
    if (c) data.currency = c.toUpperCase();
    else delete data.currency;            // currency is NOT NULL: a blank means "leave it"
  }
  if (has(body, "countryOfOrigin") && !data.countryOfOrigin) delete data.countryOfOrigin;   // same: NOT NULL with a default
  if (opts.allowKind && has(body, "kind")) {
    const k = str(body.kind)?.toUpperCase();
    if (!k || !ORDER_KINDS.includes(k as "DOMESTIC" | "EXPORT")) fail(400, "kind must be DOMESTIC or EXPORT");
    data.kind = k;
  }
  if (opts.allowClient && has(body, "clientId")) {
    const c = str(body.clientId);
    if (!c) fail(400, "clientId is required");
    data.clientId = c;
  }
  if (has(body, "enquiryId")) data.enquiryId = str(body.enquiryId);
  return data;
}

/** A client row with its commercial ext, or a 400 naming the problem. */
export async function loadClient(clientId: string): Promise<Record<string, unknown>> {
  const client = await db.salesClient.findUnique({ where: { id: clientId }, include: { commercialExt: true } });
  if (!client) fail(400, "Client not found");
  return client;
}

/**
 * The order row and its lines in the shape prefillChecklist reads. The loaders
 * hand back `Record<string, unknown>` (the Prisma client is `any` here while
 * the generated types lag the schema), so the cast happens ONCE, here, rather
 * than at each call site — orders-rules names the fields it actually reads.
 */
export function checklistSourceOf(
  order: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
): ChecklistSource {
  return checklistSourceFromOrder(order as OrderHeaderLike, items as ChecklistItemLike[]) as ChecklistSource;
}

/**
 * Re-run the checklist prefill from the order as it now stands. Every write
 * on an order ends here: prefill only fills blanks, so a point Commercial
 * answered by hand is never overwritten (lib/commercial/checklist).
 */
export async function refreshChecklist(orderId: string): Promise<ChecklistItem[]> {
  const order = await loadOrderWithItems(orderId);
  const next = prefillChecklist(parseChecklist(order.checklist), checklistSourceOf(order, order.items));
  await db.commercialOrder.update({ where: { id: orderId }, data: { checklist: next } });
  return next;
}

/** Prisma's unique-violation code, so a duplicate order number is a 409. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
