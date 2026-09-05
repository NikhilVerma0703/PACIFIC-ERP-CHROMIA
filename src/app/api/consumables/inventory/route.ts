import { consumablesGate } from "@/lib/consumables/access";
import { prisma } from "@/lib/prisma";

const CATEGORIES = ["DIRECT_MATERIAL", "PRODUCTION_CONSUMABLE", "POLISHING_CONSUMABLE"];

// Prisma reports a unique-index hit as P2002; the index that guards this table
// is a FUNCTIONAL one on lower("itemName") that Prisma cannot declare
// (scripts/0075), so the raw Postgres 23505 is accepted too, the way
// api/fab/workers does, in case the client ever passes it through unmapped.
function isUniqueViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: string }).code;
  const meta = (e as { meta?: { code?: string } }).meta;
  return code === "P2002" || code === "23505" || meta?.code === "23505";
}

// Same 3-state rule the tables use, so API / export / UI all agree.
const statusOf = (cur: number, min: number) =>
  cur <= 0 ? "Out of Stock" : min > 0 && cur <= min ? "Low" : "Healthy";

export async function GET() {
  const __g = await consumablesGate("VIEW"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const items = await prisma.inventoryStock.findMany({ orderBy: { itemName: "asc" } });
    const withStatus = items.map((item) => ({
      ...item,
      status: statusOf(item.currentStock, item.minStock),
    }));
    return Response.json(withStatus);
  } catch (error) {
    console.error("Inventory GET error:", error);
    return Response.json([], { status: 500 });
  }
}

export async function POST(request: Request) {
  const __g = await consumablesGate("WRITE"); if (!__g.ok) return Response.json({ error: "Not authorized" }, { status: __g.status });
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object")
      return Response.json({ error: "Invalid request body." }, { status: 400 });

    const { itemName: rawName, category, unit, currentStock, minStock } = body;
    if (!rawName || typeof rawName !== "string")
      return Response.json({ error: "itemName is required." }, { status: 400 });
    // TRIMMED AND COLLAPSED BEFORE THE LOOKUP, so the lookup and the unique
    // index on lower("itemName") (scripts/0075) agree on what "the same item"
    // is. lower('Gloves ') is not lower('Gloves'): untrimmed, a trailing space
    // typed by one clerk slipped past both the findFirst below and the index,
    // and the store had two Gloves rows — one of which the floor's decrement
    // would land on while the top-up landed on the other.
    const itemName = rawName.trim().replace(/\s+/g, " ");
    if (!itemName)
      return Response.json({ error: "itemName is required." }, { status: 400 });
    if (!unit || typeof unit !== "string")
      return Response.json({ error: "unit is required." }, { status: 400 });

    const cur = Number(currentStock);
    // "" is what an untouched optional number input posts, and it must NOT mean
    // "set the threshold to 0": the top-up path below now writes minStock, and
    // treating a blank box as a 0 would silently clear the alert threshold of
    // an item every time somebody received a delivery for it.
    const minProvided = minStock !== undefined && minStock !== null && minStock !== "";
    const min = minProvided ? Number(minStock) : 0;
    if (!Number.isFinite(cur) || cur < 0)
      return Response.json({ error: "currentStock must be a non-negative number." }, { status: 400 });
    if (!Number.isFinite(min) || min < 0)
      return Response.json({ error: "minStock must be a non-negative number." }, { status: 400 });

    // Case-insensitive match (aligns with the data importer) -> top up + log, atomically.
    const findExisting = () => prisma.inventoryStock.findFirst({
      where: { itemName: { equals: itemName, mode: "insensitive" } },
    });
    // The top-up is a function because TWO paths reach it: the ordinary "this
    // shelf already exists" path, and the race below where the create loses to
    // another clerk's create in the same round-trip.
    const topUp = async (existing: { id: string; unit: string }) => {
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.inventoryStock.update({
          where: { id: existing.id },
          data: {
            // increment, not existing.currentStock + cur: the read above happened
            // outside this transaction, so adding to the value we read would lose
            // a delivery entered by a second clerk in between.
            currentStock: { increment: cur },
            // minStock used to be dropped on this path entirely. Since the name
            // comes from a fixed ~33-item dropdown the item almost always exists,
            // so "almost always" meant the threshold the clerk typed was thrown
            // away without a word and the item never went Low.
            ...(minProvided ? { minStock: min } : {}),
          },
        });
        // Log the receipt in the item's own (existing) unit to avoid unit drift.
        await tx.inventoryEntry.create({ data: { quantity: cur, unit: existing.unit, inventoryStockId: u.id } });
        return u;
      });
      // toppedUp tells the modal this was a receipt against an existing shelf and
      // not a new item, so its toast can report the resulting total instead of
      // saying "added" and leaving the clerk to assume the figure they typed IS
      // the stock. currentStock in this body is the authoritative new total.
      return Response.json({ ...updated, status: statusOf(updated.currentStock, updated.minStock), toppedUp: true, received: cur });
    };

    const existing = await findExisting();
    if (existing) return topUp(existing);

    if (!category || !CATEGORIES.includes(category))
      return Response.json({ error: "category must be one of " + CATEGORIES.join(", ") + "." }, { status: 400 });

    let item;
    try {
      item = await prisma.$transaction(async (tx) => {
        const created = await tx.inventoryStock.create({
          data: { itemName, category, unit, currentStock: cur, minStock: min },
        });
        await tx.inventoryEntry.create({ data: { quantity: cur, unit, inventoryStockId: created.id } });
        return created;
      });
    } catch (e) {
      // THE RACE IS A TOP-UP, NOT A 500. Two store logins adding the same new
      // item in one Neon round-trip both pass findExisting() with nothing, and
      // the second create trips the lower("itemName") index. Without this
      // branch the loser saw "Failed to save inventory item." and had to
      // retry — and a clerk who retried a receipt that had in fact been saved
      // by the other login would count the delivery twice. Re-read the winning
      // row and receive against it: that is exactly what would have happened
      // had the two requests arrived a second apart.
      if (!isUniqueViolation(e)) throw e;
      const winner = await findExisting();
      if (!winner) throw e;
      return topUp(winner);
    }

    return Response.json({ ...item, status: statusOf(item.currentStock, item.minStock), toppedUp: false, received: cur }, { status: 201 });
  } catch (error) {
    console.error("Inventory POST error:", error);
    return Response.json({ error: "Failed to save inventory item." }, { status: 500 });
  }
}
