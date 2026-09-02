import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

/** Carries an HTTP status out of the $transaction callback.
 *
 *  Throwing is the only way to roll the entry back once we are inside the
 *  transaction, but a bare Error would land in the generic catch below and the
 *  clerk would get "Failed to save consumption entry." for a refusal we can
 *  explain precisely. The status rides along so the shortfall answers 409
 *  (the shelf disagrees, retry after a recount) rather than 500 (we broke). */
class ConsumptionRefused extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Stock is a Float, so a display figure with 2 decimals is as precise as the
 *  underlying number is trustworthy — "short by 79.99999999999999 KG" reads
 *  like a system fault rather than a counting problem. */
const show = (n: number) => Math.round(n * 100) / 100;

export async function GET(request: Request) {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const entries = await prisma.consumptionEntry.findMany({
      include: { department: true },
      orderBy: { date: "desc" },
      take: 1000,
      where: {
        ...(dateFrom && { date: { gte: new Date(dateFrom + "T00:00:00.000Z") } }),
        ...(dateTo && { date: { lte: new Date(dateTo + "T23:59:59.999Z") } }),
      },
    });

    return Response.json(entries);
  } catch (error) {
    console.error("Consumption GET error:", error);
    return Response.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  const __g = await consumablesGate("WRITE"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const { departmentId, itemName, quantity, unit, remarks, inventoryStockId } = body;
    const qty = Number(quantity);

    if (!departmentId || typeof departmentId !== "string")
      return Response.json({ error: "departmentId is required." }, { status: 400 });
    if (!itemName || typeof itemName !== "string")
      return Response.json({ error: "itemName is required." }, { status: 400 });
    if (!unit || typeof unit !== "string")
      return Response.json({ error: "unit is required." }, { status: 400 });
    if (!Number.isFinite(qty) || qty <= 0)
      return Response.json({ error: "quantity must be a positive number." }, { status: 400 });

    // Create the entry and decrement linked stock atomically.
    const entry = await prisma.$transaction(async (tx) => {
      // Name and unit are only free text while nothing is linked. The modal
      // leaves both editable AFTER the item is picked, so linking
      // "Soap Oil (Litre)" and then typing 500 "ml" wrote 500 LITRES out of
      // the shelf and logged them under whatever name was left in the box.
      // When a stock row is linked, that row is the authority on both.
      let name = itemName;
      let uom = unit;

      if (inventoryStockId) {
        const stock = await tx.inventoryStock.findUnique({ where: { id: inventoryStockId } });
        if (!stock)
          throw new ConsumptionRefused(404, "That inventory item no longer exists — reload the page and pick it again.");
        name = stock.itemName;
        uom = stock.unit;

        // Guarded decrement, same shape as assignRmBags in src/app/store/actions.ts:
        // the precondition lives in the WHERE so it is re-checked by the database
        // at write time, which is what makes two clerks logging the same item at
        // the same second safe — the loser gets the 409 instead of overdrawing.
        //
        // The old GREATEST(0, stock - qty) floor was the bug: it wrote the entry
        // at the FULL quantity and then quietly clamped the shelf. Log 100 KG
        // against 20 KG in stock and the ledger said 100 consumed, the shelf said
        // 0, and 80 KG existed in no record anybody could reconcile against. A
        // refusal is the honest answer: either the count on the shelf is stale or
        // the quantity is a typo, and only the store can say which.
        //
        // The 1e-6 slack is for Float rounding (0.1 + 0.2 arithmetic on a Float
        // column), not tolerance for a real overdraw — same epsilon the RM
        // assign path uses.
        const dec = await tx.inventoryStock.updateMany({
          where: { id: inventoryStockId, currentStock: { gte: qty - 1e-6 } },
          data: { currentStock: { decrement: qty } },
        });
        if (!dec.count)
          throw new ConsumptionRefused(
            409,
            `Only ${show(stock.currentStock)} ${stock.unit} of ${stock.itemName} in stock but ${show(qty)} ${stock.unit} was logged — short by ${show(qty - stock.currentStock)} ${stock.unit}. Recount the shelf and correct the stock figure, or log what was actually used.`,
          );
      }

      return tx.consumptionEntry.create({
        data: {
          departmentId,
          itemName: name,
          quantity: qty,
          unit: uom,
          remarks: remarks || null,
          inventoryStockId: inventoryStockId || null,
        },
        include: { department: true },
      });
    });

    return Response.json(entry, { status: 201 });
  } catch (error) {
    if (error instanceof ConsumptionRefused)
      return Response.json({ error: error.message }, { status: error.status });
    console.error("Consumption POST error:", error);
    return Response.json({ error: "Failed to save consumption entry." }, { status: 500 });
  }
}
