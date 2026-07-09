import { notFound } from "next/navigation";
import { currentUser } from "@/lib/rbac";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { BackButton } from "@/components/BackButton";
import { canWriteModel } from "@/lib/branch";
import { tableMeta, selectOptions, HIDDEN_FORM_FIELDS } from "@/lib/tables";
import { RecordEditor } from "@/components/RecordEditor";
import { getSiloFormStatus, type SiloFormInfo } from "@/lib/silo";
import { RECORD_SMART } from "@/lib/recordSmart";
import { isManager } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function NewRecord({ params }: { params: Promise<{ model: string }> }) {
  const { model } = await params;
  const _me = await currentUser();
  const operatorName = _me?.name || _me?.email || null;
  const meta = tableMeta(model);
  if (!meta) notFound();
  if (!(await canWriteModel(model))) notFound();
  if (String((((await currentUser()) as { role?: string } | null))?.role ?? "") === "OPERATOR") notFound(); // operators use smart entry only
  const options = await selectOptions(model);
  // live silo-stock cards on mixer/silo forms (same as entry + edit pages)
  const needsSilos = model === "MixerCycle" || !!RECORD_SMART[model]?.silo;
  const silos = needsSilos ? await getSiloFormStatus().catch(() => [] as SiloFormInfo[]) : [];
  const canEditBags = needsSilos ? await isManager() : false;

  return (
    <Shell>
      <BackButton fallback={`/tables/${model}`} />
      <h1 className="mb-4 text-xl font-semibold">New {meta.tableName} record</h1>
      <Card><RecordEditor model={model} fields={meta.fields} values={{}} mode="new" options={options} hideFields={HIDDEN_FORM_FIELDS[model] ?? []} operatorName={operatorName} silos={needsSilos ? silos : undefined} canEditBags={canEditBags} /></Card>
    </Shell>
  );
}
