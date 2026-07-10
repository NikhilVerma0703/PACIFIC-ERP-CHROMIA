import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { normalizeBatch } from "@/lib/normalizeBatch";
import { getBatchSlabList, getRangeEdits } from "@/lib/batchRange";
import { canRectify } from "@/lib/rbac";
import { RangeRectify } from "@/components/RangeRectify";

export const dynamic = "force-dynamic";

export default async function BatchRangePage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const { b } = await searchParams;
  const batch = (b ?? "").trim();
  const batchKey = normalizeBatch(batch) ?? "";
  if (!batchKey) notFound();
  const [slabs, edits, mayEdit] = await Promise.all([getBatchSlabList(batchKey), getRangeEdits(batchKey), canRectify()]);
  return (
    <Shell>
      <Link href={`/batch?b=${encodeURIComponent(batch)}`} className="mb-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">← Batch {batch}</Link>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-gray-900">Rectify slab range — batch {batch}</h1>
      <p className="mb-5 max-w-2xl text-sm text-gray-500">Add a slab the line head missed, or remove one that doesn&apos;t belong — it moves to its true batch, and an orphan with no line-head record is flagged instead of deleted. The range is otherwise auto-generated from Press slabs.</p>
      <RangeRectify batch={batch} batchKey={batchKey} slabs={slabs} added={edits.added} mayEdit={mayEdit} />
      {!mayEdit && <p className="mt-3 text-xs text-gray-400">View-only — only incharge and above can edit the range.</p>}
    </Shell>
  );
}
