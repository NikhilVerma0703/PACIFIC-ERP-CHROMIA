// The route sheet for one piece: which stations it visits, in what order.
//
// WHY THIS IS A LIB. Three places built this list inline — release-project,
// the cutting complete-job handler, and admin/fix-cascade — and they did not
// agree. Two of them incremented `sequence` only inside the sink branch, so a
// polish-only piece got POLISHING = 2 *and* PACKAGING = 2, and a polish+sink
// piece got POLISHING = 2 *and* SINK_CUTTING = 2. FabPieceOperation has no
// @@unique([pieceId, sequence]) (schema.prisma:2324), so nothing threw: the
// duplicate route was written and stayed there. Anything that later orders a
// piece's operations by `sequence` gets an arbitrary order out of it.
//
// The order itself is the production rule: cut the piece, polish its edges,
// cut the sink hole, hand-finish (fabricate) that hole, then pack. Fabrication
// is the outsourced polish of the sink cutout, so it can only follow the sink
// cut — see requirement-derive.ts, where fabricationRequired === sinkRequired.
//
// The FLAGS are what changed under this function, not the order. Newly released
// pieces always arrive with polishRequired true (every piece is edge-polished
// now) and with sinkRequired set per piece rather than per requirement — only
// the first N pieces of a row carry the supervisor's sink. The polish-less
// branch below stays because admin/fix-cascade replays route sheets for rows
// created under the old rules, and those really do have polishRequired false.

export type FabOperationTypeName =
  | "CUTTING"
  | "POLISHING"
  | "SINK_CUTTING"
  | "FABRICATION"
  | "PACKAGING";

export interface PieceOperationFlags {
  polishRequired?: boolean | null;
  sinkRequired?: boolean | null;
  fabricationRequired?: boolean | null;
}

export interface PlannedPieceOperation {
  operationType: FabOperationTypeName;
  sequence: number;
}

/**
 * The stations a piece must pass through, numbered 1..n with no gaps and no
 * repeats. CUTTING is always first and PACKAGING is always last — every piece
 * is cut and every piece is packed.
 */
export function planPieceOperations(flags: PieceOperationFlags): PlannedPieceOperation[] {
  const ops: PlannedPieceOperation[] = [];
  let seq = 1;
  const push = (operationType: FabOperationTypeName) => ops.push({ operationType, sequence: seq++ });

  push("CUTTING");
  if (flags.polishRequired) push("POLISHING");
  if (flags.sinkRequired) push("SINK_CUTTING");
  if (flags.fabricationRequired) push("FABRICATION");
  push("PACKAGING");

  return ops;
}
