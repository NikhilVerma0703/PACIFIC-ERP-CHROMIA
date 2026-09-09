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
// The order itself is the production rule: cut the piece, machine-polish it,
// cut the sink hole, hand-finish (fabricate) it, then pack.
//
// ─────────────────── FABRICATION NO LONGER MEANS "THE SINK'S POLISH" ────────
// It used to. requirement-derive.ts held `fabricationRequired === sinkRequired`
// on the reading that fabrication WAS the outsourced polish of the sink cutout,
// so it could only ever follow a sink cut.
//
// The owner separated the hand jobs (see lib/fab/pricing.ts): sink polish is
// implied by the sink cut and priced inside it, while HAND EDGE POLISH is
// chosen independently and charged by the running foot. Both are done at the
// same bench, so both are FABRICATION here — and a piece can now arrive with
// fabricationRequired true and sinkRequired FALSE. That combination was
// unreachable before and is ordinary now:
//
//     CUTTING -> POLISHING -> FABRICATION -> PACKAGING
//
// THIS FUNCTION NEEDED NO CHANGE FOR IT. It has always read the two flags
// independently; only its callers were coupling them. The order below is
// exactly what it was.
//
// The other FLAG note still holds: newly released pieces always arrive with
// polishRequired true (every piece is machine-polished now) and with
// sinkRequired set per piece rather than per requirement — only the first N
// pieces of a row carry the supervisor's sink. The polish-less branch below
// stays because admin/fix-cascade replays route sheets for rows created under
// the old rules, and those really do have polishRequired false.

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
