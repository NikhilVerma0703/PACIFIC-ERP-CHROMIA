import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/rbac";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { tableMeta, selectOptions , HIDDEN_FORM_FIELDS} from "@/lib/tables";
import { SMART, SLAB_MODE, paramFields, polishEntrySlabOptions } from "@/lib/smartEntry";
import { SmartSlabForm } from "@/components/SmartSlabForm";
import { canUseEntryModel, entryAccess } from "@/lib/stationAccess";
import { NoAccess } from "@/components/NoAccess";
import { prisma } from "@/lib/prisma";
import { MODEL_DEPT } from "@/lib/consumables/dept";
import { ConsumablesQuickLog, type ConsumableItem } from "@/components/ConsumablesQuickLog";

export const dynamic = "force-dynamic";

export default async function SmartEntry({ params }: { params: Promise<{ model: string }> }) {
  const { model } = await params;
  const _me = await currentUser();
  const operatorName = _me?.name || _me?.email || null;
  const meta = tableMeta(model);
  if (!meta || !(model in SMART)) notFound();
  if (!(await canUseEntryModel(model))) return <NoAccess station={(await entryAccess()).station} />;
  const slabMode = SLAB_MODE[model] ?? "increment";
  const [pf, options, slabOptions] = await Promise.all([Promise.resolve(paramFields(model)), selectOptions(model), slabMode === "dropdown" ? polishEntrySlabOptions() : Promise.resolve([] as number[])]);
  // consumables quick-log (only machines with a department mapping)
  const dept = MODEL_DEPT[model];
  let consumableItems: ConsumableItem[] = [];
  if (dept) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      consumableItems = (await (prisma as any).inventoryStock.findMany({ select: { itemName: true, unit: true, currentStock: true }, orderBy: { itemName: "asc" } })) as ConsumableItem[];
    } catch { /* panel still renders; items just aren't suggested */ }
  }
  // Line head thickness: exactly these four choices (canonicalised on save)
  if (model === "Distributor" || model === "Kreos") options.slabThickness = ["3cm", "2cm", "12mm", "7mm"];
  // Kreos: Rx/Lx belong right after Mobile Roller Rotation K3
  let formFields = meta.fields.filter((f) => !(HIDDEN_FORM_FIELDS[model] ?? []).includes(f.prismaField));
  if (model === "Kreos") {
    const rxlx = formFields.filter((f) => f.prismaField === "loadOnMobileRollerRxSideKg" || f.prismaField === "loadOnMobileRollerLxSideKg");
    const rest = formFields.filter((f) => !rxlx.includes(f));
    const k3 = rest.findIndex((f) => f.prismaField === "mobileRollerRotationK3");
    if (k3 >= 0 && rxlx.length) formFields = [...rest.slice(0, k3 + 1), ...rxlx, ...rest.slice(k3 + 1)];
    else formFields = [...rest, ...rxlx];
  }

  return (
    <Shell>
      <Link href="/entry" className="mb-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">← Data entry</Link>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">{meta.tableName} — smart entry</h1>
      <p className="mb-5 max-w-2xl text-sm text-gray-500">Type the batch and press Tab: batch parameters fill in automatically and the slab number advances by one. Dropdowns use existing values; double-click a filled field to edit.</p>
      <Card><SmartSlabForm model={model} tableName={meta.tableName} fields={formFields} paramFieldSet={pf} options={options} operatorName={operatorName} batchField={meta.fields.some((f) => f.prismaField === "batch") ? "batch" : "batchNumber"} slabMode={slabMode} slabOptions={slabOptions} slabFirst={model === "PolishEntry" || model === "PolishQc"} /></Card>
      {dept && <ConsumablesQuickLog model={model} dept={dept} items={consumableItems} />}
    </Shell>
  );
}
