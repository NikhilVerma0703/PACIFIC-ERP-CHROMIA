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
  const g = await commercialGate("view", "invoices");
  if (!g.ok) return deny(g);
  // The login's access to the invoices AREA rides along, because the screens
  // are handed the login's GLOBAL actions and "write" there is not permission
  // to write an invoice (DECISIONS-2 1 and 2: Murali holds the action and only
  // READS invoices). Without this the boxes he cannot save render enabled and
  // fail at the server; with it they are disabled with their reason, which is
  // the house rule. Nothing here depends on the settings, so it costs no read.
  return handle(async () => json({ ...choicesFor(await loadSettings()), access: g.areas.invoices }));
}
