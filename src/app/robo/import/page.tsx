import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { ImportClient } from "@/components/robo/ImportClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Import Register | Pacific ERP" };

export default function RoboImportPage() {
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Import production register</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Upload a “Complete Production” workbook to backfill robo shifts, setups and slab records.
          Preview first — nothing is written until you import.
        </p>
      </div>
      <ImportClient />
    </Shell>
  );
}
