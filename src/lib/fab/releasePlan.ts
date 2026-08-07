// Which slab each piece of a requirement gets cut from, at release time.
// Pure — no database, no Prisma — so `node --test` can reach it, and so the one
// rule that decides where physical work lands is written down once.
//
// A requirement is a piece type and a quantity ("3 of piece 2B"). Its
// allocations say which slabs those pieces come off, and there can be several:
// a CLO plan splits one piece type across slabs to use the material. Release
// used to read `allocations[0].slabId` and stamp it on every piece, so a split
// requirement released entirely onto its first slab — the cutter at the second
// slab was given nothing, and the first was asked for more than it holds.

export interface ReleaseAllocation {
  slabId: string;
  allocatedQuantity: number;
}

export interface ReleasePlanInput {
  /** How many pieces were ordered. */
  quantity: number;
  /** Slab allocations for this requirement, oldest first. */
  allocations: ReleaseAllocation[];
  /** Slab to use for pieces the allocations do not cover — normally the
   *  drawing's default slab. Null when there is none. */
  fallbackSlabId: string | null;
}

export interface ReleasePlan {
  /** One entry per piece to create, in cut order. Length is always the ordered
   *  quantity when the requirement is releasable at all. */
  slabIds: string[];
  /** Pieces the allocations claimed beyond what was ordered. Non-zero means the
   *  allocation data is wrong and someone has to look at it. */
  overAllocatedBy: number;
}

export function buildReleasePlan(input: ReleasePlanInput): ReleasePlan {
  const { quantity, allocations, fallbackSlabId } = input;

  const slabIds: string[] = [];
  for (const alloc of allocations) {
    // A negative or fractional allocatedQuantity would otherwise loop oddly or
    // forever; floor it at zero and to whole pieces.
    const n = Math.max(0, Math.floor(alloc.allocatedQuantity));
    for (let i = 0; i < n; i++) slabIds.push(alloc.slabId);
  }

  // Anything the allocations do not cover falls back — that is the ordinary
  // case when a drawing default is carrying the whole requirement, in which
  // case there are no allocations at all.
  const fallback = fallbackSlabId ?? allocations[0]?.slabId ?? null;
  while (slabIds.length < quantity && fallback) slabIds.push(fallback);

  // Over-allocation is a data problem, not an instruction to overproduce: the
  // order is for `quantity` pieces and that is what gets cut, labelled and
  // packed. The excess is dropped and counted so it can be reported.
  const overAllocatedBy = Math.max(0, slabIds.length - quantity);
  if (overAllocatedBy > 0) slabIds.length = Math.max(0, quantity);

  return { slabIds, overAllocatedBy };
}
