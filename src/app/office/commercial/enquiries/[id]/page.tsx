// One enquiry: edit it, work its lines, move its status, or convert it into a
// draft internal sales order. Gates "view"; the write action decides whether
// anything on it saves.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { EnquiryDetail } from "@/components/commercial/enquiries/EnquiryDetail";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Enquiry | Commercial | Pacific ERP" };

export default async function CommercialEnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const g = await commercialGate("view", "enquiries");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/enquiries");
  const { id } = await params;
  return (
    <EnquiryDetail
      enquiryId={id}
      canWrite={g.actions.includes("write")}
      currentUserId={g.user?.id ?? ""}
      currentUserName={g.user?.name ?? g.user?.email ?? "you"}
    />
  );
}
