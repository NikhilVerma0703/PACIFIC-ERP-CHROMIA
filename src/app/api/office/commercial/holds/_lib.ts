// Shared by every hold handler — the order-referenced POST under
// /orders/[id]/holds, the enquiry-referenced POST here, and release / extend.
// Not a route: Next only treats route.ts as one.
//
// The one rule worth stating twice: a hold's slab rows are ALWAYS built from
// the bridge's `before` snapshot for the slabs the bridge actually changed,
// never from the request body. A body can name a slab that is cut-marked, held
// by somebody else, or not in finished goods at all; recording those as held
// would make the hold lie about what is reserved.
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/commercial/http";
import { holdSlabs, reconcileHold, type BridgeResult } from "@/lib/commercial/inventory-bridge";
import {
  heldSlabNumbers, buildHoldSlabRows, holdSqft, nothingHeldMessage, holdExpiry,
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
 *  release or extend it. */
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
