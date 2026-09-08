// GET /api/office/commercial/design-codes → { items: DesignCodeDto[], total }
//
// The design master (answers 13 and 20): one row per design with the owner's
// item code, the shade the planning queue sequences by, and whether somebody
// has confirmed that shade or it is still the first guess from the name.
// Anyone who may view reads it — the code prints on documents Commercial
// prepares and the shade shows on the queue they can see.
import { commercialGate } from "@/lib/commercial/access";
import { json, deny, handle, plain, str } from "@/lib/commercial/http";
import { db } from "./_lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const g = await commercialGate("view");
  if (!g.ok) return deny(g);
  return handle(async () => {
    const q = str(new URL(req.url).searchParams.get("q"));
    const where = q
      ? { OR: [{ design: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] }
      : {};
    const [items, total] = await Promise.all([
      db.commercialDesignCode.findMany({ where, orderBy: { design: "asc" } }),
      db.commercialDesignCode.count({ where }),
    ]);
    return json(plain({ items, total }));
  });
}
