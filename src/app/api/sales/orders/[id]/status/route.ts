/* eslint-disable @typescript-eslint/no-explicit-any */
import { salesAuth as auth } from "@/lib/sales/session";
import { assertOrderVisible } from "@/lib/sales/ownership";
import { prisma } from "@/lib/prisma";
import { SalesOrderStatus } from "@prisma/client";

// The stepper's two ladders, copied from the client component that draws them:
// src/app/sales/orders/[id]/StatusFlowClient.tsx (FLOW_DIRECT / FLOW_PRODUCTION).
// They are duplicated rather than imported because that file is a "use client"
// component and pulling it into a server route drags the component (and its
// hooks) into the route's module graph. If you edit one ladder, edit the other.
//
// Until this route grew a copy it validated nothing: it wrote whatever `status`
// arrived. SALESPERSON is an allowed role here and ownership only confines them
// to their own orders, so a single PATCH {status:"DISPATCHED"} on an order still
// sitting in PENDING_PAYMENT made every list, dashboard and delay report say the
// order had shipped — and backward jumps (DELIVERED -> PENDING_PAYMENT) landed
// just as quietly.
const FLOW_DIRECT = [
  "PENDING_PAYMENT",
  "PENDING_STOCK_CHECK",
  "PACKING",
  "DISPATCHED",
  "IN_TRANSIT",
  "PORT_ARRIVED",
  "DELIVERED",
] as const;

const FLOW_PRODUCTION = [
  "PENDING_PAYMENT",
  "PENDING_STOCK_CHECK",
  "PENDING_PRODUCTION",
  "IN_PRODUCTION",
  "PACKING",
  "DISPATCHED",
  "IN_TRANSIT",
  "PORT_ARRIVED",
  "DELIVERED",
] as const;

// PACKING is where the warehouse starts pulling slabs, so PACKING and everything
// to the right of it is money already spent on the customer's behalf. The advance
// gate below therefore covers the whole tail, not the single step: it used to read
// `status === "PACKING"` and a PATCH straight to DISPATCHED walked around it.
// The tail is identical in both ladders, so FLOW_DIRECT is enough to measure it.
const PACKING_IDX = FLOW_DIRECT.indexOf("PACKING");

// Two SalesOrderStatus values sit off both ladders on purpose: DRAFT (written
// only by the books import for "sent for approval" rows — 10 of them, none of
// them live work) and STOCK_CONFIRMED (a label nothing writes any more, kept
// because the colour maps still name it). The stepper offers no next step for
// either, and neither does this route: CANCELLED is the only way out.
/** True when `target` is the one step that follows `current` on either ladder.
 *  Both are consulted because the server cannot know which one the order is on
 *  until the stock check decides (PENDING_STOCK_CHECK legitimately leads to
 *  PACKING on the direct path and to PENDING_PRODUCTION on the production one). */
