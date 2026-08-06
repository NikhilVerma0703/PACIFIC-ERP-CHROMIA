import { prisma } from "@/lib/prisma";
import { fabGate } from "@/lib/fab/access";

// Declared before use. They were below the handler, which works only because
// the handler runs after module evaluation — a detail nobody should have to
// know to read this file.
class AlreadyPackaged { constructor(readonly n: number) {} }
class MissingPieces { constructor(readonly n: number) {} }
class DuplicateCode {}

export async function POST(req: Request) {
  const g = await fabGate("EMPLOYEE");
  if (!g.ok) return Response.json({ error: "Not authorized" }, { status: g.status });

  const body = await req.json().catch(() => null);
  const { pieceIds: rawIds, packageCode, remarks } = body ?? {};

  // Array.isArray, not `?.length`: a bare string passes a length check and then
  // reaches Prisma as `{ in: "abc" }`, which is a 500 rather than a 400.
  if (!Array.isArray(rawIds) || rawIds.length === 0 || !rawIds.every((x) => typeof x === "string" && x))
    return Response.json({ error: "pieceIds must be a non-empty array of ids" }, { status: 400 });

  // Deduplicated, because the claim below compares a row COUNT against this
  // length — the same id twice would look like a piece someone else had taken.
  const pieceIds: string[] = [...new Set(rawIds as string[])];

  if (packageCode != null && typeof packageCode !== "string")
    return Response.json({ error: "packageCode must be text" }, { status: 400 });

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
      // Roll the whole thing back rather than shipping a partial package — but
      // say WHICH failure it was. A short count means either "someone packaged
      // it first" or "that id does not exist", and telling an operator to
      // refresh when the real problem is a bad id sends them round a loop.
      const exists = await tx.fabPiece.count({ where: { id: { in: pieceIds } } });
      if (exists < pieceIds.length) throw new MissingPieces(pieceIds.length - exists);
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
    if (e instanceof AlreadyPackaged || e instanceof MissingPieces) return e;
    if (typeof e === "object" && e && (e as { code?: string }).code === "P2002") return new DuplicateCode();
    throw e;
  });

  if (result instanceof AlreadyPackaged)
    return Response.json({ error: `${result.n} piece(s) already packaged — refresh and try again` }, { status: 409 });
  if (result instanceof MissingPieces)
    return Response.json({ error: `${result.n} piece(s) no longer exist — refresh the queue` }, { status: 409 });
  if (result instanceof DuplicateCode)
    return Response.json({ error: `Package code "${code}" is already used — choose another` }, { status: 409 });

  return Response.json({ success: true, packageCode: result.packageCode });
}
