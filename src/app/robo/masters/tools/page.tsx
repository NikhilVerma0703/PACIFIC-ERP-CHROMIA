import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { MastersNav } from "@/components/robo/masters/MastersNav";
import { SimpleListMaster } from "@/components/robo/masters/SimpleListMaster";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tools | Pacific ERP" };

export default function RoboToolsPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Tools</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Master list of robo tools used in batch setup.
        </p>
      </div>
      <MastersNav active="tools" />
      <SimpleListMaster endpoint="tools" emptyText="No tools yet." />
    </Shell>
  );
}
