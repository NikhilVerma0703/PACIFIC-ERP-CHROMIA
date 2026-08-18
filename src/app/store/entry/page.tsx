import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, Empty } from "@/components/ui";
import { canManageRm } from "@/lib/rbac";
import { listUnassignedPool } from "@/app/store/actions";
import { RmEntry } from "@/components/RmEntry";

export const dynamic = "force-dynamic";

export default async function RmManualEntryPage() {
  if (!(await canManageRm())) notFound();
  const pool = await listUnassignedPool(true);
  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">RM entry — add invoice line</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">Log material as it arrives, one invoice line at a time — no Excel needed. It lands in the same unassigned pool as uploaded invoices. Prefer bulk? <Link href="/store/upload" className="font-medium text-brand hover:underline">Upload an Excel</Link> instead, then hand over bags from <Link href="/store/assign" className="font-medium text-brand hover:underline">Assignment</Link>.</p>
      </div>
      <RmEntry />
      <Card className="mt-6">
        <div className="mb-3 text-sm font-semibold text-gray-800">Lines with balance to assign ({pool.length})</div>
        {pool.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500"><th className="py-2 pr-4">Invoice</th><th className="py-2 pr-4">Type</th><th className="py-2 pr-4">Size</th><th className="py-2 pr-4">Grade</th><th className="py-2 pr-4">Supplier</th><th className="py-2 pr-4 text-right">Total</th><th className="py-2 pr-4 text-right">Remaining</th></tr></thead>
              <tbody>{pool.map((p) => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="py-2 pr-4 font-medium text-gray-900">{p.invNo}</td><td className="py-2 pr-4">{p.type}</td><td className="py-2 pr-4">{p.size}</td><td className="py-2 pr-4">{p.grade}</td><td className="py-2 pr-4 text-gray-500">{p.supplier ?? "—"}</td>
                  <td className="py-2 pr-4 text-right">{p.totalKg.toLocaleString("en-IN")}</td>
                  <td className="py-2 pr-4 text-right font-semibold text-amber-700">{p.remainingKg.toLocaleString("en-IN")} kg</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty>Nothing waiting for assignment.</Empty>}
      </Card>
    </Shell>
  );
}
