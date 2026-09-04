"use server";
// Adding a consumable to the list, from the shop floor.
//
// THE LIST WAS EMPTY AND THAT IS WHY THE FORM LOOKED LIKE A TEXT BOX.
// ConsumablesQuickLog has always rendered a dropdown — but only when it is
// handed items, and it is handed `inventoryStock`, which held ZERO rows on
// 2026-09-04. With nothing to list it falls through to a free-text input, so
// every operator typed a name from memory, every spelling was a new item, and
// nothing could ever be totalled. The list could not fill up because nothing
// on the floor could put anything into it.
//
// So the floor fills it. Type a name, press enter, and it becomes a real stock
// item (owner's decision, 2026-09-04) — in the dropdown for everyone from that
// moment, and in the store's own inventory screens where Thiru can correct the
// category and set the opening stock.
//
// WHAT THAT COSTS, STATED PLAINLY: a typo becomes an inventory item, and only
// the store can tidy it. That is the trade the owner chose over a separate
// pending list, and it is why the guards below are as tight as they are — a
// case-insensitive match returns the EXISTING item instead of creating a
// second one, so "gloves", "Gloves" and "GLOVES" cannot become three rows.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { canUseEntryModel } from "@/lib/stationAccess";
import { currentUser, rankOf, ROLE_RANK } from "@/lib/rbac";
import { MODEL_DEPT } from "./dept";

const db = prisma as any;

/** Which inventory category a station's items belong to. The enum has three
 *  members and only two of them are consumables; DIRECT_MATERIAL is resin and
 *  grit, which the store receives against invoices and nobody logs from a
 *  machine form. Polishing is its own category because the dashboard reports
 *  it separately (PolishingConsumablesTable). */
function categoryFor(model: string): "PRODUCTION_CONSUMABLE" | "POLISHING_CONSUMABLE" {
  return MODEL_DEPT[model] === "Polishing" ? "POLISHING_CONSUMABLE" : "PRODUCTION_CONSUMABLE";
}

export interface AddedItem { itemName: string; unit: string; currentStock: number }
export type AddItemResult = { ok: true; item: AddedItem; existed: boolean } | { ok: false; error: string };

/**
 * Add a consumable to the list (or return the one that is already there).
 *
 * Gated exactly as logging is — same station check, same fabrication exclusion,
 * same incharge floor — because the two are one gesture to the person doing
 * them: they are adding an item in order to log it. A person who may not log
 * may not create the master data for logging either.
 */
export async function addConsumableItem(model: string, rawName: string, rawUnit: string): Promise<AddItemResult> {
  if (!Object.hasOwn(MODEL_DEPT, model)) return { ok: false, error: "This form has no consumables department." };
  if (!(await canUseEntryModel(model))) return { ok: false, error: "Not allowed from this login/station." };
  const me = await currentUser();
  if (String((me as { role?: string } | null)?.role ?? "") !== "ADMIN"
      && String((me as { branch?: string } | null)?.branch ?? "") === "FABRICATION") {
    return { ok: false, error: "Not available for fabrication logins." };
  }
  if (rankOf(String((me as { role?: string } | null)?.role ?? "")) < ROLE_RANK.INCHARGE) {
    return { ok: false, error: "Adding a consumable is for incharges for now." };
  }

  const itemName = String(rawName ?? "").trim().replace(/\s+/g, " ");
  const unit = (String(rawUnit ?? "").trim() || "PCS").toUpperCase();
  if (itemName.length < 2) return { ok: false, error: "Give the item a name of at least two characters." };
  if (itemName.length > 80) return { ok: false, error: "That name is too long (max 80 characters)." };
  // A name that is only punctuation or digits is a slip, not an item.
  if (!/[a-z]/i.test(itemName)) return { ok: false, error: "An item name needs letters in it." };
  if (unit.length > 12) return { ok: false, error: "That unit is too long (max 12 characters)." };

  try {
    // CASE-INSENSITIVE, and this is the guard that stops the list filling with
    // near-duplicates. There is no unique index on itemName to lean on, so the
    // check is here and the existing row is RETURNED rather than an error
    // raised: the operator wanted an item by that name and there is one.
    const hit: any = await db.inventoryStock.findFirst({
      where: { itemName: { equals: itemName, mode: "insensitive" } },
      select: { itemName: true, unit: true, currentStock: true },
    });
    if (hit) return { ok: true, item: { itemName: hit.itemName, unit: hit.unit, currentStock: hit.currentStock }, existed: true };

    const created: any = await db.inventoryStock.create({
      data: {
        itemName, unit, category: categoryFor(model),
        // Zero, and honestly zero: nobody on the floor knows what the store
        // holds. The store sets the real figure when it receives against an
        // invoice. Logging against a 0-stock item still records the
        // consumption; the decrement is floored at 0 and simply does nothing.
        currentStock: 0, minStock: 0, maxStock: 0,
      },
      select: { itemName: true, unit: true, currentStock: true },
    });
    return { ok: true, item: { itemName: created.itemName, unit: created.unit, currentStock: created.currentStock }, existed: false };
  } catch (e) {
    console.error("addConsumableItem error:", e);
    return { ok: false, error: "Could not add the item — try again." };
  }
}

/** The current list, for a form that has just added to it. Same shape and same
 *  order the entry pages pass in, so the client can swap one for the other. */
export async function listConsumableItems(): Promise<AddedItem[]> {
  try {
    return await db.inventoryStock.findMany({
      select: { itemName: true, unit: true, currentStock: true },
      orderBy: { itemName: "asc" },
    });
  } catch { return []; }
}
