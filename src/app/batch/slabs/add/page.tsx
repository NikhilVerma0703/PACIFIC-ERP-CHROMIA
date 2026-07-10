import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/rbac";
import { Card, Empty } from "@/components/ui";
import { BackButton } from "@/components/BackButton";
import { getAddSlabForm } from "../actions";
import { AddSlabForm } from "../AddSlabForm";
import type { SlabStation } from "@/lib/erp";

export const dynamic = "force-dynamic";

const FIX: SlabStation[] = ["press", "distributor", "kreos", "oven", "jot", "polishEntry", "polishQc"];

export default async function AddSlabPage({
  searchParams,
}: {
  searchParams: Promise<{ b?: string; station?: string; slab?: string }>;
}) {
  const { b, station: stationRaw, slab: slabRaw } = await searchParams;
  const _me = await currentUser();
  const operatorName = _me?.name || _me?.email || null;
  const batch = b?.trim();
  const station = (FIX.includes(stationRaw as SlabStation) ? stationRaw : "press") as Exclude<SlabStation, "mixer">;
  const slab = Number(slabRaw);

  const backHref = batch ? `/batch/slabs?b=${encodeURIComponent(batch)}&station=${station}&only=missing` : "/batch";

  if (!batch || !Number.isFinite(slab)) {
    return (
      <Shell>
        <BackButton fallback={backHref} />
        <Empty>Missing batch or slab number.</Empty>
      </Shell>
    );
  }

  const form = await getAddSlabForm(batch, station, slab);

  return (
    <Shell>
      <BackButton fallback={backHref} />
      <h1 className="mb-4 text-xl font-semibold">Add &amp; verify slab</h1>
      {"error" in form ? (
        <Empty>{form.error}</Empty>
      ) : (
        <Card>
          <AddSlabForm
            model={form.model}
            batch={form.batch}
            slab={form.slab}
            fields={form.fields}
            values={form.values}
            options={form.options}
            templateSlab={form.templateSlab}
            avgWeight={form.avgWeight}
            weightField={form.weightField}
            operatorName={operatorName}
          />
        </Card>
      )}
    </Shell>
  );
}
