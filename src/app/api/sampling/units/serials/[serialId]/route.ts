// ONE PHYSICAL STAND, and the moves a person makes to it (scripts/0086).
//
// RELEASED and DISPATCHED are NOT here. A stand leaves on a package, in the
// same transaction as the pieces, through lib/sampling/release.ts — and it
// moves on to DISPATCHED when that package does, on the dispatch board. A
// route that could set either by hand would let a stand be "sent" with no
// package behind it, which is exactly the drift serialising them was meant to
// end.
//
// WHAT IS LEFT IS WHAT ONLY A PERSON CAN DECIDE: a stand that has come back,
// and whether it goes on the shelf again or out of service. That is a question
// about the condition of a physical object, and only somebody who has looked
// at it can answer — the same reason the sample lifecycle has no undo.
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { samplingGate } from "@/lib/sampling/access";
import { checkSerialTransition } from "@/lib/sampling/unit-rules";

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

/** The two moves the incharge makes by hand, and what each means in the ledger. */
const BY_HAND: Record<string, { to: string; reason: "RETURN" | "RETIRE" | "INTAKE"; delta: number }> = {
  // Back on the shelf: it came back and it is fit to go out again.
  IN_STOCK: { to: "IN_STOCK", reason: "RETURN", delta: 1 },
  // Out of service: broken, obsolete, or written off at the customer.
  RETIRED: { to: "RETIRED", reason: "RETIRE", delta: -1 },
  // Recorded as returned before anybody has looked at it.
  RETURNED: { to: "RETURNED", reason: "RETURN", delta: 0 },
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ serialId: string }> }) {
  const g = await samplingGate("manageUnits");
  if (!g.ok) return deny(g.status);

  const { serialId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Malformed request body.");
  }

  const to = String(body.status ?? "").trim().toUpperCase();
  const move = BY_HAND[to];
  if (!move) {
    return bad("A stand can be marked returned, put back in stock, or retired. Sending one happens on a package.");
  }
  const note = String(body.note ?? "").trim() || null;
  const locationNote = String(body.locationNote ?? "").trim() || null;
  const createdById = (g.user as { id?: string })?.id ?? null;

  const out = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM sampling_unit_serial WHERE id = ${serialId} FOR UPDATE`;
    const serial = await tx.samplingUnitSerial.findUnique({
      where: { id: serialId },
      select: { id: true, serialNo: true, status: true, unitTypeId: true, unitType: { select: { name: true } } },
    });
    if (!serial) return { error: "That stand is no longer on the list — reload the page." };

    // checkSerialTransition owns the legality AND the wording, so the sentence
    // the incharge reads is the rule itself rather than a paraphrase of it.
    const legal = checkSerialTransition(serial.status, move.to);
    if (!legal.ok) return { error: legal.reason ?? "That move is not allowed." };

    await tx.samplingUnitSerial.update({
      where: { id: serial.id },
      data: {
        status: move.to as never,
        locationNote: locationNote ?? undefined,
        // Coming back to the shelf ends the stand's association with the
        // customer it was at: leaving the name on would make the next "where
        // is FS-0007" answer with a showroom it is no longer in.
        ...(move.to === "IN_STOCK"
          ? { customerName: null, dispatchId: null, salesRequestId: null, installedAt: null }
          : {}),
      },
    });
    await tx.samplingUnitLedger.create({
      data: {
        unitTypeId: serial.unitTypeId,
        serialId: serial.id,
        // A RETURNED stand has not yet rejoined the count — it is back in the
        // building but nobody has said it is fit to send. Zero, and the count
        // moves when the incharge decides.
        delta: move.delta,
        reason: move.reason,
        note: note ?? `${serial.unitType.name} ${serial.serialNo} → ${move.to.toLowerCase().replace("_", " ")}`,
        createdById,
      },
    });
    return { serialNo: serial.serialNo, status: move.to };
  });

  if ("error" in out && out.error) return bad(out.error);
  return Response.json({ ok: true, ...out });
}
