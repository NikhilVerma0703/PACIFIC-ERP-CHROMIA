import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await prisma.roboDesign.update({ where: { id }, data: await req.json() });
  return NextResponse.json(data);
}

/**
 * Deletes a design, but never at the cost of production history.
 *
 * A design is reachable from a slab only through its batch setup, so the
 * question that decides this is whether any slab was ever recorded under one
 * of this design's setups. If so the delete is refused and the operator must
 * clear those slab records first.
 *
 * A setup with NO slabs is a different matter, and this is the whole point of
 * the rule: it is a run that was configured and then abandoned, and once its
 * shift is closed no screen in the module can reach it. Refusing on those —
 * which is what this route used to do, blocking on any referencing setup at
 * all — made a design permanently undeletable, because a design is almost
 * always created by typing it INTO a batch setup in the first place. Every
 * mistyped design name was therefore stuck in the master list forever. Empty
 * setups are unlinked instead (the setup row and its recorded machine
 * settings stay exactly where they are) and the design goes.
 *
 * Programs are still a hard block: they are a named list under the design
 * that the operator can see and delete themselves, so silently orphaning them
 * would lose information the empty-setup case does not.
 */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const setups = await prisma.roboBatchRecipe.findMany({ where: { designId: id }, select: { id: true } });
  const setupIds = setups.map((s) => s.id);

  const slabs = setupIds.length
    ? await prisma.roboProductionRecord.count({ where: { batchRecipeId: { in: setupIds } } })
    : 0;

  if (slabs > 0) {
    return NextResponse.json(
      { error: `This design is used by ${slabs} slab record${slabs === 1 ? "" : "s"}. Delete ${slabs === 1 ? "it" : "them"} from Slabs Records first.` },
      { status: 409 },
    );
  }

  const programs = await prisma.roboProgram.count({ where: { designId: id } });
  if (programs > 0) {
    return NextResponse.json(
      { error: `This design still has ${programs} program${programs === 1 ? "" : "s"} under it. Delete ${programs === 1 ? "it" : "them"} from Master Lists → Programs first.` },
      { status: 409 },
    );
  }

  // Unlink and delete together: a half-done cleanup would leave setups
  // pointing at a design row that no longer exists.
  await prisma.$transaction([
    prisma.roboBatchRecipe.updateMany({ where: { designId: id }, data: { designId: null } }),
    prisma.roboDesign.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true, unlinkedSetups: setupIds.length });
}
