// The order log. Every stage move, hold, request, PI, packing list and
// invoice writes one row here, so the order page can show what happened, who
// did it, and when — and so a dispute about a PI revision has a record.
import { prisma } from "@/lib/prisma";
import type { CommercialUser } from "./access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Every kind a document's own story needs, so the Log tab can filter it. The
// first cut had only the milestone of each document (pi_issued, invoice_issued)
// and the builders logged drafting, editing and cancelling as "note" — which
// reads in the log as somebody's free-text comment rather than as the act it
// was. A kind costs nothing and an un-filterable log costs an argument later.
export type OrderEventKind =
  | "created" | "edited" | "stage" | "checklist" | "approved"
  | "hold_placed" | "hold_released" | "hold_expired"
  | "production_requested" | "production_produced"
  | "pi_drafted" | "pi_edited" | "pi_issued" | "pi_accepted" | "pi_superseded" | "pi_revised" | "pi_cancelled"
  | "receipt_recorded" | "receipt_deleted"
  // Answer 12: the manager let a truck go without the advance, and lifting it
  // again is just as much a fact. A kind rather than a note so the log can be
  // filtered for every order that shipped unpaid.
  | "advance_waived" | "advance_waiver_lifted"
  | "plan_changed" | "slab_swapped"
  | "packing_created" | "packing_submitted" | "packing_verified" | "packing_rejected" | "packing_final"
  | "invoice_created" | "invoice_edited" | "invoice_issued" | "invoice_cancelled"
  | "challan_created" | "challan_issued" | "challan_cancelled"
  | "export_docs"
  | "dispatched" | "cancelled" | "note";

/** Best-effort: a failed log write never fails the action it describes. */
export async function logOrderEvent(orderId: string, kind: OrderEventKind, opts: {
  note?: string | null; payload?: unknown; by?: CommercialUser | null;
} = {}): Promise<void> {
  try {
    await db.commercialOrderEvent.create({
      data: {
        orderId,
        kind,
        note: opts.note ?? null,
        payload: opts.payload === undefined ? undefined : (opts.payload as object),
        byId: opts.by?.id || null,
        byName: opts.by?.name || opts.by?.email || null,
      },
    });
  } catch (e) {
    console.error("[commercial] event log failed:", (e as Error).message);
  }
}
