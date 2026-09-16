// BOXES AND STANDS — the shelf, and putting things on it (scripts/0086; the
// owner, 2026-09-14: "we want to add to track sample boxes and stands in the
// sampling modules").
//
// GET is gated on "view" like the rest of the module. Every WRITE is gated on
// manageUnits, which is a NEW action and deliberately not addStock: addStock
// admits the fabrication floor for its one errand of recording an offcut off
// the saw, and a display stand is a capital asset going to a named customer
// for years. lib/sampling/actions.ts states that trap at length.
//
// ON HAND IS NEVER STORED TWICE. A counted type reads sampling_unit_stock; a
// serialised type is count(*) of IN_STOCK serials, computed here on every
// read. A stored count beside the rows it summarises is a second source of
// truth, and the two part company the first time a transaction half-fails.
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { samplingGate } from "@/lib/sampling/access";
import { unitAvailability, proposeSerial, adjustmentIssue } from "@/lib/sampling/unit-rules";

export const dynamic = "force-dynamic";

function deny(status: number) {
  return Response.json(
    { error: status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
    { status },
  );
}
function bad(error: string) {
  return Response.json({ error }, { status: 400 });
}

/**
 * The whole units shelf: every active type with its on-hand, what open
 * requests have already spoken for, and — for a serialised type — its serials.
 *
 * COMMITTED IS ZERO UNTIL PART C EXISTS. The sample-request table arrives with
 * the Salesforce request loop (scripts/0087); until then nothing can commit a
 * unit, and the field is present and honest rather than absent and surprising
 * when it starts moving.
 */
export async function GET() {
  const g = await samplingGate("view");
  if (!g.ok) return deny(g.status);

  const types = await prisma.samplingUnitType.findMany({
    where: { active: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true, kind: true, name: true, sfStandType: true, serialised: true,
      capacityPieces: true, minQty: true,
      stock: { select: { quantity: true } },
      serials: {
        orderBy: [{ serialNo: "asc" }],
        select: {
          id: true, serialNo: true, status: true, customerName: true,
          installedAt: true, locationNote: true, updatedAt: true,
        },
      },
    },
  });

  const rows = types.map((t) => {
    const onHand = t.serialised
      ? t.serials.filter((s) => s.status === "IN_STOCK").length
      : Number(t.stock?.quantity ?? 0);
    const committed = 0;
    return {
      id: t.id,
      kind: t.kind,
      name: t.name,
      sfStandType: t.sfStandType,
      serialised: t.serialised,
      capacityPieces: t.capacityPieces,
      minQty: t.minQty,
      ...unitAvailability(onHand, committed, t.minQty),
      serials: t.serialised ? t.serials : [],
    };
  });

  return Response.json({ ok: true, types: rows });
}

/**
 * PUT SOMETHING ON THE SHELF.
 *
 *  • a counted type: { unitTypeId, quantity, note? }
 *  • a serialised type: { unitTypeId, serials: ["FS-0007", …] } — or
 *    { unitTypeId, quantity } to have the numbers proposed, which the incharge
 *    can overtype afterwards. The number on the metal wins over the number the
 *    software would have liked.
 *
 * Every path writes its ledger row in the SAME transaction as the change.
 */
export async function POST(req: NextRequest) {
  const g = await samplingGate("manageUnits");
  if (!g.ok) return deny(g.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Malformed request body.");
  }

  const unitTypeId = String(body.unitTypeId ?? "").trim();
  if (!unitTypeId) return bad("Which box or stand is this?");
  const note = String(body.note ?? "").trim() || null;
  const reference = String(body.reference ?? "").trim() || null;
  const createdById = (g.user as { id?: string })?.id ?? null;

  const givenSerials = (Array.isArray(body.serials) ? body.serials : [])
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
  const quantity = Math.trunc(Number(body.quantity ?? 0));

  const type = await prisma.samplingUnitType.findUnique({
    where: { id: unitTypeId },
    select: { id: true, name: true, serialised: true },
  });
  if (!type) return bad("That box or stand is no longer on the list — reload the page.");

  if (!type.serialised) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return bad(`How many ${type.name.toLowerCase()}s are being added? At least one.`);
    }
    const out = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // The row is created on first use, exactly as sampling_stock is: a type
      // nobody has ever counted has no row, which is the true answer until
      // somebody counts it.
      const stock = await tx.samplingUnitStock.upsert({
        where: { unitTypeId: type.id },
        create: { unitTypeId: type.id, quantity },
        update: { quantity: { increment: quantity } },
        select: { quantity: true },
      });
      await tx.samplingUnitLedger.create({
        data: { unitTypeId: type.id, delta: quantity, reason: "INTAKE", reference, note, createdById },
      });
      return stock.quantity;
    });
    return Response.json({ ok: true, onHand: out });
  }

  // ── a serialised type: one row per physical object ────────────────────────
  const wanted = givenSerials.length > 0 ? givenSerials.length : quantity;
  if (!Number.isInteger(wanted) || wanted <= 0) {
    return bad(`Give the serial numbers of the ${type.name.toLowerCase()}s, or how many to number automatically.`);
  }
  if (new Set(givenSerials.map((x) => x.toUpperCase())).size !== givenSerials.length) {
    return bad("The same serial number is in that list twice.");
  }

  try {
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Counted under the lock the insert itself takes: the proposal is only a
      // proposal, and a collision is refused by the unique index below rather
      // than papered over here.
      const existing = await tx.samplingUnitSerial.count({ where: { unitTypeId: type.id } });
      const serials = givenSerials.length
        ? givenSerials
        : Array.from({ length: wanted }, (_, i) => proposeSerial(type.name, existing + i));

      const made: Array<{ id: string; serialNo: string }> = [];
      for (const serialNo of serials) {
        const row = await tx.samplingUnitSerial.create({
          data: { unitTypeId: type.id, serialNo, status: "IN_STOCK", createdById },
          select: { id: true, serialNo: true },
        });
        made.push(row);
        await tx.samplingUnitLedger.create({
          data: {
            unitTypeId: type.id, serialId: row.id, delta: 1, reason: "INTAKE",
            reference, note, createdById,
          },
        });
      }
      return made;
    });
    return Response.json({ ok: true, serials: created });
  } catch (err) {
    if (String((err as { code?: string })?.code ?? "") === "P2002") {
      // A serial number is the number stencilled on ONE frame. Two rows
      // claiming it means one of them is about the wrong object, and guessing
      // which would put a stand in a customer's showroom under a name that
      // already belongs to another.
      return bad("One of those serial numbers is already on a stand. Serial numbers are unique — check the list.");
    }
    throw err;
  }
}

