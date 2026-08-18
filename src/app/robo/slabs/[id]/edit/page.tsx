import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/prisma";
import { RoboEntryForm } from "@/components/robo/RoboEntryForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit Slab | Pacific ERP" };

/**
 * Edit any slab record, from any shift — INCLUDING shifts that are already
 * closed. That is the point of the page: the robo entry form only ever reaches
 * the active shift, so before this existed a slab logged wrong could not be
 * corrected at all once its shift rolled over, and the only remedy would have
 * been to delete and re-enter it.
 *
 * It mounts the same RoboEntryForm the operator fills in, in edit mode, so the
 * fields, the delay logging and the validation behave identically; only the
 * way in is different.
 */
export default async function EditRoboSlabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Resolved here rather than in the client so a missing slab is a real 404
  // page, and so the heading is right on first paint instead of after a fetch.
  const record = await prisma.roboProductionRecord.findUnique({
    where: { id },
    select: { slabNumber: true, shift: { select: { shiftNumber: true, date: true, status: true } } },
  });
  if (!record) notFound();

  return (
    <Shell>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/robo/slabs/${id}`} className="text-sm text-gray-400 hover:text-gray-600">← Complete Details</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Edit slab {record.slabNumber}</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Shift {record.shift?.shiftNumber} · {record.shift?.date}
          {record.shift?.status === "CLOSED" ? " · this shift is closed — the correction still saves" : ""}
        </p>
      </div>
      <div className="max-w-4xl">
        <RoboEntryForm recordId={id} />
      </div>
    </Shell>
  );
}
