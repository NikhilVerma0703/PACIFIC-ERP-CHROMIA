import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { isAdmin } from "@/lib/rbac";
import { listSyncStatus } from "@/lib/airtableSync";
import { MigrationClient } from "./MigrationClient";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // big "Sync now" pulls can take a few minutes

export default async function MigrationPage() {
  if (!(await isAdmin())) notFound();
  let rows;
  try { rows = await listSyncStatus(); }
  catch {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Airtable migration</h1>
        <p className="mt-3 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The sync_state table doesn&apos;t exist yet. Run <code className="rounded bg-amber-100 px-1">npx prisma generate &amp;&amp; npx prisma db push</code> on your machine, restart the dev server, and reload this page.
        </p>
      </Shell>
    );
  }
  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Airtable migration — phased cutover</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Fully automatic. Every 30 minutes the sync pulls changed records for tables still entered in Airtable (never deletes ERP records).
          A table cuts itself over once three signals hold: <b>Airtable quiet 48h</b> → <b>record counts verified equal</b> → <b>operators entering in the ERP</b>.
          Migrate stations in order — RM → Silo → Resin → Mixer → Distributor / Kreos → Press → Oven → Jot → Polish Entry → Polish QC — and the app detects each move on its own.
          The buttons are overrides for exceptions only.
        </p>
      </div>
      <MigrationClient rows={rows} />
    </Shell>
  );
}