function isNextStep(current: string, target: string): boolean {
  for (const flow of [FLOW_DIRECT, FLOW_PRODUCTION] as readonly (readonly string[])[]) {
    const i = flow.indexOf(current);
    if (i >= 0 && i < flow.length - 1 && flow[i + 1] === target) return true;
  }
  return false;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const user = session.user as any;
  const salesRole = user.salesRole as string | undefined;

  const allowed =
    salesRole === "SALESPERSON" ||
    salesRole === "SALES_ADMIN" ||
    salesRole === "COMMERCIAL"; // production-manager duty retired -> admins
  if (!allowed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const refused = await assertOrderVisible(session.user, id);
  if (refused) return refused;
  const body = await req.json();
  const { status, note } = body as { status: string; note?: string };

  if (!status) return Response.json({ error: "status is required" }, { status: 400 });

  // An unknown string used to reach Prisma and come back as a 500 with a P2009 in
  // the log, so the caller could not tell a typo from an outage. 422 says "I read
  // your request and it is not a status", which is what actually happened.
  if (!Object.prototype.hasOwnProperty.call(SalesOrderStatus, status)) {
    return Response.json(
      { error: `Unknown order status "${status}".`, code: "STATUS_UNKNOWN" },
      { status: 422 }
    );
  }

  const db = prisma as any;

  const existing = await db.salesOrder.findUnique({
    where: { id },
    include: { paymentDivisions: true },
  });
  if (!existing) return Response.json({ error: "Order not found" }, { status: 404 });
  const current = String(existing.status);

  // Re-sending the status the order already has is the double-click case: nothing
  // to move, nothing to audit, and refusing it would show the user an error for a
  // click that changed nothing.
  if (status === current) return Response.json(existing);

  // CANCELLED is reachable from anywhere — an order can die at any point. Every
  // other move must be the single next step on one of the ladders above, which is
  // exactly what the stepper offers; a skip and a backward jump are both refused.
  if (status !== "CANCELLED" && !isNextStep(current, status)) {
    return Response.json(
      {
        error: `Cannot move an order from ${current} to ${status}.`,
        code: "TRANSITION_NOT_ALLOWED",
      },
      { status: 422 }
    );
  }

  // PENDING_STOCK_CHECK IS NOT A MANUAL STEP — refused outright, from any state.
  //
  // The system writes it itself, in exactly two places and only once every
  // ADVANCE division is settled: /api/sales/payments/[id] (Accounts marks the
  // advance paid) and /api/sales/orders/[id]/payment-division (an RM waives it)
  // both call advanceIfAdvancesSettled(), which moves the order AND opens the
  // stock check in one step.
  //
  // Leaving it PATCHable here walked around the advance gate below in two hops.
  // PENDING_STOCK_CHECK is index 1 and PACKING is index 2, so `targetIdx >=
  // PACKING_IDX` never fired on it; and once an order sits in
  // PENDING_STOCK_CHECK the stock-check route (/api/sales/stock-checks/[id],
  // status AVAILABLE or PARTIAL) writes status = PACKING itself. A SALESPERSON
  // — an allowed role here, confined by ownership only to their own orders —
  // could therefore send one PATCH {status:"PENDING_STOCK_CHECK"} on an order
  // whose advance had not arrived, and it landed in Commercial's queue looking
  // exactly like an order whose money had. Commercial confirms stock, the order
  // is in PACKING, the warehouse pulls slabs, and nobody was ever paid. The
  // comment above claiming the gate covers "PACKING and everything to the right
  // of it" was only true of the front door.
  //
  // Refused rather than gated because no caller asks for it: the stepper
  // (sales/orders/[id]/StatusFlowClient.tsx) only offers a manual advance from
  // PACKING onward (canManuallyAdvance), ProductionClient only ever sends
  // IN_PRODUCTION or PACKING, and sales_order_logs holds zero STATUS_CHANGED
  // rows into PENDING_STOCK_CHECK. This takes away no work anyone has ever done.
  // It sits after the ladder check on purpose, so a jump from DELIVERED still
  // reports TRANSITION_NOT_ALLOWED — the more accurate complaint.
  if (status === "PENDING_STOCK_CHECK") {
    return Response.json(
      {
        error:
          "An order moves to Stock Check by itself once the advance is settled — it cannot be set by hand. Record the advance payment, or have an RM override it, and the order will move.",
        code: "STATUS_NOT_MANUAL",
      },
      { status: 422 }
    );
  }

  // Payment gate: block PACKING and everything past it until the advance is
  // settled. A manager waiver (overridden_at, written by
  // /api/sales/orders/[id]/payment-division) settles a division without money
  // arriving and counts here exactly like paidAt — before that, a waived advance
  // left the order locked and the only way out was Accounts falsely clicking Mark
  // Paid, which then counted never-received money into paidAmount. An override
  // still contributes nothing to paidAmount / amount_received: money stays keyed
  // on paidAt, this gate is about permission to move.
  const targetIdx = (FLOW_DIRECT as readonly string[]).indexOf(status);
  if (targetIdx >= PACKING_IDX) {
    const advanceDivs: any[] = (existing.paymentDivisions ?? []).filter((d: any) => d.type === "ADVANCE");
    if (advanceDivs.length > 0) {
      const allSettled = advanceDivs.every((d: any) => !!d.paidAt || !!d.overriddenAt);
      if (!allSettled) {
        return Response.json(
          {
            // The code is what the stepper keys on (it draws its own amber panel);
            // the text is for every other caller and for the server log.
            error: `Advance payment must be received before moving to ${status === "PACKING" ? "Packing" : status}.`,
            code: "ADVANCE_UNPAID",
          },
          { status: 422 }
        );
      }
    }
  }

  const order = await db.salesOrder.update({
    where: { id },
    data: { status },
  });

  try {
    await db.salesOrderLog.create({
      data: {
        orderId: id,
        userId: user.id,
        // The PRIOR status is half the record: "-> DISPATCHED" on its own cannot
        // be told apart from a legitimate step when the log is read back weeks
        // later, which is precisely what an audit of a jump needs to see.
        action: "STATUS_CHANGED",
        note: note ? `${current} -> ${status}: ${note}` : `${current} -> ${status}`,
      },
    });
  } catch (e) {
    // Non-fatal on purpose — the status is already committed and failing the
    // request now would tell the caller nothing happened when it did. But the
    // bare `catch {}` that used to sit here swallowed the reason, so a stretch of
    // missing audit rows had no explanation anywhere; leave a trace on the server.
    console.error(`[sales/status] audit log write failed for order ${id} (${current} -> ${status}):`, e);
  }

  return Response.json(order);
}
