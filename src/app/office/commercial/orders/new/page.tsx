// A new internal sales order. Gates "write" rather than "view": a login that
// can only read the module has no business on a form whose only button creates
// a numbered document.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { NewOrderForm } from "@/components/commercial/orders/NewOrderForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New order | Commercial | Pacific ERP" };

export default async function NewCommercialOrderPage() {
  const g = await commercialGate("write", "orders");
  if (!g.ok) redirect(g.status === 401 ? "/login" : "/office/commercial/orders");
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">New order</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          The header only — the lines are added on the order itself, next to the stock check. Everything left blank takes
          the default for the kind of order, or what the client master already knows.
        </p>
      </div>
      <NewOrderForm />
    </>
  );
}
