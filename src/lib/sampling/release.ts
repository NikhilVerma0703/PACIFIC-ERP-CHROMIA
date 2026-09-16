// THE ONE PLACE STOCK LEAVES THE SAMPLING SHELF.
//
// Extracted verbatim from the body of POST /api/sampling/dispatch on
// 2026-09-16, when boxes and stands arrived (scripts/0086) and a second caller
// appeared: a Salesforce sample request packed from the board. Two routes that
// each decrement a shelf are two chances to get the lock order wrong, and the
// second one is always the one written in a hurry.
//
// WHY A FUNCTION AND NOT A COPY. The walk-in dispatch and the Salesforce
// request differ only in where their arguments come from. Everything that is
// hard — the deterministic lock order, re-reading under the lock, the
// all-or-nothing plan, the ledger row in the same transaction — is identical,
// and identical code in two files diverges the first time one of them is
// fixed.
//
// THE UNIT IS LOCKED LAST, ALWAYS. The shelves are locked in sorted
// (sizeId, colourFinishId) order so two packages sharing two shelves take them
// in the same order; the unit row or the chosen serial is then locked after
// all of them. If the unit were locked first, a package taking a shelf then a
// box could deadlock against a package taking that box then that shelf.
// Last means there is only ever one ordering.
import type { Prisma } from "@prisma/client";
import { planRelease, type StockRelease } from "./lifecycle";
import { checkUnitRelease } from "./unit-rules";

export interface ReleaseLine {
  colourFinishId: string;
  sizeId: string;
  quantity: number;
}

/** Which box or stand goes with the package, if any. */
export interface ReleaseUnit {
  unitTypeId: string;
  /** A named stand. Omit for a counted type — the quantity comes off the count. */
  serialId?: string | null;
  quantity?: number;
}

export interface ReleaseInput {
  customerName: string;
  destination: "DOMESTIC" | "INTERNATIONAL";
  reference: string | null;
  notes: string | null;
  lines: ReleaseLine[];
  unit?: ReleaseUnit | null;
  salesRequestId?: string | null;
  releasedById: string | null;
}

export type ReleaseOutcome =
  | { kind: "ok"; id: string; releasedAt: Date; pieces: number; unitLabel: string | null; serialNo: string | null }
  | { kind: "unknown-item" }
  | { kind: "unknown-unit" }
  | { kind: "short"; shortfalls: string[] };

function itemLabel(colour: string, finish: string, size: { lengthIn: unknown; widthIn: unknown; thicknessMm: unknown }): string {
  return `${colour} (${finish}) ${size.lengthIn} × ${size.widthIn} in · ${size.thicknessMm} mm`;
}

/**
 * Release a package: decrement the shelves, consume the unit, create the
 * SamplingDispatch and write the unit ledger row — all inside the caller's
 * transaction, so nothing here can half-happen.
 *
 * The caller supplies `tx`; this function never opens its own transaction,
 * because the Salesforce pack route has to mark the request PACKED in the SAME
 * one and a nested transaction would let the two disagree.
 */
