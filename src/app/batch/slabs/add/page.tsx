import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/rbac";
import { Card, Empty } from "@/components/ui";
import { BackButton } from "@/components/BackButton";
import { getAddSlabForm } from "../actions";
import { AddSlabForm } from "../AddSlabForm";
import type { SlabStation } from "@/lib/erp";
import { REJECT_GRADE_FIELD, rejectPhotosRequired } from "@/lib/photoSlots";

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

  // A PRE-FILLED REJECT NEVER REACHES THE DROPDOWN.
  //
  // getAddSlabForm copies every editable value off the nearest neighbouring
  // slab, quality grade included. On a batch whose previous slab was graded
  // C (Reject) this screen therefore opened with 'C (Reject)' already selected,
  // one tap from an undocumented reject — and this form carries no photo fields
  // at all, so it can never satisfy the rule the QC paths enforce (owner,
  // 2026-09-04: only non-C slabs may be added here). Blanking it hands the
  // operator an empty grade to choose from instead of a wrong one to notice;
  // the form refuses a reject either way, and so must createVerifiedSlab.
  //
  // Only the grade is dropped — every other prefilled value is still the point
  // of the screen. Nothing is dropped for stations that carry no reject rule.
  if (!("error" in form) && rejectPhotosRequired(form.model, String(form.values[REJECT_GRADE_FIELD] ?? ""))) {
    form.values[REJECT_GRADE_FIELD] = "";
  }

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
