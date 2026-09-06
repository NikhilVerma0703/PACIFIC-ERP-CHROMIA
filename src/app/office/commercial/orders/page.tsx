// The order book. Gates "view" — the dispatch team reaches only its own
// screen, and the layout has already sent it there.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { OrdersBoard } from "@/components/commercial/orders/OrdersBoard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders | Commercial | Pacific ERP" };

export default async function CommercialOrdersPage({ searchParams }: {
  searchParams: Promise<{ status?: string; kind?: string; q?: string; clientId?: string }>;
}) {
  const g = await commercialGate("view");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/orders");
  const sp = await searchParams;
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Orders</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Internal sales orders, by stage. A stage can be entered whenever the work is done — the board records where each
          order has been, it does not gate what comes next.
        </p>
      </div>
      <OrdersBoard
        actions={g.actions}
        initialStatus={sp.status ?? ""}
        initialKind={sp.kind ?? ""}
        initialQ={sp.q ?? ""}
        initialClientId={sp.clientId ?? ""}
      />
    </>
  );
}
