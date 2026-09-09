// THE HAND BENCH QUEUE.
//
// TWO JOBS ARRIVE HERE, and until scripts/0063 only one of them could:
//
//   SINK POLISH   the hand-finish of a sink cutout. Follows the sink cut, which
//                 is why the OR below waits for sink_completed.
//   EDGE POLISH   hand polish along the piece's edges, chosen per row. A piece
//                 can have it with NO sink at all — the `hasSink: false` branch.
//
// The queue admitted both from the day the flag was split, because
// fabrication_required became `has_sink OR has_edge_polish`. What it did not do
// was SAY WHICH, and the card showed a Sink Model column that reads "—" for an
// edge-only piece. The man was told to go to the bench and not what to do there.
//
// So the row's edge selection is read and sent with the piece. It lives on
// fab_requirement (per row — every piece of a row gets the same treatment), and
// it is read RAW for the same reason the CEO route and the supervisor board read
// it raw: finished_edges arrived in scripts/0055 and shape_type may predate a
// deploy's Prisma client. A missing column leaves every piece reading "not
// marked", which is what an unmigrated database honestly holds — it must not
// take the queue down.

import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";
import { attachQueueActivity } from "@/lib/fab/queueActivity";
import { isDroppedFromQueues } from "@/lib/fab/rejectPiece";
// parseEdges/describeEdges are gone with the single-selection label above —
// rowFaceEdges and describeFaceEdges read all three faces instead.
import { rowFaceEdges, rowHasHandPolish, describeFaceEdges } from "@/lib/fab/shape";

export async function GET() {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const pieces = await prisma.fabPiece.findMany({
    where: {
      fabricationRequired: true,
      fabricationCompleted: false,
      status: { not: "PENDING" },
      OR: [
        { hasSink: false },
        { hasSink: true, sinkCompleted: true },
      ],
    },
    include: {
      project: { select: { projectCode: true, customerName: true } },
      drawing: { select: { drawingNumber: true } },
      requirement: { select: { pieceLabel: true, rowLetter: true, po: { select: { poNumber: true } }, description: true, length: true, width: true, dimUnit: true, sinkModel: true } },
      slab: { select: { slabCode: true, colour: true } },
      pieceOperations: { select: { operationType: true, isCompleted: true, completedAt: true } },
    },
  });

  const live = pieces.filter(p => !isDroppedFromQueues(p.status));

  // ---- WHICH EDGES, per row ------------------------------------------------
  const reqIds = [...new Set(live.map(p => p.requirementId).filter((id): id is string => !!id))];
  const edgeByReq = new Map<string, { label: string; hasEdgeWork: boolean }>();
  if (reqIds.length) {
    try {
      // ALL FIVE COLUMNS. This selected finished_edges alone — the pre-0067
      // selection — so a row specified with the three-face controls (which
      // leave it NULL) reached the bench labelled "not marked" with
      // edgeWork false. The fabricator was handed the piece and told there was
      // nothing to do to it, on a row the invoice was charging for.
      const rows = await prisma.$queryRaw<Array<{
        id: string; finished_edges: string | null; shape_type: string | null;
        edge_faces: string | null;
        edges_top: string | null; edges_bottom: string | null; edges_side: string | null;
      }>>`
        SELECT id, finished_edges, shape_type::text AS shape_type, edge_faces,
               edges_top, edges_bottom, edges_side
        FROM   fab_requirement WHERE id = ANY(${reqIds}::text[])
      `;
      for (const r of rows) {
        const row = {
          shapeType: r.shape_type,
          finishedEdges: r.finished_edges,
          edgeFaces: r.edge_faces,
          edgesTop: r.edges_top,
          edgesBottom: r.edges_bottom,
          edgesSide: r.edges_side,
        };
        const faces = rowFaceEdges(row);
        // NOTHING STORED AT ALL is "not marked" — nobody has decided. An
        // explicit empty specification is a decision and reads as "None".
        const untouched = r.finished_edges === null
          && r.edges_top === null && r.edges_bottom === null && r.edges_side === null;
        edgeByReq.set(r.id, {
          // THREE FACES, NAMED — "top all four · bottom left + right". The same
          // vocabulary the picker and the CEO board use, from one function, so
          // the bench and the invoice cannot describe one row two ways. It used
          // to be describeEdges, which can only say ONE selection and so could
          // not tell the bench that the underside is polished too.
          label: untouched ? "not marked" : describeFaceEdges(r.shape_type, faces),
          hasEdgeWork: rowHasHandPolish(row),
        });
      }
    } catch {
      // scripts/0055 / 0063 not applied — every piece reads as not marked.
    }
  }

  return Response.json(attachQueueActivity(
    live.map(p => {
      const e = p.requirementId ? edgeByReq.get(p.requirementId) : undefined;
      return {
        ...p,
        /** WHY THIS PIECE IS AT THE BENCH. Both can be true — a sink piece whose
         *  row also has polished edges is two jobs on one piece, and the card
         *  has to show both or he will do one and move on. */
        edgeWork: e?.hasEdgeWork ?? false,
        /** Which edges, in the picker's own words. "not marked" when nobody has
         *  chosen — different from "None", which is an answer. */
        edgeLabel: e?.label ?? "not marked",
      };
    }),
    "FABRICATION",
  ));
}
