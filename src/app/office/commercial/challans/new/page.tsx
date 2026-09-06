// A new delivery challan. Gates "write" — reading the book is enough for
// "view", but drafting a numbered document is not.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { commercialGate } from "@/lib/commercial/access";
import { ChallanNew } from "@/components/commercial/challans/ChallanNew";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New challan | Commercial | Pacific ERP" };

export default async function NewChallanPage() {
  const g = await commercialGate("write");
  if (!g.ok) redirect(g.actions.includes("view") ? "/office/commercial/challans" : "/no-access?from=/office/commercial/challans/new");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">New delivery challan</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          The consignee can come from the client master or be typed in. The number is taken from the counter when the draft is created — type one only to mirror a number issued elsewhere.
        </p>
      </div>
      <Suspense fallback={null}>
        <ChallanNew />
      </Suspense>
    </>
  );
}
