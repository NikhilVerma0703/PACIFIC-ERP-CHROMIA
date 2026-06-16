import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { Empty } from "@/components/ui";
import { canManageRm } from "@/lib/rbac";
import { listUnassignedPool } from "@/app/store/actions";
import { RmAssign } from "@/components/RmAssign";

export const dynamic = "force-dynamic";

export default async function RmAssignPage() {
  if (!(await canManageRm())) notFound();
  const lines = await listUnassignedPool(true); // only lines with remaining to assign
  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">RM assignment — bags to invoice</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">When a silo operator needs bags, pick the invoice line, enter the bag numbers and weights you&apos;re handing over, and confirm. Each bag&apos;s weight is deducted from that invoice&apos;s remaining pool, and the bags then appear in the silo dump form.</p>
      </div>
      {lines.length ? <RmAssign lines={lines} /> : <Empty>No unassigned RM with remaining balance. Upload invoices first.</Empty>}
    </Shell>
  );
}
