// GET    /api/sampling/dispatch          the board: every package and its lines
// POST   /api/sampling/dispatch          build one and RELEASE it (stock leaves here)
// PATCH  /api/sampling/dispatch          one step forward: DISPATCHED, then DELIVERED
//
// ─────────────────────────────────────────────────────────────────────────────
// STOCK LEAVES THE SHELF AT RELEASE, NOT AT DISPATCH.
//
// "Released to package" means the pieces have been physically pulled off the
// shelf and put in the box. They are no longer available to anybody else, and a
// count that still showed them would promise the same piece to two customers.
// So the below-zero check and the only write to sampling_stock both live in the
// POST — and there is no IN_STOCK status, because a dispatch that has not been
// released does not exist (lib/sampling/lifecycle.ts).
//
// ALL OR NOTHING. A package is packed as one thing. Releasing the three lines
// that fit and silently dropping the fourth sends a customer a box missing a
// sample nobody told them about — so planRelease() checks every line first and
// the refusal names EVERY line that cannot be met, by colour, finish and size.
// "only 2 in stock, 5 requested" against no item name is a message somebody has
// to come and ask about.
//
// THE LOCK. Two tablets releasing the same shelf at once both read "4 in stock"
// and both are right at the moment they look; Postgres runs Prisma's
// interactive transactions at READ COMMITTED, and a count is not a constraint.
// So every shelf a package touches is locked with SELECT ... FOR UPDATE before
// anything is re-read, IN A DETERMINISTIC ORDER (by size id, then colour+finish
// id) so two packages sharing two shelves queue rather than deadlock. Same shape
// as the requirement lock in /api/fab/supervisor/slab-assignment, for the same
// reason.
//
// EVERY TRANSITION IS ONE STEP FORWARD, and every one records WHO and WHEN —
// releasedAt/ById, dispatchedAt/ById, deliveredAt/ById. Which columns those are
// is lifecycle.ts's STATE_STAMP rather than three literals here, so "who moved
// it and when" cannot be half-implemented. There is no cancel and no undo: an
// undo is not a missing line of code, it is an unanswered question about stock
// that was already pulled.
//
// THE GATE IS PER TRANSITION, not per route: release, dispatch and deliver are
// three separate actions in SAMPLING_ACTORS. They happen to have the same
// audience today; asking for each by name is what makes the day they do not a
// one-word change in actions.ts.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { samplingGate } from "@/lib/sampling/access";
import { sampleSizeLabel } from "@/lib/sampling/size";
import { checkTransition, planRelease, STATE_STAMP, type StockRelease } from "@/lib/sampling/lifecycle";

export const dynamic = "force-dynamic";

const DESTINATIONS = ["DOMESTIC", "INTERNATIONAL"] as const;
type Destination = (typeof DESTINATIONS)[number];

// TYPE PREDICATES, NOT `.includes()` ON A WIDENED ARRAY.
//
// `(DESTINATIONS as readonly string[]).includes(x)` throws the literal types
// away, so x is still `string` after the check and what reaches Prisma is a
// bare string where a generated enum is required. That passes HERE, because
// this sandbox has a stub @prisma/client and every model type is `any`. It
// fails in `npm run build`, which runs `prisma generate` first and then
// typechecks against the real enums under "strict": true. Verified with a
// minimal repro: `Type 'string' is not assignable to type 'SamplingDestination'`.
//
// A predicate keeps the narrowing, so the guard that validates the input is
// also the guard that types it — one check instead of a check plus a cast.
function isDestination(v: unknown): v is Destination {
  return typeof v === "string" && (DESTINATIONS as readonly string[]).includes(v);
}

const DISPATCH_STATUSES = ["RELEASED", "DISPATCHED", "DELIVERED"] as const;
type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

function isDispatchStatus(v: unknown): v is DispatchStatus {
  return typeof v === "string" && (DISPATCH_STATUSES as readonly string[]).includes(v);
}

function deny(status: number) {
  return Response.json(
    { error: status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
    { status },
  );
}
function bad(error: string, status = 400) {
  return Response.json({ error }, { status });
}

/** How a line names itself everywhere — in a refusal, on the board, on the
 *  packing note. One function, so the shortfall the incharge reads is the same
 *  words as the row he is looking at. */
function itemLabel(
  colour: string, finish: string,
  size: { lengthIn: unknown; widthIn: unknown; thicknessMm: unknown },
): string {
  return `${colour} (${finish}) ${sampleSizeLabel({
    lengthIn: Number(size.lengthIn),
    widthIn: Number(size.widthIn),
    thicknessMm: Number(size.thicknessMm),
  })}`;
}

/** users.id -> name. The three *_by_id columns carry no hard FK (the
 *  Sales/Chromia precedent), so the names are stitched in rather than joined. */
async function namesFor(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => typeof v === "string" && v !== ""))];
  if (wanted.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name || u.email || "someone"]));
}

