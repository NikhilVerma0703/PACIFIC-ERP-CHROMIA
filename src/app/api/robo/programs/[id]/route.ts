import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await prisma.roboProgram.update({ where: { id }, data: await req.json() });
  return NextResponse.json(data);
}

/**
 * Deletes a program on the same terms as a design: refused while any slab was
 * produced under a setup that names it, allowed when the only thing pointing
 * at it is an empty setup — which is unlinked rather than removed.
 *
 * The old rule refused on any referencing setup, which meant a program typed
 * once by mistake into a batch setup could never be removed from the master
 * list: the setup that pinned it sits on a shift that has since closed, and
 * nothing in the module can reach it to clear the reference.
 */
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const setups = await prisma.roboBatchRecipe.findMany({ where: { programId: id }, select: { id: true } });
  const setupIds = setups.map((s) => s.id);

  const slabs = setupIds.length
    ? await prisma.roboProductionRecord.count({ where: { batchRecipeId: { in: setupIds } } })
    : 0;

  if (slabs > 0) {
    return NextResponse.json(
      { error: `This program is used by ${slabs} slab record${slabs === 1 ? "" : "s"}. Delete ${slabs === 1 ? "it" : "them"} from Slabs Records first.` },
      { status: 409 },
    );
  }

  await prisma.$transaction([
    prisma.roboBatchRecipe.updateMany({ where: { programId: id }, data: { programId: null } }),
    prisma.roboProgram.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true, unlinkedSetups: setupIds.length });
}
