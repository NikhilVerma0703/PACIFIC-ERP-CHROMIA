import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { tableMeta, selectOptions, HIDDEN_FORM_FIELDS } from "@/lib/tables";
import { RECORD_SMART } from "@/lib/recordSmart";
import { getSiloFormStatus, getAvailableRmBags } from "@/lib/silo";
import { SmartRecordForm } from "@/components/SmartRecordForm";
import { canUseEntryModel, entryAccess } from "@/lib/stationAccess";
import { NoAccess } from "@/components/NoAccess";

export const dynamic = "force-dynamic";

export default async function SmartRecord({ params }: { params: Promise<{ model: string }> }) {
  // storage tanks for the resin-prep source picker
  let storageTanks: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (prisma as any).$queryRaw`SELECT DISTINCT tank_no FROM resin_storage WHERE tank_no IS NOT NULL ORDER BY 1`;
    storageTanks = rows.map((r) => String(r.tank_no));
  } catch { /* optional */ }
  const { model } = await params;
  const cfg = RECORD_SMART[model];
  const meta = tableMeta(model);
  if (!cfg || !meta) notFound();
  if (!(await canUseEntryModel(model))) return <NoAccess station={(await entryAccess()).station} />;
  const _me = await currentUser();
  const operatorName = _me?.name || _me?.email || null;
  const [options, silos, rmBags] = await Promise.all([
    selectOptions(model),
    cfg.silo ? getSiloFormStatus().catch(() => []) : Promise.resolve([]),
    model === "Silo" ? getAvailableRmBags().catch(() => []) : Promise.resolve([]),
  ]);

  return (
    <Shell>
      <Link href="/entry" className="mb-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">← Data entry</Link>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">{cfg.title} — smart entry</h1>
      <p className="mb-5 max-w-2xl text-sm text-gray-500">{cfg.description}</p>
      <Card>
        <SmartRecordForm
          model={model}
          tableName={meta.tableName}
          fields={meta.fields}
          options={options}
          operatorName={operatorName}
          silos={silos}
          rmBags={rmBags}
          storageTanks={storageTanks}
          hideFields={HIDDEN_FORM_FIELDS[model] ?? []}
          cfg={{
            keyField: cfg.keyField,
            keyLabel: cfg.keyLabel,
            keyHint: cfg.keyHint,
            silo: cfg.silo,
            cloneFields: cfg.cloneFields ?? [],
            incrementFields: (cfg.increments ?? []).map((i) => i.field),
            nowFields: cfg.nowFields ?? [],
          }}
        />
      </Card>
    </Shell>
  );
}
