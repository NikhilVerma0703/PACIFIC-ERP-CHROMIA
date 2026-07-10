import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Card, Empty } from "@/components/ui";
import { canManageRm } from "@/lib/rbac";
import { listUnassignedPool } from "@/app/store/actions";
import { RmUpload } from "@/components/RmUpload";

export const dynamic = "force-dynamic";

export default async function RmUploadPage() {
  if (!(await canManageRm())) notFound();
  const pool = await listUnassignedPool();
  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">RM upload — unassigned pool</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">Upload your grit &amp; filler invoices as Excel. Re-uploading the same growing file only adds new invoice lines — existing ones are left exactly as they are, so balances are never overwritten. Bags are assigned later from the Assignment page.</p>
      </div>
      <RmUpload />
      <Card className="mt-6">
        <div className="mb-3 text-sm font-semibold text-gray-800">Current unassigned pool ({pool.length} line{pool.length === 1 ? "" : "s"})</div>
        {pool.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500"><th className="py-2 pr-4">Invoice</th><th className="py-2 pr-4">Type</th><th className="py-2 pr-4">Size</th><th className="py-2 pr-4">Grade</th><th className="py-2 pr-4">Supplier</th><th className="py-2 pr-4 text-right">Total</th><th className="py-2 pr-4 text-right">Assigned</th><th className="py-2 pr-4 text-right">Remaining</th></tr></thead>
              <tbody>{pool.map((p) => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="py-2 pr-4 font-medium text-gray-900">{p.invNo}</td><td className="py-2 pr-4">{p.type}</td><td className="py-2 pr-4">{p.size}</td><td className="py-2 pr-4">{p.grade}</td><td className="py-2 pr-4 text-gray-500">{p.supplier ?? "—"}</td>
                  <td className="py-2 pr-4 text-right">{p.totalKg.toLocaleString("en-IN")}</td><td className="py-2 pr-4 text-right text-gray-500">{p.assignedKg.toLocaleString("en-IN")}</td>
                  <td className={`py-2 pr-4 text-right font-semibold ${p.remainingKg > 0 ? "text-amber-700" : "text-gray-400"}`}>{p.remainingKg.toLocaleString("en-IN")} kg</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty>No invoices uploaded yet.</Empty>}
      </Card>
    </Shell>
  );
}
