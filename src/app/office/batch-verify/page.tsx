import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/rbac";
import { readableSides, signableSides } from "@/lib/costing/verification";
import { BatchVerifyPanel } from "@/components/office/BatchVerifyPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify a Batch | Pacific ERP" };

/**
 * The two checks either side of a costing, and neither of them is a costing.
 *
 * Middleware admits ADMIN, STORE and LINE_MANAGER to this path; that is the
 * coarse gate and it is not the answer. Which HALF a person sees is decided
 * here and again in the route, from the session — because "Line Manager" is a
 * rank and the person who verifies production weights is one named individual,
 * so a LINE_MANAGER who is not on WEIGHTS_VERIFIER_EMAILS gets nothing and is
 * sent home rather than shown an empty screen.
 *
 * Re-checked here rather than trusted from middleware for the same reason the
 * costing page re-checks: a UI condition is not an authorisation.
 */
export default async function BatchVerifyPage() {
  const u = await currentUser();
  const role = (u as { role?: string } | null)?.role ?? null;
  const email = (u as { email?: string } | null)?.email ?? null;
  const raw = process.env.WEIGHTS_VERIFIER_EMAILS;

  const can = readableSides(role, email, raw);
  const sign = signableSides(role, email, raw);
  if (!can.length) redirect("/");

  const onlyWeights = can.length === 1 && can[0] === "WEIGHTS";
  const onlyPrices = can.length === 1 && can[0] === "COSTS";

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Verify a batch</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          {onlyWeights && (
            <>
              What the mixer weighed for each batch — resin, grit by silo, filler and the
              charge count. Check it against the floor and mark it verified. If a record is
              corrected afterwards the batch comes back here needing a fresh check.
            </>
          )}
          {onlyPrices && (
            <>
              The unit prices each batch is costed at — what the rate card holds and anything
              set on the batch itself. Check them and mark them verified. If a rate is revised
              afterwards the batch comes back here needing a fresh check.
            </>
          )}
          {!onlyWeights && !onlyPrices && (
            <>
              Both halves of a batch check, as the two people who sign them see it. Weights are
              confirmed by production, prices by the store. You can read both and sign neither —
              a verification is one named person saying they checked it.
            </>
          )}
        </p>
      </div>
      <BatchVerifyPanel can={can} sign={sign} />
    </Shell>
  );
}