/* -- The board ------------------------------------------------------------- */

export async function GET(req: NextRequest) {
  const g = await samplingGate("view");
  if (!g.ok) return deny(g.status);

  // An unknown ?status= is REFUSED, not passed through. Handed straight to
  // Prisma it reaches Postgres as an enum value that does not exist, throws
  // inside a handler with no try/catch, and the caller gets a 500 for what is
  // a malformed request. The predicate answers both questions at once: is this
  // a real status, and is it typed as one.
  const statusParam = req.nextUrl.searchParams.get("status");
  if (statusParam !== null && !isDispatchStatus(statusParam)) {
    return bad(`Unknown status "${statusParam}". Use one of ${DISPATCH_STATUSES.join(", ")}.`);
  }
  const status = statusParam;
  const dispatches = await prisma.samplingDispatch.findMany({
    where: status ? { status } : {},
    // Newest first, and the index is on [status, createdAt] for exactly this.
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, customerName: true, destination: true, reference: true, status: true, notes: true,
      releasedAt: true, releasedById: true,
      dispatchedAt: true, dispatchedById: true,
      deliveredAt: true, deliveredById: true,
      createdAt: true,
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, quantity: true, colourFinishId: true, sizeId: true,
          size: { select: { lengthIn: true, widthIn: true, thicknessMm: true } },
          colourFinish: { select: { finish: true, colour: { select: { name: true } } } },
        },
      },
    },
  });

  const names = await namesFor(
    dispatches.flatMap((d) => [d.releasedById, d.dispatchedById, d.deliveredById]),
  );

  return Response.json(dispatches.map((d) => ({
    id: d.id,
    customerName: d.customerName,
    destination: d.destination,
    reference: d.reference,
    status: d.status,
    notes: d.notes,
    // Each transition's own time and person, side by side, because that is the
    // whole reason the lifecycle lives in rows rather than in a status column
    // that changes with nobody's name on it.
    releasedAt: d.releasedAt,
    releasedBy: d.releasedById ? names.get(d.releasedById) ?? null : null,
    dispatchedAt: d.dispatchedAt,
    dispatchedBy: d.dispatchedById ? names.get(d.dispatchedById) ?? null : null,
    deliveredAt: d.deliveredAt,
    deliveredBy: d.deliveredById ? names.get(d.deliveredById) ?? null : null,
    pieces: d.lines.reduce((n, l) => n + Number(l.quantity), 0),
    lines: d.lines.map((l) => ({
      id: l.id,
      colourFinishId: l.colourFinishId,
      sizeId: l.sizeId,
      quantity: Number(l.quantity),
      colourName: l.colourFinish.colour.name,
      finish: l.colourFinish.finish,
      sizeLabel: sampleSizeLabel({
        lengthIn: Number(l.size.lengthIn),
        widthIn: Number(l.size.widthIn),
        thicknessMm: Number(l.size.thicknessMm),
      }),
      label: itemLabel(l.colourFinish.colour.name, l.colourFinish.finish, l.size),
    })),
  })));
}

/* -- Build it and release it ----------------------------------------------- */

interface IncomingLine { colourFinishId: string; sizeId: string; quantity: number }

