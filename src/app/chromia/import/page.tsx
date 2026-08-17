import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, Empty } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { chromiaGate, CHROMIA_MIN_TIER } from "@/lib/chromia/access";
import { ImportPanel } from "./ImportPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chromia import | Pacific ERP" };

const dt = (d: Date | null) =>
  d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

/**
 * Bring the monthly production register across from Excel.
 *
 * Supervisor-and-above, matching the module's MANAGEMENT_ROLES guard: this
 * writes history wholesale, which is not an operator's call.
 */
export default async function ChromiaImportPage() {
  const gate = await chromiaGate(CHROMIA_MIN_TIER.management);
  if (!gate.ok) redirect("/");

  const past = await prisma.chromiaImportBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, sourceFile: true, sheetName: true, periodLabel: true, status: true,
      totalRows: true, importedRows: true, skippedRows: true, failedRows: true,
      completedAt: true, createdAt: true,
    },
  });

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Import the register</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Load a monthly production workbook. Every imported slab keeps a pointer back to its file,
          sheet and row, so it can always be reconciled against the spreadsheet it came from.
        </p>
      </div>

      <ImportPanel />

      <Card className="mt-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Past imports
        </h2>
        {past.length === 0 ? (
          <Empty>Nothing has been imported yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-4 font-medium">File</th>
                  <th className="py-2 pr-4 font-medium">Sheet</th>
                  <th className="py-2 pr-4 font-medium">Period</th>
                  <th className="py-2 pr-4 font-medium">Rows</th>
                  <th className="py-2 pr-4 font-medium">Imported</th>
                  <th className="py-2 pr-4 font-medium">Skipped</th>
                  <th className="py-2 pr-4 font-medium">Failed</th>
                  <th className="py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {past.map((b) => (
                  <tr key={b.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4 text-gray-900">{b.sourceFile}</td>
                    <td className="py-2 pr-4 text-gray-600">{b.sheetName ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-600">{b.periodLabel ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-600">{b.totalRows}</td>
                    <td className="py-2 pr-4 font-medium text-gray-900">{b.importedRows}</td>
                    <td className="py-2 pr-4 text-gray-600">{b.skippedRows}</td>
                    <td className={`py-2 pr-4 ${b.failedRows ? "text-red-600" : "text-gray-600"}`}>
                      {b.failedRows}
                    </td>
                    <td className="py-2 text-gray-500">{dt(b.completedAt ?? b.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}
