// Shared by the two receipts handlers. Not a route — Next ignores a colocated
// file that is not route.ts.
//
// WHY THIS EXISTS. `advanceOf` in ../../_lib answers the advance question
// WITHOUT an exchange rate, which is what round two's answer 13 asked for:
// same currency only. Round three, answer 10 replaced that — a receipt in
// another currency now counts, converted through the manual rate on the order's
// live invoice — so the receipts side has to hand the rule that rate. This
// composes exactly what advanceOf composes, plus the rate, and nothing else:
// the same total (Σ of the priced lines), the same percentage in force.
import { advanceStatus, type AdvanceStatus } from "@/lib/commercial/receipts-rules";
import { orderTotals, type ItemLike } from "@/lib/commercial/orders-rules";
import { advanceRateFor } from "../../../invoices/_lib";
import { advancePctOf } from "../../_lib";

/**
 * The advance gate for one order, WITH the invoice's rate (answers 11, 12, 10).
 * `receipts` is every receipt on the order — advanceStatus picks the ADVANCE
 * ones itself, and the card needs the rest for its totals.
 */
export async function advanceWithRate(
  order: Record<string, unknown>,
  items: ReadonlyArray<unknown>,
  receipts: ReadonlyArray<{ kind: string; amount: unknown; currency: string }>,
): Promise<AdvanceStatus> {
  return advanceStatus({
    receipts,
    orderTotal: orderTotals(items as ItemLike[]).amount,
    currency: String(order.currency ?? ""),
    advancePct: await advancePctOf(order),
    waived: order.advanceWaivedAt != null,
    rate: await advanceRateFor(String(order.id ?? "")),
  });
}
