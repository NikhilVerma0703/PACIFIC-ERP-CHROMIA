import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { SlabsBrowser } from "@/components/robo/SlabsBrowser";
import { canDeleteRoboSlab, isAdmin } from "@/lib/rbac";
import { lastUndoableFor } from "@/lib/actionLog";
import { UndoDeleteButton } from "./UndoDeleteButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Slabs Records | Pacific ERP" };

export default async function RoboSlabsPage() {
  // See /robo/page.tsx — a courtesy hide, not the control.
  const canDelete = await canDeleteRoboSlab();
  // The tablet can delete, so an admin must be able to put one back. Only the
  // most recent deletion is offered: this is an "that was a mistake, undo it"
  // control, not a recycle bin, and every older deletion is still in
  // action_log if one ever has to be recovered by hand.
  const admin = await isAdmin();
  const undoable = admin ? await lastUndoableFor("RoboProductionRecord") : null;
  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Slabs Records</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Browse robo production records — filter by Production Date, Batch No., Slab number or Design Name, then open a slab for its complete details.
        </p>
      </div>
      {undoable && (
        <UndoDeleteButton summary={undoable.summary} by={undoable.actor} at={undoable.createdAt} />
      )}
      <SlabsBrowser canDelete={canDelete} />
    </Shell>
  );
}
