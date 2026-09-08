// GET /api/office/commercial/dispatch-check/[plId] — one list to check.
// Crates, slabs and just enough of the order to know what is being shipped.
//
// TWO GATES, NOT ONE. `verify` says the login may check slabs; it does not say
// which lists. A list Commercial is still building (DRAFT), or one that has
// been finalised and shipped, is not part of that job — so anything outside
// CHECKER_STATUSES answers 404 rather than 403 or a status message, which would
// confirm the list exists to someone who is only allowed to know about the ones
// in front of them.
//
// The body is the whitelist in checkerListView: the order's rates, the client's
// tax registrations and the order's payment terms are not on a floor screen.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, fail, handle, plain } from "@/lib/commercial/http";
import { checkerListView, checkerMaySee } from "@/lib/commercial/packing-rules";
import { db, paramPl } from "../../packing-lists/_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ plId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("verify");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const plId = await paramPl(params);
    const row = await db.commercialPackingList.findUnique({
      where: { id: plId },
      select: {
        id: true, number: true, status: true, submittedAt: true, verifiedAt: true, verifiedByName: true,
        verificationNote: true, containerNo: true, sealNo: true, linerOtlNo: true, vehicleNo: true,
        packagesSummary: true, grossWeightKg: true, netWeightKg: true, notes: true, measurementUnit: true,
        order: { select: { number: true, kind: true, customerPoNumber: true, client: { select: { name: true, country: true } } } },
        crates: { orderBy: { crateNo: "asc" } },
        slabs: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!row || !checkerMaySee(String(row.status))) fail(404, "Packing list not found");
    // The signed-in login's own Commercial actions ride along, so the screen
    // can offer the swap (a `write` action, answer 30) to Commercial and hide
    // it from a verify-only login rather than showing a button that 403s.
    return json(plain({ ...checkerListView(plain<Record<string, unknown>>(row)), actions: g.actions }));
  });
}
