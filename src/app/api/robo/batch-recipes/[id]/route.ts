import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEditRoboSetup, roboGate } from "@/lib/rbac";
import {
  carryEntryNotes,
  entryCreateData,
  rebuildsEntries,
  setupScalarData,
  type SetupEntryInput,
} from "@/lib/robo/setupMasters";
import { registerTypedMasters, resolveDesignId } from "@/lib/robo/setupMastersDb";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await params;
  const data = await prisma.roboBatchRecipe.findUnique({
    where: { id },
    include: {
      design: true,
      program: true,
      entries: { include: { machine: true } },
      productionRecords: true,
    },
  });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

/**
 * Updates a production setup IN PLACE.
 *
 * Reopening the setup and saving it corrects the run the shift is already on —
 * it does not start a second one. That matters because every slab of the shift
 * points at this setup: replacing the row would leave those slabs attached to a
 * setup nobody can see any more, and would leave the design linked to a spare
 * setup that then blocks the design from ever being deleted.
 *
 * ── Verified against this schema and this database, not assumed ───────────
 * The per-machine rows are rebuilt rather than matched up one by one, since a
 * machine can be ticked or unticked between saves. That is only safe because
 * nothing points AT a RoboBatchRecipeEntry: its two relations
 * (RoboBatchRecipe.entries, RoboMachine.recipeEntries) are back-relations of
 * foreign keys that live on the entry itself, so deleting one strands nothing.
 * Confirmed twice, the way the slab-delete port had to confirm it — every
 * Robo* model in schema.prisma, and information_schema in Neon, which lists
 * no inbound foreign key on the table at all.
 *
 * The rows that DO reference this setup are RoboProductionRecord.batchRecipeId
 * — the slabs of the shift in progress. They are not read, written or deleted
 * here: the setup keeps its id, so every slab stays attached to it, in-process
 * ones included.
 *
 * That is not a nicety. The constraint in Neon is ON DELETE SET NULL (checked
 * against the live database, not inferred from schema.prisma), so replacing
 * the setup instead of editing it would not fail loudly — Postgres would
 * quietly blank batchRecipeId on every slab of the shift, and each one would
 * come back with no design, no machines and no target cycle times, with
 * nothing anywhere to say what it had been logged against. Upstream's note
 * calls this "attached to a setup nobody can see any more"; here it is worse
 * than that, because the link is not stale, it is gone.
 *
 * What the slabs MEAN does shift, and deliberately so: the In/Out labels and
 * the → chain a slab shows are read live from the setup's entries, so
 * unticking a robot restates which machines that shift ran on. That is what
 * correcting a setup means, and it is why this is a correction of one run
 * rather than the start of another.
 *
 * `shiftId` is never taken from the body — see setupScalarData.
 *
 * A body with no `entries` array is treated as the older notes-only update —
 * see rebuildsEntries for why that contract is kept even though no ERP screen
 * sends it any more.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const refused = await roboGate();
  if (refused) return refused;
  const { id } = await params;
  const body = await req.json();

  // Gated here and not in middleware: middleware matches on path prefix and
  // cannot tell this PATCH from the GET above. See canEditRoboSetup() for why
  // the ROBO tablet is admitted where the slab DELETE turns it away.
  if (!(await canEditRoboSetup())) {
    return NextResponse.json(
      { error: "You do not have permission to change a production setup." },
      { status: 403 },
    );
  }

  try {
    if (!rebuildsEntries(body)) {
      const data = await prisma.roboBatchRecipe.update({
        where: { id },
        data: { notes: body.notes },
      });
      return NextResponse.json(data);
    }

    const entries: SetupEntryInput[] = body.entries;

    // Outside the transaction on purpose: these are upserts into the shared
    // master lists, they are idempotent, and holding a write transaction open
    // across four sequential round trips to Neon is how a tablet save starts
    // timing out. Nothing below depends on them beyond designId.
    const designId = await resolveDesignId(body.designName);
    await registerTypedMasters(entries, designId);

    const updated = await prisma.$transaction(async (tx) => {
      // Read before deleting: `notes` on an entry is a column no screen in this
      // ERP sends, so rebuilding the rows from the request body alone erases it
      // — see carryEntryNotes(). Inside the transaction so the read cannot see
      // a state the write does not.
      const existing = await tx.roboBatchRecipeEntry.findMany({
        where: { batchRecipeId: id },
        select: { machineId: true, notes: true },
      });
      const notesByMachine = new Map(existing.map((e) => [e.machineId, e.notes]));

      await tx.roboBatchRecipeEntry.deleteMany({ where: { batchRecipeId: id } });
      return tx.roboBatchRecipe.update({
        where: { id },
        data: {
          designId:  designId,
          ...setupScalarData(body),
          entries:   { create: carryEntryNotes(entryCreateData(entries), notesByMachine) },
        },
        include: { entries: { include: { machine: true } } },
      });
    });

    return NextResponse.json(updated);
  } catch (err) {
    // A setup deleted in another tab, or an id that never existed. Worth its
    // own answer: the form would otherwise report "failed to save" for a setup
    // that is simply no longer there, and the operator would keep retrying.
    if ((err as { code?: string })?.code === "P2025") {
      return NextResponse.json({ error: "This production setup no longer exists." }, { status: 404 });
    }
    console.error("RoboBatchRecipe PATCH error:", err);
    return NextResponse.json({ error: "Failed to update production setup" }, { status: 500 });
  }
}
