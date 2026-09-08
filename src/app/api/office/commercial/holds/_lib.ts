// Shared by every hold handler — the order-referenced POST under
// /orders/[id]/holds, the POST here (which takes an orderId in the body and
// does the same thing), and release. Not a route: Next only treats route.ts
// as one.
//
// The one rule worth stating twice: a hold's slab rows are ALWAYS built from
// the bridge's `before` snapshot for the slabs the bridge actually changed,
// never from the request body. A body can name a slab that is cut-marked, held
// by somebody else, or not in finished goods at all; recording those as held
// would make the hold lie about what is reserved.
//
// There is no extend (answer 11) and no enquiry hold (answer 12): a hold is
// placed against an order, runs its days, and either ends in a packing list or
// lapses — at which point reconcileHold sends the order back to the stock check.
import { prisma } from "@/lib/prisma";
import { fail, str } from "@/lib/commercial/http";
import type { CommercialGate } from "@/lib/commercial/access";
import { actorStamp } from "@/lib/commercial/access";
import { loadSettings } from "@/lib/commercial/settings";
import { logOrderEvent } from "@/lib/commercial/events";
import { bumpOrder } from "@/lib/commercial/order-stage";
import { holdSlabs, reconcileHold, type BridgeResult } from "@/lib/commercial/inventory-bridge";
import {
  heldSlabNumbers, buildHoldSlabRows, holdSqft, nothingHeldMessage, holdExpiry,
  parseSlabNumbers, normaliseDays, resolveHoldReference,
} from "@/lib/commercial/holds-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = prisma as any;

/** Hold + slabs + the two references, for the screens and the detail routes. */
export const HOLD_INCLUDE = {
  slabs: { orderBy: { slabNumber: "asc" } },
  order: { select: { id: true, number: true, status: true, client: { select: { id: true, name: true } } } },
  enquiry: { select: { id: true, number: true } },
} as const;

export async function loadHold(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialStockHold.findUnique({ where: { id }, include: HOLD_INCLUDE });
  if (!row) fail(404, "Hold not found");
  return row;
}

/** Reconcile against live inventory, then read. A hold whose slabs the sweep
 *  expired overnight must not still read ACTIVE on the screen that is about to
 *  release it. */
export async function reconcileAndLoad(id: string): Promise<Record<string, unknown>> {
  await reconcileHold(id);
  return loadHold(id);
}

export interface PlaceHoldArgs {
  slabNumbers: number[];
  reference: string;
  customer: string | null;
  days: number;
  notes: string | null;
  orderId: string | null;
  enquiryId: string | null;
  by: string | null;
  byId: string | null;
  isAdmin: boolean;
}

export interface PlaceHoldResult {
  hold: Record<string, unknown>;
  held: number[];
  updated: number;
  skipped: BridgeResult["skipped"];
  missing: number[];
  sqft: number;
}

/**
 * Reserve the slabs through the bridge and record the hold. Refuses (409) when
 * the bridge could hold nothing, naming every reason it gave — "no slab could
 * be held" on its own tells the person nothing they can act on.
 */
export async function placeHold(args: PlaceHoldArgs): Promise<PlaceHoldResult> {
  const now = new Date();
  const res = await holdSlabs({
    slabNumbers: args.slabNumbers,
    reference: args.reference,
    customer: args.customer,
    days: args.days,
    by: args.by,
    isAdmin: args.isAdmin,
  });
  if (res.updated === 0) fail(409, nothingHeldMessage(res));
  const held = heldSlabNumbers(args.slabNumbers, res);
  const rows = buildHoldSlabRows(res.before, held);
  const hold = await db.commercialStockHold.create({
    data: {
      orderId: args.orderId,
      enquiryId: args.enquiryId,
      reference: args.reference,
      customer: args.customer,
      status: "ACTIVE",
      placedById: args.byId,
      placedByName: args.by,
      placedAt: now,
      expiresAt: holdExpiry(now, args.days),
      notes: args.notes,
      slabs: { create: rows },
    },
    include: HOLD_INCLUDE,
  });
  return { hold, held, updated: res.updated, skipped: res.skipped, missing: res.missing, sqft: holdSqft(rows) };
}

export async function loadOrderForHold(id: string): Promise<Record<string, unknown>> {
  const row = await db.commercialOrder.findUnique({
    where: { id },
    select: {
      id: true, number: true, status: true,
      client: { select: { id: true, name: true } },
      // The enquiry's number is the OTHER reference this order's stock may
      // legitimately sit under: a hold placed before answer 12 closed enquiry
      // holds carries it, and a release of that hold has to be able to name
      // it. Nothing else is allowed — see resolveHoldReference.
      enquiry: { select: { id: true, number: true } },
    },
  });
  if (!row) fail(404, "Order not found");
  return row;
}

/**
 * The whole of "hold these slabs for this order": parse the body, derive the
 * reference from the RECORD (never the body on trust — see holds-rules
 * resolveHoldReference), reserve through the bridge, bump the order to
 * STOCK_CHECKED, log the event. Both hold routes call this so they cannot
 * drift; what they return is the same shape.
 */
export async function placeOrderHold(orderId: string, body: Record<string, unknown>, g: CommercialGate): Promise<PlaceHoldResult & { days: number; reference: string }> {
  const order = await loadOrderForHold(orderId);
  const slabNumbers = parseSlabNumbers(body.slabNumbers);
  if (!slabNumbers.length) fail(400, "Tick at least one slab to hold");

  const settings = await loadSettings();
  const days = normaliseDays(body.days, settings.holdDays);
  const enquiry = order.enquiry as { number?: string | null } | null;
  const ref = resolveHoldReference(body.reference, [String(order.number), enquiry?.number ?? null]);
  if (!ref.ok) fail(400, ref.reason);
  const reference = ref.reference;
  const client = order.client as { name?: string } | null;
  const customer = str(body.customer) ?? (client?.name ?? null);
  const stamp = actorStamp(g.user);

  const res = await placeHold({
    slabNumbers, reference, customer, days,
    notes: str(body.notes),
    orderId, enquiryId: null,
    by: stamp.name, byId: stamp.id, isAdmin: g.actor === "ADMIN",
  });

  await bumpOrder(orderId, "STOCK_CHECKED", g.user, `Stock held under ${reference}`);
  await logOrderEvent(orderId, "hold_placed", {
    note: `${res.updated} slab(s) held under ${reference} for ${days} day(s)`
      + (res.skipped.length ? `; ${res.skipped.length} skipped` : "")
      + (res.missing.length ? `; ${res.missing.length} not in stock` : ""),
    by: g.user,
    payload: { holdId: res.hold.id, reference, days, updated: res.updated, skipped: res.skipped, missing: res.missing, sqft: res.sqft },
  });
  return { ...res, days, reference };
}
