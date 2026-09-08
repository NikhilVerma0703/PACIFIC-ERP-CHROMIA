// GET /api/office/commercial/invoices/choices — what the two invoice dropdowns
// offer: the GSTINs the company issues under (answer 21) and the two bank
// accounts (answer 23), plus the alwaysIgst switch (answer 22).
//
// Its own route because the settings route is admin-only: the clerk drafting
// an invoice may pick a registration without being allowed to change one.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { choicesFor } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => json(choicesFor(await loadSettings())));
}
