import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser, isManager, rankOf, ROLE_RANK } from "@/lib/rbac";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { tableMeta, selectOptions, HIDDEN_FORM_FIELDS } from "@/lib/tables";
import { SmartMixerForm } from "@/components/SmartMixerForm";
import { getSiloFormStatus } from "@/lib/silo";
import { canUseEntryModel, entryAccess } from "@/lib/stationAccess";
import { NoAccess } from "@/components/NoAccess";
import { prisma } from "@/lib/prisma";
import { MODEL_DEPT } from "@/lib/consumables/dept";
import { ConsumablesQuickLog, type ConsumableItem } from "@/components/ConsumablesQuickLog";

export const dynamic = "force-dynamic";

export default async function SmartMixer() {
  const meta = tableMeta("MixerCycle");
  if (!meta) notFound();
  if (!(await canUseEntryModel("MixerCycle"))) return <NoAccess station={(await entryAccess()).station} />;
  const [options, silos] = await Promise.all([selectOptions("MixerCycle"), getSiloFormStatus().catch(() => [])]);
  const _me = await currentUser();
  const operatorName = _me?.name || _me?.email || null;
  const canEditBags = await isManager();
  let consumableItems: ConsumableItem[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    consumableItems = (await (prisma as any).inventoryStock.findMany({ select: { itemName: true, unit: true, currentStock: true }, orderBy: { itemName: "asc" } })) as ConsumableItem[];
  } catch { /* best-effort */ }
  return (
    <Shell>
      <Link href="/entry" className="mb-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">← Data entry</Link>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">Mixer Cycle — smart entry</h1>
      <p className="mb-5 max-w-2xl text-sm text-gray-500">Type the batch and press Tab: the previous cycle is cloned, the cycle number advances by one, and the same mixers are pre-selected with their grit/filler data. Edit only what changed.</p>
      <Card><SmartMixerForm fields={meta.fields} options={options} hideFields={["batch", ...(HIDDEN_FORM_FIELDS.MixerCycle ?? [])]} operatorName={operatorName} silos={silos} canEditBags={canEditBags} /></Card>
      {rankOf(String((_me as { role?: string } | null)?.role ?? "")) >= ROLE_RANK.INCHARGE && (
        <ConsumablesQuickLog model="MixerCycle" dept={MODEL_DEPT.MixerCycle} items={consumableItems} />
      )}
    </Shell>
  );
}
