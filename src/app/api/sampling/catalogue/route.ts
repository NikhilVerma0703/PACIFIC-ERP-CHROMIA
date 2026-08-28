// GET /api/sampling/catalogue
//
// The colour chart, as the pick-lists behind "add stock" need it: series ->
// colour -> finish, in the printed chart's order.
//
// GATED ON "addStock", NOT ON "view", and that is the one decision in this
// file. The Fabrication Supervisor may add sample stock and may NOT see the
// inventory (lib/sampling/actions.ts) — but he cannot name a colour+finish
// without the list of them, so reading the chart is part of adding stock rather
// than part of viewing the shelf. Nothing here carries a quantity, a size or a
// dispatch: it is the same chart already printed on the wall and already stored
// in product_* precisely because it is not sampling's property.
//
// Gating it on "view" instead would leave the supervisor's control on
// /fab/supervisor/slabs with an empty colour dropdown and a 403 he cannot act
// on — the module's stated audience granting him an action and then withholding
// the only way to perform it.
//
// IT RETURNS AN ARRAY. getJson() in lib/fab/postJson.ts hands back
// `Array.isArray(j) ? j : []`, so an object body would arrive at the screen as
// a successful empty list.

import { prisma } from "@/lib/prisma";
import { samplingGate } from "@/lib/sampling/access";

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

  const series = await prisma.productSeries.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      position: true,
      colours: {
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          position: true,
          finishes: {
            orderBy: { finish: "asc" },
            select: { id: true, finish: true },
          },
        },
      },
    },
  });

  return Response.json(series);
}
