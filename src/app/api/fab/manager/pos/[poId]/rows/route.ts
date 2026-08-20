// GET  /api/fab/manager/pos/[poId]/rows
// POST /api/fab/manager/pos/[poId]/rows
// List and add piece rows on an already-imported PO.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { PO_REQUIREMENT_SLAB_CODE } from "@/lib/fab/poParser";
import { deriveRoutingFlags } from "@/lib/fab/requirement-derive";
import { parseRequirementRowInput, rowSqft } from "@/lib/fab/requirementRow";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ poId: string }> },
) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  const { poId } = await params;
  const po = await prisma.fabPo.findUnique({
    where: { id: poId },
    select: { id: true, pdfImportedAt: true },
  });
  if (!po) return Response.json({ error: "That purchase order no longer exists." }, { status: 404 });
  if (!po.pdfImportedAt) return Response.json({ rows: [] });

  const rows = await prisma.fabRequirement.findMany({
    where: { poId: po.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      pieceLabel: true,
      length: true,
      width: true,
      quantity: true,
      totalSqft: true,
      notes: true,
      allocations: { select: { allocatedQuantity: true } },
      _count: { select: { pieces: true } },
    },
  });

  return Response.json({
    rows: rows.map(r => {
      const allocatedQty = r.allocations.reduce((s, a) => s + a.allocatedQuantity, 0);
      return {
        id: r.id,
        pieceLabel: r.pieceLabel,
        length: r.length,
        width: r.width,
        quantity: r.quantity,
        totalSqft: r.totalSqft,
        notes: r.notes,
        allocatedQty,
        pieceCount: r._count.pieces,
        locked: r._count.pieces > 0,
      };
    }),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ poId: string }> },
) {
  const g = await fabGate("MANAGER");
  if (!g.ok) {
    return Response.json(
      { error: g.status === 401 ? "Your session has ended — sign in again." : "Not authorized" },
      { status: g.status },
    );
  }

  const { poId } = await params;
  const parsed = parseRequirementRowInput(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  if (v.pieceLabel == null || v.lengthIn == null || v.widthIn == null || v.quantity == null) {
    return Response.json({ error: "Label, length, width and quantity are required." }, { status: 400 });
  }
  // Pinned to a local because the guard above narrows a PROPERTY, and TypeScript
  // discards that narrowing inside the transaction callback below — the object could
  // in principle be mutated before the closure runs. parseRequirementRowInput returns
  // Partial<RequirementRowFields>, so without this the create() sees number|undefined.
  const quantity = v.quantity;

  const po = await prisma.fabPo.findUnique({
    where: { id: poId },
    select: { id: true, projectId: true, pdfImportedAt: true },
  });
  if (!po) return Response.json({ error: "That purchase order no longer exists." }, { status: 404 });
  if (!po.pdfImportedAt) {
    return Response.json({ error: "Upload the PDF first, then add or change rows." }, { status: 409 });
  }

  const flags = deriveRoutingFlags({ sinkQuantity: null });
  const sq = rowSqft(v.lengthIn, v.widthIn, v.quantity);

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.fabRequirement.create({
      data: {
        projectId: po.projectId,
        poId: po.id,
        pieceLabel: v.pieceLabel,
        slabCode: PO_REQUIREMENT_SLAB_CODE,
        length: v.lengthIn,
        width: v.widthIn,
        quantity,
        sqftPerPiece: sq.sqftPerPiece,
        totalSqft: sq.totalSqft,
        notes: v.notes ?? null,
        sinkRequired: flags.sinkRequired,
        fabricationRequired: flags.fabricationRequired,
        polishRequired: flags.polishRequired,
      },
    });
    await tx.fabProject.update({
      where: { id: po.projectId },
      data: { numberOfPieces: { increment: quantity } },
    });
    return created;
  });

  return Response.json({ success: true, id: row.id });
}
