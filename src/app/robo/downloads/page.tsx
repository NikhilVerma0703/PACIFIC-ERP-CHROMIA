import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { DownloadsClient } from "@/components/robo/DownloadsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Downloads | Pacific ERP" };

export default function RoboDownloadsPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Downloads</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Slab record exports, a design&rsquo;s last run, and what QC did with a batch.
        </p>
      </div>
      <DownloadsClient />
    </Shell>
  );
}
