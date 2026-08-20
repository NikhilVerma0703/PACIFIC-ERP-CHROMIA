// PATCH  /api/fab/manager/pos/rows/[id]
// DELETE /api/fab/manager/pos/rows/[id]
// Edit or remove one imported piece row. Rows already sent to cutting are locked.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { resolveSinkQuantity } from "@/lib/fab/requirement-derive";
import { parseRequirementRowInput, rowSqft } from "@/lib/fab/requirementRow";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  const { id } = await params;
  const parsed = parseRequirementRowInput(await req.json().catch(() => null), { partial: true });
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const patch = parsed.value;

  const existing = await prisma.fabRequirement.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      poId: true,
      pieceLabel: true,
      length: true,
      width: true,
      quantity: true,
      notes: true,
      sinkQuantity: true,
      allocations: { select: { allocatedQuantity: true } },
      _count: { select: { pieces: true } },
      po: { select: { pdfImportedAt: true } },
    },
  });
  if (!existing?.poId) return Response.json({ error: "That row no longer exists." }, { status: 404 });
  if (!existing.po?.pdfImportedAt) {
    return Response.json({ error: "Upload the PDF first, then change rows." }, { status: 409 });
  }
  if (existing._count.pieces > 0 && (patch.lengthIn != null || patch.widthIn != null || patch.quantity != null || patch.pieceLabel != null)) {
    return Response.json(
      { error: "This row has already been sent to cutting. Only notes can still be changed." },
      { status: 409 },
    );
  }

  const allocatedQty = existing.allocations.reduce((s, a) => s + a.allocatedQuantity, 0);
  const nextQty = patch.quantity ?? existing.quantity;
  if (patch.quantity != null && nextQty < allocatedQty) {
    return Response.json(
      { error: `Quantity cannot go below ${allocatedQty} — that many are already on a slab.` },
      { status: 409 },
    );
  }

  const lengthIn = patch.lengthIn ?? existing.length ?? 0;
  const widthIn = patch.widthIn ?? existing.width ?? 0;
  const sq = rowSqft(lengthIn, widthIn, nextQty);
  const qtyDelta = nextQty - existing.quantity;

  await prisma.$transaction(async (tx) => {
    await tx.fabRequirement.update({
      where: { id },
      data: {
        ...(patch.pieceLabel != null ? { pieceLabel: patch.pieceLabel } : {}),
        ...(patch.lengthIn != null ? { length: patch.lengthIn } : {}),
        ...(patch.widthIn != null ? { width: patch.widthIn } : {}),
        ...(patch.quantity != null ? { quantity: patch.quantity } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        sqftPerPiece: sq.sqftPerPiece,
        totalSqft: sq.totalSqft,
        ...(existing.sinkQuantity != null ? { sinkQuantity: resolveSinkQuantity(existing.sinkQuantity, nextQty) } : {}),
      },
    });
    if (qtyDelta !== 0) {
      await tx.fabProject.update({
        where: { id: existing.projectId },
        data: { numberOfPieces: { increment: qtyDelta } },
      });
    }
  });

  return Response.json({ success: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  const { id } = await params;
  const existing = await prisma.fabRequirement.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      poId: true,
      quantity: true,
      allocations: { select: { id: true } },
      _count: { select: { pieces: true } },
      po: { select: { pdfImportedAt: true } },
    },
  });
  if (!existing?.poId) return Response.json({ error: "That row no longer exists." }, { status: 404 });
  if (!existing.po?.pdfImportedAt) {
    return Response.json({ error: "Upload the PDF first, then change rows." }, { status: 409 });
  }
  if (existing._count.pieces > 0) {
    return Response.json({ error: "This row has already been sent to cutting and cannot be deleted." }, { status: 409 });
  }
  if (existing.allocations.length > 0) {
    return Response.json({ error: "Take this row off the slab board first, then delete it." }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.fabRequirement.delete({ where: { id } });
    await tx.fabProject.update({
      where: { id: existing.projectId },
      data: { numberOfPieces: { increment: -existing.quantity } },
    });
  });

  return Response.json({ success: true });
}
