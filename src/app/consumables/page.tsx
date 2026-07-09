import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { canAccessConsumables } from "@/lib/consumables/access";
import ConsumablesDashboard from "@/components/consumables/ConsumablesDashboard";

export const dynamic = "force-dynamic";

export default async function ConsumablesPage() {
  if (!(await canAccessConsumables())) redirect("/");
  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">Consumables</h1>
      <p className="mb-5 max-w-3xl text-sm text-gray-500">Stock, consumption and forecasts for direct materials, production &amp; polishing consumables, and film rolls.</p>
      <ConsumablesDashboard />
    </Shell>
  );
}
