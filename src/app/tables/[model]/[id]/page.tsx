import { notFound } from "next/navigation";
import { currentUser, isAdmin } from "@/lib/rbac";
import { Shell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { BackButton } from "@/components/BackButton";
import { tableMeta, getRow, selectOptions, HIDDEN_FORM_FIELDS } from "@/lib/tables";
import { RecordEditor } from "@/components/RecordEditor";
import { canSeeModel } from "@/lib/branch";
import { operatorTableModels } from "@/lib/stationAccess";
import { photosForRecord } from "@/lib/entryPhoto";
import { getSiloFormStatus, type SiloFormInfo } from "@/lib/silo";
import { RECORD_SMART } from "@/lib/recordSmart";
import { isManager } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function EditRecord({ params }: { params: Promise<{ model: string; id: string }> }) {
  const { model, id } = await params;
  const _me = await currentUser();
  const operatorName = _me?.name || _me?.email || null;
  const meta = tableMeta(model);
  if (!meta) notFound();
  if (!(await canSeeModel(model))) notFound();
  const isOperator = String((_me as { role?: string } | null)?.role ?? "") === "OPERATOR";
  if (isOperator && !operatorTableModels((_me as { station?: string | null } | null)?.station).has(model)) notFound();
  // Mixer/Silo edits show the same live silo-stock cards as the entry forms —
  // without this the edit page wrongly says "empty / no live data" everywhere.
  const needsSilos = model === "MixerCycle" || !!RECORD_SMART[model]?.silo;
  const [row, options, photos, silos] = await Promise.all([
    getRow(model, id), selectOptions(model), photosForRecord(model, id),
    needsSilos ? getSiloFormStatus().catch(() => [] as SiloFormInfo[]) : Promise.resolve([] as SiloFormInfo[]),
  ]);
  if (!row) notFound();
  const canEditBags = needsSilos ? await isManager() : false;
  const PhotoStrip = () =>
    photos.length ? (
      <div className="mb-4 flex flex-wrap gap-3">
        {photos.map((ph) => (
          <a key={ph.id} href={`/api/photo?id=${ph.id}`} target="_blank" className="block overflow-hidden rounded-lg border border-gray-200 shadow-sm transition hover:border-brand" title={`${ph.filename}${ph.taken_by ? ` · ${ph.taken_by}` : ""}`}>
            {/* width/height reserve the 96px box before the bytes arrive (these are
                full camera JPEGs, avg 324 KB), lazy + async keep their decode off the
                path of the editor's hydration; the classes still size the box. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/photo?id=${ph.id}`} alt={ph.filename} width={96} height={96} loading="lazy" decoding="async" className="h-24 w-24 object-cover" />
          </a>
        ))}
      </div>
    ) : null;
  // an operator's OWN entry is editable (matched by user id stamped at creation)
  const ownRow = isOperator && !!(_me as { id?: string } | null)?.id && (row as { enteredById?: string | null }).enteredById === (_me as { id?: string }).id;
  // Polish QC is shared: any QC operator may correct any QC row (saveRow enforces
  // the same station gate and logs the edit).
  const polishQcShared = isOperator && model === "PolishQc";

  // Operators get a strictly read-only view for rows that are NOT theirs.
  if (isOperator && !ownRow && !polishQcShared) {
    const show = (v: unknown): string => {
      if (v == null || v === "") return "—";
      if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
      if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "—";
      if (typeof v === "object") return "…";
      return String(v);
    };
    return (
      <Shell>
        <BackButton fallback={`/tables/${model}`} />
        <h1 className="mb-1 text-xl font-semibold">{meta.tableName} — record</h1>
        <p className="mb-4 text-sm text-gray-500">View only — ask your incharge to correct anything that&apos;s wrong.</p>
        <PhotoStrip />
        <Card>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {meta.fields.filter((f) => !["id"].includes(f.prismaField)).map((f) => (
              <div key={f.prismaField}>
                <dt className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{f.airtableName}</dt>
                <dd className="mt-0.5 text-sm text-gray-900">{show((row as Record<string, unknown>)[f.prismaField])}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <BackButton fallback={`/tables/${model}`} />
      <h1 className="mb-1 text-xl font-semibold">Edit record</h1>
      {ownRow ? <p className="mb-4 text-sm text-gray-500">Your own entry — you can correct it. Other records are view-only for you.</p> : polishQcShared ? <p className="mb-4 text-sm text-gray-500">Polish QC — any QC operator can correct this entry; the change is logged.</p> : null}
      <PhotoStrip />
      <Card><RecordEditor model={model} id={id} fields={meta.fields} values={row} mode="edit" options={options} hideFields={HIDDEN_FORM_FIELDS[model] ?? []} operatorName={operatorName} silos={needsSilos ? silos : undefined} canEditBags={canEditBags} canDelete={await isAdmin()} /></Card>
    </Shell>
  );
}
