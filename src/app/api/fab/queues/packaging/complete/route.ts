import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const { pieceIds, packageCode, remarks } = await req.json();
  if (!pieceIds?.length) return Response.json({ error: "pieceIds required" }, { status: 400 });

  // A user-supplied code that already exists is a collision the operator can
  // fix; without this it surfaced as a raw 500 from the unique constraint.
  // The generated fallback carries a random suffix because Date.now() alone
  // collides when two packages are closed in the same millisecond.
  const code = packageCode || `PKG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const result = await prisma.$transaction(async (tx) => {
    // CLAIM THE PIECES FIRST, CONDITIONALLY. This was a count() before the
    // transaction, which two concurrent submits both passed — each then created
    // a package, and the same piece ended up in two of them. Filtering the write
    // on "not already PACKAGED" makes the database pick the winner: whoever
    // updates 0 rows never had the pieces.
    const claimed = await tx.fabPiece.updateMany({
      where: { id: { in: pieceIds }, status: { not: "PACKAGED" } },
      data:  { status: "PACKAGED" },
    });
    if (claimed.count !== pieceIds.length) {
      // Some piece was packaged by someone else in the meantime. Roll the whole
      // thing back rather than shipping a partial package.
      throw new AlreadyPackaged(pieceIds.length - claimed.count);
    }

    const p = await tx.fabPackage.create({
      data: {
        packageCode: code,
        remarks: remarks ?? null,
        pieces: { create: pieceIds.map((pid: string) => ({ pieceId: pid })) },
      },
    });
    await tx.fabPieceOperation.updateMany({
      where: { pieceId: { in: pieceIds }, operationType: "PACKAGING", isCompleted: false },
      data: { isCompleted: true, completedAt: new Date() },
    });
    return p;
  }).catch((e: unknown) => {
    if (e instanceof AlreadyPackaged) return e;
    if (typeof e === "object" && e && (e as { code?: string }).code === "P2002") return new DuplicateCode();
    throw e;
  });

  if (result instanceof AlreadyPackaged)
    return Response.json({ error: `${result.n} piece(s) already packaged — refresh and try again` }, { status: 409 });
  if (result instanceof DuplicateCode)
    return Response.json({ error: `Package code "${code}" is already used — choose another` }, { status: 409 });

  return Response.json({ success: true, packageCode: result.packageCode });
}

class AlreadyPackaged { constructor(readonly n: number) {} }
class DuplicateCode {}
