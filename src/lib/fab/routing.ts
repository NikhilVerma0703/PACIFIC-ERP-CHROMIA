// Pure routing rules for a fabrication piece — no database, no Prisma, no I/O.
//
// Split out so `node --test` can reach them, and so the queues and the undo
// path cannot drift: the same predicate that decides a piece is ready to pack
// must be the one the polishing station consults, or a piece becomes packable
// at one screen and not at another. It was written out by hand in three places
// before this file existed.
//
// A piece routes through up to five stages. CUTTING and PACKAGING always
// happen; POLISHING, SINK_CUTTING and FABRICATION happen only when the
// requirement asked for them, which is what the `*Required` flags record.

/** What the routing rules need to know about a piece. Deliberately structural,
 *  so both a Prisma row and a test fixture satisfy it. */
export interface PieceRouting {
  polishRequired: boolean;
  polishingCompleted: boolean;
  hasSink: boolean;
  sinkCompleted: boolean;
  fabricationRequired: boolean;
  fabricationCompleted: boolean;
}

/** True when every stage this piece actually needs has been done, so the only
 *  thing left is packing it.
 *
 *  A stage that was never required is not a blocker — `!required || completed`
 *  and not `completed` alone, or a piece with no sink would wait forever for a
 *  sink cut nobody is going to make. */
export function isReadyForPackaging(p: PieceRouting): boolean {
  return (!p.polishRequired      || p.polishingCompleted)
    &&   (!p.hasSink             || p.sinkCompleted)
    &&   (!p.fabricationRequired || p.fabricationCompleted);
}

/** The stages this piece still owes, in route order. Empty means ready to pack.
 *  Used for the "waiting on" text so a supervisor can see WHY a piece is not in
 *  the packaging queue without opening it. */
export function pendingStages(p: PieceRouting): string[] {
  const out: string[] = [];
  if (p.polishRequired      && !p.polishingCompleted)   out.push("POLISHING");
  if (p.hasSink             && !p.sinkCompleted)        out.push("SINK_CUTTING");
  if (p.fabricationRequired && !p.fabricationCompleted) out.push("FABRICATION");
  return out;
}

/** The furthest stage a piece can still claim, from the flags that remain set.
 *
 *  Recomputed rather than assumed, because a fixed per-operation status is
 *  wrong as soon as a piece has more than one stage done: undoing PACKAGING on
 *  a piece that had been polished used to send it to "CUT" and silently lose
 *  the polish. Ordered by how far through the route each stage sits.
 *
 *  CUTTING is NOT handled here. Undoing the cut takes the piece to PENDING
 *  whatever else is ticked, because nothing downstream survives it — the caller
 *  applies that rule. */
export function statusFromFlags(
  p: Pick<PieceRouting, "polishingCompleted" | "sinkCompleted" | "fabricationCompleted">,
): "FABRICATED" | "SINK_CUT" | "POLISHED" | "CUT" {
  if (p.fabricationCompleted) return "FABRICATED";
  if (p.sinkCompleted)        return "SINK_CUT";
  if (p.polishingCompleted)   return "POLISHED";
  return "CUT";
}
