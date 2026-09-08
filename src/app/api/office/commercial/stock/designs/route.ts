// GET /api/office/commercial/stock/designs → { designs: string[] }
//
// The design picker's source: distinct canonical design names on AVAILABLE
// finished slabs, through the sales-approval filter for a non-admin. The
// reading itself is ./_lib listStockDesigns, shared with the design-master
// seed so the two cannot disagree about what a "design name" is.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain } from "@/lib/commercial/http";
import { listStockDesigns } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const g = await commercialGate("view", "stock");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const designs = await listStockDesigns({ isAdmin: g.actor === "ADMIN", availableOnly: true });
    return json(plain({ designs, total: designs.length }));
  });
}
