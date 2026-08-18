import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { MastersNav } from "@/components/robo/masters/MastersNav";
import { ProgramsMaster } from "@/components/robo/masters/ProgramsMaster";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Programs | Pacific ERP" };

export default function RoboProgramsPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Programs</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Master list of robo programs. Each program belongs to a design.
        </p>
      </div>
      <MastersNav active="programs" />
      <ProgramsMaster />
    </Shell>
  );
}
