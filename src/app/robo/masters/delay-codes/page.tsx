import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { MastersNav } from "@/components/robo/masters/MastersNav";
import { DelayCodesMaster } from "@/components/robo/masters/DelayCodesMaster";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Delay Codes | Pacific ERP" };

export default function RoboDelayCodesPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Delay codes</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Lettered delay-code categories matching the official DELAYS LIST sheet.
        </p>
      </div>
      <MastersNav active="delay-codes" />
      <DelayCodesMaster />
    </Shell>
  );
}