/**
 * CORRECT A COUNT. Separate from POST because it is a different act: POST says
 * "these arrived", PATCH says "the number was wrong". Conflating them makes
 * the ledger unreadable, since INTAKE would then mean both.
 *
 * REFUSED WITHOUT A REASON. A count that changed because somebody typed a
 * number, with nothing saying why, is how a ledger stops being evidence.
 */
export async function PATCH(req: NextRequest) {
  const g = await samplingGate("manageUnits");
  if (!g.ok) return deny(g.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Malformed request body.");
  }

  const unitTypeId = String(body.unitTypeId ?? "").trim();
  if (!unitTypeId) return bad("Which box or stand is this?");
  const note = String(body.note ?? "").trim() || null;

  const type = await prisma.samplingUnitType.findUnique({
    where: { id: unitTypeId },
    select: { id: true, name: true, serialised: true },
  });
  if (!type) return bad("That box or stand is no longer on the list — reload the page.");
  if (type.serialised) {
    // There is no count to correct: the count IS the serials. Adding or
    // retiring one of those is an act about a specific physical object, and it
    // has its own route.
    return bad(`${type.name} is tracked one stand at a time — add or retire a serial instead of correcting a count.`);
  }

  const out = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM sampling_unit_stock WHERE unit_type_id = ${type.id} FOR UPDATE`;
    const stock = await tx.samplingUnitStock.findUnique({
      where: { unitTypeId: type.id },
      select: { quantity: true },
    });
    const current = Number(stock?.quantity ?? 0);

    // The form sends the NUMBER ON THE SHELF, not a difference: an incharge
    // counting a cupboard knows what is in it, not what it changed by. The
    // delta is derived here so the ledger records the movement while the
    // person records the observation.
    const counted = Math.trunc(Number(body.quantity ?? NaN));
    if (!Number.isInteger(counted) || counted < 0) {
      return { error: "What is the actual count on the shelf? A whole number, zero or more." };
    }
    const delta = counted - current;
    const issue = adjustmentIssue(delta, note);
    if (issue) return { error: issue };

    await tx.samplingUnitStock.upsert({
      where: { unitTypeId: type.id },
      create: { unitTypeId: type.id, quantity: counted },
      update: { quantity: counted },
      select: { id: true },
    });
    await tx.samplingUnitLedger.create({
      data: { unitTypeId: type.id, delta, reason: "ADJUST", note, createdById: (g.user as { id?: string })?.id ?? null },
    });
    return { onHand: counted, delta };
  });

  if ("error" in out && out.error) return bad(out.error);
  return Response.json({ ok: true, ...out });
}
