// GET /api/office/commercial/proformas/choices — the two dropdowns on a draft
// PI: which bank prints (answer 23) and which GSTIN it is issued under
// (answer 21), plus the validity setting so the tab can say "valid forever".
//
// Gated on "view", not "admin": the settings route is the admin's, but the
// clerk who builds and issues PIs is a Commercial login and still has to make
// these two choices. Only names and registration numbers leave here; the bank
// account a PI prints is frozen into its snapshot by the draft route.
//
// It also carries `access`, this login's answer for the proforma AREA. The
// order workspace hands its tabs the action list alone, and since answers 1
// and 2 split the desk the action list no longer says whether THIS login may
// write a PI (Raghav and Murali write elsewhere and only read here). The tab
// already fetches this payload, so it learns the area's answer here and
// disables its writes with the reason instead of offering a 403.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle } from "@/lib/commercial/http";
import { loadSettings } from "@/lib/commercial/settings";
import { piChoices } from "@/lib/commercial/proforma-rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const g = await commercialGate("view", "proforma");
  if (!g.ok) return deny(g);
  // g.areas is the whole area table for this login; the proforma row is the
  // one the PI tab needs to know whether it may offer a write.
  return handle(async () => json(piChoices(await loadSettings(), g.areas.proforma)));
}
