// Commercial module settings — the company master, the banks, the tax rates,
// the default terms and the document numbering every proforma, invoice, packing
// list and challan prints from. ADMIN, plainly: its API refuses anyone else,
// and a form that loads into a 403 is worse than no form.
//
// IT USED TO GATE "view" so the design-code master could ride along for the
// manager. The master has its own screen now (/office/commercial/design-codes,
// round two answer 15), so this page has nothing left that is not the admin's
// and the gate says so.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { CommercialSettingsScreen } from "@/components/commercial/settings/CommercialSettingsScreen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commercial settings | Pacific ERP" };

export default async function CommercialSettingsPage() {
  const g = await commercialGate("admin", "settings");
  if (!g.ok) redirect(g.status === 401 ? "/login" : "/no-access?from=/office/commercial/settings");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Commercial settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          The company master, banks, tax rates, default terms and document numbering every proforma, invoice, packing list
          and challan is printed from. A field left alone follows the shipped default; only what you change is stored.
          Design codes and colours have their own screen.
        </p>
      </div>
      <CommercialSettingsScreen />
    </>
  );
}
