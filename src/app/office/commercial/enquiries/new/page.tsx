// Logging an enquiry. Gates "write" — reading the book is "view", adding to it
// is not — and hands the client the current user so the form can offer
// "assign to me" without a users endpoint.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { NewEnquiry } from "@/components/commercial/enquiries/NewEnquiry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New enquiry | Commercial | Pacific ERP" };

export default async function NewEnquiryPage() {
  const g = await commercialGate("write");
  if (!g.ok) redirect(g.status === 401 ? "/login" : "/no-access?from=/office/commercial/enquiries/new");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Log an enquiry</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Who asked, what they asked for, and what the mail said. The customer can be added later if they are not on the master
          yet — but an order needs one, so it has to be filled before Convert.
        </p>
      </div>
      <NewEnquiry currentUserId={g.user?.id ?? ""} currentUserName={g.user?.name ?? g.user?.email ?? "you"} />
    </>
  );
}
