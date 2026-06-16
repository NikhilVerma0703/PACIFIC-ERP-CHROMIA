import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Card, H2 } from "@/components/ui";
import { allTables } from "@/lib/tables";
import { currentBranchName, OFFICE_MODELS, HIDDEN_TABLES, ADMIN_ONLY_TABLES } from "@/lib/branch";
import { isAdmin, currentUser } from "@/lib/rbac";
import { operatorTableModels } from "@/lib/stationAccess";

export const dynamic = "force-dynamic";

// Curated "core" operational tables shown first; everything else is grouped
// under "Other" to keep the list simple.
const CORE = new Set([
  "Mixer Cycle", "Press", "Polish Entry", "Polish QC", "SILO", "MIS", "Oven",
  "Distributor", "Kreos", "Batch Wastage", "Production Report", "RM", "Used Bags",
  "Slab Summary", "Daily Resin Tank", "RESIN STORAGE", "Supplier Master",
  "Grit Master", "Shipping & Invoice", "Inventory", "RM — Unassigned (pool)",
]);

const LABEL: Record<string, string> = { Rm: "RM — Assigned (bags)" };

export default async function TablesIndex() {
  const branch = await currentBranchName();
  const admin = await isAdmin();
  const me = await currentUser();
  const isOperator = String((me as { role?: string } | null)?.role ?? "") === "OPERATOR";
  const myModels = isOperator ? operatorTableModels((me as { station?: string | null } | null)?.station) : null;
  const tables = allTables().filter((t) =>
    !HIDDEN_TABLES.has(t.model) &&
    (admin || !ADMIN_ONLY_TABLES.has(t.model)) &&
    (myModels ? myModels.has(t.model) : true) &&
    (branch === "OFFICE" ? true : !OFFICE_MODELS.has(t.model)));
  const core = tables.filter((t) => CORE.has(t.tableName));
  const other = tables.filter((t) => !CORE.has(t.tableName));

  const Grid = ({ items }: { items: typeof tables }) => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((t) => (
        <Link key={t.model} href={`/tables/${t.model}`}>
          <Card className="transition hover:border-brand">
            <div className="text-sm font-medium text-gray-900">{LABEL[t.model] ?? t.tableName}</div>
            <div className="mt-1 text-xs text-gray-400">{t.fields.length} fields</div>
          </Card>
        </Link>
      ))}
    </div>
  );

  return (
    <Shell>
      <H2>Tables</H2>
      <p className="mb-4 text-sm text-gray-500">{isOperator ? "Your station's tables — view only." : "Browse, edit and create records in any table — the full Airtable grid, on your own database."}</p>
      <Grid items={isOperator ? tables : core} />
      {!isOperator && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-gray-600">Other tables ({other.length})</summary>
          <div className="mt-3"><Grid items={other} /></div>
        </details>
      )}
    </Shell>
  );
}
