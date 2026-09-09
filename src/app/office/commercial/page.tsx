// Commercial overview. The one screen that shows the whole module, so it shows
// only as much of it as this login reaches: the cards come from the area table
// (round two: "nav, the overview and every screen build themselves from
// commercialAreasFor(user), never from the role string") and the actions come
// from the gate.
//
// A login with no overview at all — bay 5, whose one screen is the dispatch
// check — is sent to the screen it does have rather than to /no-access, which
// is the same answer commercialHomeFor gives at login.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { commercialAreasFor, commercialHomeFor, COMMERCIAL_HOME } from "@/lib/commercial/access-rules";
import { CommercialDashboard } from "@/components/commercial/CommercialDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commercial | Pacific ERP" };

export default async function CommercialHome() {
  const g = await commercialGate("view", "overview");
  const areas = commercialAreasFor(g.user);
  if (!g.ok || areas.overview === "none") {
    const home = commercialHomeFor(g.user);
    // Never redirect to this page from this page: a login with neither the
    // overview nor a screen of its own has nothing here to be sent to.
    redirect(home === COMMERCIAL_HOME ? "/no-access?from=/office/commercial" : home);
  }
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Commercial</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Enquiries, internal sales orders, stock holds, proforma invoices, packing lists, the dispatch check, invoices and delivery challans.
        </p>
      </div>
      <CommercialDashboard actions={g.actions} areas={areas} />
    </>
  );
}
