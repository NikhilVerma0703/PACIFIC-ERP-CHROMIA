// The order workspace. Gates "view" and hands the client component the user's
// actions, so every tab hides its write controls from a read-only login
// without asking the server a second time.
//
// The tab is read HERE, from the query string, and passed down. Reading it in
// the client with useSearchParams would drag the whole workspace behind a
// Suspense boundary for no gain — the page is already force-dynamic.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { commercialGate } from "@/lib/commercial/access";
import { OrderWorkspace } from "@/components/commercial/order/OrderWorkspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order | Commercial | Pacific ERP" };

export default async function CommercialOrderPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const g = await commercialGate("view", "orders");
  if (!g.ok) redirect(g.actions.includes("verify") ? "/office/commercial/dispatch-check" : "/no-access?from=/office/commercial/orders");
  const { id } = await params;
  const { tab } = await searchParams;
  return <OrderWorkspace orderId={id} actions={g.actions} initialTab={tab ?? "overview"} />;
}
