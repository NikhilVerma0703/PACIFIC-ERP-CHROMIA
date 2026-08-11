import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { MastersNav } from "@/components/robo/masters/MastersNav";
import { DesignsMaster } from "@/components/robo/masters/DesignsMaster";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Designs | Pacific ERP" };

export default function RoboDesignsPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Designs</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Master list of robo designs. Expand a design to see the programs linked to it.
        </p>
      </div>
      <MastersNav active="designs" />
      <DesignsMaster />
    </Shell>
  );
}
