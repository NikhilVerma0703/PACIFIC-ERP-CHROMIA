// GET /api/sampling/sizes
//
// Every size that has ever been typed, newest last — the pick-list half of the
// size control. Typing a new one is a POST to /api/sampling/intake, which
// creates the sampling_size row as a side effect of using it; there is no
// endpoint that creates a size on its own, because a size nobody has any stock
// in is an entry in a list nobody curates, which is the failure
// lib/sampling/size.ts exists to prevent.
//
// GATED ON "addStock" for the same reason as the catalogue: the Fabrication
// Supervisor needs the list to pick from and may not see the inventory. A size
// carries no quantity and no colour — it is 6 x 4 in x 20 mm.
//
// ORDERED LARGEST FIRST, matching the inventory screen's size ordering, so the
// same list does not read in two different orders on two screens.

import { prisma } from "@/lib/prisma";
import { samplingGate } from "@/lib/sampling/access";
import { sampleSizeLabel } from "@/lib/sampling/size";

export const dynamic = "force-dynamic";

function deny(status: number) {
  return Response.json(
    { error: status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
    { status },
  );
}

export async function GET() {
  const g = await samplingGate("addStock");
  if (!g.ok) return deny(g.status);

  const sizes = await prisma.samplingSize.findMany({
    orderBy: [{ lengthIn: "desc" }, { widthIn: "desc" }, { thicknessMm: "desc" }],
    select: { id: true, lengthIn: true, widthIn: true, thicknessMm: true },
  });

  return Response.json(
    // Decimal -> number at the seam, once. sampling_size.length_in/.width_in
    // are NUMERIC(10,2) and arrive as Prisma Decimal objects, which JSON.
    // stringify turns into a string ("4") — and a string reaching
    // sampleSizeLabel or a client-side comparison is the kind of quiet type
    // drift that makes 4 and "4.00" two sizes on screen.
    sizes.map((s) => {
      const lengthIn = Number(s.lengthIn);
      const widthIn = Number(s.widthIn);
      const thicknessMm = Number(s.thicknessMm);
      return {
        id: s.id,
        lengthIn,
        widthIn,
        thicknessMm,
        // Derived, never stored — a stored label drifts from the numbers it
        // describes (lib/sampling/size.ts).
        label: sampleSizeLabel({ lengthIn, widthIn, thicknessMm }),
      };
    }),
  );
}
