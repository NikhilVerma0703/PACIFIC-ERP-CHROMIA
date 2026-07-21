import { Shell } from "@/components/Shell";
import { Card, H2, Empty } from "@/components/ui";
import { BackButton } from "@/components/BackButton";
import { getDesignFix } from "./actions";
import { DesignFixForm } from "./DesignFixForm";

export const dynamic = "force-dynamic";

export default async function DesignFixPage({
  searchParams,
}: {
  searchParams: Promise<{ b?: string }>;
}) {
  const { b } = await searchParams;
  const batch = b?.trim();
  const backHref = batch ? `/batch?b=${encodeURIComponent(batch)}` : "/batch";

  if (!batch) {
    return (
      <Shell>
        <BackButton fallback="/batch" />
        <Empty>No batch specified.</Empty>
      </Shell>
    );
  }

  let fix = null;
  let error: string | null = null;
  try {
    fix = await getDesignFix(batch);
  } catch {
    error = "Could not read the database. Run the import first (see README).";
  }

  return (
    <Shell>
      <BackButton fallback={backHref} />
      <h1 className="mb-4 text-xl font-semibold">Reconcile design — Batch {fix?.key || batch}</h1>
      {error ? (
        <Empty>{error}</Empty>
      ) : fix && fix.designs.length === 0 ? (
        <Empty>No design recorded for this batch.</Empty>
      ) : fix ? (
        <Card>
          <H2>Set a single design for the batch</H2>
          <p className="mb-4 text-sm text-gray-600">
            Choose the correct design; it will be written to every Press / Polish / MIS record in the batch that currently has a different design. You can undo within 10 seconds.
          </p>
          <DesignFixForm batch={fix.batch} designs={fix.designs} primary={fix.primary} bySource={fix.bySource} />
        </Card>
      ) : null}
    </Shell>
  );
}
