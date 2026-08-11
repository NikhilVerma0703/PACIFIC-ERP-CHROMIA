import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { MastersNav } from "@/components/robo/masters/MastersNav";
import { OperatorsMaster } from "@/components/robo/masters/OperatorsMaster";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operators | Pacific ERP" };

export default function RoboOperatorsPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Operators</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Master list of robo line operators. Deactivate instead of deleting to preserve history.
        </p>
      </div>
      <MastersNav active="operators" />
      <OperatorsMaster />
    </Shell>
  );
}
