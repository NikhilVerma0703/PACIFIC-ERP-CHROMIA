// One customer: the whole record, editable, with the enquiries and orders on
// it. Gates "view"; the write action decides whether the form saves.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { ClientDetail } from "@/components/commercial/clients/ClientDetail";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customer | Commercial | Pacific ERP" };

export default async function CommercialClientPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/clients");
  const { id } = await params;
  return <ClientDetail clientId={id} canWrite={g.actions.includes("write")} />;
}
