// GET /api/office/commercial/proformas/choices — the two dropdowns on a draft
// PI: which bank prints (answer 23) and which GSTIN it is issued under
// (answer 21), plus the validity setting so the tab can say "valid forever".
//
// Gated on "view", not "admin": the settings route is the admin's, but the
// clerk who builds and issues PIs is a Commercial login and still has to make
// these two choices. Only names and registration numbers leave here; the bank
// account a PI prints is frozen into its snapshot by the draft route.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { piChoices } from "@/lib/commercial/proforma-rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => json(piChoices(await loadSettings())));
}
