// PUT /api/office/commercial/design-codes/[design]
//     { code?, shade?, shadeConfirmed?, notes? } → the row (upsert)
//
// The design is the key, as stock spells it (URL-encoded in the path; Next
// hands it over decoded). Only the fields the body names change
// (design-rules.designCodePatch), so a save
// of the code alone cannot clear a confirmed shade. A code already on another
// design is answered 409 with that design's name — the column is unique
// because the code is what the customer's paperwork identifies a design by,
// and two designs under one code would make an export line ambiguous.
//
// THE LOOKUP IS CASE-BLIND. Every reader of the master matches the design
// trimmed and case-insensitively (design-rules.findDesignRow, the seed, the
// stock picker's de-dup), so a PUT for "CARRARA ROYALE" must land on the row
// stored as "Carrara Royale" — a case-sensitive upsert on the primary key
// would create a second master row that every reader then finds first or
// second by accident, with two codes and two shades for one design. So: find
// the stored spelling first and update THAT row; create only when none exists.
//
// Gates "plan": the shade drives the queue's cleaning hours and the code the
// documents, so an admin or the Commercial Manager owns both (answer 20).
import { commercialGate, actorStamp } from "@/lib/commercial/access";
import { json, deny, fail, handle, readBody, plain } from "@/lib/commercial/http";
import { designCodePatch, normaliseDesignName, guessShade } from "@/lib/commercial/design-rules";
import { db, isUniqueViolation } from "../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ design: string }> };

/** The master row whose design matches `design` trimmed and case-blind, or
 *  null — the stored spelling is the one every write must key on. */
async function findStored(design: string): Promise<{ design: string } | null> {
  return db.commercialDesignCode.findFirst({ where: { design: { equals: design, mode: "insensitive" } }, select: { design: true } });
}

export async function PUT(req: Request, { params }: Ctx) {
  const g = await commercialGate("plan");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { design: raw } = await params;
    const design = normaliseDesignName(raw ?? "");
    if (!design) fail(400, "Which design?");
    const body = await readBody<Record<string, unknown>>(req);
    const parsed = designCodePatch(body);
    if (!parsed.ok) fail(400, parsed.reason);
    const stamp = actorStamp(g.user);

    const stored = await findStored(design);
    const key = stored?.design ?? design;
    if (parsed.patch.code) {
      const clash = await db.commercialDesignCode.findUnique({ where: { code: parsed.patch.code }, select: { design: true } });
      if (clash && clash.design.trim().toLowerCase() !== key.trim().toLowerCase()) fail(409, `Code ${parsed.patch.code} is already ${clash.design}'s.`);
    }
    try {
      const row = stored
        ? await db.commercialDesignCode.update({ where: { design: key }, data: { ...parsed.patch, updatedById: stamp.id } })
        // A row created by hand gets the same first guess the seed would give
        // it, unless the body already says.
        : await db.commercialDesignCode.create({ data: { design, shade: guessShade(design), shadeConfirmed: false, ...parsed.patch, updatedById: stamp.id } });
      return json(plain(row));
    } catch (e) {
      if (isUniqueViolation(e)) fail(409, `Code ${parsed.patch.code ?? ""} is already another design's.`);
      throw e;
    }
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await commercialGate("plan");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const { design: raw } = await params;
    const design = normaliseDesignName(raw ?? "");
    if (!design) fail(400, "Which design?");
    // Same case-blind lookup as PUT: delete the row as it is stored.
    const stored = await findStored(design);
    if (!stored) fail(404, "No master row for that design");
    await db.commercialDesignCode.delete({ where: { design: stored.design } });
    return json({ deleted: true, design: stored.design });
  });
}
