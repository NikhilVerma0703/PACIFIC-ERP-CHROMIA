import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { ReportsClient } from "@/components/robo/reports/ReportsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Robo Reports | Pacific ERP" };

export default function RoboReportsPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Robo reports</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Production and downtime analysis for the robo line — slab output, machine downtime,
          delay types, and daily trends.
        </p>
      </div>
      <ReportsClient />
    </Shell>
  );
}
