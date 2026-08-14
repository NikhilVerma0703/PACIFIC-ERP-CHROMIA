import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { SlabsBrowser } from "@/components/robo/SlabsBrowser";
import { canDeleteRoboSlab } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Slabs Records | Pacific ERP" };

export default async function RoboSlabsPage() {
  // See /robo/page.tsx — a courtesy hide, not the control.
  const canDelete = await canDeleteRoboSlab();
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Slabs Records</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Browse robo production records — filter by date, slab number or design, then open a slab for its complete details.
        </p>
      </div>
      <SlabsBrowser canDelete={canDelete} />
    </Shell>
  );
}
