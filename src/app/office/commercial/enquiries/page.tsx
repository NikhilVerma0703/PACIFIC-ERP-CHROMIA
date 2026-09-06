// The enquiry book. Gates "view"; the filters arrive as query parameters and
// are read here rather than in the client, so the list needs no Suspense
// boundary around useSearchParams.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { EnquiriesList } from "@/components/commercial/enquiries/EnquiriesList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Enquiries | Commercial | Pacific ERP" };

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? "" : v ?? "");

export default async function CommercialEnquiriesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/enquiries");
  const sp = await searchParams;
  const status = one(sp.status);
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Enquiries</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          What customers have asked for, logged from the mail that brought it. An enquiry with a customer on the master can be
          converted into a draft internal sales order in one click.
        </p>
      </div>
      <EnquiriesList
        initialStatus={status === "" && !sp.status ? "OPEN" : status}
        initialQ={one(sp.q)}
        clientId={one(sp.clientId)}
      />
    </>
  );
}
