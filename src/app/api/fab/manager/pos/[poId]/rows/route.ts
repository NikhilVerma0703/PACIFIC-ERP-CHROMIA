// GET  /api/fab/manager/pos/[poId]/rows
// POST /api/fab/manager/pos/[poId]/rows
// List and add piece rows on an already-imported PO.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { PO_REQUIREMENT_SLAB_CODE } from "@/lib/fab/poParser";
import { deriveRoutingFlags } from "@/lib/fab/requirement-derive";
import { parseRequirementRowInput, rowSqft } from "@/lib/fab/requirementRow";
import { nextRowLetter } from "@/lib/fab/pieceNaming";

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
      rowLetter: true,
      length: true,
      width: true,
      quantity: true,
      // The sink decision now STARTS HERE rather than on the shop floor, and a
      // partial SPLITS the row in two — see rows/[id]/sink. The screen needs the
      // current count both to draw the control and to plan a split with the same
      // module the route uses, so the button and the server cannot disagree.
      sinkQuantity: true,
      totalSqft: true,
      notes: true,
      allocations: { select: { allocatedQuantity: true } },
      _count: { select: { pieces: true } },
    },
  });

  // HAND EDGE POLISH AND SHAPE — read raw, and the same way the CEO route and
  // the supervisor board read them.
  //
  // The owner put this decision beside the sink: "we choose the sink, there
  // itself we need to choose the edge polish." Both columns arrived after the
  // Prisma client this deploy may be running (0055 and 0063), so a typed read
  // would take the whole order screen down over two fields that only feed a
  // price. A missing column means "not chosen" and "rectangle", which is what
  // an unmigrated database honestly holds.
  //
  // THE THICKNESS COMES WITH THEM, from whatever slab the row is on. The rate
  // card is keyed on the STONE (2 cm ₹15/ft, 3 cm ₹20/ft), and a row not yet
  // given a slab has no thickness and therefore no rate — the board shows the
  // feet and says the rate follows, rather than guessing at one. MAX rather
  // than an arbitrary pick, so the answer is stable across refreshes.
  const edges = new Map<string, {
    finishedEdges: string | null; shapeType: string | null; edgeFaces: string | null; thicknessMm: number | null;
  }>();
  if (rows.length) {
    try {
      const ids = rows.map(r => r.id);
      const raw = await prisma.$queryRaw<Array<{
        id: string; finished_edges: string | null; shape_type: string | null; edge_faces: string | null; thickness: number | null;
      }>>`
        SELECT r.id, r.finished_edges, r.shape_type::text AS shape_type, r.edge_faces,
               MAX(s.thickness) AS thickness
        FROM   fab_requirement r
        LEFT   JOIN fab_requirement_allocation ra ON ra.requirement_id = r.id
        LEFT   JOIN fab_slab s ON s.id = ra.slab_id
        WHERE  r.id = ANY(${ids}::text[])
        GROUP  BY r.id
      `;
      for (const r of raw) {
        edges.set(r.id, {
          finishedEdges: r.finished_edges ?? null,
          shapeType: r.shape_type ?? null,
          edgeFaces: r.edge_faces ?? null,
          thicknessMm: r.thickness == null ? null : Number(r.thickness),
        });
      }
    } catch {
      // 0055 / 0063 not applied yet.
    }
  }

  return Response.json({
    rows: rows.map(r => {
      const allocatedQty = r.allocations.reduce((s, a) => s + a.allocatedQuantity, 0);
      const edge = edges.get(r.id);
      return {
        id: r.id,
        pieceLabel: r.pieceLabel,
        // The row's LETTER — what every piece cut from it is named after
        // ({projectCode}-{LETTER}-{n}). Null for rows imported before 0054.
        rowLetter: r.rowLetter,
        length: r.length,
        width: r.width,
        quantity: r.quantity,
        /** fab_requirement.sink_quantity. NULL = nobody has decided, which is a
         *  different fact from 0 and is drawn differently. After a split a row
         *  is homogeneous: this is either 0 or equal to quantity. */
        sinkQuantity: r.sinkQuantity,
        totalSqft: r.totalSqft,
        notes: r.notes,
        /** fab_requirement.finished_edges — which edges get HAND polish, the
         *  running-foot job. NULL = nobody has marked them, which is NOT the
         *  same as "no edges" and is drawn differently. Independent of the sink
         *  since scripts/0063. */
        finishedEdges: edge?.finishedEdges ?? null,
        /** RECTANGLE / CIRCLE / OVAL. Null is a rectangle. A CIRCLE keeps its
         *  DIAMETER in `length`; an OVAL keeps a in `length`, b in `width`. */
        shapeType: edge?.shapeType ?? null,
        /** TOP / BOTTOM / BOTH. NULL means TOP — see scripts/0065. BOTH doubles
         *  the running feet, because it is the same line walked twice. */
        edgeFaces: edge?.edgeFaces ?? null,
        /** MILLIMETRES of the stone this row is on, or null before it has one.
         *  Decides the edge rate; null means the feet show and the charge waits. */
        thicknessMm: edge?.thicknessMm ?? null,
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
    // A HAND-ADDED ROW NEEDS A LETTER TOO.
    //
    // Without one its pieces fall back to a letter derived from the row's
    // POSITION, which can land on a letter another row already stores — and two
    // rows sharing a letter means two piece codes that collide on a UNIQUE
    // column, so the send fails rather than merely mislabelling.
    //
    // Read INSIDE the transaction so two managers adding a row at the same
    // moment cannot both read the same maximum and be handed the same letter.
    let taken: string[] = [];
    try {
      const used = await tx.$queryRaw<Array<{ row_letter: string | null }>>`
        SELECT row_letter FROM fab_requirement
        WHERE project_id = ${po.projectId} AND row_letter IS NOT NULL
        FOR UPDATE
      `;
      taken = used.map(u => u.row_letter).filter((l): l is string => !!l);
    } catch {
      taken = [];   // scripts/0054 not applied — the row keeps its label only
    }

    const created = await tx.fabRequirement.create({
      data: {
        projectId: po.projectId,
        poId: po.id,
        pieceLabel: v.pieceLabel,
        rowLetter: nextRowLetter(taken),
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
