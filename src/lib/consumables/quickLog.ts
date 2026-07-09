"use server";
// Quick consumables logging from the MACHINE entry forms. Operators can log
// usage at their own station (gated by the same station rules as the form
// itself) — unlike the dashboard, which stays Admin/Store/LM/Incharge.
// Same write semantics as /api/consumables/consumption: entry + atomic
// stock decrement floored at 0; unknown items save unlinked (no decrement).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { canUseEntryModel } from "@/lib/stationAccess";
import { currentUser, rankOf, ROLE_RANK } from "@/lib/rbac";
import { MODEL_DEPT } from "./dept";

const db = prisma as any;

export interface QuickLine { itemName: string; quantity: number; unit: string }

export async function logConsumables(model: string, lines: QuickLine[]): Promise<string> {
  if (!Object.hasOwn(MODEL_DEPT, model)) return "This form has no consumables department.";
  if (!(await canUseEntryModel(model))) return "Not allowed from this login/station.";
  // consumables is a production capability — fab staff are excluded (same as the dashboard gate)
  const me0 = await currentUser();
  if (String((me0 as { role?: string } | null)?.role ?? "") !== "ADMIN" && String((me0 as { branch?: string } | null)?.branch ?? "") === "FABRICATION") return "Not available for fabrication logins.";
  // Rollout: incharge and above only for now — operators get access later.
  if (rankOf(String((me0 as { role?: string } | null)?.role ?? "")) < ROLE_RANK.INCHARGE) return "Consumables logging is for incharges for now.";
  const clean = (Array.isArray(lines) ? lines : [])
    .map((l) => ({ itemName: String(l.itemName ?? "").trim(), quantity: Number(l.quantity), unit: String(l.unit ?? "").trim() || "PCS" }))
    .filter((l) => l.itemName && Number.isFinite(l.quantity) && l.quantity > 0);
  if (clean.length === 0) return "Nothing to log — add an item and quantity.";
  if (clean.length > 20) return "Too many lines in one go (max 20).";
  const by = me0?.name ?? null;
  try {
    const dept = await db.consumableDepartment.upsert({
      where: { name: MODEL_DEPT[model] }, update: {}, create: { name: MODEL_DEPT[model] },
    });
    const stocks: any[] = await db.inventoryStock.findMany({ select: { id: true, itemName: true } });
    const byName = new Map(stocks.map((s: any) => [s.itemName.toLowerCase(), s.id]));
    await db.$transaction(async (tx: any) => {
      for (const l of clean) {
        const stockId = byName.get(l.itemName.toLowerCase()) ?? null;
        await tx.consumptionEntry.create({ data: {
          departmentId: dept.id, itemName: l.itemName, quantity: l.quantity, unit: l.unit,
          remarks: by ? `Logged at ${model} form by ${by}` : `Logged at ${model} form`,
          inventoryStockId: stockId,
        } });
        if (stockId) {
          // atomic decrement, floored at 0 — identical to the dashboard API
          await tx.$executeRaw`UPDATE consumable_inventory_stock SET "currentStock" = GREATEST(0, "currentStock" - ${l.quantity}), "updatedAt" = now() WHERE "id" = ${stockId}`;
        }
      }
    });
    return "ok";
  } catch (e) {
    console.error("Quick consumables log error:", e);
    return "Could not save — try again.";
  }
}