export async function releasePackage(tx: Prisma.TransactionClient, input: ReleaseInput): Promise<ReleaseOutcome> {
  // DETERMINISTIC LOCK ORDER. Two packages that share two shelves must take
  // them in the same order or they deadlock holding one each.
  const lines = [...input.lines].sort(
    (a, b) => a.sizeId.localeCompare(b.sizeId) || a.colourFinishId.localeCompare(b.colourFinishId),
  );

  const checks: StockRelease[] = [];
  const shelves: Array<{ line: ReleaseLine; stockId: string | null; label: string }> = [];

  for (const line of lines) {
    // THE LOCK, one shelf at a time in the sorted order above. A shelf that
    // does not exist locks nothing and reads as 0 on hand, which is the true
    // answer: nobody has ever put one of these on a shelf.
    await tx.$queryRaw`
      SELECT id FROM sampling_stock
      WHERE colour_finish_id = ${line.colourFinishId} AND size_id = ${line.sizeId}
      FOR UPDATE`;

    const [stock, colourFinish, size] = await Promise.all([
      tx.samplingStock.findUnique({
        where: { colourFinishId_sizeId: { colourFinishId: line.colourFinishId, sizeId: line.sizeId } },
        select: { id: true, quantity: true },
      }),
      tx.productColourFinish.findUnique({
        where: { id: line.colourFinishId },
        select: { finish: true, colour: { select: { name: true } } },
      }),
      tx.samplingSize.findUnique({
        where: { id: line.sizeId },
        select: { lengthIn: true, widthIn: true, thicknessMm: true },
      }),
    ]);
    if (!colourFinish || !size) return { kind: "unknown-item" };

    const label = itemLabel(colourFinish.colour.name, colourFinish.finish, size);
    checks.push({ label, onHand: Number(stock?.quantity ?? 0), quantity: line.quantity });
    shelves.push({ line, stockId: stock?.id ?? null, label });
  }

  // ── the unit, locked AFTER every shelf ─────────────────────────────────────
  let unitLabel: string | null = null;
  let serialNo: string | null = null;
  let unitStockId: string | null = null;
  const unitQty = Math.max(1, Math.trunc(Number(input.unit?.quantity ?? 1)));
  const unitShortfalls: string[] = [];

  if (input.unit?.unitTypeId) {
    const type = await tx.samplingUnitType.findUnique({
      where: { id: input.unit.unitTypeId },
      select: { id: true, name: true, serialised: true },
    });
    if (!type) return { kind: "unknown-unit" };
    unitLabel = type.name;

    if (type.serialised) {
      // A NAMED STAND, locked by its own row. Without a serial there is
      // nothing to lock and nothing to send: which stand left is the whole
      // point of serialising them.
      if (!input.unit.serialId) {
        unitShortfalls.push(`${type.name}: choose which one is going`);
      } else {
        await tx.$queryRaw`SELECT id FROM sampling_unit_serial WHERE id = ${input.unit.serialId} FOR UPDATE`;
        const serial = await tx.samplingUnitSerial.findUnique({
          where: { id: input.unit.serialId },
          select: { id: true, serialNo: true, status: true, unitTypeId: true },
        });
        if (!serial || serial.unitTypeId !== type.id) return { kind: "unknown-unit" };
        if (serial.status !== "IN_STOCK") {
          unitShortfalls.push(`${type.name} ${serial.serialNo}: already ${serial.status.toLowerCase().replace("_", " ")}`);
        } else {
          serialNo = serial.serialNo;
        }
      }
    } else {
      await tx.$queryRaw`SELECT id FROM sampling_unit_stock WHERE unit_type_id = ${type.id} FOR UPDATE`;
      const stock = await tx.samplingUnitStock.findUnique({
        where: { unitTypeId: type.id },
        select: { id: true, quantity: true },
      });
      unitStockId = stock?.id ?? null;
      const check = checkUnitRelease(type.name, Number(stock?.quantity ?? 0), unitQty);
      if (!check.ok && check.reason) unitShortfalls.push(check.reason);
    }
  }

  // The whole package, decided before any of it moves — and the piece refusals
  // are planRelease's own sentences, each already carrying the item's name.
  // The unit's are appended after, so a package short of both reports the
  // pieces first: that is the part the incharge can do something about.
  const plan = planRelease(checks);
  const shortfalls = [...(plan.ok ? [] : plan.shortfalls), ...unitShortfalls];
  if (shortfalls.length) return { kind: "short", shortfalls };

  for (const shelf of shelves) {
    // decrement, not a write of a computed number: the value was read under
    // the lock, but `{ decrement }` is what keeps this true if the lock is
    // ever loosened.
    await tx.samplingStock.update({
      where: { id: shelf.stockId as string },
      data: { quantity: { decrement: shelf.line.quantity } },
    });
  }

  const dispatch = await tx.samplingDispatch.create({
    data: {
      customerName: input.customerName,
      destination: input.destination,
      reference: input.reference,
      notes: input.notes,
      // Creating the dispatch IS the first transition — there is no IN_STOCK
      // row to move off. The default on the column says RELEASED too; it is
      // written explicitly so this states the transition it performs.
      status: "RELEASED",
      releasedAt: new Date(),
      releasedById: input.releasedById,
      unitTypeId: input.unit?.unitTypeId ?? null,
      unitSerialId: input.unit?.serialId ?? null,
      salesRequestId: input.salesRequestId ?? null,
      lines: {
        create: shelves.map((s) => ({
          colourFinishId: s.line.colourFinishId,
          sizeId: s.line.sizeId,
          quantity: s.line.quantity,
        })),
      },
    },
    select: { id: true, releasedAt: true },
  });

  // ── the unit moves, and says so in the ledger ─────────────────────────────
  if (input.unit?.unitTypeId) {
    if (serialNo && input.unit.serialId) {
      await tx.samplingUnitSerial.update({
        where: { id: input.unit.serialId },
        data: {
          status: "RELEASED",
          customerName: input.customerName,
          dispatchId: dispatch.id,
          salesRequestId: input.salesRequestId ?? null,
        },
      });
    } else if (unitStockId) {
      await tx.samplingUnitStock.update({
        where: { id: unitStockId },
        data: { quantity: { decrement: unitQty } },
      });
    }
    // APPEND-ONLY, IN THIS TRANSACTION. A count that moved without a ledger
    // row is a count nobody can explain a month later, and the admin page
    // asserts quantity = sum(delta) precisely so that drift is visible rather
    // than carried.
    await tx.samplingUnitLedger.create({
      data: {
        unitTypeId: input.unit.unitTypeId,
        serialId: input.unit.serialId ?? null,
        delta: -(serialNo ? 1 : unitQty),
        reason: "RELEASE",
        reference: input.reference,
        salesRequestId: input.salesRequestId ?? null,
        dispatchId: dispatch.id,
        note: serialNo ? `${unitLabel} ${serialNo} to ${input.customerName}` : `${unitLabel} to ${input.customerName}`,
        createdById: input.releasedById,
      },
    });
  }

  return {
    kind: "ok",
    id: dispatch.id,
    releasedAt: dispatch.releasedAt,
    pieces: shelves.reduce((n, s) => n + s.line.quantity, 0),
    unitLabel,
    serialNo,
  };
}
