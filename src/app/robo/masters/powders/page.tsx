import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { MastersNav } from "@/components/robo/masters/MastersNav";
import { SimpleListMaster } from "@/components/robo/masters/SimpleListMaster";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Powders | Pacific ERP" };

export default function RoboPowdersPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Powders</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Master list of robo powders used in batch recipes.
        </p>
      </div>
      <MastersNav active="powders" />
      <SimpleListMaster endpoint="powders" emptyText="No powders yet." />
    </Shell>
  );
}
