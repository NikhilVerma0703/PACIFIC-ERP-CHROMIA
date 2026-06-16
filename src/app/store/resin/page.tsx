import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { canManageRm } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { RmResinEntry, RmResinUpload } from "@/components/RmResinIntake";

export const dynamic = "force-dynamic";

export default async function ResinIntakePage() {
  if (!(await canManageRm())) notFound();
  let tanks: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (prisma as any).$queryRaw`SELECT DISTINCT tank_no FROM resin_storage WHERE tank_no IS NOT NULL ORDER BY 1`;
    tanks = rows.map((r) => String(r.tank_no));
  } catch { /* fresh table */ }
  return (
    <Shell>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Resin intake — storage tanks</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">Tanker deliveries into the resin storage tanks. Day-tank preparations draw from these and are entered by the Line Manager from Data Entry.</p>
      </div>
      <div className="space-y-6">
        <RmResinEntry tanks={tanks} />
        <RmResinUpload />
      </div>
    </Shell>
  );
}
