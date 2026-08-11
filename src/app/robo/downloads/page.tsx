import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { DownloadsClient } from "@/components/robo/DownloadsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Download Records | Pacific ERP" };

export default function RoboDownloadsPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Download Records</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Export robo production and delay records to Excel for the selected date filter.
        </p>
      </div>
      <DownloadsClient />
    </Shell>
  );
}