export async function POST(req: NextRequest) {
  const g = await samplingGate("release");
  if (!g.ok) return deny(g.status);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Malformed request body.");
  }

  const customerName = String(body.customerName ?? "").trim();
  if (!customerName) return bad("Who is this package for?");
  const destination = String(body.destination ?? "");
  if (!isDestination(destination)) {
    return bad("Say whether this is domestic or international.");
  }
  const referenceRaw = String(body.reference ?? "").trim();
  const reference = referenceRaw === "" ? null : referenceRaw;
  const notesRaw = String(body.notes ?? "").trim();
  const notes = notesRaw === "" ? null : notesRaw;

  // ONE LINE PER ITEM: sampling_dispatch_line is unique on
  // (dispatch, colour+finish, size), and the model says why — adding the same
  // item twice is a quantity change, not a second line. Folding here rather
  // than rejecting means a form that lets somebody add Cappuccino 4x4 twice
  // does the obvious thing instead of failing on a constraint they cannot see.
  const folded = new Map<string, IncomingLine>();
  for (const raw of Array.isArray(body.lines) ? body.lines : []) {
    const l = raw as Record<string, unknown>;
    const colourFinishId = String(l?.colourFinishId ?? "").trim();
    const sizeId = String(l?.sizeId ?? "").trim();
    const quantity = Number(l?.quantity);
    if (!colourFinishId || !sizeId) return bad("Every line needs a colour, a finish and a size.");
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return bad(`quantity ${l?.quantity} must be a whole number of pieces, at least 1`);
    }
    const key = `${colourFinishId}|${sizeId}`;
    const seen = folded.get(key);
    if (seen) seen.quantity += quantity;
    else folded.set(key, { colourFinishId, sizeId, quantity });
  }
  const lines = [...folded.values()];
  if (lines.length === 0) return bad("A package needs at least one line.");

  // DETERMINISTIC LOCK ORDER. Two packages that share two shelves must take
  // them in the same order or they deadlock holding one each.
  lines.sort((a, b) => a.sizeId.localeCompare(b.sizeId) || a.colourFinishId.localeCompare(b.colourFinishId));

  const releasedById = (g.user as { id?: string })?.id ?? null;

  const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const checks: StockRelease[] = [];
    const shelves: Array<{ line: IncomingLine; stockId: string | null; label: string }> = [];

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
      if (!colourFinish || !size) return { kind: "unknown-item" as const };

      const label = itemLabel(colourFinish.colour.name, colourFinish.finish, size);
      checks.push({ label, onHand: Number(stock?.quantity ?? 0), quantity: line.quantity });
      shelves.push({ line, stockId: stock?.id ?? null, label });
    }

    // The whole package, decided before any of it moves — and the refusals are
    // planRelease's own sentences, each already carrying the item's name.
    const plan = planRelease(checks);
    if (!plan.ok) return { kind: "short" as const, shortfalls: plan.shortfalls };

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
        customerName, destination, reference, notes,
        // Creating the dispatch IS the first transition — there is no IN_STOCK
        // row to move off. The default on the column says RELEASED too; it is
        // written explicitly so this route states the transition it performs.
        status: "RELEASED",
        releasedAt: new Date(),
        releasedById,
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

    return {
      kind: "ok" as const,
      id: dispatch.id,
      releasedAt: dispatch.releasedAt,
      pieces: shelves.reduce((n, s) => n + s.line.quantity, 0),
    };
  });

  if (outcome.kind === "unknown-item") {
    return bad("One of those items is no longer in the chart — reload the page.");
  }
  if (outcome.kind === "short") {
    // 409, not 400: nothing about the request was malformed — the shelf moved
    // under it. postJson's default wording for a 409 is "someone else changed
    // this first", and the shortfalls below replace it with the specifics.
    return Response.json(
      {
        error: `Not released — ${outcome.shortfalls.join("; ")}`,
        shortfalls: outcome.shortfalls,
      },
      { status: 409 },
    );
  }

  return Response.json({
    ok: true,
    id: outcome.id,
    status: "RELEASED",
    pieces: outcome.pieces,
    releasedAt: outcome.releasedAt,
    customerName,
  }, { status: 201 });
}

/* -- One step forward ------------------------------------------------------ */

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Malformed request body.");
  }

  const dispatchId = String(body.dispatchId ?? "").trim();
  const to = String(body.to ?? "");
  if (!dispatchId) return bad("Which package?");

  // WHICH ACTION THIS IS depends on where it is going, so the gate cannot be
  // asked before the body is read. DISPATCHED needs "dispatch", DELIVERED needs
  // "deliver" — and anything else is refused before a session is even
  // revalidated, so an unknown target cannot be probed for a 403 vs a 400.
  // Written as a guard rather than a ternary chain so `to` is NARROWED by it.
  // The old shape tested `to` inside the ternary and asserted on `action`,
  // which leaves `to` as `string` for the rest of the handler — and `string`
  // is not assignable to the generated SamplingDispatchStatus enum at the
  // updateMany below. Same build-only failure as the two above.
  if (to !== "DISPATCHED" && to !== "DELIVERED") {
    return bad(`A package can be moved to DISPATCHED or DELIVERED, not "${to}". Releasing one creates it.`);
  }
  const action = to === "DISPATCHED" ? "dispatch" : "deliver";

  const g = await samplingGate(action);
  if (!g.ok) return deny(g.status);

  const current = await prisma.samplingDispatch.findUnique({
    where: { id: dispatchId },
    select: { id: true, status: true, customerName: true },
  });
  if (!current) return bad("That package is not there any more — refresh the board.", 404);

  // checkTransition owns the legality AND the wording: "already DISPATCHED",
  // "RELEASED -> DELIVERED skips DISPATCHED", "would move backwards".
  const legal = checkTransition(current.status, to);
  if (!legal.ok) return bad(legal.reason, 409);

  const stamp = STATE_STAMP[to];
  // CONDITIONAL ON THE STATUS WE READ. Two taps on a slow tablet, or two people
  // on the board, must not both stamp the same transition — the second would
  // overwrite the first person's name and time with its own. updateMany with the
  // old status in the WHERE is one atomic statement: exactly one of them
  // matches a row.
  const moved = await prisma.samplingDispatch.updateMany({
    where: { id: dispatchId, status: current.status },
    data: {
      status: to,
      [stamp.at]: new Date(),
      [stamp.by]: (g.user as { id?: string })?.id ?? null,
    },
  });
  if (moved.count === 0) {
    return bad("Someone else moved this package first — refresh the board.", 409);
  }

  return Response.json({ ok: true, id: dispatchId, status: to, customerName: current.customerName });
}
