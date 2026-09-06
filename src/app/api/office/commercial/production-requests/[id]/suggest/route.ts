// GET /api/office/commercial/production-requests/[id]/suggest
//   → { received, since, design, thickness, batches }
//
// "Has production actually run?" — the hint beside each queued row. The owner
// chose to mark PRODUCED by hand (open question 15) with the ERP showing how
// many slabs of that design and thickness finished goods has received since the
// request was raised.
//
// Only source = QC_AUTOLINK counts: a bulk upload or a slab typed in on
// /slab-intake is old stock being recorded, not production running today, and
// counting either would tell the planner the run is done when it has not
// started. Design is matched through the alias table in both directions (the
// request may name the canonical, the slab a variant) and thickness through
// canonThickness, because finished goods holds '20mm', '2cm' and '2 cm' alike.
import { prisma } from "@/lib/prisma";
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain, paramId } from "@/lib/commercial/http";
import { suggestMatches, designVariants } from "@/lib/commercial/production-rules";
import { loadRequest } from "../../_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const id = await paramId(params);
    const row = await loadRequest(id);
    const design = String(row.design ?? "");
    const thickness = String(row.thickness ?? "");
    const raisedAt = new Date(row.raisedAt as Date);

    const aliasRows: Array<{ variant: string; canonical: string }> = await db.designAlias.findMany({ select: { variant: true, canonical: true } });
    const aliases: Record<string, string> = {};
    for (const a of aliasRows) aliases[a.variant] = a.canonical;
    const variants = designVariants(aliases, design);

    // Case-insensitive per spelling: `in` is case-sensitive in Postgres and
    // finished goods has both "Carrara Royale" and "CARRARA ROYALE".
    const candidates: Array<{ source: string | null; design: string | null; slabThickness: string | null; firstSeenAt: Date; batchKey: string | null }> =
      await db.finishedSlab.findMany({
        where: {
          source: "QC_AUTOLINK",
          firstSeenAt: { gte: raisedAt },
          OR: variants.map((v) => ({ design: { equals: v, mode: "insensitive" } })),
        },
        select: { source: true, design: true, slabThickness: true, firstSeenAt: true, batchKey: true },
        take: 5000,
      });

    const matches = suggestMatches(candidates, { design, thickness, raisedAt }, aliases);
    const batches = Array.from(new Set(matches.map((m) => m.batchKey).filter((b): b is string => !!b))).sort();
    return json(plain({ requestId: id, received: matches.length, since: raisedAt, design, thickness, batches }));
  });
}
