import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { MastersNav } from "@/components/robo/masters/MastersNav";
import { SimpleListMaster } from "@/components/robo/masters/SimpleListMaster";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Liquids | Pacific ERP" };

export default function RoboLiquidsPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Liquids</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Master list of robo liquids used in batch recipes.
        </p>
      </div>
      <MastersNav active="liquids" />
      <SimpleListMaster endpoint="liquids" emptyText="No liquids yet." />
    </Shell>
  );
}
