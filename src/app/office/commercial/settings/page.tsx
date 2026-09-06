// Commercial module settings. Gates "admin" — everything on this screen is
// printed on a document the company issues, so a COMMERCIAL login reads its
// effect everywhere and changes it nowhere.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { CommercialSettingsScreen } from "@/components/commercial/settings/CommercialSettingsScreen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commercial settings | Pacific ERP" };

export default async function CommercialSettingsPage() {
  const g = await commercialGate("admin");
  if (!g.ok) redirect(g.status === 401 ? "/login" : "/no-access?from=/office/commercial/settings");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Commercial settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          The company master, banks, tax rates, default terms and document numbering every proforma, invoice, packing list
          and challan is printed from. A field left alone follows the shipped default; only what you change is stored.
        </p>
      </div>
      <CommercialSettingsScreen />
    </>
  );
}
