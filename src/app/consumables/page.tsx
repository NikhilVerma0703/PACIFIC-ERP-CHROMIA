import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { consumablesTierOf } from "@/lib/consumables/access";
import { currentUser } from "@/lib/rbac";
import ConsumablesDashboard from "@/components/consumables/ConsumablesDashboard";

export const dynamic = "force-dynamic";

export default async function ConsumablesPage() {
  const tier = consumablesTierOf(await currentUser());
  // Say so, rather than bouncing to Overview: a page that silently becomes a
  // different page reads as a broken link.
  if (!tier) redirect(`/no-access?from=${encodeURIComponent("/consumables")}`);
  // VIEW is Maintenance. The tier is read once here and provided to the whole
  // tree; the routes enforce it again on every write regardless.
  const canWrite = tier !== "VIEW";
  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">Consumables</h1>
      <p className="mb-5 max-w-3xl text-sm text-gray-500">Stock, consumption and forecasts for direct materials, production &amp; polishing consumables, and film rolls.</p>
      {!canWrite && (
        <p className="mb-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
          You have <b>read access</b> to consumables. Stock and consumption are recorded by the store.
        </p>
      )}
      <ConsumablesDashboard canWrite={canWrite} />
    </Shell>
  );
}
