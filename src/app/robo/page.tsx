import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { RoboEntryForm } from "@/components/robo/RoboEntryForm";
import { canDeleteRoboSlab } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Robo Entry | Pacific ERP" };

export default async function RoboPage() {
  // Resolved on the server so the tablet never renders a Delete it cannot use.
  // The gate that matters is in the route handler, not here.
  const canDelete = await canDeleteRoboSlab();
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Robo entry</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Batch setup and slab logging for the robo line (Distributor/Kreos → Robo → Press).
          Robo doesn’t run in every production — when it does, save a batch setup once and log slabs against it.
        </p>
      </div>
      <RoboEntryForm canDelete={canDelete} />
    </Shell>
  );
}
