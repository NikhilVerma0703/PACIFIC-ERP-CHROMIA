import { Shell } from "@/components/Shell";
import { Card, H2, Empty, Badge, fmt } from "@/components/ui";
import { listCuttingEntries, getCuttingStats } from "@/lib/cutting";
import { CuttingForm } from "@/components/CuttingForm";
import { canEnterData } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const PURPOSE_TONE: Record<string, "brand" | "green" | "amber" | "red"> = {
  Sample: "brand",
  Display: "green",
  QC: "amber",
  Waste: "red",
};

export default async function CuttingPage() {
  const [canEnter, entries, stats] = await Promise.all([
    canEnterData(),
    listCuttingEntries(50),
    getCuttingStats(),
  ]);

  return (
    <Shell>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Cutting</h1>
            <p className="mt-0.5 text-sm text-gray-500">Post-QC sample &amp; offcut logging</p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-center shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Today</div>
              <div className="text-2xl font-semibold text-gray-900">{stats.today}</div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-center shadow-sm">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Total</div>
              <div className="text-2xl font-semibold text-gray-900">{fmt(stats.total)}</div>
            </div>
          </div>
        </div>

        {canEnter && (
          <Card>
            <H2>Log a Cutting Entry</H2>
            <CuttingForm />
          </Card>
        )}

        <Card>
          <H2>Recent Entries</H2>
          {entries.length === 0 ? (
            <Empty>No cutting entries yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                    <th className="pb-2 pr-4">Slab</th>
                    <th className="pb-2 pr-4">Batch</th>
                    <th className="pb-2 pr-4">Design</th>
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Operator</th>
                    <th className="pb-2 pr-4">Size (cm)</th>
                    <th className="pb-2 pr-4">Qty</th>
                    <th className="pb-2 pr-4">Purpose</th>
                    <th className="pb-2">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50/60">
                      <td className="py-2 pr-4 font-mono font-medium text-gray-900">{e.slabNumber}</td>
                      <td className="py-2 pr-4 text-gray-600">{e.batchKey}</td>
                      <td className="py-2 pr-4 text-gray-600">{e.design ?? "—"}</td>
                      <td className="py-2 pr-4 text-gray-500">
                        {new Date(e.cutDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                      </td>
                      <td className="py-2 pr-4 text-gray-700">{e.operator}</td>
                      <td className="py-2 pr-4 text-gray-600">
                        {e.lengthCm != null && e.widthCm != null
                          ? `${e.lengthCm} × ${e.widthCm}${e.thicknessMm != null ? ` × ${e.thicknessMm}mm` : ""}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-4 text-gray-700">{e.quantity}</td>
                      <td className="py-2 pr-4">
                        {e.purpose ? (
                          <Badge tone={PURPOSE_TONE[e.purpose] ?? "brand"}>{e.purpose}</Badge>
                        ) : "—"}
                      </td>
                      <td className="py-2 max-w-xs truncate text-gray-500">{e.remarks ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </Shell>
  );
}
