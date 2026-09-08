// Commercial module settings. Gates "view" and hands the screen the user's
// actions: the settings FORM (banks, GSTIN, tax, numbering — everything a
// document prints from) appears only for "admin", and the design-code master
// (answer 20) for "plan", so the Commercial Manager can keep the codes and
// shades without being handed the bank account. A login with neither sees
// the master read-only.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { CommercialSettingsScreen } from "@/components/commercial/settings/CommercialSettingsScreen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Commercial settings | Pacific ERP" };

export default async function CommercialSettingsPage() {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.status === 401 ? "/login" : "/no-access?from=/office/commercial/settings");
  const admin = g.actions.includes("admin");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Commercial settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          {admin
            ? "The company master, banks, tax rates, default terms, document numbering and the design-code master every proforma, invoice, packing list and challan is printed from. A field left alone follows the shipped default; only what you change is stored."
            : "The design-code master: the item code and the shade of every design, printed on order lines and export documents and used to sequence the production queue."}
        </p>
      </div>
      <CommercialSettingsScreen actions={g.actions} />
    </>
  );
}
